/**
 * 収集データ（data/collected）を Firestore **Emulator** に投入する（ドライラン・統合テスト用）。
 *
 *   # エミュレータを起動した状態で（npm run emulators）
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run import:emulator -- --dry-run
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run import:emulator
 *
 * 本番 Firestore には接続しない（scripts/lib/emulatorGuard.ts で FIRESTORE_EMULATOR_HOST と demo- プロジェクトを強制）。
 *
 * - 書き込み順: locations → products → catalogIndex のシャード → catalogIndex/meta（最後）
 *   meta が書かれるまでアプリは新しい索引を使わない（途中で止まっても中途半端な索引を読まない）
 * - WriteBatch（既定 400 件）で set()。ID は公式の識別子から決まるため、再実行しても二重登録にならない
 * - チェックポイント（書き込んだ内容のハッシュ）で、変わっていないドキュメントは書き直さない（書き込み件数を節約）
 * - --max-writes で 1 回の書き込み件数の上限（無料枠 20,000 件/日に合わせて分割投入）。上限に達したら停止し、次回続きから
 * - 一時的なエラー（UNAVAILABLE 等）は指数バックオフで再試行。RESOURCE_EXHAUSTED（上限超過）は即停止
 * - 最初に、既存の架空のモックデータ（src/data/mock.ts の ID の products / locations）に isSample: true を付ける。
 *   削除はしない。ID を指定して読むだけ（最大 18 読み取り）で、全件は読まない。isSample が付いたドキュメントは
 *   一覧・検索・詳細・「この店で見つけた」の対象外になる
 *
 * オプション: --dry-run / --batch-size=400 / --max-writes=15000 / --no-checkpoint / --reset-checkpoint / --no-mark-samples
 */
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertEmulatorOnly } from "./lib/emulatorGuard";

export interface ImportOptions {
  dryRun?: boolean;
  batchSize?: number;
  maxWrites?: number;
  useCheckpoint?: boolean;
  resetCheckpoint?: boolean;
  dataDir?: string;
  checkpointPath?: string;
  /** 既存のモックデータに isSample: true を付ける（既定 true） */
  markSamples?: boolean;
  /** 再試行の初回待ち時間（ミリ秒）。テストで短くするため */
  retryBaseMs?: number;
  log?: (message: string) => void;
}

export interface ImportResult {
  projectId: string;
  dryRun: boolean;
  converted: { products: number; locations: number; indexShards: number };
  duplicates: { products: string[]; locations: string[] };
  planned: number;
  skippedUnchanged: number;
  written: number;
  batches: number;
  retries: number;
  failures: { batch: number; error: string }[];
  stoppedByWriteLimit: boolean;
  metaWritten: boolean;
  /** isSample を付ける対象のモック ID の数 / 実際に付けた件数（既に付いている・存在しないものは書かない） */
  samples: { candidates: number; marked: number; alreadyMarked: number; missing: number };
  durationMs: number;
}

const RETRYABLE = new Set([4, 10, 13, 14]); // DEADLINE_EXCEEDED, ABORTED, INTERNAL, UNAVAILABLE
const RESOURCE_EXHAUSTED = 8;
const MAX_RETRIES = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runImport(options: ImportOptions = {}): Promise<ImportResult> {
  const guard = assertEmulatorOnly(); // firebase-admin を読み込む前に必ず確認する
  const started = Date.now();
  const log = options.log ?? ((m: string) => console.log(m));
  const batchSize = Math.min(Math.max(options.batchSize ?? 400, 1), 500);
  const maxWrites = options.maxWrites ?? Number.POSITIVE_INFINITY;
  const useCheckpoint = options.useCheckpoint ?? true;
  const root = path.resolve(__dirname, "..");
  const dataDir = options.dataDir ?? path.join(root, "data", "collected");
  const checkpointPath =
    options.checkpointPath ?? path.join(root, ".catalog-build", `import-checkpoint-${guard.projectId}.json`);

  // 変換（Firestore には依存しない）
  const { convertCollected, contentHash } = await import("../src/lib/catalog/firestoreDocs");
  const [rawProducts, rawLocations] = await Promise.all([
    readFile(path.join(dataDir, "products.json"), "utf8").then(JSON.parse),
    readFile(path.join(dataDir, "locations.json"), "utf8").then(JSON.parse),
  ]);
  const converted = convertCollected(rawProducts, rawLocations);
  const docs = [
    ...converted.locationDocs,
    ...converted.productDocs,
    ...converted.indexShardDocs,
    converted.indexMetaDoc, // 必ず最後
  ];

  // チェックポイント
  if (options.resetCheckpoint) await rm(checkpointPath, { force: true });
  let checkpoint: Record<string, string> = {};
  if (useCheckpoint) {
    try {
      checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    } catch {
      checkpoint = {};
    }
  }
  const keyOf = (d: { collection: string; id: string }) => `${d.collection}/${d.id}`;
  const pending = docs.filter((d) => !useCheckpoint || checkpoint[keyOf(d)] !== contentHash(d.data));

  const result: ImportResult = {
    projectId: guard.projectId,
    dryRun: !!options.dryRun,
    converted: {
      products: converted.products.length,
      locations: converted.locations.length,
      indexShards: converted.indexShardDocs.length,
    },
    duplicates: converted.duplicates,
    planned: docs.length,
    skippedUnchanged: docs.length - pending.length,
    written: 0,
    batches: 0,
    retries: 0,
    failures: [],
    stoppedByWriteLimit: false,
    metaWritten: false,
    samples: { candidates: 0, marked: 0, alreadyMarked: 0, missing: 0 },
    durationMs: 0,
  };

  // 既存のモックデータの ID（本番の products / locations に入っている架空のデータ）
  const markSamples = options.markSamples ?? true;
  const sampleRefs: { collection: string; id: string }[] = [];
  if (markSamples) {
    const { createMockDatabase } = await import("../src/data/mock");
    const mock = createMockDatabase(new Date());
    sampleRefs.push(
      ...mock.products.map((p) => ({ collection: "products", id: p.id })),
      ...mock.locations.map((l) => ({ collection: "locations", id: l.id })),
    );
    const realIds = new Set(docs.map(keyOf));
    const clash = sampleRefs.filter((r) => realIds.has(keyOf(r)));
    if (clash.length) throw new Error(`モックの ID が実データの ID と重複しています: ${clash.map(keyOf).join(", ")}`);
    result.samples.candidates = sampleRefs.length;
  }

  log(
    `[${guard.projectId} @ ${guard.firestoreHost}] 変換: 商品 ${converted.products.length} / 店舗 ${converted.locations.length} / ` +
      `索引シャード ${converted.indexShardDocs.length}。書き込み予定 ${pending.length} 件（変更なしでスキップ ${result.skippedUnchanged} 件）`,
  );
  if (options.dryRun) {
    if (markSamples) log(`モックデータへの isSample 付与: 最大 ${sampleRefs.length} 件（読み取り ${sampleRefs.length} 件）`);
    result.batches = Math.ceil(Math.min(pending.length, maxWrites) / batchSize);
    result.stoppedByWriteLimit = pending.length > maxWrites;
    result.durationMs = Date.now() - started;
    log(`ドライラン：書き込みは行っていません（${result.batches} バッチ相当）`);
    return result;
  }

  const { getAdminFirestore } = await import("../src/lib/firebase/adminApp");
  const db = getAdminFirestore();

  const saveCheckpoint = async () => {
    if (!useCheckpoint) return;
    await mkdir(path.dirname(checkpointPath), { recursive: true });
    const tmp = `${checkpointPath}.tmp`;
    await writeFile(tmp, JSON.stringify(checkpoint));
    await rename(tmp, checkpointPath);
  };

  /** 1 バッチを書き込む（一時的なエラーは指数バックオフで再試行）。失敗したら false */
  const commit = async (chunk: typeof pending): Promise<boolean> => {
    const batchNo = result.batches + 1;
    for (let attempt = 0; ; attempt++) {
      try {
        const batch = db.batch();
        for (const d of chunk) batch.set(db.collection(d.collection).doc(d.id), d.data);
        await batch.commit();
        break;
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code === RESOURCE_EXHAUSTED || !RETRYABLE.has(code ?? -1) || attempt >= MAX_RETRIES) {
          result.failures.push({ batch: batchNo, error: `${code ?? ""} ${(error as Error).message}`.trim() });
          log(`バッチ ${batchNo} で停止: ${(error as Error).message}`);
          return false;
        }
        result.retries += 1;
        const wait = (options.retryBaseMs ?? 2000) * 2 ** attempt;
        log(`バッチ ${batchNo} を再試行 ${attempt + 1}/${MAX_RETRIES}（${wait}ms 後）: ${(error as Error).message}`);
        await sleep(wait);
      }
    }
    result.batches = batchNo;
    result.written += chunk.length;
    for (const d of chunk) {
      checkpoint[keyOf(d)] = contentHash(d.data);
      if (d.collection === "catalogIndex" && d.id === "meta") result.metaWritten = true;
    }
    await saveCheckpoint();
    if (batchNo % 10 === 0) log(`  ${result.written} / ${pending.length} 件`);
    return true;
  };

  // 実データより先に、既存のモックデータを isSample: true にする（削除しない）
  if (sampleRefs.length) {
    const snaps = await db.getAll(...sampleRefs.map((r) => db.collection(r.collection).doc(r.id)));
    const batch = db.batch();
    for (const snap of snaps) {
      if (!snap.exists) result.samples.missing += 1;
      else if (snap.get("isSample") === true) result.samples.alreadyMarked += 1;
      else {
        batch.update(snap.ref, { isSample: true });
        result.samples.marked += 1;
      }
    }
    if (result.samples.marked > 0) await batch.commit();
    log(
      `モックデータに isSample を付与: ${result.samples.marked} 件（付与済み ${result.samples.alreadyMarked} / 存在しない ${result.samples.missing}）`,
    );
  }

  const isMeta = (d: { collection: string; id: string }) => d.collection === "catalogIndex" && d.id === "meta";
  const body = pending.filter((d) => !isMeta(d));
  const meta = pending.find(isMeta);

  let completed = true;
  for (let i = 0; i < body.length; ) {
    const remaining = maxWrites - result.written;
    if (remaining <= 0) {
      result.stoppedByWriteLimit = true;
      completed = false;
      break;
    }
    const chunk = body.slice(i, i + Math.min(batchSize, remaining));
    if (!(await commit(chunk))) {
      completed = false;
      break;
    }
    i += chunk.length;
  }
  // meta はそれ以外がすべて書けた場合だけ、最後に単独で書く（アプリが新しい索引に切り替わる）
  if (completed && meta) {
    if (result.written < maxWrites) await commit([meta]);
    else result.stoppedByWriteLimit = true;
  }

  result.durationMs = Date.now() - started;
  log(
    `完了: 書き込み ${result.written} 件 / ${result.batches} バッチ / 再試行 ${result.retries} 回 / 失敗 ${result.failures.length} 件` +
      (result.stoppedByWriteLimit ? "（書き込み上限で停止。次回は続きから）" : "") +
      ` / ${(result.durationMs / 1000).toFixed(1)} 秒`,
  );
  return result;
}

function parseArgs(argv: string[]): ImportOptions {
  const opt: ImportOptions = {};
  for (const a of argv) {
    if (a === "--dry-run") opt.dryRun = true;
    else if (a === "--no-checkpoint") opt.useCheckpoint = false;
    else if (a === "--reset-checkpoint") opt.resetCheckpoint = true;
    else if (a === "--no-mark-samples") opt.markSamples = false;
    else if (a.startsWith("--batch-size=")) opt.batchSize = Number(a.split("=")[1]);
    else if (a.startsWith("--max-writes=")) opt.maxWrites = Number(a.split("=")[1]);
    else throw new Error(`不明なオプション: ${a}`);
  }
  return opt;
}

if (require.main === module) {
  runImport(parseArgs(process.argv.slice(2)))
    .then((r) => {
      console.log(JSON.stringify({ ...r, duplicates: { products: r.duplicates.products.length, locations: r.duplicates.locations.length } }, null, 1));
      if (r.failures.length) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`✗ ${(error as Error).message}`);
      process.exit(1);
    });
}

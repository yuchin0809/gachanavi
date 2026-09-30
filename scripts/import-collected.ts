/**
 * 収集データ（data/collected）を Firestore に投入する。
 *
 * ■ エミュレータ（既定。ドライラン・統合テスト用）
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run import:emulator -- --dry-run
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run import:emulator
 *   scripts/lib/emulatorGuard.ts がローカルのエミュレータと demo- プロジェクトを強制する（本番には接続しない）。
 *
 * ■ 本番（--target=production。scripts/lib/productionGuard.ts の条件をすべて満たす場合だけ）
 *   1) ドライラン（書き込みなし。既存 ID の確認で読み取りあり）→ 確認コードが表示される
 *      npx tsx scripts/import-collected.ts --target=production --project=gachanavi-21ee8 --max-writes=15000 --dry-run
 *   2) 書き込み（ドライランの確認コードが必要）
 *      npx tsx scripts/import-collected.ts --target=production --project=gachanavi-21ee8 --max-writes=15000 --confirm-plan=<コード>
 *   本番では既存ドキュメントを上書きしない（create() で書き込み、同じ ID があれば失敗して停止する）。
 *
 * 共通の動作:
 * - 最初に既存の架空のモックデータ（src/data/mock.ts の ID の products / locations）に isSample: true を付ける
 *   （削除しない。isSample 以外の項目は変えない）。一覧・検索・詳細・在庫報告の対象外になる
 * - 書き込み順: モックの isSample → locations → products → catalogIndex のシャード → catalogIndex/meta（最後）
 *   meta は、全商品・全店舗・全シャードが揃い、件数の確認ができた後にだけ書く。
 *   meta が無い間、アプリは新しい索引を使わない（途中で止まっても中途半端な索引を読まない）
 * - --max-writes は isSample の更新と meta を含む書き込み件数の上限（超えない）。上限で停止し、次回は続きから
 * - 再開（--resume=firestore。本番では必須）: Firestore の既存 ID を一覧し（既存ドキュメント数だけ読み取り）、
 *   未投入の ID だけを書く。作業環境のローカル記録には依存しない。
 *   既存の catalogIndex が今回の内容と異なる場合は、何も書かずに停止する（既存の索引を壊さない）
 * - 再開（--resume=checkpoint。エミュレータの既定）: ローカルのチェックポイント（内容のハッシュ）で判定
 * - 一時的なエラー（UNAVAILABLE 等）は指数バックオフで再試行。RESOURCE_EXHAUSTED（上限超過）は即停止
 * - placements / stockReports / users には一切書き込まない
 *
 * オプション: --target=emulator|production / --project= / --confirm-plan= / --dry-run / --offline（ドライランで接続しない）
 *   / --batch-size=400 / --max-writes=15000 / --resume=firestore|checkpoint / --no-checkpoint / --reset-checkpoint / --no-mark-samples
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertEmulatorOnly } from "./lib/emulatorGuard";
import { PRODUCTION_MAX_WRITES_LIMIT, PRODUCTION_PROJECT_ID, assertProductionTarget } from "./lib/productionGuard";

export type ImportTarget = "emulator" | "production";

export interface ImportOptions {
  /** 投入先（既定: emulator） */
  target?: ImportTarget;
  /** 本番: 投入先プロジェクト ID の確認（PRODUCTION_PROJECT_ID と完全一致が必要） */
  confirmProject?: string;
  /** 本番の書き込み: ドライランで表示された確認コード */
  confirmPlan?: string;
  dryRun?: boolean;
  /** ドライランで Firestore に接続しない（既存 ID を確認しないため、件数は最大値） */
  offline?: boolean;
  batchSize?: number;
  maxWrites?: number;
  /** 再開の判定方法（本番は firestore 固定。エミュレータの既定は checkpoint） */
  resume?: "firestore" | "checkpoint";
  /** 書き込み方法（本番は create 固定 = 既存ドキュメントを上書きしない。エミュレータの既定は set） */
  writeMode?: "create" | "set";
  useCheckpoint?: boolean;
  resetCheckpoint?: boolean;
  /** 既存のモックデータに isSample: true を付ける（既定 true） */
  markSamples?: boolean;
  dataDir?: string;
  checkpointPath?: string;
  /** 再試行の初回待ち時間（ミリ秒）。テストで短くするため */
  retryBaseMs?: number;
  log?: (message: string) => void;
}

export interface ImportResult {
  target: ImportTarget;
  projectId: string;
  dryRun: boolean;
  /** 投入内容の確認コード（本番の書き込みで --confirm-plan= に指定する） */
  planCode: string;
  converted: { products: number; locations: number; indexShards: number };
  duplicates: { products: string[]; locations: string[] };
  /** 投入対象のドキュメント数（店舗 + 商品 + 索引シャード + meta） */
  planned: number;
  /** チェックポイントで変更なしと判定してスキップした件数（resume=checkpoint） */
  skippedUnchanged: number;
  /** Firestore に既に存在したためスキップした件数（resume=firestore。上書きしない） */
  skippedExisting: number;
  /** 今回必要な書き込み件数（isSample の更新・meta を含む） */
  pendingWrites: number;
  /** 書き込んだ件数（isSample の更新・meta を含む。ドライランでは 0） */
  written: number;
  /** 今回の上限（--max-writes）で書き込む予定の件数 */
  plannedThisRun: number;
  batches: number;
  retries: number;
  failures: { batch: number; error: string }[];
  stoppedByWriteLimit: boolean;
  metaWritten: boolean;
  /** 索引の meta が有効（今回書いた、または既に同じ内容で存在） */
  indexComplete: boolean;
  /** isSample を付ける対象のモック ID の数 / 付けた件数（既に付いている・存在しないものは書かない） */
  samples: { candidates: number; marked: number; alreadyMarked: number; missing: number };
  /** 読み取り件数（目安）：既存 ID の一覧・モックの確認・既存の索引の確認・件数の確認 */
  reads: { existingIds: number; samples: number; index: number; verify: number };
  durationMs: number;
}

/** 既存の catalogIndex が今回の投入内容と異なる（上書きせずに停止する） */
export class IndexConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexConflictError";
  }
}

const RETRYABLE = new Set([4, 10, 13, 14]); // DEADLINE_EXCEEDED, ABORTED, INTERNAL, UNAVAILABLE
const ALREADY_EXISTS = 6;
const RESOURCE_EXHAUSTED = 8;
const MAX_RETRIES = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** キーの順序に依存しない JSON（Firestore から読み戻した値と比べるため） */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

type DocRef = { collection: string; id: string };
type WriteOp =
  | { kind: "sample"; collection: string; id: string }
  | { kind: "doc"; collection: string; id: string; data: Record<string, unknown> };

export async function runImport(options: ImportOptions = {}): Promise<ImportResult> {
  const target: ImportTarget = options.target ?? "emulator";
  // firebase-admin を読み込む前に必ず接続先を確認する
  const guard = target === "production" ? assertProductionTarget(options.confirmProject) : assertEmulatorOnly();
  const production = target === "production";
  const started = Date.now();
  const log = options.log ?? ((m: string) => console.log(m));
  const batchSize = Math.min(Math.max(options.batchSize ?? 400, 1), 500);
  const maxWrites = options.maxWrites ?? Number.POSITIVE_INFINITY;
  const resume = production ? "firestore" : (options.resume ?? "checkpoint");
  const writeMode: "create" | "set" = production ? "create" : (options.writeMode ?? "set");
  const useCheckpoint = resume === "checkpoint" && (options.useCheckpoint ?? true);
  const connectForPlan = resume === "firestore" && !(options.dryRun && options.offline);

  if (production) {
    if (!Number.isInteger(maxWrites) || maxWrites < 1 || maxWrites > PRODUCTION_MAX_WRITES_LIMIT) {
      throw new Error(`本番投入では --max-writes=1〜${PRODUCTION_MAX_WRITES_LIMIT} の指定が必要です`);
    }
    if (options.resume === "checkpoint" || options.markSamples === false || options.writeMode === "set") {
      throw new Error("本番投入では --resume=checkpoint / --no-mark-samples / 上書き（set）は使えません");
    }
  }

  const root = path.resolve(__dirname, "..");
  const dataDir = options.dataDir ?? path.join(root, "data", "collected");
  const checkpointPath =
    options.checkpointPath ?? path.join(root, ".catalog-build", `import-checkpoint-${guard.projectId}.json`);

  // 変換（Firestore には依存しない）
  const { convertCollected, contentHash, IMPORT_BATCH } = await import("../src/lib/catalog/firestoreDocs");
  const { CATALOG_COLLECTION } = await import("../src/lib/catalog/index-format");
  const [rawProducts, rawLocations] = await Promise.all([
    readFile(path.join(dataDir, "products.json"), "utf8").then(JSON.parse),
    readFile(path.join(dataDir, "locations.json"), "utf8").then(JSON.parse),
  ]);
  const converted = convertCollected(rawProducts, rawLocations);
  const bodyDocs = [...converted.locationDocs, ...converted.productDocs, ...converted.indexShardDocs];
  const metaDoc = converted.indexMetaDoc;
  const allDocs = [...bodyDocs, metaDoc];
  const keyOf = (d: DocRef) => `${d.collection}/${d.id}`;

  // 既存のモックデータの ID（本番の products / locations に入っている架空のデータ）
  const markSamples = options.markSamples ?? true;
  const sampleRefs: DocRef[] = [];
  if (markSamples) {
    const { createMockDatabase } = await import("../src/data/mock");
    const mock = createMockDatabase(new Date());
    sampleRefs.push(
      ...mock.products.map((p) => ({ collection: "products", id: p.id })),
      ...mock.locations.map((l) => ({ collection: "locations", id: l.id })),
    );
    const realIds = new Set(allDocs.map(keyOf));
    const clash = sampleRefs.filter((r) => realIds.has(keyOf(r)));
    if (clash.length) throw new Error(`モックの ID が実データの ID と重複しています: ${clash.map(keyOf).join(", ")}`);
  }

  // 投入内容の確認コード（データ・投入先・モックの ID から決まる。内容が同じなら何度実行しても同じ）
  const planCode = contentHash([
    guard.projectId,
    IMPORT_BATCH,
    allDocs.map((d) => [keyOf(d), contentHash(d.data)]),
    sampleRefs.map(keyOf),
  ]).slice(0, 12);
  if (production && !options.dryRun && options.confirmPlan !== planCode) {
    throw new Error(
      "本番への書き込みには、先にドライラン（--dry-run）で表示される確認コードを --confirm-plan= に指定してください" +
        (options.confirmPlan ? "（指定されたコードは現在の投入内容と一致しません）" : ""),
    );
  }

  const result: ImportResult = {
    target,
    projectId: guard.projectId,
    dryRun: !!options.dryRun,
    planCode,
    converted: {
      products: converted.products.length,
      locations: converted.locations.length,
      indexShards: converted.indexShardDocs.length,
    },
    duplicates: converted.duplicates,
    planned: allDocs.length,
    skippedUnchanged: 0,
    skippedExisting: 0,
    pendingWrites: 0,
    written: 0,
    plannedThisRun: 0,
    batches: 0,
    retries: 0,
    failures: [],
    stoppedByWriteLimit: false,
    metaWritten: false,
    indexComplete: false,
    samples: { candidates: sampleRefs.length, marked: 0, alreadyMarked: 0, missing: 0 },
    reads: { existingIds: 0, samples: 0, index: 0, verify: 0 },
    durationMs: 0,
  };

  const { getAdminFirestore } = await import("../src/lib/firebase/adminApp");
  // 接続しないドライラン（チェックポイント方式・--offline）では firebase-admin を初期化しない
  const db = !options.dryRun || connectForPlan ? getAdminFirestore() : null;
  if (db && production) {
    // 初期化された接続先がすべて本番プロジェクトであることを確認する
    const { getApps } = await import("firebase-admin/app");
    const projects = getApps().map((a) => a.options.projectId);
    if (projects.length === 0 || projects.some((p) => p !== PRODUCTION_PROJECT_ID)) {
      throw new Error(`接続先のプロジェクトが ${PRODUCTION_PROJECT_ID} ではありません: ${projects.join(", ")}`);
    }
  }

  /* ---------- 今回必要な書き込みを決める ---------- */

  let pendingBody = bodyDocs;
  let metaPending = true;
  let checkpoint: Record<string, string> = {};

  if (resume === "checkpoint") {
    if (options.resetCheckpoint) await rm(checkpointPath, { force: true });
    if (useCheckpoint) {
      try {
        checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
      } catch {
        checkpoint = {};
      }
    }
    const changed = (d: (typeof allDocs)[number]) => !useCheckpoint || checkpoint[keyOf(d)] !== contentHash(d.data);
    pendingBody = bodyDocs.filter(changed);
    metaPending = changed(metaDoc);
    result.skippedUnchanged = allDocs.length - pendingBody.length - (metaPending ? 1 : 0);
  } else if (db) {
    // Firestore の既存 ID（既存ドキュメント数だけ読み取り）。既存のドキュメントは上書きしない
    const existing = new Set<string>();
    for (const collection of ["locations", "products", CATALOG_COLLECTION]) {
      const refs = await db.collection(collection).listDocuments();
      result.reads.existingIds += refs.length;
      for (const ref of refs) existing.add(`${collection}/${ref.id}`);
    }
    // 既存の索引（シャード・meta）は内容を確認し、今回と異なれば何も書かずに停止する
    const indexDocs = allDocs.filter((d) => d.collection === CATALOG_COLLECTION && existing.has(keyOf(d)));
    if (indexDocs.length > 0) {
      const snaps = await db.getAll(...indexDocs.map((d) => db.collection(d.collection).doc(d.id)));
      result.reads.index = snaps.length;
      const differs = indexDocs.filter((d, i) => stableStringify(snaps[i].data()) !== stableStringify(d.data));
      if (differs.length > 0) {
        throw new IndexConflictError(
          `既存の catalogIndex が今回の投入内容と異なります（${differs.map((d) => d.id).join(", ")}）。既存の索引を壊さないため何も書き込まずに停止しました`,
        );
      }
    }
    const otherIndex = [...existing].filter(
      (k) => k.startsWith(`${CATALOG_COLLECTION}/`) && !allDocs.some((d) => keyOf(d) === k),
    );
    if (otherIndex.length > 0) {
      throw new IndexConflictError(`今回の投入に無い catalogIndex のドキュメントがあります（${otherIndex.join(", ")}）。停止しました`);
    }
    pendingBody = bodyDocs.filter((d) => !existing.has(keyOf(d)));
    metaPending = !existing.has(keyOf(metaDoc));
    result.skippedExisting = allDocs.length - pendingBody.length - (metaPending ? 1 : 0);
  }
  // resume=firestore かつ offline のドライランは、既存 ID を確認しない（すべて未投入とみなした最大値）

  // モックの isSample（ID を指定して読む。存在しない・付与済みは書かない）
  const sampleOps: WriteOp[] = [];
  if (sampleRefs.length > 0) {
    if (db && (!options.dryRun || connectForPlan)) {
      const snaps = await db.getAll(...sampleRefs.map((r) => db.collection(r.collection).doc(r.id)));
      result.reads.samples = snaps.length;
      snaps.forEach((snap, i) => {
        if (!snap.exists) result.samples.missing += 1;
        else if (snap.get("isSample") === true) result.samples.alreadyMarked += 1;
        else sampleOps.push({ kind: "sample", ...sampleRefs[i] });
      });
    } else {
      sampleOps.push(...sampleRefs.map((r) => ({ kind: "sample" as const, ...r }))); // 接続しないドライラン：最大値
    }
  }

  const ops: WriteOp[] = [...sampleOps, ...pendingBody.map((d) => ({ kind: "doc" as const, ...d }))];
  result.pendingWrites = ops.length + (metaPending ? 1 : 0);
  result.indexComplete = !metaPending;
  result.plannedThisRun = Math.min(result.pendingWrites, maxWrites);

  log(
    `[${target}: ${guard.projectId} @ ${guard.firestoreHost}] 変換: 商品 ${converted.products.length} / 店舗 ${converted.locations.length} / ` +
      `索引シャード ${converted.indexShardDocs.length}（投入対象 ${allDocs.length} 件）。` +
      `今回必要な書き込み ${result.pendingWrites} 件（モックの isSample ${sampleOps.length} / 本体 ${pendingBody.length} / meta ${metaPending ? 1 : 0}）、` +
      `スキップ ${result.skippedExisting + result.skippedUnchanged} 件`,
  );

  if (options.dryRun) {
    const todays = result.plannedThisRun;
    result.batches = Math.ceil(Math.min(ops.length, maxWrites) / batchSize) + (metaPending && result.pendingWrites <= maxWrites ? 1 : 0);
    result.stoppedByWriteLimit = result.pendingWrites > maxWrites;
    result.durationMs = Date.now() - started;
    log(
      `ドライラン：書き込みは行っていません。今回の上限で書き込む予定 ${todays} 件（${result.batches} バッチ）` +
        (result.stoppedByWriteLimit ? `、残り ${result.pendingWrites - todays} 件は次回` : "、meta まで完了予定") +
        (connectForPlan ? `。読み取り ${result.reads.existingIds + result.reads.samples + result.reads.index} 件` : "（接続なし・最大値）"),
    );
    log(`確認コード: ${planCode}${production ? `（書き込み時に --confirm-plan=${planCode} を指定）` : ""}`);
    return result;
  }

  /* ---------- 書き込み ---------- */

  const firestore = db!;
  const refOf = (d: DocRef) => firestore.collection(d.collection).doc(d.id);

  const saveCheckpoint = async () => {
    if (!useCheckpoint) return;
    await mkdir(path.dirname(checkpointPath), { recursive: true });
    const tmp = `${checkpointPath}.tmp`;
    await writeFile(tmp, JSON.stringify(checkpoint));
    await rename(tmp, checkpointPath);
  };

  /** 1 バッチを書き込む（一時的なエラーは指数バックオフで再試行）。失敗したら false */
  const commit = async (chunk: WriteOp[]): Promise<boolean> => {
    const batchNo = result.batches + 1;
    for (let attempt = 0; ; attempt++) {
      try {
        const batch = firestore.batch();
        for (const op of chunk) {
          if (op.kind === "sample") batch.update(refOf(op), { isSample: true });
          else if (writeMode === "create") batch.create(refOf(op), op.data);
          else batch.set(refOf(op), op.data);
        }
        await batch.commit();
        break;
      } catch (error) {
        const code = (error as { code?: number }).code;
        // 再試行中の ALREADY_EXISTS：前回の試行が実は成功していた場合（応答だけ失われた）。全件あれば成功とみなす
        if (code === ALREADY_EXISTS && attempt > 0) {
          const snaps = await firestore.getAll(...chunk.map(refOf));
          if (snaps.every((s) => s.exists)) break;
        }
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
    for (const op of chunk) {
      if (op.kind === "sample") result.samples.marked += 1;
      else if (useCheckpoint) checkpoint[keyOf(op)] = contentHash(op.data);
    }
    await saveCheckpoint();
    if (batchNo % 10 === 0) log(`  ${result.written} / ${result.pendingWrites} 件`);
    return true;
  };

  let completed = true;
  for (let i = 0; i < ops.length; ) {
    const remaining = maxWrites - result.written;
    if (remaining <= 0) {
      result.stoppedByWriteLimit = true;
      completed = false;
      break;
    }
    const chunk = ops.slice(i, i + Math.min(batchSize, remaining));
    if (!(await commit(chunk))) {
      completed = false;
      break;
    }
    i += chunk.length;
  }

  // meta は、全商品・全店舗・全シャードが揃ったことを件数で確認してから、最後に単独で書く（アプリが新しい索引に切り替わる）
  if (completed && metaPending) {
    if (result.written >= maxWrites) {
      result.stoppedByWriteLimit = true;
    } else {
      const [products, locations, shards] = await Promise.all([
        firestore.collection("products").where("importBatch", "==", IMPORT_BATCH).count().get(),
        firestore.collection("locations").where("importBatch", "==", IMPORT_BATCH).count().get(),
        firestore.getAll(...converted.indexShardDocs.map(refOf)),
      ]);
      // count() は 1,000 件ごとに 1 読み取り
      result.reads.verify =
        Math.ceil(products.data().count / 1000) + Math.ceil(locations.data().count / 1000) + shards.length;
      const ok =
        products.data().count === converted.products.length &&
        locations.data().count === converted.locations.length &&
        shards.every((s) => s.exists);
      if (!ok) {
        const message = `件数の確認に失敗しました（商品 ${products.data().count}/${converted.products.length}・店舗 ${locations.data().count}/${converted.locations.length}・シャード ${shards.filter((s) => s.exists).length}/${shards.length}）。meta は書き込みません`;
        result.failures.push({ batch: result.batches + 1, error: message });
        log(message);
      } else if (await commit([{ kind: "doc", ...metaDoc }])) {
        result.metaWritten = true;
        result.indexComplete = true;
      }
    }
  }

  result.durationMs = Date.now() - started;
  log(
    `完了: 書き込み ${result.written} 件（上限 ${Number.isFinite(maxWrites) ? maxWrites : "なし"}）/ ${result.batches} バッチ / 再試行 ${result.retries} 回 / 失敗 ${result.failures.length} 件` +
      (result.stoppedByWriteLimit ? "（書き込み上限で停止。次回は同じコマンドで続きから）" : "") +
      (result.indexComplete ? " / 索引 有効" : " / 索引 未完成（meta 未書き込み）") +
      ` / ${(result.durationMs / 1000).toFixed(1)} 秒`,
  );
  return result;
}

function parseArgs(argv: string[]): ImportOptions {
  const opt: ImportOptions = {};
  for (const a of argv) {
    const value = a.includes("=") ? a.slice(a.indexOf("=") + 1) : "";
    if (a === "--dry-run") opt.dryRun = true;
    else if (a === "--offline") opt.offline = true;
    else if (a === "--no-checkpoint") opt.useCheckpoint = false;
    else if (a === "--reset-checkpoint") opt.resetCheckpoint = true;
    else if (a === "--no-mark-samples") opt.markSamples = false;
    else if (a.startsWith("--target=")) {
      if (value !== "emulator" && value !== "production") throw new Error(`--target は emulator / production: ${value}`);
      opt.target = value;
    } else if (a.startsWith("--project=")) opt.confirmProject = value;
    else if (a.startsWith("--confirm-plan=")) opt.confirmPlan = value;
    else if (a.startsWith("--resume=")) {
      if (value !== "firestore" && value !== "checkpoint") throw new Error(`--resume は firestore / checkpoint: ${value}`);
      opt.resume = value;
    } else if (a.startsWith("--batch-size=")) opt.batchSize = Number(value);
    else if (a.startsWith("--max-writes=")) opt.maxWrites = Number(value);
    else throw new Error(`不明なオプション: ${a}`);
  }
  if (opt.target !== "production" && (opt.confirmProject || opt.confirmPlan)) {
    throw new Error("--project= / --confirm-plan= は --target=production と一緒に指定してください");
  }
  return opt;
}

if (require.main === module) {
  Promise.resolve()
    .then(() => runImport(parseArgs(process.argv.slice(2))))
    .then((r) => {
      console.log(JSON.stringify({ ...r, duplicates: { products: r.duplicates.products.length, locations: r.duplicates.locations.length } }, null, 1));
      if (r.failures.length) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`✗ ${(error as Error).message}`);
      process.exit(1);
    });
}

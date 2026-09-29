/**
 * Firestore Emulator での投入処理の統合テスト（本番 Firestore には接続しない）。
 *
 *   npm run test:emulator   （エミュレータを起動して実行・終了後に停止）
 */
import { guard, resetEmulator, emulatorIdToken } from "./helpers";

import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { createMockDatabase } from "../../src/data/mock";
import { type CollectedLocation, type CollectedProduct, toGachaProduct, toLocation } from "../../src/lib/catalog/collected";
import { convertCollected } from "../../src/lib/catalog/firestoreDocs";
import { COLLECTIONS, locationFromDoc, productFromDoc } from "../../src/lib/data/firestore/schema";
import { placementIdOf } from "../../src/lib/data/source";
import { getAdminFirestore } from "../../src/lib/firebase/adminApp";
import { runImport } from "../../scripts/import-collected";

const ROOT = path.resolve(__dirname, "../..");
const CHECKPOINT = path.join(ROOT, ".catalog-build", `import-checkpoint-test-${guard.projectId}.json`);
const db = getAdminFirestore();
const count = async (c: string) => (await db.collection(c).count().get()).data().count;
const quiet = () => {};

let rawProducts: CollectedProduct[];
let rawLocations: CollectedLocation[];

before(async () => {
  assert.equal(guard.projectId.startsWith("demo-"), true);
  await resetEmulator();
  await rm(CHECKPOINT, { force: true });
  rawProducts = JSON.parse(await readFile(path.join(ROOT, "data/collected/products.json"), "utf8"));
  rawLocations = JSON.parse(await readFile(path.join(ROOT, "data/collected/locations.json"), "utf8"));

  // 現在の本番と同じ状態を再現：isSample の付いていないモック（products 10 / locations 8 / placements 34 / stockReports 27 / users 3）
  const mock = createMockDatabase(new Date());
  const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
  const batch = db.batch();
  for (const { id, ...p } of mock.products) batch.set(db.collection("products").doc(id), p);
  for (const { id, ...l } of mock.locations) batch.set(db.collection("locations").doc(id), l);
  for (const u of mock.users) batch.set(db.collection("users").doc(u.id), { displayName: u.displayName, createdAt: ts(u.createdAt) });
  const latest = new Map<string, { status: string; reportedAt: Timestamp; reportId: string }>();
  for (const r of mock.stockReports) {
    const k = placementIdOf(r.productId, r.locationId);
    if (!latest.has(k) || ts(r.reportedAt).toMillis() > latest.get(k)!.reportedAt.toMillis()) {
      latest.set(k, { status: r.status, reportedAt: ts(r.reportedAt), reportId: r.id });
    }
    batch.set(db.collection("stockReports").doc(r.id), {
      productId: r.productId, locationId: r.locationId, placementId: k, userId: r.userId, status: r.status, reportedAt: ts(r.reportedAt),
    });
  }
  for (const pl of mock.placements) {
    batch.set(db.collection("placements").doc(pl.id), {
      productId: pl.productId, locationId: pl.locationId, firstSeenAt: ts(pl.firstSeenAt), latestStock: latest.get(pl.id) ?? null,
    });
  }
  await batch.commit();
});

test("1-3. 変換：23,464 商品・1,796 店舗を Firestore の形式に変換でき、ID 衝突がない", () => {
  const c = convertCollected(rawProducts, rawLocations);
  assert.equal(c.productDocs.length, 23464);
  assert.equal(c.locationDocs.length, 1796);
  assert.deepEqual(c.duplicates, { products: [], locations: [] });
  const ids = [...c.productDocs, ...c.locationDocs].map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[A-Za-z0-9_-]{1,120}$/.test(id)));
  // 既存のモック ID（p-001 / l-001）と衝突しない
  assert.ok(!ids.some((id) => /^[pl]-\d{3}$/.test(id)));
});

test("ドライラン：書き込みを行わない", async () => {
  const r = await runImport({ dryRun: true, checkpointPath: CHECKPOINT, log: quiet });
  assert.equal(r.written, 0);
  assert.equal(r.planned, 23464 + 1796 + 13 + 1);
  assert.equal(await count("products"), 10);
  assert.equal(await count("locations"), 8);
});

test("4. バッチ投入（400 件）：1 日の上限（15,000 件）で止まり、索引の meta はまだ書かれない", async () => {
  const r = await runImport({ batchSize: 400, maxWrites: 15000, checkpointPath: CHECKPOINT, retryBaseMs: 50, log: quiet });
  assert.equal(r.failures.length, 0);
  assert.equal(r.written, 15000);
  assert.equal(r.batches, Math.ceil(15000 / 400));
  assert.equal(r.stoppedByWriteLimit, true);
  assert.equal(r.metaWritten, false);
  assert.equal((await db.collection("catalogIndex").doc("meta").get()).exists, false);
  console.log(`  1回目: ${r.written} 件 / ${r.batches} バッチ / ${(r.durationMs / 1000).toFixed(1)} 秒`);
});

test("4. 翌日分の再開：残りと索引を書き、最後に meta を書く", async () => {
  const r = await runImport({ batchSize: 400, maxWrites: 15000, checkpointPath: CHECKPOINT, retryBaseMs: 50, log: quiet });
  assert.equal(r.failures.length, 0);
  assert.equal(r.skippedUnchanged, 15000);
  assert.equal(r.written, 25274 - 15000);
  assert.equal(r.metaWritten, true);
  assert.equal(await count("products"), 23464 + 10);
  assert.equal(await count("locations"), 1796 + 8);
  assert.equal(await count("catalogIndex"), 14);
  console.log(`  2回目: ${r.written} 件 / ${r.batches} バッチ / ${(r.durationMs / 1000).toFixed(1)} 秒`);
});

test("5. 再実行：変更がなければ書き込み 0 件。チェックポイントなしでも二重登録にならない", async () => {
  const again = await runImport({ checkpointPath: CHECKPOINT, log: quiet });
  assert.equal(again.written, 0);
  assert.equal(again.skippedUnchanged, 25274);

  const full = await runImport({ useCheckpoint: false, checkpointPath: CHECKPOINT, log: quiet });
  assert.equal(full.written, 25274);
  assert.equal(await count("products"), 23464 + 10);
  assert.equal(await count("locations"), 1796 + 8);
  assert.equal(await count("catalogIndex"), 14);
});

test("1-2, 11. 全件を読み戻すと変換結果と一致し、欠損値（価格・発売日・座標）は null のまま", async () => {
  const expectedProducts = new Map(rawProducts.map((r) => { const p = toGachaProduct(r); return [p.id, p]; }));
  const snap = await db.collection("products").where("importBatch", "!=", null).get();
  assert.equal(snap.size, 23464);
  let mismatch = 0;
  for (const doc of snap.docs) {
    const got = productFromDoc(doc);
    const exp = expectedProducts.get(doc.id);
    try { assert.deepEqual(got, exp); } catch { mismatch += 1; }
  }
  assert.equal(mismatch, 0);
  assert.ok(snap.docs.some((d) => d.get("price") === null));
  assert.ok(snap.docs.some((d) => d.get("releaseMonth") === null));
  assert.ok(snap.docs.some((d) => d.get("priceTaxIncluded") === false));
  assert.ok(snap.docs.some((d) => typeof d.get("resaleMonth") === "string"));

  const expectedLocations = new Map(rawLocations.map((r) => { const l = toLocation(r); return [l.id, l]; }));
  const lsnap = await db.collection("locations").where("importBatch", "!=", null).get();
  assert.equal(lsnap.size, 1796);
  for (const doc of lsnap.docs) assert.deepEqual(locationFromDoc(doc), expectedLocations.get(doc.id));
  const noCoords = lsnap.docs.filter((d) => d.get("lat") === null);
  assert.equal(noCoords.length, 50);
  assert.ok(noCoords.every((d) => d.get("lng") === null)); // 0 にならない
});

test("6. catalogIndex：meta の件数・シャード数、各シャードは 1MiB 未満、商品 ID と一致、モックを含まない", async () => {
  const meta = (await db.collection("catalogIndex").doc("meta").get()).data()!;
  assert.equal(meta.productCount, 23464);
  assert.equal(meta.locationCount, 1796);
  assert.equal(meta.productShards, 12);
  assert.equal(meta.locationShards, 1);
  const ids: string[] = [];
  const sizes: number[] = [];
  for (let i = 0; i < meta.productShards; i++) {
    const s = await db.collection("catalogIndex").doc(`products-${String(i).padStart(3, "0")}`).get();
    const items = s.get("items") as { id: string }[];
    ids.push(...items.map((x) => x.id));
    sizes.push(Buffer.byteLength(JSON.stringify(s.data()), "utf8"));
  }
  assert.equal(ids.length, 23464);
  assert.equal(new Set(ids).size, 23464);
  assert.ok(!ids.includes("p-001"));
  assert.ok(sizes.every((b) => b < 1_048_576));
  const loc = await db.collection("catalogIndex").doc("locations-000").get();
  assert.equal((loc.get("items") as unknown[]).length, 1796);
  console.log(`  索引: 商品シャード ${sizes.length}（最大 ${Math.max(...sizes)} バイト）/ 店舗シャード 1`);
});

test("9-10. 在庫報告：既存モックの設置情報・実データの「この店で見つけた」（設置情報の新規作成）・座標なし店舗", async () => {
  const { createFirestoreDataSource } = await import("../../src/lib/data/firestoreSource");
  const { PlacementNotFoundError, ReportRateLimitedError } = await import("../../src/lib/data/source");
  const ds = createFirestoreDataSource();
  const mock = createMockDatabase(new Date());
  const beforePlacements = await count("placements");
  const beforeReports = await count("stockReports");
  // 投入で既存の placements / stockReports は変わっていない
  assert.equal(beforePlacements, mock.placements.length);
  assert.equal(beforeReports, mock.stockReports.length);

  // 既存（モック）の設置情報への報告は従来どおり
  await ds.addStockReport({ productId: "p-001", locationId: "l-001", userId: "uid-a", status: "low" });
  assert.equal(await count("placements"), beforePlacements);

  // 実データの商品 × 実データの店舗（設置情報なし）→ 設置情報を作成して登録
  const productId = "bandai-4570118187086000";
  const locationId = "gp-S90000893";
  const report = await ds.addStockReport({ productId, locationId, userId: "uid-a", status: "in_stock" });
  const pl = await db.collection(COLLECTIONS.placements).doc(placementIdOf(productId, locationId)).get();
  assert.equal(pl.exists, true);
  assert.equal(pl.get("productId"), productId);
  assert.equal(pl.get("latestStock").status, "in_stock");
  assert.equal(pl.get("latestStock").reportId, report.id);
  const sr = await db.collection(COLLECTIONS.stockReports).doc(report.id).get();
  assert.deepEqual(Object.keys(sr.data()!).sort(), ["locationId", "placementId", "productId", "reportedAt", "status", "userId"]);
  assert.ok(sr.get("reportedAt") instanceof Timestamp);

  // 座標なしの店舗にも報告できる
  const noCoords = (await db.collection("locations").where("lat", "==", null).limit(1).get()).docs[0].id;
  await ds.addStockReport({ productId, locationId: noCoords, userId: "uid-a", status: "low" });

  // 連投制限・存在しない商品・サンプル商品
  await assert.rejects(ds.addStockReport({ productId, locationId, userId: "uid-a", status: "sold_out" }), ReportRateLimitedError);
  await assert.rejects(ds.addStockReport({ productId: "bandai-0", locationId, userId: "uid-a", status: "low" }), PlacementNotFoundError);
  await db.collection("products").doc("p-002").update({ isSample: true });
  await assert.rejects(ds.addStockReport({ productId: "p-002", locationId, userId: "uid-a", status: "low" }), PlacementNotFoundError);

  assert.equal(await count("placements"), beforePlacements + 2);
  assert.equal(await count("stockReports"), beforeReports + 3);
  assert.equal((await db.collection("users").doc("uid-a").get()).get("displayName"), "ゲスト");
});

test("Auth Emulator の ID トークンを Admin SDK で検証できる（報告者の識別）", async () => {
  const { getReporterId } = await import("../../src/lib/auth/reporter");
  const { idToken, uid } = await emulatorIdToken();
  process.env.DATA_SOURCE = "firestore";
  assert.equal(await getReporterId(idToken), uid);
  delete process.env.DATA_SOURCE;
});

/**
 * 本番投入と同じ方式の統合テスト（Firestore Emulator。本番には接続しない）。
 *
 * - 再開：Firestore の既存 ID で判定（--resume=firestore）。ローカルのチェックポイントは使わない
 * - 書き込み：create()（既存ドキュメントを上書きしない）
 * - 1 日の上限：モックの isSample の更新も含めて 15,000 件を超えない
 * - 索引：全件がそろい件数を確認できてから meta を書く。既存の索引と異なる場合は何も書かずに停止
 * - placements / stockReports / users は変更しない
 */
import { guard, resetEmulator, seedProductionLikeMock } from "./helpers";

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import { IMPORT_BATCH } from "../../src/lib/catalog/firestoreDocs";
import { getAdminFirestore } from "../../src/lib/firebase/adminApp";
import { type ImportOptions, IndexConflictError, runImport } from "../../scripts/import-collected";

const ROOT = path.resolve(__dirname, "../..");
// このテストではチェックポイントを使わない（ファイルが作られないことも確認する）
const CHECKPOINT = path.join(ROOT, ".catalog-build", `import-checkpoint-resume-test-${guard.projectId}.json`);
const db = getAdminFirestore();
const count = async (c: string) => (await db.collection(c).count().get()).data().count;
const quiet = () => {};
const opts: ImportOptions = {
  resume: "firestore",
  writeMode: "create",
  batchSize: 400,
  maxWrites: 15000,
  retryBaseMs: 50,
  checkpointPath: CHECKPOINT,
  log: quiet,
};

const TOTAL = 23464 + 1796 + 13 + 1; // 投入対象
const EXISTING_REAL_ID = "bandai-4570118187086000";

/** 変更してはいけないコレクションの全ドキュメント（ID → 内容） */
async function snapshotProtected(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of ["placements", "stockReports", "users"]) {
    for (const d of (await db.collection(c).get()).docs) out[`${c}/${d.id}`] = JSON.stringify(d.data());
  }
  return out;
}

let protectedBefore: Record<string, string>;

before(async () => {
  assert.equal(guard.projectId.startsWith("demo-"), true);
  await resetEmulator();
  await rm(CHECKPOINT, { force: true });
  await seedProductionLikeMock(db);
  // 既に同じ ID の実データが（別の内容で）存在する場合：上書きしないことを確認する
  await db.collection("products").doc(EXISTING_REAL_ID).set({ name: "既存のデータ（上書き禁止）", importBatch: IMPORT_BATCH, isSample: false });
  protectedBefore = await snapshotProtected();
});

test("ドライラン：Firestore の既存 ID を読むだけで書き込まない。上限にはモックの isSample を含む", async () => {
  const r = await runImport({ ...opts, dryRun: true });
  assert.equal(r.written, 0);
  assert.equal(r.skippedExisting, 1);
  assert.equal(r.pendingWrites, 18 + TOTAL - 1);
  assert.equal(r.plannedThisRun, 15000);
  assert.equal(r.stoppedByWriteLimit, true);
  assert.equal(r.reads.existingIds, 11 + 8); // products（モック 10 + 既存 1）+ locations 8
  assert.equal(r.reads.samples, 18);
  assert.match(r.planCode, /^[0-9a-f]{12}$/);
  assert.equal(await count("products"), 11);
  assert.equal((await db.collection("products").doc("p-001").get()).get("isSample"), undefined);
});

test("1 日目：isSample 18 件を含めてちょうど 15,000 件で止まり、meta は書かれない", async () => {
  const r = await runImport(opts);
  assert.equal(r.failures.length, 0);
  assert.equal(r.written, 15000);
  assert.deepEqual(r.samples, { candidates: 18, marked: 18, alreadyMarked: 0, missing: 0 });
  assert.equal(r.stoppedByWriteLimit, true);
  assert.equal(r.metaWritten, false);
  assert.equal(r.indexComplete, false);
  assert.equal((await db.collection("catalogIndex").doc("meta").get()).exists, false);
  assert.equal(await count("locations"), 8 + 1796);
  assert.equal(await count("products"), 11 + (15000 - 18 - 1796));
  assert.equal(await count("catalogIndex"), 0);
  assert.equal(existsSync(CHECKPOINT), false); // ローカルの記録に依存しない
  // モックは削除されず、isSample だけが付く
  const p1 = await db.collection("products").doc("p-001").get();
  assert.equal(p1.get("isSample"), true);
  assert.equal(p1.get("name"), "ねこだんご ミニフィギュア");
});

test("2 日目：ローカルの記録なしで、未投入の ID だけを書き、件数を確認してから最後に meta を書く", async () => {
  const r = await runImport(opts);
  assert.equal(r.failures.length, 0);
  assert.equal(r.written, TOTAL + 18 - 1 - 15000);
  assert.equal(r.skippedExisting, 1 + 1796 + (15000 - 18 - 1796));
  assert.deepEqual(r.samples, { candidates: 18, marked: 0, alreadyMarked: 18, missing: 0 });
  assert.equal(r.reads.existingIds, 11 + (15000 - 18 - 1796) + 8 + 1796); // 既存ドキュメント数だけ読み取り
  assert.ok(r.reads.verify > 0);
  assert.equal(r.metaWritten, true);
  assert.equal(r.indexComplete, true);
  assert.equal(await count("products"), 10 + 23464);
  assert.equal(await count("locations"), 8 + 1796);
  assert.equal(await count("catalogIndex"), 14);
  // 既存の同じ ID のドキュメントは上書きしない
  assert.equal((await db.collection("products").doc(EXISTING_REAL_ID).get()).get("name"), "既存のデータ（上書き禁止）");
});

test("再実行：すべて投入済みなら書き込み 0 件（既存の索引は内容を確認して一致）", async () => {
  const r = await runImport(opts);
  assert.equal(r.failures.length, 0);
  assert.equal(r.written, 0);
  assert.equal(r.pendingWrites, 0);
  assert.equal(r.indexComplete, true);
  assert.equal(r.reads.index, 14);
});

test("既存の索引と内容が異なる場合は、何も書き込まずに停止する（既存の索引を壊さない）", async () => {
  const meta = db.collection("catalogIndex").doc("meta");
  const original = (await meta.get()).data()!;
  await meta.update({ version: "other-version" });
  await db.collection("products").doc("tta-Y907104").delete(); // 未投入の ID を 1 件つくる
  await assert.rejects(runImport(opts), IndexConflictError);
  assert.equal((await meta.get()).get("version"), "other-version");
  assert.equal((await db.collection("products").doc("tta-Y907104").get()).exists, false); // 書き込んでいない
  await meta.set(original);
  // 元に戻せば、足りない 1 件だけを書く
  const r = await runImport(opts);
  assert.equal(r.written, 1);
  assert.equal(await count("products"), 10 + 23464);
});

test("placements / stockReports / users は一切変更しない", async () => {
  assert.deepEqual(await snapshotProtected(), protectedBefore);
});

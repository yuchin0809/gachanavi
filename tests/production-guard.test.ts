/**
 * 本番投入モードの安全装置のテスト。Firestore には接続しない。
 * 認証情報は偽の値に置き換える（万一接続を試みても認証で失敗する）。
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { runImport } from "../scripts/import-collected";
import { PRODUCTION_PROJECT_ID, ProductionGuardError, assertProductionTarget } from "../scripts/lib/productionGuard";

const quiet = () => {};

beforeEach(() => {
  for (const key of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "EMULATOR_PROJECT_ID", "GOOGLE_APPLICATION_CREDENTIALS"]) {
    delete process.env[key];
  }
  process.env.FIREBASE_PROJECT_ID = PRODUCTION_PROJECT_ID;
  process.env.FIREBASE_CLIENT_EMAIL = `test-only@${PRODUCTION_PROJECT_ID}.iam.gserviceaccount.com`;
  process.env.FIREBASE_PRIVATE_KEY = "not-a-real-key";
});

test("本番の投入先はコードに固定したプロジェクトだけ", () => {
  assert.equal(PRODUCTION_PROJECT_ID, "gachanavi-21ee8");
  assert.deepEqual(assertProductionTarget("gachanavi-21ee8").projectId, "gachanavi-21ee8");
});

test("本番モードの条件：どれか 1 つでも欠けたら停止する", () => {
  assert.throws(() => assertProductionTarget(undefined), ProductionGuardError); // --project なし
  assert.throws(() => assertProductionTarget("gachanavi-21ee9"), ProductionGuardError); // 完全一致でない
  assert.throws(() => assertProductionTarget("GACHANAVI-21EE8"), ProductionGuardError);

  process.env.FIREBASE_PROJECT_ID = "other-project";
  assert.throws(() => assertProductionTarget("gachanavi-21ee8"), /FIREBASE_PROJECT_ID/);
  process.env.FIREBASE_PROJECT_ID = PRODUCTION_PROJECT_ID;

  process.env.FIREBASE_CLIENT_EMAIL = "someone@other-project.iam.gserviceaccount.com";
  assert.throws(() => assertProductionTarget("gachanavi-21ee8"), /FIREBASE_CLIENT_EMAIL/);
  process.env.FIREBASE_CLIENT_EMAIL = `test-only@${PRODUCTION_PROJECT_ID}.iam.gserviceaccount.com`;

  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  assert.throws(() => assertProductionTarget("gachanavi-21ee8"), /FIRESTORE_EMULATOR_HOST/);
  delete process.env.FIRESTORE_EMULATOR_HOST;

  delete process.env.FIREBASE_PRIVATE_KEY;
  assert.throws(() => assertProductionTarget("gachanavi-21ee8"), /FIREBASE_PRIVATE_KEY/);
});

test("エミュレータ用のガードは、本番の設定では従来どおり拒否する", async () => {
  await assert.rejects(runImport({ dryRun: true, log: quiet }), /FIRESTORE_EMULATOR_HOST/);
});

test("本番の書き込みには --max-writes（20,000 以下）と、ドライランの確認コードが必要", async () => {
  const base = { target: "production" as const, confirmProject: "gachanavi-21ee8", log: quiet };
  await assert.rejects(runImport(base), /--max-writes/);
  await assert.rejects(runImport({ ...base, maxWrites: 25000 }), /--max-writes/);
  await assert.rejects(runImport({ ...base, maxWrites: 15000, resume: "checkpoint" }), /使えません/);
  await assert.rejects(runImport({ ...base, maxWrites: 15000, writeMode: "set" }), /使えません/);
  await assert.rejects(runImport({ ...base, maxWrites: 15000 }), /ドライラン/);
  await assert.rejects(runImport({ ...base, maxWrites: 15000, confirmPlan: "000000000000" }), /一致しません/);
});

test("本番のドライラン（--offline：接続しない）：確認コードと 1 日目の予定件数", async () => {
  const r = await runImport({ target: "production", confirmProject: "gachanavi-21ee8", maxWrites: 15000, dryRun: true, offline: true, log: quiet });
  assert.equal(r.projectId, "gachanavi-21ee8");
  assert.match(r.planCode, /^[0-9a-f]{12}$/);
  assert.equal(r.planned, 25274);
  assert.equal(r.pendingWrites, 18 + 25274); // 接続しないため最大値（モックの isSample 18 件を含む）
  assert.equal(r.plannedThisRun, 15000);
  assert.equal(r.written, 0);
  assert.deepEqual(r.reads, { existingIds: 0, samples: 0, index: 0, verify: 0 });

  // 確認コードは投入先によって変わる（エミュレータのコードを本番に使えない）
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  const emu = await runImport({ dryRun: true, log: quiet });
  assert.notEqual(emu.planCode, r.planCode);
});

/**
 * Firestore Emulator：お気に入り・在庫通知・「この店舗で見つけた」の設置情報（本番 Firestore には接続しない）。
 *
 *   npx -y firebase-tools@15 emulators:exec --only firestore,auth --project demo-gachanavi \
 *     "tsx --conditions=react-server --test tests/emulator/favorites.test.ts"
 */
import { guard, emulatorIdToken } from "./helpers";

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS, placementFromDoc } from "../../src/lib/data/firestore/schema";
import { placementIdOf } from "../../src/lib/data/source";
import { findStockAlerts } from "../../src/lib/favorites";
import { getAdminFirestore } from "../../src/lib/firebase/adminApp";

const db = getAdminFirestore();
const P1 = "bandai-4570118187086000";
const P2 = "tta-Y907104";
// 投入テスト（import.test.ts）・画面テストで使う店舗（gp-S90000893）とは別の店舗を使う
const L1 = "gp-S90001158";
const L2 = "gp-S90000105";
const TEST_USERS = ["uid-a", "uid-b", "uid-c", "uid-n", "uid-x", "uid-y", "uid-z", "uid-m"];
const favRef = (uid: string, pid: string) => db.collection("users").doc(uid).collection("favorites").doc(pid);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 投入済みのエミュレータのデータ（画面テストで使う）を消さないよう、全体のリセットはしない。
 * 商品・店舗は無い場合だけ作り、このテストで作る設置情報・在庫報告・ユーザーだけを事前に削除する
 */
before(async () => {
  assert.equal(guard.projectId.startsWith("demo-"), true);
  const ensure = async (col: string, id: string, data: Record<string, unknown>) => {
    const ref = db.collection(col).doc(id);
    if (!(await ref.get()).exists) await ref.set(data);
  };
  for (const id of [P1, P2]) await ensure("products", id, { name: `商品 ${id}`, maker: "テスト", isSample: false });
  for (const id of [L1, L2]) await ensure("locations", id, { name: `店舗 ${id}`, address: "", lat: 35, lng: 135, isSample: false });
  for (const [p, l] of [[P2, L1], [P1, L2]]) {
    await db.collection("placements").doc(placementIdOf(p, l)).delete();
    for (const d of (await db.collection("stockReports").where("placementId", "==", placementIdOf(p, l)).get()).docs) await d.ref.delete();
  }
  for (const uid of TEST_USERS) await db.recursiveDelete(db.collection("users").doc(uid));
});

async function ds() {
  const { createFirestoreDataSource } = await import("../../src/lib/data/firestoreSource");
  return createFirestoreDataSource();
}

test("お気に入り：users/{uid}/favorites/{productId} に 1 件だけ（冪等）・商品情報は複製しない・users は作らない", async () => {
  const d = await ds();
  const a = await d.setFavorite("uid-a", P1, true);
  const b = await d.setFavorite("uid-a", P1, true);
  assert.equal(a?.createdAt, b?.createdAt);
  const snap = await db.collection("users").doc("uid-a").collection("favorites").get();
  assert.equal(snap.size, 1);
  assert.deepEqual(Object.keys(snap.docs[0].data()).sort(), ["createdAt", "lastNotifiedAt", "notifyEnabledAt", "notifyInStock", "productId"]);
  assert.ok(snap.docs[0].get("createdAt") instanceof Timestamp);
  assert.equal((await db.collection("users").doc("uid-a").get()).exists, false);

  await sleep(5);
  await d.setFavorite("uid-a", P2, true);
  assert.deepEqual((await d.listFavorites("uid-a")).map((f) => f.productId), [P2, P1]);
  // 他のユーザーのお気に入りは見えない
  assert.deepEqual(await d.listFavorites("uid-b"), []);

  // 解除（2 回目も成功）
  assert.equal(await d.setFavorite("uid-a", P2, false), null);
  assert.equal(await d.setFavorite("uid-a", P2, false), null);
  assert.equal((await favRef("uid-a", P2).get()).exists, false);
  // 解除済みのお気に入りに「通知済み」を書いても復活しない
  await d.markStockAlertsNotified("uid-a", [P2]);
  assert.equal((await favRef("uid-a", P2).get()).exists, false);
});

test("在庫通知の設定：ON で保存（お気に入りでなければ登録）・同じ設定は書き込まない・OFF", async () => {
  const d = await ds();
  assert.equal(await d.setStockAlert("uid-c", P1, false), null);
  assert.equal((await favRef("uid-c", P1).get()).exists, false);
  const on = await d.setStockAlert("uid-c", P1, true);
  assert.equal(on?.notifyInStock, true);
  const t1 = (await favRef("uid-c", P1).get()).updateTime!;
  await d.setStockAlert("uid-c", P1, true);
  assert.equal((await favRef("uid-c", P1).get()).updateTime!.isEqual(t1), true); // 変化なしなら書き込まない
  assert.deepEqual((await d.listFavorites("uid-c", { notifyOnly: true })).map((f) => f.productId), [P1]);
  await d.setStockAlert("uid-c", P1, false);
  assert.deepEqual(await d.listFavorites("uid-c", { notifyOnly: true }), []);
  assert.equal((await favRef("uid-c", P1).get()).get("notifyInStock"), false);
});

test("この店舗で見つけた：設置情報を作成（source=user_report）→ 別ユーザーは再利用・在庫報告は履歴・古い報告で上書きしない", async () => {
  const d = await ds();
  const plRef = db.collection(COLLECTIONS.placements).doc(placementIdOf(P2, L1));
  assert.equal((await plRef.get()).exists, false);

  const r1 = await d.addStockReport({ productId: P2, locationId: L1, userId: "uid-x", status: "in_stock" });
  assert.equal(r1.placementCreated, true);
  const pl = await plRef.get();
  assert.equal(pl.get("source"), "user_report");
  assert.equal(pl.get("latestStock").status, "in_stock");
  // 報告日時はサーバーの時刻（Timestamp）
  const sr = await db.collection("stockReports").doc(r1.id).get();
  assert.ok(sr.get("reportedAt") instanceof Timestamp);
  assert.ok(Math.abs(sr.get("reportedAt").toMillis() - Date.now()) < 60_000);

  const r2 = await d.addStockReport({ productId: P2, locationId: L1, userId: "uid-y", status: "sold_out" });
  assert.equal(r2.placementCreated, false);
  assert.equal((await db.collection("placements").where("productId", "==", P2).get()).size, 1);
  assert.equal((await plRef.get()).get("latestStock").status, "sold_out");
  assert.equal((await db.collection("stockReports").where("placementId", "==", placementIdOf(P2, L1)).get()).size, 2);

  // 古い日時の報告は履歴には残るが latestStock を上書きしない
  await d.addStockReport({ productId: P2, locationId: L1, userId: "uid-z", status: "low", reportedAt: new Date(Date.now() - 3600_000).toISOString() });
  assert.equal((await plRef.get()).get("latestStock").status, "sold_out");

  // 10 分制限
  const { ReportRateLimitedError } = await import("../../src/lib/data/source");
  await assert.rejects(d.addStockReport({ productId: P2, locationId: L1, userId: "uid-x", status: "low" }), ReportRateLimitedError);
});

test("在庫通知の判定（Firestore の placements.latestStock から）・通知済みの記録", async () => {
  const d = await ds();
  const on = (await d.setStockAlert("uid-n", P1, true))!;
  await sleep(5);
  await d.addStockReport({ productId: P1, locationId: L2, userId: "uid-m", status: "in_stock" });
  const placements = (await db.collection("placements").where("productId", "==", P1).get()).docs.map(placementFromDoc);
  const names = { product: () => "商品", location: (id: string) => ({ name: id }) };
  const alerts = findStockAlerts(await d.listFavorites("uid-n", { notifyOnly: true }), placements, names);
  assert.deepEqual(alerts.map((a) => a.locations.map((l) => l.locationId)), [[L2]]);
  await d.markStockAlertsNotified("uid-n", [P1]);
  const after = await d.listFavorites("uid-n", { notifyOnly: true });
  assert.ok(after[0].lastNotifiedAt && after[0].lastNotifiedAt > on.createdAt);
  assert.deepEqual(findStockAlerts(after, placements, names), []);
});

test("匿名認証：ID トークンの uid だけを使う・Security Rules でブラウザから favorites を読めない", async () => {
  const { getReporterId, ReporterAuthError } = await import("../../src/lib/auth/reporter");
  const { idToken, uid } = await emulatorIdToken();
  process.env.DATA_SOURCE = "firestore";
  assert.equal(await getReporterId(idToken), uid);
  await assert.rejects(getReporterId(null), ReporterAuthError);
  await assert.rejects(getReporterId("forged.token.value"), ReporterAuthError);
  delete process.env.DATA_SOURCE;

  const d = await ds();
  await d.setFavorite(uid, P1, true);
  // 本人でもクライアント SDK（REST）からは読み書きできない（サーバー経由のみ）
  const url = `http://${guard.firestoreHost}/v1/projects/${guard.projectId}/databases/(default)/documents/users/${uid}/favorites/${P1}`;
  const read = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  assert.equal(read.status, 403);
  const write = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify({ fields: { productId: { stringValue: P1 } } }),
  });
  assert.equal(write.status, 403);
});

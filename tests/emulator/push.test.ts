/**
 * Firestore Emulator：バックグラウンド通知（本番 Firestore・FCM には接続しない。FCM の送信は差し替え）。
 * 投入済みのデータ（画面テストで使う）を消さないよう、全体のリセットはせず、このテストのデータだけを作り直す。
 */
import { guard, emulatorIdToken } from "./helpers";

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import type { PushMessage } from "../../src/lib/push/sender";
import { getAdminFirestore } from "../../src/lib/firebase/adminApp";

const db = getAdminFirestore();
const P = "bandai-4582769978920000";
const L1 = "gp-S90000105";
const L2 = "gp-S90001158";
const USERS = ["push-on", "push-off", "push-other", "push-nodevice"];
const tok = (s: string) => `${s}_${"t".repeat(150)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  assert.equal(guard.projectId.startsWith("demo-"), true);
  process.env.DATA_SOURCE = "firestore";
  const ensure = async (col: string, id: string, data: Record<string, unknown>) => {
    const ref = db.collection(col).doc(id);
    if (!(await ref.get()).exists) await ref.set(data);
  };
  await ensure("products", P, { name: `商品 ${P}`, maker: "テスト", isSample: false });
  for (const id of [L1, L2]) await ensure("locations", id, { name: `店舗 ${id}`, address: "", lat: 35, lng: 135, isSample: false });
  for (const l of [L1, L2]) {
    await db.collection("placements").doc(`${P}__${l}`).delete();
    for (const d of (await db.collection("stockReports").where("placementId", "==", `${P}__${l}`).get()).docs) await d.ref.delete();
  }
  for (const uid of USERS) await db.recursiveDelete(db.collection("users").doc(uid));
});

const ds = async () => (await import("../../src/lib/data/firestoreSource")).createFirestoreDataSource();
const sent: PushMessage[] = [];
async function fakeSender(invalid: string[] = [], throws = false) {
  const { setPushSenderForTests } = await import("../../src/lib/push/sender");
  setPushSenderForTests({
    async send(messages) {
      if (throws) throw new Error("FCM down");
      sent.push(...messages);
      return messages.map((m) => ({ token: m.token, ok: !invalid.includes(m.token), invalidToken: invalid.includes(m.token) }));
    },
  });
}

test("端末の登録：users/{uid}/pushTokens/{hash} に 1 件（token・platform・日時だけ）、2 回目は書き込まない", async () => {
  const d = await ds();
  await d.savePushToken("push-on", tok("on1"));
  const col = db.collection("users").doc("push-on").collection("pushTokens");
  const snap = await col.get();
  assert.equal(snap.size, 1);
  assert.match(snap.docs[0].id, /^[0-9a-f]{40}$/);
  assert.ok(!snap.docs[0].id.includes("on1"));
  assert.deepEqual(Object.keys(snap.docs[0].data()).sort(), ["createdAt", "platform", "token", "updatedAt"]);
  assert.ok(snap.docs[0].get("updatedAt") instanceof Timestamp);
  const t1 = snap.docs[0].updateTime;
  await d.savePushToken("push-on", tok("on1"));
  assert.equal((await col.get()).docs[0].updateTime.isEqual(t1), true);
  await d.savePushToken("push-on", tok("on2")); // 2 台目
  assert.equal((await d.listPushTokens("push-on")).length, 2);
  assert.equal((await db.collection("users").doc("push-on").get()).exists, false); // users ドキュメントは作らない
});

test("通知対象の検索：collectionGroup で「この商品・通知 ON」だけ（通知 OFF・別の商品は読まない）", async () => {
  const d = await ds();
  await d.setStockAlert("push-on", P, true);
  await d.setFavorite("push-off", P, true); // お気に入りだが通知 OFF
  await d.savePushToken("push-off", tok("off"));
  await d.setStockAlert("push-other", "tta-Y907104", true); // 別の商品
  await d.savePushToken("push-other", tok("other"));
  await d.setStockAlert("push-nodevice", P, true); // 端末なし
  const watchers = await d.listStockAlertWatchers(P);
  assert.deepEqual(watchers.map((w) => w.userId).sort(), ["push-nodevice", "push-on"]);
});

test("在庫報告 → 通知：在庫ありは送る・売り切れは送らない・同じ報告は重複しない・無効な端末は削除", async () => {
  await fakeSender([tok("on2")]);
  const d = await ds();
  const { sendStockPushNotifications } = await import("../../src/lib/data");
  await sleep(5);

  const soldOut = await d.addStockReport({ productId: P, locationId: L1, userId: "reporter-1", status: "sold_out" });
  assert.equal((await sendStockPushNotifications(soldOut)).skipped, "status");

  const inStock = await d.addStockReport({ productId: P, locationId: L2, userId: "reporter-2", status: "in_stock" });
  assert.equal(inStock.latestUpdated, true);
  const res = await sendStockPushNotifications(inStock);
  assert.equal(res.watchers, 2);
  assert.equal(res.sent, 1);
  assert.equal(res.removedTokens, 1);
  assert.deepEqual(res.notifiedUsers, ["push-on"]);
  assert.deepEqual(sent.map((m) => m.token).sort(), [tok("on1"), tok("on2")]);
  assert.deepEqual(await d.listPushTokens("push-on"), [tok("on1")]);
  const fav = await db.collection("users").doc("push-on").collection("favorites").doc(P).get();
  assert.ok(fav.get("lastNotifiedAt") instanceof Timestamp);
  // 端末が無いユーザーは通知済みにしない
  assert.equal((await db.collection("users").doc("push-nodevice").collection("favorites").doc(P).get()).get("lastNotifiedAt"), null);

  const again = await sendStockPushNotifications(inStock);
  assert.equal(again.sent, 0);

  // 古い日時の報告：latestStock を上書きしない → 通知もしない
  const older = await d.addStockReport({ productId: P, locationId: L2, userId: "reporter-3", status: "low", reportedAt: new Date(Date.now() - 3600_000).toISOString() });
  assert.equal(older.latestUpdated, false);
  assert.equal((await sendStockPushNotifications(older)).skipped, "not_latest");
  assert.equal((await db.collection("placements").doc(`${P}__${L2}`).get()).get("latestStock").status, "in_stock");

  // 新しい報告で再び通知
  await sleep(5);
  const newer = await d.addStockReport({ productId: P, locationId: L1, userId: "reporter-4", status: "low" });
  assert.equal((await sendStockPushNotifications(newer)).sent, 1);
});

test("FCM が失敗しても在庫報告（StockReport・latestStock）は保存済み・10 分制限はそのまま", async () => {
  await fakeSender([], true);
  const d = await ds();
  const { sendStockPushNotifications } = await import("../../src/lib/data");
  const { ReportRateLimitedError } = await import("../../src/lib/data/source");
  await sleep(5);
  const r = await d.addStockReport({ productId: P, locationId: L2, userId: "reporter-5", status: "in_stock" });
  await assert.rejects(sendStockPushNotifications(r));
  assert.equal((await db.collection("stockReports").doc(r.id).get()).exists, true);
  assert.equal((await db.collection("placements").doc(`${P}__${L2}`).get()).get("latestStock").reportId, r.id);
  await assert.rejects(d.addStockReport({ productId: P, locationId: L2, userId: "reporter-5", status: "low" }), ReportRateLimitedError);
});

test("Security Rules：本人でもブラウザから pushTokens を読み書きできない／ID トークンの uid だけに保存", async () => {
  const { idToken, uid } = await emulatorIdToken();
  const { savePushTokenAction } = await import("../../src/app/actions/push");
  assert.deepEqual(await savePushTokenAction({ token: tok("browser"), idToken }), { ok: true });
  assert.deepEqual(await savePushTokenAction({ token: tok("browser") }), { ok: false, error: "unauthenticated" });
  const docs = (await db.collection("users").doc(uid).collection("pushTokens").get()).docs;
  assert.equal(docs.length, 1);
  const base = `http://${guard.firestoreHost}/v1/projects/${guard.projectId}/databases/(default)/documents/users/${uid}/pushTokens`;
  const read = await fetch(`${base}/${docs[0].id}`, { headers: { Authorization: `Bearer ${idToken}` } });
  assert.equal(read.status, 403);
  const list = await fetch(base, { headers: { Authorization: `Bearer ${idToken}` } });
  assert.equal(list.status, 403);
  const write = await fetch(`${base}/x`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify({ fields: { token: { stringValue: "x" } } }),
  });
  assert.equal(write.status, 403);
});

/**
 * バックグラウンド通知（FCM Web Push）の送信側。DATA_SOURCE=local のため Firestore・FCM には接続しない。
 * FCM の送信部分は setPushSenderForTests で差し替える（成功・無効なトークン・一時的なエラー・例外）。
 */
process.env.DATA_SOURCE = "local";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { PushMessage, PushResult } from "../src/lib/push/sender";

const PRODUCT = "tta-Y907104";
const STORE = "gp-S90000893";
const STORE2 = "gp-S90001158";
const TOKEN_A = "tokenA_" + "a".repeat(140);
const TOKEN_B = "tokenB_" + "b".repeat(140);
const TOKEN_C = "tokenC_" + "c".repeat(140);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Behavior = Record<string, Omit<PushResult, "token">>;
const sent: PushMessage[][] = [];
async function useFakeSender(behavior: Behavior = {}, opts: { throws?: boolean } = {}) {
  const { setPushSenderForTests } = await import("../src/lib/push/sender");
  setPushSenderForTests({
    async send(messages) {
      if (opts.throws) throw new Error("FCM unavailable");
      sent.push(messages);
      return messages.map((m) => ({ token: m.token, ...(behavior[m.token] ?? { ok: true, invalidToken: false }) }));
    },
  });
}
afterEach(async () => {
  const { setPushSenderForTests } = await import("../src/lib/push/sender");
  setPushSenderForTests(null);
  sent.length = 0;
});

async function report(status: "in_stock" | "low" | "sold_out", locationId = STORE, userId = `reporter-${Math.random()}`, reportedAt?: string) {
  const { getDataSource } = await import("../src/lib/data");
  return (await getDataSource()).addStockReport({ productId: PRODUCT, locationId, userId, status, reportedAt });
}

test("①② 通知 OFF では端末を登録しても送らない／通知 ON・端末の登録（冪等）", async () => {
  await useFakeSender();
  const { savePushTokenAction, removePushTokenAction } = await import("../src/app/actions/push");
  const { setFavoriteAction, setStockAlertAction } = await import("../src/app/actions/favorites");
  const { sendStockPushNotifications, getDataSource } = await import("../src/lib/data");
  const { mockCurrentUserId } = await import("../src/data/mock");
  const ds = await getDataSource();

  assert.deepEqual(await savePushTokenAction({ token: TOKEN_A }), { ok: true });
  assert.deepEqual(await savePushTokenAction({ token: TOKEN_A }), { ok: true });
  assert.deepEqual(await ds.listPushTokens(mockCurrentUserId), [TOKEN_A]); // 同じ端末は 1 件

  // お気に入りだが通知 OFF
  await setFavoriteAction({ productId: PRODUCT, favorite: true });
  await sleep(3);
  const off = await sendStockPushNotifications(await report("in_stock"));
  assert.equal(off.watchers, 0);
  assert.equal(sent.length, 0);

  // 不正な入力
  assert.deepEqual(await savePushTokenAction({ token: "short" }), { ok: false, error: "invalid_input" });
  assert.deepEqual(await savePushTokenAction({ token: "x y".repeat(20) }), { ok: false, error: "invalid_input" });
  assert.deepEqual(await savePushTokenAction({ token: TOKEN_A, idToken: 5 }), { ok: false, error: "invalid_input" });
  assert.deepEqual(await removePushTokenAction({ token: TOKEN_C }), { ok: true }); // 無い端末の削除も成功

  const on = await setStockAlertAction({ productId: PRODUCT, enabled: true });
  assert.ok(on.ok && on.favorite?.notifyInStock);
});

test("③④⑤⑦ 在庫あり・残りわずかは送る／売り切れ・古い報告・最新でない報告は送らない（内容：商品詳細へのリンク・画像なし）", async () => {
  await useFakeSender();
  const { sendStockPushNotifications } = await import("../src/lib/data");
  await sleep(3);

  const soldOut = await sendStockPushNotifications(await report("sold_out"));
  assert.equal(soldOut.skipped, "status");
  assert.equal(sent.length, 0);

  const inStock = await sendStockPushNotifications(await report("in_stock", STORE2));
  assert.equal(inStock.sent, 1);
  assert.equal(inStock.notifiedUsers.length, 1);
  const msg = sent[0][0];
  assert.equal(msg.token, TOKEN_A);
  assert.equal(msg.data.title, "GachaNavi 在庫情報");
  assert.match(msg.data.body, /「在庫あり」の報告があります（.+）/);
  assert.equal(msg.data.url, `/gacha/${PRODUCT}`);
  assert.deepEqual(Object.keys(msg.data).sort(), ["body", "tag", "title", "url"]); // 画像・位置情報なし

  await sleep(3);
  const low = await sendStockPushNotifications(await report("low"));
  assert.equal(low.sent, 1);
  assert.match(sent[1][0].data.body, /「残りわずか」/);

  // 24 時間以上前の報告（日時を指定した報告。古いため最新にもならない）
  const old = await report("in_stock", STORE2, "old-reporter", new Date(Date.now() - 25 * 3600_000).toISOString());
  assert.equal(old.latestUpdated, false);
  assert.equal((await sendStockPushNotifications(old)).skipped, "not_latest");
  assert.equal((await sendStockPushNotifications({ ...old, latestUpdated: true })).skipped, "too_old");
  assert.equal(sent.length, 2);
});

test("⑥ 未確認（報告なし）は通知の対象外", async () => {
  const { isStockAlertStatus, shouldNotifyFavorite } = await import("../src/lib/favorites");
  assert.equal(isStockAlertStatus("unknown"), false);
  assert.equal(isStockAlertStatus("sold_out"), false);
  assert.equal(isStockAlertStatus("in_stock") && isStockAlertStatus("low"), true);
  const fav = { productId: "p", createdAt: new Date(0).toISOString(), notifyInStock: false, notifyEnabledAt: null, lastNotifiedAt: null };
  assert.equal(shouldNotifyFavorite(fav, new Date().toISOString()), false); // 通知 OFF
});

test("⑧⑨ 同じ報告では重複して送らない・新しい報告なら再び送る／アプリ内のお知らせとも重複しない", async () => {
  await useFakeSender();
  const { sendStockPushNotifications } = await import("../src/lib/data");
  const { takeStockAlertsAction } = await import("../src/app/actions/favorites");
  await sleep(3);
  const r = await report("in_stock");
  assert.equal((await sendStockPushNotifications(r)).sent, 1);
  const again = await sendStockPushNotifications(r);
  assert.equal(again.targets, 0);
  assert.equal(again.sent, 0);
  // バックグラウンド通知で届いた報告は、アプリを開いた時のお知らせでも重ねて出さない
  assert.deepEqual(await takeStockAlertsAction({}), { ok: true, alerts: [] });

  await sleep(5);
  assert.equal((await sendStockPushNotifications(await report("low", STORE2))).sent, 1);
  assert.equal(sent.length, 2);
});

test("⑩ 無効なトークンは削除・一時的なエラーでは削除しない。届かなかったユーザーは通知済みにしない", async () => {
  const { savePushTokenAction } = await import("../src/app/actions/push");
  const { sendStockPushNotifications, getDataSource } = await import("../src/lib/data");
  const { takeStockAlertsAction } = await import("../src/app/actions/favorites");
  const { mockCurrentUserId } = await import("../src/data/mock");
  const ds = await getDataSource();
  await savePushTokenAction({ token: TOKEN_B });
  await savePushTokenAction({ token: TOKEN_C });
  await useFakeSender({
    [TOKEN_A]: { ok: false, invalidToken: true, error: "messaging/registration-token-not-registered" },
    [TOKEN_B]: { ok: false, invalidToken: false, error: "messaging/internal-error" },
    [TOKEN_C]: { ok: false, invalidToken: true, error: "messaging/invalid-registration-token" },
  });
  await sleep(5);
  const res = await sendStockPushNotifications(await report("in_stock"));
  assert.equal(res.sent, 0);
  assert.equal(res.failed, 3);
  assert.equal(res.removedTokens, 2);
  assert.deepEqual(await ds.listPushTokens(mockCurrentUserId), [TOKEN_B]);
  assert.deepEqual(res.notifiedUsers, []);
  // 届かなかったので、アプリを開いた時のお知らせで伝わる
  const alerts = await takeStockAlertsAction({});
  assert.ok(alerts.ok && alerts.alerts.length === 1);
});

test("⑪ FCM の送信が失敗（例外）しても在庫報告は成功する", async () => {
  await useFakeSender({}, { throws: true });
  const { reportStockAction } = await import("../src/app/actions/stockReports");
  const { getDataSource } = await import("../src/lib/data");
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    await sleep(5);
    const res = await reportStockAction({ productId: PRODUCT, locationId: "gp-S90000105", status: "in_stock" });
    assert.ok(res.ok, JSON.stringify(res));
    await sleep(50); // レスポンス後の送信処理を待つ
  } finally {
    console.error = original;
  }
  const ds = await getDataSource();
  const placements = await ds.listPlacementsWithStock({ productId: PRODUCT, locationId: "gp-S90000105" });
  assert.equal(placements[0].stock.status, "in_stock");
  assert.ok(errors.some((e) => String((e as unknown[])[0]).includes("push notification failed")));
});

test("登録の解除：トークンを削除すると送らない", async () => {
  await useFakeSender();
  const { removePushTokenAction } = await import("../src/app/actions/push");
  const { sendStockPushNotifications, getDataSource } = await import("../src/lib/data");
  const { mockCurrentUserId } = await import("../src/data/mock");
  await removePushTokenAction({ token: TOKEN_B });
  assert.deepEqual(await (await getDataSource()).listPushTokens(mockCurrentUserId), []);
  await sleep(5);
  const res = await sendStockPushNotifications(await report("in_stock", STORE2));
  assert.equal(res.targets, 1);
  assert.equal(sent.length, 0);
  assert.deepEqual(res.notifiedUsers, []); // 端末が無いユーザーは通知済みにしない（アプリ内のお知らせで伝える）
});

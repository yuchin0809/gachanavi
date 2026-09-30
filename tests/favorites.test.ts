/**
 * お気に入り・在庫通知・ルート URL・在庫の鮮度・「この店舗で見つけた」の設置情報。
 * DATA_SOURCE=local のため Firestore には接続しない（お気に入りはサーバーのメモリ上のみ）。
 */
process.env.DATA_SOURCE = "local";

import assert from "node:assert/strict";
import { test } from "node:test";
import { findStockAlerts, stockAlertBaseline } from "../src/lib/favorites";
import { formatRelativeTime } from "../src/lib/format";
import { routeUrls } from "../src/lib/geo";
import { isStockStale } from "../src/lib/stock";
import type { Favorite, PlacementWithStock, StockStatus } from "../src/types";

const PRODUCT = "bandai-4570118187086000";
const PRODUCT2 = "tta-Y907104";
const STORE = "gp-S90000893"; // #C-pla くずはモール店
const STORE2 = "gp-S90001158";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("お気に入り：未登録 → 登録 → 重複しない → 一覧 → 解除（冪等）", async () => {
  const { setFavoriteAction, listFavoritesAction } = await import("../src/app/actions/favorites");

  const empty = await listFavoritesAction({ idToken: null });
  assert.deepEqual(empty, { ok: true, items: [] });

  const first = await setFavoriteAction({ productId: PRODUCT, favorite: true });
  assert.ok(first.ok && first.favorite?.productId === PRODUCT && first.favorite.notifyInStock === false);
  const again = await setFavoriteAction({ productId: PRODUCT, favorite: true });
  assert.ok(first.ok && again.ok);
  assert.equal(again.favorite?.createdAt, first.favorite?.createdAt); // 同じ 1 件（登録日時も変わらない）
  await sleep(2);
  await setFavoriteAction({ productId: PRODUCT2, favorite: true });

  const list = await listFavoritesAction({});
  assert.ok(list.ok);
  assert.deepEqual(list.ok && list.items.map((v) => v.product.id), [PRODUCT2, PRODUCT]); // 新しい順・重複なし
  // 商品情報は索引から（お気に入りには productId と日時・通知設定だけ）
  assert.ok(list.ok && list.items[1].product.name.length > 0);
  assert.deepEqual(Object.keys(list.ok ? list.items[1].favorite : {}).sort(), [
    "createdAt", "lastNotifiedAt", "notifyEnabledAt", "notifyInStock", "productId",
  ]);

  assert.deepEqual(await setFavoriteAction({ productId: PRODUCT2, favorite: false }), { ok: true, favorite: null });
  assert.deepEqual(await setFavoriteAction({ productId: PRODUCT2, favorite: false }), { ok: true, favorite: null });
  const after = await listFavoritesAction({});
  assert.deepEqual(after.ok && after.items.map((v) => v.product.id), [PRODUCT]);
});

test("お気に入り：不正な入力・存在しない商品は拒否", async () => {
  const { setFavoriteAction, setStockAlertAction, listFavoritesAction } = await import("../src/app/actions/favorites");
  assert.deepEqual(await setFavoriteAction({ productId: "../x", favorite: true }), { ok: false, error: "invalid_input" });
  assert.deepEqual(await setFavoriteAction({ productId: PRODUCT, favorite: "yes" }), { ok: false, error: "invalid_input" });
  assert.deepEqual(await setFavoriteAction({ productId: PRODUCT, favorite: true, idToken: 1 }), { ok: false, error: "invalid_input" });
  assert.deepEqual(await setFavoriteAction({ productId: "bandai-0", favorite: true }), { ok: false, error: "product_not_found" });
  assert.deepEqual(await setStockAlertAction({ productId: "bandai-0", enabled: true }), { ok: false, error: "product_not_found" });
  assert.deepEqual(await listFavoritesAction({ idToken: "x".repeat(9000) }), { ok: false, error: "invalid_input" });
});

test("在庫通知：OFF → ON（お気に入りにも登録）→ 在庫あり報告で 1 回だけ通知、売り切れでは通知しない", async () => {
  const { setStockAlertAction, takeStockAlertsAction } = await import("../src/app/actions/favorites");
  const { getDataSource } = await import("../src/lib/data");
  const ds = await getDataSource();

  // 通知 OFF（お気に入りでない商品の OFF は何もしない）
  assert.deepEqual(await setStockAlertAction({ productId: PRODUCT2, enabled: false }), { ok: true, favorite: null });
  // OFF のままの報告では通知しない
  await ds.addStockReport({ productId: PRODUCT2, locationId: STORE2, userId: "someone", status: "in_stock" });
  assert.deepEqual(await takeStockAlertsAction({}), { ok: true, alerts: [] });

  const on = await setStockAlertAction({ productId: PRODUCT2, enabled: true });
  assert.ok(on.ok && on.favorite?.notifyInStock === true && on.favorite.notifyEnabledAt);
  // ON にする前の報告では通知しない
  assert.deepEqual(await takeStockAlertsAction({}), { ok: true, alerts: [] });

  await sleep(5);
  // 売り切れの報告だけでは通知しない
  await ds.addStockReport({ productId: PRODUCT2, locationId: STORE, userId: "someone", status: "sold_out" });
  assert.deepEqual(await takeStockAlertsAction({}), { ok: true, alerts: [] });

  await sleep(5);
  await ds.addStockReport({ productId: PRODUCT2, locationId: STORE, userId: "someone-else", status: "in_stock" });
  const alerts = await takeStockAlertsAction({});
  assert.ok(alerts.ok && alerts.alerts.length === 1);
  assert.equal(alerts.ok && alerts.alerts[0].productId, PRODUCT2);
  assert.deepEqual(alerts.ok && alerts.alerts[0].locations.map((l) => [l.locationId, l.status]), [[STORE, "in_stock"]]);
  // 同じ報告で再び通知しない（lastNotifiedAt）
  assert.deepEqual(await takeStockAlertsAction({}), { ok: true, alerts: [] });

  // 残りわずかも「今買える」報告として通知する
  await sleep(5);
  await ds.addStockReport({ productId: PRODUCT2, locationId: STORE2, userId: "third", status: "low" });
  const low = await takeStockAlertsAction({});
  assert.deepEqual(low.ok && low.alerts[0].locations.map((l) => l.status), ["low"]);

  // OFF にすると通知しない（お気に入りは残る）
  const off = await setStockAlertAction({ productId: PRODUCT2, enabled: false });
  assert.ok(off.ok && off.favorite?.notifyInStock === false);
  await sleep(5);
  await ds.addStockReport({ productId: PRODUCT2, locationId: STORE, userId: "fourth", status: "in_stock" });
  assert.deepEqual(await takeStockAlertsAction({}), { ok: true, alerts: [] });
});

test("在庫通知の判定：基準時刻・古い報告・最新が売り切れの店舗", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const fav: Favorite = { productId: "p", createdAt: iso(600), notifyInStock: true, notifyEnabledAt: iso(120), lastNotifiedAt: iso(60) };
  assert.equal(stockAlertBaseline(fav), now - 60 * 60_000);
  assert.equal(stockAlertBaseline({ ...fav, notifyInStock: false }), null);
  const pl = (loc: string, status: StockStatus, minutesAgo: number | null): PlacementWithStock => ({
    placement: { id: `p__${loc}`, productId: "p", locationId: loc, firstSeenAt: iso(1000) },
    stock: { status, lastCheckedAt: minutesAgo === null ? null : iso(minutesAgo) },
  });
  const names = { product: () => "テスト商品", location: (id: string) => ({ name: `店${id}` }) };
  const alerts = findStockAlerts(
    [fav],
    [
      pl("a", "in_stock", 10), // 通知する
      pl("b", "in_stock", 90), // 前回の通知より前
      pl("c", "sold_out", 5), // 売り切れ
      pl("d", "unknown", null), // 未確認
      pl("e", "low", 30), // 残りわずか：通知する
    ],
    names,
    now,
  );
  assert.deepEqual(alerts[0].locations.map((l) => l.locationId), ["a", "e"]);
  // 24 時間より前の報告では通知しない
  const old = { ...fav, notifyEnabledAt: iso(3000), lastNotifiedAt: null, createdAt: iso(3000) };
  assert.deepEqual(findStockAlerts([old], [pl("a", "in_stock", 25 * 60)], names, now), []);
});

test("ルート：現在地あり＝現在地→店舗、現在地なし＝店舗を目的地（Google マップ / Apple マップ。API キーなし）", () => {
  const dest = { lat: 35.6595123, lng: 139.7005456 };
  const withOrigin = routeUrls(dest, { lat: 35.1234567, lng: 139.7654321 });
  assert.equal(withOrigin.google, "https://www.google.com/maps/dir/?api=1&destination=35.659512%2C139.700546&origin=35.12346%2C139.76543");
  assert.equal(withOrigin.apple, "https://maps.apple.com/?daddr=35.659512%2C139.700546&saddr=35.12346%2C139.76543");
  const noOrigin = routeUrls(dest, null);
  assert.equal(noOrigin.google, "https://www.google.com/maps/dir/?api=1&destination=35.659512%2C139.700546");
  assert.equal(noOrigin.apple, "https://maps.apple.com/?daddr=35.659512%2C139.700546");
  for (const url of [...Object.values(withOrigin), ...Object.values(noOrigin)]) assert.doesNotMatch(url, /key=/);
});

test("在庫の鮮度：24 時間以上前は古い（状態は変えない）・相対時刻", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const H = 3600_000;
  assert.equal(isStockStale(null, now), false); // 未確認は対象外
  assert.equal(isStockStale(ago(8 * 60_000), now), false);
  assert.equal(isStockStale(ago(23.9 * H), now), false);
  assert.equal(isStockStale(ago(24 * H), now), true);
  const d = new Date(now);
  assert.equal(formatRelativeTime(ago(12 * 60_000), d), "12分前");
  assert.equal(formatRelativeTime(ago(2 * H), d), "2時間前");
  assert.equal(formatRelativeTime(ago(30 * H), d), "昨日");
  assert.equal(formatRelativeTime(ago(50 * H), d), "2日前");
});

test("この店舗で見つけた：設置情報が無ければ作成・あれば再利用、在庫報告は毎回追加、10 分制限", async () => {
  const { reportStockAction } = await import("../src/app/actions/stockReports");
  const { getLocationDetail, getDataSource } = await import("../src/lib/data");
  const P = "tta-Y907104";
  const L = "gp-S90000105";
  // 設置情報なし → この店舗の商品一覧に出ない
  assert.ok(!(await getLocationDetail(L))!.products.some((e) => e.product.id === P));

  const first = await reportStockAction({ productId: P, locationId: L, status: "low" });
  assert.ok(first.ok && first.report.placementCreated === true);
  const detail = (await getLocationDetail(L))!;
  assert.deepEqual(detail.products.filter((e) => e.product.id === P).map((e) => e.stock.status), ["low"]);

  // 同じユーザー・同じ商品×店舗は 10 分に 1 回
  const limited = await reportStockAction({ productId: P, locationId: L, status: "sold_out" });
  assert.ok(!limited.ok && limited.error === "rate_limited" && limited.retryAfterSeconds > 0);

  // 別のユーザーの報告：設置情報は再利用（重複しない）、在庫状態は新しい報告で更新
  const ds = await getDataSource();
  const second = await ds.addStockReport({ productId: P, locationId: L, userId: "other", status: "sold_out" });
  assert.equal(second.placementCreated, false);
  const placements = await ds.listPlacementsWithStock({ productId: P, locationId: L });
  assert.equal(placements.length, 1);
  assert.equal(placements[0].stock.status, "sold_out");
  assert.equal((await ds.listStockReports({ productId: P, locationId: L })).length, 2);
});

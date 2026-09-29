/**
 * 実データ（data/collected の 23,464 商品・1,796 店舗）を使った画面用データ関数の結合テスト。
 * DATA_SOURCE=local（Firestore には接続しない。設置情報・在庫報告はメモリ上のみ）
 */
process.env.DATA_SOURCE = "local";

import assert from "node:assert/strict";
import { test } from "node:test";

const load = () => import("../src/lib/data");
const ds = async () => (await load()).getDataSource();

test("カタログ：23,464 商品・1,796 店舗を読み込める", async () => {
  const d = await ds();
  const catalog = await d.listCatalogProducts();
  const locations = await d.listLocations();
  assert.equal(catalog.length, 23464);
  assert.equal(locations.length, 1796);
  // 一覧用の軽量データに説明文などは含まない
  assert.equal("description" in catalog[0], false);
});

test("一覧（キーワードなし）：既定で過去の商品を含めず、発売中→発売予定→不明の順", async () => {
  const { searchProducts } = await load();
  const t = performance.now();
  const r = await searchProducts("");
  const ms = performance.now() - t;
  assert.equal(r.includePast, false);
  assert.ok(r.items.every((s) => s.releaseStatus !== "past"));
  assert.ok(r.hiddenPastCount > 20000, `hiddenPastCount=${r.hiddenPastCount}`);
  assert.equal(r.items.length, 40); // 1 ページ 40 件
  assert.equal(r.items[0].releaseStatus, "current");
  console.log(`  一覧: ${r.total} 件（過去 ${r.hiddenPastCount} 件は非表示）/ ${r.pageCount} ページ / ${ms.toFixed(0)}ms`);

  const all = await searchProducts("", { includePast: true, page: 999 });
  assert.equal(all.total, 23464);
  assert.equal(all.page, all.pageCount); // 範囲外のページは最終ページ
});

test("検索（キーワード）：過去の商品も含めるが、発売中・発売予定を先に並べる", async () => {
  const { searchProducts } = await load();
  const t = performance.now();
  const r = await searchProducts("ちいかわ", { pageSize: 1000 });
  const ms = performance.now() - t;
  assert.ok(r.total > 0);
  const order = { current: 0, upcoming: 1, unknown: 2, past: 3 };
  for (let i = 1; i < r.items.length; i++) {
    assert.ok(order[r.items[i - 1].releaseStatus] <= order[r.items[i].releaseStatus], "発売状況の順に並ぶ");
  }
  console.log(`  「ちいかわ」: ${r.total} 件 / ${ms.toFixed(0)}ms`);

  // ひらがな・カタカナの表記ゆれ・AND 検索・タグ（【再販】）
  assert.ok((await searchProducts("ガンダム ザク")).total > 0);
  assert.ok((await searchProducts("再販", { includePast: true })).total > 0);
});

test("新着：発売中の商品だけ・発売予定は別枠", async () => {
  const { getNewProducts, getUpcomingProducts } = await load();
  const newest = await getNewProducts(6);
  assert.equal(newest.length, 6);
  assert.ok(newest.every((s) => s.releaseStatus === "current"));
  const upcoming = await getUpcomingProducts(6);
  assert.ok(upcoming.every((s) => s.releaseStatus === "upcoming"));
});

test("商品詳細：1 件だけ取得し、欠損値は null のまま", async () => {
  const { getProductDetail } = await load();
  const d = await ds();
  const catalog = await d.listCatalogProducts();
  const noPrice = catalog.find((p) => p.price === null)!;
  const detail = await getProductDetail(noPrice.id);
  assert.ok(detail);
  assert.equal(detail.product.price, null);
  assert.equal(detail.locations.length, 0); // 設置情報はまだ無い（ユーザー投稿で集める）
  assert.equal(await getProductDetail("bandai-存在しない"), null);

  const taxExcluded = catalog.find((p) => p.priceTaxIncluded === false)!;
  assert.equal((await getProductDetail(taxExcluded.id))!.product.priceTaxIncluded, false);
});

test("在庫報告：設置情報が無い「実データの商品 × 実在の店舗」でも登録でき、画面に反映される", async () => {
  const { getProductDetail, getLocationDetail, searchProducts, getAvailableFinds, getTrendingProducts } = await load();
  const { PlacementNotFoundError, ReportRateLimitedError } = await import("../src/lib/data/source");
  const d = await ds();
  const product = (await d.listCatalogProducts()).find((p) => p.id === "bandai-4570118187086000")!;
  const locations = await d.listLocations();
  const located = locations.find((l) => l.id === "gp-S90000893")!;
  const noCoords = locations.find((l) => l.lat === null)!;
  assert.ok(product && located && noCoords);

  await d.addStockReport({ productId: product.id, locationId: located.id, userId: "u-test", status: "in_stock" });
  await d.addStockReport({ productId: product.id, locationId: noCoords.id, userId: "u-test", status: "low" });

  // 連投制限（同じユーザー・同じ商品×店舗）
  await assert.rejects(
    d.addStockReport({ productId: product.id, locationId: located.id, userId: "u-test", status: "sold_out" }),
    ReportRateLimitedError,
  );
  // 存在しない商品・店舗には報告できない
  await assert.rejects(
    d.addStockReport({ productId: "bandai-0", locationId: located.id, userId: "u-test", status: "in_stock" }),
    PlacementNotFoundError,
  );

  const pd = (await getProductDetail(product.id))!;
  assert.equal(pd.locations.length, 2);
  assert.equal(pd.locations[0].stock.status, "in_stock");

  const ld = (await getLocationDetail(located.id))!;
  assert.deepEqual(ld.products.map((e) => e.product.id), [product.id]);

  const available = await searchProducts("", { availableOnly: true, includePast: true });
  assert.deepEqual(available.items.map((s) => s.product.id), [product.id]);
  assert.equal(available.items[0].availableLocationCount, 2);

  // 近くの候補：座標のない店舗は含めない
  const finds = await getAvailableFinds();
  assert.deepEqual(finds.map((f) => f.location.id), [located.id]);

  assert.equal((await getTrendingProducts())[0].product.id, product.id);
});

test("店舗詳細：座標なしの店舗も表示でき、座標は null のまま", async () => {
  const { getLocationDetail } = await load();
  const d = await ds();
  const noCoords = (await d.listLocations()).find((l) => l.lat === null)!;
  const detail = (await getLocationDetail(noCoords.id))!;
  assert.equal(detail.location.lat, null);
  assert.equal(detail.location.lng, null);
});

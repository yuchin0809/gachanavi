/**
 * 収集データの変換・ID 生成のテスト（投入スクリプトと local データソースで共通の処理）
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { locationIdOf, productIdOf, resaleMonthOf, toGachaProduct, toLocation } from "../src/lib/catalog/collected";

const base = { id: "x", name: "商品", sourceUrl: "https://example.com/a" };

test("商品 ID は公式の識別子から作る", () => {
  assert.equal(
    productIdOf({ ...base, maker: "バンダイ", officialUrl: "https://gashapon.jp/products/detail.php?jan_code=4570118187086000" }),
    "bandai-4570118187086000",
  );
  assert.equal(productIdOf({ ...base, maker: "タカラトミーアーツ", makerItemCode: "Y907104" }), "tta-Y907104");
  assert.equal(productIdOf({ ...base, maker: "キタンクラブ", officialUrl: "https://kitan.jp/products/aip_moomin2/" }), "kitan-aip_moomin2");
  // スラッグが日本語の場合はハッシュ
  const id = productIdOf({
    ...base,
    maker: "アイピーフォー",
    officialUrl: "https://www.ip4.co.jp/cupsuletoy/%e3%81%b6%e3%82%8b/",
    sourceUrl: "https://www.ip4.co.jp/cupsuletoy/%e3%81%b6%e3%82%8b/",
  });
  assert.match(id, /^ip4-h[0-9a-f]{12}$/);
  assert.equal(id, productIdOf({ ...base, maker: "アイピーフォー", officialUrl: "https://www.ip4.co.jp/cupsuletoy/%e3%81%b6%e3%82%8b/", sourceUrl: "https://www.ip4.co.jp/cupsuletoy/%e3%81%b6%e3%82%8b/" }));
});

test("店舗 ID は公式の店舗コードから作る", () => {
  assert.equal(
    locationIdOf({ id: "", name: "a", address: "b", sources: [{ url: "https://gashapon.jp/shop/shop.php?shop_code=S90000893", shopCode: "S90000893" }] }),
    "gp-S90000893",
  );
  assert.equal(
    locationIdOf({ id: "", name: "a", address: "b", sources: [{ url: "https://bandainamco-am.co.jp/others/capsule-toy-store/store/tottorikita/" }] }),
    "bnam-dept-tottorikita",
  );
  assert.match(locationIdOf({ id: "", name: "a", address: "b", sources: [] }), /^loc-h[0-9a-f]{12}$/);
});

test("再発売月の抽出", () => {
  assert.equal(resaleMonthOf("2026年3月（3月23日週発売・2026年9月28日週再発売））"), "2026-09");
  assert.equal(resaleMonthOf("2026年9月 第1週"), null);
});

test("商品の変換：欠損値は null、区分はタグ、仮画像は null、http は https", () => {
  const p = toGachaProduct({
    ...base,
    maker: "トイズスピリッツ",
    name: "【再販】テスト　商品 ",
    price: null,
    releaseYearMonth: null,
    imageUrl: "https://www.takaratomy-arts.co.jp/common/images/noimage_main.png",
    officialUrl: "http://www.toysp.co.jp/2509tray.html",
    priceTaxIncluded: false,
  });
  assert.equal(p.name, "【再販】テスト 商品");
  assert.equal(p.price, null);
  assert.equal(p.releaseMonth, null);
  assert.equal(p.imageUrl, null);
  assert.equal(p.officialUrl, "https://www.toysp.co.jp/2509tray.html");
  assert.equal(p.priceTaxIncluded, false);
  assert.ok(p.tags.includes("再販"));
});

test("店舗の変換：座標なしは null（0 にしない）、エリアは市区町村", () => {
  const l = toLocation({ id: "", name: "＃C-pla テスト", address: "東京都渋谷区\n宇田川町 ﾋﾞﾙ", city: "渋谷区", lat: null, lng: 139.7 });
  assert.equal(l.lat, null);
  assert.equal(l.lng, null);
  assert.equal(l.area, "渋谷区");
  assert.equal(l.name, "#C-pla テスト");
  assert.equal(l.address, "東京都渋谷区 宇田川町 ビル");
});

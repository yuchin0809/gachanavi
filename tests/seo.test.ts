/**
 * SEO（src/lib/seo）のテスト：正規 URL・インデックス可否・タイトル／説明文・サイトマップ XML・JSON-LD。Firestore には接続しない。
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { breadcrumbJsonLd, productJsonLd, storeJsonLd } from "../src/lib/seo/jsonld";
import { absoluteUrl, isIndexable, siteUrl } from "../src/lib/seo/site";
import { PRODUCTS_PER_SITEMAP, productSitemapNames, sitemapIndex, urlset } from "../src/lib/seo/sitemap";
import {
  locationDescription,
  locationTitle,
  prefectureCodeOf,
  prefectureName,
  productDescription,
  productTitle,
  truncate,
} from "../src/lib/seo/text";
import type { GachaProduct, Location } from "../src/types";

const ENV_KEYS = ["NEXT_PUBLIC_SITE_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_ENV", "DATA_SOURCE", "SEO_INDEXABLE"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function setEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
}
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const product = {
  id: "bandai-123",
  name: "ねこだんご ミニフィギュア",
  maker: "カプセルワークス",
  price: 300,
  priceTaxIncluded: true,
  releaseMonth: "2026-09",
  resaleMonth: null,
  lineupCount: "全5種",
} as unknown as GachaProduct;

const store: Location = {
  id: "loc-1",
  name: "ガチャステーション 渋谷店",
  address: "東京都渋谷区宇田川町1-1",
  area: "渋谷",
  lat: 35.66,
  lng: 139.7,
  openingHours: null,
};

/* ---------------- 正規 URL・インデックス可否 ---------------- */

test("siteUrl: NEXT_PUBLIC_SITE_URL → VERCEL_PROJECT_PRODUCTION_URL → localhost（Preview の URL は使わない）", () => {
  setEnv({ NEXT_PUBLIC_SITE_URL: "https://gachanavi.example.jp", VERCEL_PROJECT_PRODUCTION_URL: "prod.vercel.app" });
  assert.equal(siteUrl().toString(), "https://gachanavi.example.jp/");
  assert.equal(absoluteUrl("/gacha/a"), "https://gachanavi.example.jp/gacha/a");
  setEnv({ VERCEL_PROJECT_PRODUCTION_URL: "prod.vercel.app", VERCEL_ENV: "preview" });
  assert.equal(siteUrl().toString(), "https://prod.vercel.app/");
  setEnv({});
  assert.equal(siteUrl().toString(), "http://localhost:3000/");
});

test("isIndexable: 本番（firestore・VERCEL_ENV=production）だけ。Preview・mock・local は出さない", () => {
  setEnv({ DATA_SOURCE: "firestore", VERCEL_ENV: "production" });
  assert.equal(isIndexable(), true);
  setEnv({ DATA_SOURCE: "firestore", VERCEL_ENV: "preview", NEXT_PUBLIC_SITE_URL: "https://x.jp" });
  assert.equal(isIndexable(), false);
  setEnv({ DATA_SOURCE: "firestore", VERCEL_ENV: "development" });
  assert.equal(isIndexable(), false);
  setEnv({ DATA_SOURCE: "mock", VERCEL_ENV: "production" });
  assert.equal(isIndexable(), false);
  setEnv({ DATA_SOURCE: "local", NEXT_PUBLIC_SITE_URL: "https://x.jp" });
  assert.equal(isIndexable(), false);
  setEnv({ DATA_SOURCE: "firestore" });
  assert.equal(isIndexable(), false, "Vercel 以外は NEXT_PUBLIC_SITE_URL が必要");
  setEnv({ DATA_SOURCE: "firestore", NEXT_PUBLIC_SITE_URL: "https://x.jp" });
  assert.equal(isIndexable(), true);
  setEnv({ DATA_SOURCE: "firestore", VERCEL_ENV: "production", SEO_INDEXABLE: "false" });
  assert.equal(isIndexable(), false, "緊急停止");
  setEnv({ DATA_SOURCE: "mock", SEO_INDEXABLE: "true" });
  assert.equal(isIndexable(), true, "テスト用の上書き");
});

/* ---------------- タイトル・説明文 ---------------- */

test("productTitle / productDescription: 商品名と実際のデータだけで作る", () => {
  assert.equal(productTitle(product), "ねこだんご ミニフィギュア｜設置店舗・在庫情報");
  const d = productDescription(product, 3);
  assert.match(d, /^「ねこだんご ミニフィギュア」の設置店舗と在庫情報。/);
  assert.match(d, /カプセルワークス・1回300円/);
  assert.match(d, /2026年9月発売/);
  assert.match(d, /3店舗で設置が報告されています。/);
  assert.ok([...d].length <= 160);
});

test("productDescription: 設置情報が無い商品は「登録されていません」（在庫ありとは書かない）", () => {
  const d = productDescription({ ...product, maker: "", price: null, releaseMonth: null, lineupCount: null }, 0);
  assert.match(d, /現在、設置店舗の情報は登録されていません。/);
  assert.doesNotMatch(d, /在庫あり|販売中|最安/);
  assert.doesNotMatch(d, /円|発売/);
});

test("タイトル・説明文は商品ごとに異なり、長い名前は切り詰める", () => {
  const other = { ...product, id: "x", name: "ふわもこアルパカ 寝そべりぬいぐるみ" } as GachaProduct;
  assert.notEqual(productTitle(product), productTitle(other));
  assert.notEqual(productDescription(product, 1), productDescription(other, 1));
  const long = { ...product, name: "あ".repeat(120) } as GachaProduct;
  assert.equal([...productTitle(long)].length, 48 + "｜設置店舗・在庫情報".length);
  assert.ok([...productDescription(long, 1)].length <= 160);
  assert.equal(truncate("abcdef", 4), "abc…");
});

test("productTitle: 同名の商品があるときだけ発売時期を添える（不明なら付けない）", () => {
  assert.equal(productTitle(product, true), "ねこだんご ミニフィギュア（2026年9月発売）｜設置店舗・在庫情報");
  assert.equal(productTitle({ ...product, releaseMonth: null }, true), "ねこだんご ミニフィギュア｜設置店舗・在庫情報");
  assert.notEqual(productTitle(product, true), productTitle({ ...product, releaseMonth: "2018-03" }, true));
});

test("locationTitle / locationDescription", () => {
  assert.equal(locationTitle(store), "ガチャステーション 渋谷店｜ガチャガチャの設置情報");
  assert.match(locationDescription(store, 4), /（東京都渋谷区宇田川町1-1）.*4種類のガチャの設置が報告されています/);
  assert.match(locationDescription({ ...store, address: "" }, 0), /^ガチャステーション 渋谷店のガチャガチャ.*登録されていません/);
});

test("prefectureCodeOf / prefectureName（JIS コード）", () => {
  assert.equal(prefectureCodeOf("東京都渋谷区"), "13");
  assert.equal(prefectureCodeOf("北海道札幌市"), "01");
  assert.equal(prefectureCodeOf(" 沖縄県那覇市"), "47");
  assert.equal(prefectureCodeOf("京都府京都市"), "26");
  assert.equal(prefectureCodeOf("渋谷区"), null);
  assert.equal(prefectureName("13"), "東京都");
  assert.equal(prefectureName("00"), null);
  assert.equal(prefectureName("48"), null);
  assert.equal(prefectureName("1"), null);
  assert.equal(prefectureName("abc"), null);
});

/* ---------------- サイトマップ ---------------- */

test("urlset / sitemapIndex: 絶対 URL・XML エスケープ・lastmod は分かるときだけ", () => {
  setEnv({ NEXT_PUBLIC_SITE_URL: "https://gachanavi.example.jp" });
  const xml = urlset([{ path: "/gacha/a&b" }, { path: "/locations/x", lastModified: "2026-09-01T00:00:00.000Z" }]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<url>\s*<loc>https:\/\/gachanavi\.example\.jp\/gacha\/a&amp;b<\/loc>\s*<\/url>/);
  assert.match(xml, /<loc>https:\/\/gachanavi\.example\.jp\/locations\/x<\/loc>\s*<lastmod>2026-09-01T00:00:00.000Z<\/lastmod>/);
  assert.equal(xml.match(/<lastmod>/g)?.length, 1);
  const idx = sitemapIndex(["pages.xml", "products-1.xml"]);
  assert.match(idx, /<sitemapindex /);
  assert.match(idx, /<loc>https:\/\/gachanavi\.example\.jp\/sitemaps\/products-1\.xml<\/loc>/);
});

test("sitemapIndex: Google が読める sitemap index（XML 宣言・名前空間・<sitemap><loc>）", () => {
  setEnv({ NEXT_PUBLIC_SITE_URL: "https://gachanavi-alpha.vercel.app" });
  assert.equal(
    sitemapIndex(["pages.xml", "products-1.xml"]),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      "  <sitemap>",
      "    <loc>https://gachanavi-alpha.vercel.app/sitemaps/pages.xml</loc>",
      "  </sitemap>",
      "  <sitemap>",
      "    <loc>https://gachanavi-alpha.vercel.app/sitemaps/products-1.xml</loc>",
      "  </sitemap>",
      "</sitemapindex>",
      "",
    ].join("\n"),
  );
});

test("productSitemapNames: 10,000 件ずつに分割（1 ファイル 50,000 URL の上限内）", () => {
  assert.ok(PRODUCTS_PER_SITEMAP <= 50_000);
  assert.deepEqual(productSitemapNames(0), ["products-1.xml"]);
  assert.deepEqual(productSitemapNames(10_000), ["products-1.xml"]);
  assert.deepEqual(productSitemapNames(23_456), ["products-1.xml", "products-2.xml", "products-3.xml"]);
});

/* ---------------- JSON-LD ---------------- */

test("productJsonLd: 実データだけ（評価・レビュー・SKU・ブランド・在庫状況は入れない）", () => {
  setEnv({ NEXT_PUBLIC_SITE_URL: "https://gachanavi.example.jp" });
  const ld = productJsonLd(product, "説明");
  assert.equal(ld["@type"], "Product");
  assert.equal(ld.url, "https://gachanavi.example.jp/gacha/bandai-123");
  assert.equal(ld.image, "https://gachanavi.example.jp/gacha/bandai-123/opengraph-image");
  assert.deepEqual(ld.manufacturer, { "@type": "Organization", name: "カプセルワークス" });
  const offers = ld.offers as Record<string, unknown>;
  assert.equal(offers.price, 300);
  assert.equal(offers.priceCurrency, "JPY");
  const json = JSON.stringify(ld);
  for (const k of ["aggregateRating", "review", "sku", "gtin", "brand", "availability"]) assert.ok(!json.includes(`"${k}"`), k);
  assert.doesNotMatch(json, /InStock/);
});

test("productJsonLd: 価格・メーカーが不明なら offers・manufacturer を付けない", () => {
  const ld = productJsonLd({ ...product, price: null, maker: "" } as GachaProduct, "説明");
  assert.equal(ld.offers, undefined);
  assert.equal(ld.manufacturer, undefined);
});

test("storeJsonLd: 住所・座標は分かるときだけ", () => {
  setEnv({ NEXT_PUBLIC_SITE_URL: "https://gachanavi.example.jp" });
  const ld = storeJsonLd(store) as Record<string, Record<string, unknown>>;
  assert.equal(ld["@type"] as unknown, "Store");
  assert.equal(ld.address.addressRegion, "東京都");
  assert.equal(ld.geo.latitude, 35.66);
  const bare = storeJsonLd({ ...store, address: "", lat: null, lng: null });
  assert.equal(bare.address, undefined);
  assert.equal(bare.geo, undefined);
});

test("breadcrumbJsonLd: 表示と同じ順番・最後は現在のページ", () => {
  setEnv({ NEXT_PUBLIC_SITE_URL: "https://gachanavi.example.jp" });
  const ld = breadcrumbJsonLd([{ name: "ホーム", href: "/" }, { name: "ガチャを探す", href: "/search" }, { name: "商品" }], "/gacha/a");
  const items = ld.itemListElement as { position: number; name: string; item: string }[];
  assert.deepEqual(
    items.map((i) => [i.position, i.name, i.item]),
    [
      [1, "ホーム", "https://gachanavi.example.jp/"],
      [2, "ガチャを探す", "https://gachanavi.example.jp/search"],
      [3, "商品", "https://gachanavi.example.jp/gacha/a"],
    ],
  );
});

/* ---------------- 存在しない URL は 404（Firestore の不正な ID で 500 にしない） ---------------- */

test("isValidDocId: Firestore で使えない ID は読まずに「見つからない」", async () => {
  const { isValidDocId } = await import("../src/lib/data/firestoreSource");
  for (const ok of ["p-001", "bandai-123", "ねこ"]) assert.equal(isValidDocId(ok), true, ok);
  for (const ng of ["", ".", "..", "a/b", "__nope__", "__x__", "a".repeat(1501)]) assert.equal(isValidDocId(ng), false, ng);
});

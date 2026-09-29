/**
 * 発売状況・欠損値の表示・距離計算のテスト（Firestore にはアクセスしない）
 *   npm test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDistance, formatPrice, formatReleaseMonth } from "../src/lib/format";
import { distanceOrNull, googleMapsUrl, hasCoordinates, pickNearbyFinds } from "../src/lib/geo";
import { displayableImageUrl } from "../src/lib/images";
import { currentMonth, latestMonth, releaseStatusOf } from "../src/lib/release";
import type { NearbyFindCandidate } from "../src/types";

const NOW = new Date("2026-09-30T03:00:00Z"); // 日本時間 2026-09-30

test("今月は日本時間で判定する", () => {
  assert.equal(currentMonth(new Date("2026-09-30T16:00:00Z")), "2026-10"); // 日本時間 10/1 1:00
  assert.equal(currentMonth(NOW), "2026-09");
});

test("発売状況：upcoming / current（6か月以内）/ past / unknown", () => {
  const s = (releaseMonth: string | null, resaleMonth: string | null = null) =>
    releaseStatusOf({ releaseMonth, resaleMonth }, NOW);
  assert.equal(s("2026-10"), "upcoming");
  assert.equal(s("2027-02"), "upcoming");
  assert.equal(s("2026-09"), "current");
  assert.equal(s("2026-04"), "current");
  assert.equal(s("2026-03"), "past");
  assert.equal(s("2000-02"), "past");
  assert.equal(s(null), "unknown");
  assert.equal(s("不正な値"), "unknown");
});

test("再発売月がある商品は、発売月と再発売月の新しい方で判定する", () => {
  assert.equal(latestMonth({ releaseMonth: "2026-03", resaleMonth: "2026-09" }), "2026-09");
  assert.equal(releaseStatusOf({ releaseMonth: "2026-03", resaleMonth: "2026-09" }, NOW), "current");
  assert.equal(releaseStatusOf({ releaseMonth: "2019-01", resaleMonth: "2026-11" }, NOW), "upcoming");
  assert.equal(releaseStatusOf({ releaseMonth: null, resaleMonth: "2026-08" }, NOW), "current");
});

test("欠損値の表示：価格・発売時期・距離", () => {
  assert.equal(formatPrice(null), "価格情報なし");
  assert.equal(formatPrice(300), "300円");
  assert.equal(formatPrice(273, false), "273円（税抜）");
  assert.equal(formatPrice(300, true), "300円");
  assert.equal(formatReleaseMonth(null), "発売時期不明");
  assert.equal(formatReleaseMonth("2026-09"), "2026年9月");
  assert.equal(formatDistance(null), "距離情報なし");
  assert.equal(formatDistance(1234), "1.2km");
});

test("座標なしの場所は 0 として扱わず、距離を計算しない", () => {
  const origin = { lat: 35.658, lng: 139.7016 };
  assert.equal(hasCoordinates({ lat: null, lng: null }), false);
  assert.equal(distanceOrNull(origin, { lat: null, lng: null }), null);
  assert.ok((distanceOrNull(origin, { lat: 35.66, lng: 139.7 }) ?? -1) > 0);
  // 座標なしは店名・住所で検索する URL にする
  assert.match(googleMapsUrl({ lat: null, lng: null, name: "店", address: "東京都" }), /query=%E5%BA%97%20/);
});

test("近くの候補から座標なしの場所を除く", () => {
  const product = {
    id: "p", name: "n", series: "", maker: "m", price: null, priceTaxIncluded: null, releaseMonth: null,
    resaleMonth: null, imageUrl: null, characters: [], tags: [],
  };
  const stock = { status: "in_stock" as const, lastCheckedAt: null };
  const base = { name: "x", address: "", area: "", openingHours: null };
  const candidates: NearbyFindCandidate[] = [
    { product, stock, location: { ...base, id: "a", lat: null, lng: null } },
    { product: { ...product, id: "q" }, stock, location: { ...base, id: "b", lat: 35.66, lng: 139.7 } },
  ];
  const found = pickNearbyFinds(candidates, { lat: 35.658, lng: 139.7016 });
  assert.deepEqual(found.map((f) => f.location.id), ["b"]);
});

test("画像：権利確認が済んでいない外部画像は表示しない", () => {
  assert.equal(displayableImageUrl("https://bandai-a.akamaihd.net/bc/img/model/xl/1.jpg"), null);
  assert.equal(displayableImageUrl("http://example.com/a.jpg"), null);
  assert.equal(displayableImageUrl("/images/gacha/p-001.svg"), "/images/gacha/p-001.svg");
  assert.equal(displayableImageUrl("//evil.example.com/a.jpg"), null);
  assert.equal(displayableImageUrl(null), null);
});

/**
 * 在庫報告の Server Action（入力検証 → 報告者 → 保存）を実データで確認する。
 * DATA_SOURCE=local のため Firestore には接続しない。
 */
process.env.DATA_SOURCE = "local";

import assert from "node:assert/strict";
import { test } from "node:test";

test("Server Action：実データの商品 ID・店舗 ID で報告でき、不正な入力は拒否する", async () => {
  const { reportStockAction } = await import("../src/app/actions/stockReports");
  const ok = await reportStockAction({ productId: "tta-Y907104", locationId: "gp-S90001158", status: "in_stock", idToken: null });
  assert.equal(ok.ok, true);

  const again = await reportStockAction({ productId: "tta-Y907104", locationId: "gp-S90001158", status: "low", idToken: null });
  assert.equal(again.ok, false);
  assert.equal(!again.ok && again.error, "rate_limited");

  const bad = await reportStockAction({ productId: "../etc", locationId: "gp-S90001158", status: "in_stock" });
  assert.equal(!bad.ok && bad.error, "invalid_input");

  const missing = await reportStockAction({ productId: "tta-NOPE", locationId: "gp-S90001158", status: "in_stock" });
  assert.equal(!missing.ok && missing.error, "placement_not_found");
});

test("Server Action：店舗検索（店舗名・地名・住所の AND 検索、件数上限、不正な入力）", async () => {
  const { searchLocationsAction } = await import("../src/app/actions/locations");

  const kuzuha = await searchLocationsAction("枚方 くずは");
  assert.ok(kuzuha.ok);
  assert.ok(kuzuha.ok && kuzuha.items.some((l) => l.id === "gp-S90000893")); // #C-pla くずはモール店
  assert.ok(kuzuha.ok && kuzuha.items.every((l) => Object.keys(l).sort().join() === "address,area,id,lat,lng,name"));

  // カタカナ・ひらがな、全角・半角を区別しない
  const kana = await searchLocationsAction("ｸｽﾞﾊ");
  assert.ok(kana.ok && kana.items.some((l) => l.id === "gp-S90000893"));

  // 多く当たる語は 20 件まで返し、全件数も返す
  const tokyo = await searchLocationsAction("東京都");
  assert.ok(tokyo.ok && tokyo.items.length === 20 && tokyo.total > 20);

  // 店舗名に含まれるものを先に並べる
  const shibuya = await searchLocationsAction("渋谷");
  assert.ok(shibuya.ok && shibuya.items[0].name.includes("渋谷"));

  const empty = await searchLocationsAction("   ");
  assert.deepEqual(empty, { ok: true, items: [], total: 0 });
  const none = await searchLocationsAction("該当しない店舗名xyz");
  assert.ok(none.ok && none.total === 0);

  assert.deepEqual(await searchLocationsAction(123), { ok: false, error: "invalid_input" });
  assert.deepEqual(await searchLocationsAction("あ".repeat(61)), { ok: false, error: "invalid_input" });
});

test("「この店で見つけた」：実データの商品 × 検索で選んだ店舗で報告すると、商品詳細・店舗詳細に反映される", async () => {
  const { searchLocationsAction } = await import("../src/app/actions/locations");
  const { reportStockAction } = await import("../src/app/actions/stockReports");
  const { getProductDetail, getLocationDetail } = await import("../src/lib/data");

  const found = await searchLocationsAction("ドリームカプセル 津");
  const store = found.ok ? found.items.find((l) => l.id === "dream-2327") : undefined; // 座標なしの店舗
  assert.ok(store);

  const productId = "bandai-4582770068238000"; // 発売予定の商品
  const res = await reportStockAction({ productId, locationId: store.id, status: "low" });
  assert.equal(res.ok, true);

  const product = await getProductDetail(productId);
  const entry = product?.locations.find((e) => e.location.id === store.id);
  assert.equal(entry?.stock.status, "low");
  assert.equal(entry?.location.lat, null);

  const location = await getLocationDetail(store.id);
  assert.ok(location?.products.some((e) => e.product.id === productId));
});

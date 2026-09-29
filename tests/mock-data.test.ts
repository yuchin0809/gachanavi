/**
 * モックデータでの互換性テスト（既存の画面・在庫報告が壊れていないこと）
 */
process.env.DATA_SOURCE = "mock";

import assert from "node:assert/strict";
import { test } from "node:test";

test("モック：検索・新着・詳細・在庫報告", async () => {
  const data = await import("../src/lib/data");
  const { PlacementNotFoundError } = await import("../src/lib/data/source");
  const all = await data.searchProducts("", { includePast: true });
  assert.equal(all.total, 10);
  assert.ok((await data.searchProducts("ねこ")).total > 0);
  const detail = await data.getProductDetail("p-001");
  assert.ok(detail && detail.locations.length > 0);
  const loc = await data.getLocationDetail("l-001");
  assert.ok(loc && loc.products.length > 0);
  assert.ok((await data.getTrendingProducts()).length > 0);
  assert.ok((await data.getAvailableFinds()).length > 0);

  const ds = await data.getDataSource();
  // 既存の設置情報への報告
  await ds.addStockReport({ productId: "p-001", locationId: "l-001", userId: "u-9", status: "low" });
  // 設置情報が無い組み合わせでも、商品・場所が存在すれば報告できる
  await ds.addStockReport({ productId: "p-009", locationId: "l-001", userId: "u-9", status: "in_stock" });
  await assert.rejects(ds.addStockReport({ productId: "p-999", locationId: "l-001", userId: "u-9", status: "low" }), PlacementNotFoundError);
});

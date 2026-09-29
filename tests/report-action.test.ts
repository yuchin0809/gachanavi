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

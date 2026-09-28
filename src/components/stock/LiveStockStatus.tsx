"use client";

import type { ID, StockSnapshot } from "@/types";
import { LastChecked } from "./LastChecked";
import { StockBadge } from "./StockBadge";
import { useStockSnapshot } from "./StockReportsProvider";

/** ローカルの在庫報告を反映した在庫バッジ + 最終確認時刻 */
export function LiveStockStatus({
  productId,
  locationId,
  initial,
  size = "md",
  layout = "column",
}: {
  productId: ID;
  locationId: ID;
  initial: StockSnapshot;
  size?: "sm" | "md" | "lg";
  layout?: "row" | "column";
}) {
  const stock = useStockSnapshot(productId, locationId, initial);
  return (
    <div className={layout === "row" ? "flex flex-wrap items-center gap-2" : "flex flex-col items-end gap-1"}>
      <StockBadge status={stock.status} size={size} />
      <LastChecked at={stock.lastCheckedAt} />
    </div>
  );
}

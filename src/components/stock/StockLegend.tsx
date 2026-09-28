import { STOCK_STATUS_META } from "@/lib/stock";
import type { StockStatus } from "@/types";
import { StockDot } from "./StockBadge";

const ORDER: StockStatus[] = ["in_stock", "low", "sold_out", "unknown"];

export function StockLegend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {ORDER.map((status) => (
        <li key={status} className="inline-flex items-center gap-1">
          <StockDot status={status} className="h-2 w-2" />
          {STOCK_STATUS_META[status].label}
        </li>
      ))}
    </ul>
  );
}

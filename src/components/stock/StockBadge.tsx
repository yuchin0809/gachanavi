import { STOCK_STATUS_META } from "@/lib/stock";
import type { StockStatus } from "@/types";

export function StockDot({ status, className = "h-2.5 w-2.5" }: { status: StockStatus; className?: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 rounded-full ${STOCK_STATUS_META[status].dotClass} ${className}`} />;
}

export function StockBadge({ status, size = "md" }: { status: StockStatus; size?: "sm" | "md" | "lg" }) {
  const meta = STOCK_STATUS_META[status];
  const sizeClass = {
    sm: "h-6 gap-1.5 px-2 text-xs",
    md: "h-7 gap-1.5 px-2.5 text-sm",
    lg: "h-9 gap-2 px-3.5 text-base",
  }[size];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full font-bold ring-1 ring-inset ${meta.badgeClass} ${sizeClass}`}>
      <StockDot status={status} className={size === "lg" ? "h-3 w-3" : "h-2.5 w-2.5"} />
      {meta.label}
    </span>
  );
}

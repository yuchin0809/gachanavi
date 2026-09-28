import Link from "next/link";
import { ChevronRightIcon, StoreIcon } from "@/components/ui/Icons";
import { StockDot } from "@/components/stock/StockBadge";
import { formatPrice } from "@/lib/format";
import type { GachaProductSummary } from "@/types";
import { GachaImage } from "./GachaImage";

/** 検索結果の1行 */
export function SearchResultItem({ summary }: { summary: GachaProductSummary }) {
  const { product, locationCount, availableLocationCount } = summary;
  const hasStock = availableLocationCount > 0;
  return (
    <Link
      href={`/gacha/${product.id}`}
      className="flex gap-3 rounded-2xl bg-surface p-3 shadow-card ring-1 ring-line transition hover:ring-ink/30"
    >
      <GachaImage product={product} sizes="112px" className="w-24 shrink-0 rounded-xl sm:w-28" />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-xs text-muted">{product.series}</p>
        <p className="line-clamp-2 font-bold leading-snug">{product.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted">
          {product.maker}・<span className="font-bold text-ink">{formatPrice(product.price)}</span>
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs">
          <span className="inline-flex items-center gap-1 text-muted">
            <StoreIcon className="h-3.5 w-3.5" />
            設置 {locationCount}店舗
          </span>
          <span
            className={`inline-flex items-center gap-1 font-bold ${hasStock ? "text-stock-in-ink" : "text-muted"}`}
          >
            <StockDot status={hasStock ? "in_stock" : "unknown"} className="h-2 w-2" />
            在庫あり報告 {availableLocationCount}店舗
          </span>
        </div>
      </div>
      <ChevronRightIcon className="h-5 w-5 shrink-0 self-center text-muted" />
    </Link>
  );
}

import Link from "next/link";
import { formatPrice } from "@/lib/format";
import type { GachaProductSummary } from "@/types";
import { GachaImage } from "./GachaImage";

/** トップページの横スクロール用カード */
export function GachaCard({ summary, badge }: { summary: GachaProductSummary; badge?: string }) {
  const { product, locationCount, availableLocationCount } = summary;
  return (
    <Link
      href={`/gacha/${product.id}`}
      className="group block w-40 shrink-0 overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-line transition hover:-translate-y-0.5 sm:w-44"
    >
      <div className="relative">
        <GachaImage product={product} sizes="176px" className="transition group-hover:scale-[1.03]" />
        {badge && (
          <span className="absolute left-2 top-2 rounded-full bg-ink/85 px-2 py-0.5 text-[11px] font-bold text-white">
            {badge}
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="truncate text-[11px] text-muted">{product.series}</p>
        <p className="mt-0.5 line-clamp-2 min-h-[2.5em] text-sm font-bold leading-tight">{product.name}</p>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="font-bold">{formatPrice(product.price)}</span>
          <span className={availableLocationCount > 0 ? "font-bold text-stock-in-ink" : "text-muted"}>
            在庫 {availableLocationCount}/{locationCount}店
          </span>
        </div>
      </div>
    </Link>
  );
}

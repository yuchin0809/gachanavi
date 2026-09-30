import Link from "next/link";
import { RELEASE_STATUS_LABEL } from "@/lib/release";
import type { GachaProductSummary } from "@/types";
import { GachaImage } from "./GachaImage";

/** トップページの横スクロール用カード */
export function GachaCard({ summary, badge }: { summary: GachaProductSummary; badge?: string }) {
  const { product, releaseStatus, locationCount, availableLocationCount } = summary;
  return (
    <Link
      href={`/gacha/${product.id}`}
      className="group block w-40 shrink-0 overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-line transition hover:-translate-y-0.5 sm:w-44"
    >
      <div className="relative">
        {/* 商品名・メーカー・価格・発売月は画像の下部に表示される */}
        <GachaImage product={product} sizes="176px" variant="full" />
        {badge && (
          <span className="absolute left-2 top-2 rounded-full bg-ink/85 px-2 py-0.5 text-[11px] font-bold text-white">
            {badge}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs">
        <span className="min-w-0 truncate text-[11px] text-muted">
          {releaseStatus === "upcoming" ? (
            <span className="font-bold text-brand-ink">{RELEASE_STATUS_LABEL.upcoming}</span>
          ) : (
            product.series
          )}
        </span>
        <span className={`shrink-0 ${availableLocationCount > 0 ? "font-bold text-stock-in-ink" : "text-muted"}`}>
          在庫 {availableLocationCount}/{locationCount}店
        </span>
      </div>
    </Link>
  );
}

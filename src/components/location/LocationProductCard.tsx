"use client";

import Link from "next/link";
import { useState } from "react";
import { GachaImage } from "@/components/gacha/GachaImage";
import { LiveStockStatus } from "@/components/stock/LiveStockStatus";
import { StockReportPanel } from "@/components/stock/StockReportPanel";
import { formatPrice } from "@/lib/format";
import type { ID, LocationProductEntry } from "@/types";

/** 設置場所詳細：この場所にあるガチャ1件（在庫状態 + 報告UI） */
export function LocationProductCard({
  locationId,
  entry,
  highlighted = false,
}: {
  locationId: ID;
  entry: LocationProductEntry;
  highlighted?: boolean;
}) {
  const { product, stock } = entry;
  const [reportOpen, setReportOpen] = useState(highlighted);

  return (
    <article
      className={`rounded-2xl bg-surface p-3 shadow-card ${highlighted ? "ring-2 ring-brand" : "ring-1 ring-line"}`}
    >
      <div className="flex gap-3">
        <Link href={`/gacha/${product.id}`} className="shrink-0">
          <GachaImage product={product} sizes="96px" className={`rounded-xl ${highlighted ? "w-24" : "w-18"}`} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] text-muted">{product.series}</p>
          <Link href={`/gacha/${product.id}`} className="line-clamp-2 text-sm font-bold leading-snug hover:underline">
            {product.name}
          </Link>
          <p className="text-xs text-muted">{formatPrice(product.price)}</p>
          <div className="mt-2">
            <LiveStockStatus
              productId={product.id}
              locationId={locationId}
              initial={stock}
              size={highlighted ? "lg" : "md"}
              layout="row"
            />
          </div>
        </div>
      </div>

      {reportOpen ? (
        <div className="mt-3">
          <StockReportPanel productId={product.id} locationId={locationId} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="mt-3 h-10 w-full rounded-xl border border-line text-sm font-bold text-ink hover:bg-canvas"
        >
          在庫を報告する
        </button>
      )}
    </article>
  );
}

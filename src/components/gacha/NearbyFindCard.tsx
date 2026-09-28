import Link from "next/link";
import { LiveStockStatus } from "@/components/stock/LiveStockStatus";
import { PinIcon } from "@/components/ui/Icons";
import { formatDistance } from "@/lib/format";
import type { NearbyFind } from "@/types";
import { GachaImage } from "./GachaImage";

/** 📍 近くで見つかったガチャ の1件 */
export function NearbyFindCard({ find }: { find: NearbyFind }) {
  const { product, location, stock, distanceMeters } = find;
  return (
    <div className="flex gap-3 rounded-2xl bg-surface p-3 shadow-card ring-1 ring-line">
      <Link href={`/gacha/${product.id}`} className="shrink-0">
        <GachaImage product={product} sizes="80px" className="w-20 rounded-xl" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/gacha/${product.id}`} className="line-clamp-2 text-sm font-bold leading-snug hover:underline">
          {product.name}
        </Link>
        <Link
          href={`/locations/${location.id}?product=${product.id}`}
          className="mt-1 flex items-center gap-1 text-xs text-muted hover:text-ink"
        >
          <PinIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{location.name}</span>
          <span className="shrink-0 font-bold text-ink">{formatDistance(distanceMeters)}</span>
        </Link>
        <div className="mt-1.5">
          <LiveStockStatus productId={product.id} locationId={location.id} initial={stock} size="sm" layout="row" />
        </div>
      </div>
    </div>
  );
}

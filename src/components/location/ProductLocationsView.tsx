"use client";

import Link from "next/link";
import { useState } from "react";
import { LocationMap, type MapMarker } from "@/components/map/LocationMap";
import { LastChecked } from "@/components/stock/LastChecked";
import { StockBadge } from "@/components/stock/StockBadge";
import { StockLegend } from "@/components/stock/StockLegend";
import { useStockResolver } from "@/components/stock/StockReportsProvider";
import { ChevronRightIcon } from "@/components/ui/Icons";
import { formatDistance } from "@/lib/format";
import { distanceMeters } from "@/lib/geo";
import { STOCK_STATUS_ORDER } from "@/lib/stock";
import type { GeoPoint, ID, ProductLocationEntry } from "@/types";

type View = "list" | "map";

/** 商品詳細の「このガチャが見つかった場所」：地図 + 設置場所リスト */
export function ProductLocationsView({
  productId,
  entries,
  currentPosition,
}: {
  productId: ID;
  entries: ProductLocationEntry[];
  currentPosition: GeoPoint;
}) {
  const resolve = useStockResolver();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");

  const resolved = entries
    .map((e) => ({
      ...e,
      stock: resolve(productId, e.location.id, e.stock),
      distance: distanceMeters(currentPosition, e.location),
    }))
    .sort((a, b) => STOCK_STATUS_ORDER[a.stock.status] - STOCK_STATUS_ORDER[b.stock.status] || a.distance - b.distance);

  const markers: MapMarker[] = resolved.map((e) => ({
    id: e.location.id,
    label: e.location.name,
    lat: e.location.lat,
    lng: e.location.lng,
    status: e.stock.status,
  }));

  if (entries.length === 0) {
    return (
      <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted ring-1 ring-line">
        まだ設置場所が報告されていません。
      </p>
    );
  }

  function selectFromMap(id: string) {
    setSelectedId(id);
    document.getElementById(`loc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <StockLegend />
        {/* スマホでは地図とリストを切り替え、PC では両方表示 */}
        <div className="flex shrink-0 rounded-full bg-line/70 p-0.5 text-xs font-bold sm:hidden" role="tablist">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 ${view === v ? "bg-surface shadow" : "text-muted"}`}
            >
              {v === "list" ? "リスト" : "地図"}
            </button>
          ))}
        </div>
      </div>

      <div className={`mb-3 ${view === "map" ? "block" : "hidden"} sm:block`}>
        <LocationMap
          markers={markers}
          currentPosition={currentPosition}
          selectedId={selectedId}
          onSelect={selectFromMap}
        />
      </div>

      <ul className={`space-y-2 ${view === "list" ? "block" : "hidden"} sm:block`}>
        {resolved.map(({ location, stock, distance }) => {
          const selected = location.id === selectedId;
          return (
            <li key={location.id} id={`loc-${location.id}`}>
              <Link
                href={`/locations/${location.id}?product=${productId}`}
                onMouseEnter={() => setSelectedId(location.id)}
                className={`flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card ring-1 transition ${
                  selected ? "ring-2 ring-ink" : "ring-line hover:ring-ink/30"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-bold leading-snug">{location.name}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {location.area}・現在地から{formatDistance(distance)}
                  </p>
                  <LastChecked at={stock.lastCheckedAt} className="mt-1" />
                </div>
                <StockBadge status={stock.status} />
                <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

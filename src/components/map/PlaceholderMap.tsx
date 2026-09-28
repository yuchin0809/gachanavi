"use client";

import { STOCK_STATUS_META } from "@/lib/stock";
import type { GeoPoint } from "@/types";
import type { LocationMapProps } from "./types";

/** 1件しかない場合などに使う最小表示範囲（度） */
const MIN_SPAN = 0.02;
const PADDING_RATIO = 0.18;

interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function computeBounds(points: GeoPoint[]): Bounds {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);

  const latSpan = Math.max(maxLat - minLat, MIN_SPAN);
  const lngSpan = Math.max(maxLng - minLng, MIN_SPAN);
  const latMid = (minLat + maxLat) / 2;
  const lngMid = (minLng + maxLng) / 2;
  minLat = latMid - (latSpan / 2) * (1 + PADDING_RATIO * 2);
  maxLat = latMid + (latSpan / 2) * (1 + PADDING_RATIO * 2);
  minLng = lngMid - (lngSpan / 2) * (1 + PADDING_RATIO * 2);
  maxLng = lngMid + (lngSpan / 2) * (1 + PADDING_RATIO * 2);
  return { minLat, maxLat, minLng, maxLng };
}

function project(point: GeoPoint, b: Bounds) {
  const left = ((point.lng - b.minLng) / (b.maxLng - b.minLng)) * 100;
  const top = ((b.maxLat - point.lat) / (b.maxLat - b.minLat)) * 100;
  // ピンは座標から上方向に描画されるため、上端側に余白を多めに取る
  return { left: `${left}%`, top: `${12 + top * 0.85}%` };
}

/**
 * APIキー不要の簡易地図。
 * 緯度経度を矩形に投影してピンを配置するだけの仮表示で、実際の道路などは描画しない。
 */
export function PlaceholderMap({ markers, currentPosition, selectedId, onSelect, className = "" }: LocationMapProps) {
  const points: GeoPoint[] = currentPosition ? [...markers, currentPosition] : markers;

  return (
    <div
      className={`relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-[#eef3ec] sm:aspect-[16/9] ${className}`}
      role="group"
      aria-label="設置場所の地図"
    >
      <MapBackdrop />

      {points.length > 0 && <Pins {...{ markers, currentPosition, selectedId, onSelect }} bounds={computeBounds(points)} />}

      <span className="absolute bottom-2 left-2 rounded-md bg-white/85 px-2 py-0.5 text-[10px] text-muted">
        簡易地図（位置は目安です）
      </span>
    </div>
  );
}

function Pins({
  markers,
  currentPosition,
  selectedId,
  onSelect,
  bounds,
}: Pick<LocationMapProps, "markers" | "currentPosition" | "selectedId" | "onSelect"> & { bounds: Bounds }) {
  return (
    <>
      {currentPosition && (
        <span
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={project(currentPosition, bounds)}
          aria-label="現在地"
        >
          <span className="absolute inset-0 -m-2 animate-ping rounded-full bg-sky-400/40" />
          <span className="relative block h-4 w-4 rounded-full border-[3px] border-white bg-sky-500 shadow" />
        </span>
      )}

      {markers.map((marker) => {
        const selected = marker.id === selectedId;
        const dotClass = marker.status ? STOCK_STATUS_META[marker.status].dotClass : "bg-brand";
        const statusLabel = marker.status ? `（${STOCK_STATUS_META[marker.status].label}）` : "";
        return (
          <button
            key={marker.id}
            type="button"
            onClick={() => onSelect?.(marker.id)}
            className={`absolute -translate-x-1/2 -translate-y-full transition ${selected ? "z-20 scale-110" : "z-10"}`}
            style={project(marker, bounds)}
            aria-label={`${marker.label}${statusLabel}`}
            aria-pressed={selected}
          >
            {selected && (
              <span className="absolute bottom-full left-1/2 mb-1 max-w-40 -translate-x-1/2 truncate whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[11px] font-bold text-white shadow">
                {marker.label}
              </span>
            )}
            <span
              aria-hidden="true"
              className={`mb-1 flex items-center justify-center rounded-[50%_50%_50%_0] border-2 border-ink bg-white shadow-md -rotate-45 ${
                selected ? "h-10 w-10" : "h-8 w-8"
              }`}
            >
              <span className={`rounded-full ${dotClass} ${selected ? "h-4 w-4" : "h-3.5 w-3.5"}`} />
            </span>
          </button>
        );
      })}
    </>
  );
}

/** 地図っぽい背景（ブロック・道路・川の抽象表現） */
function MapBackdrop() {
  return (
    <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 400 300" aria-hidden="true">
      <defs>
        <pattern id="blocks" width="40" height="40" patternUnits="userSpaceOnUse">
          <rect width="40" height="40" fill="#eef3ec" />
          <rect x="4" y="4" width="32" height="32" rx="4" fill="#e3eae0" />
        </pattern>
      </defs>
      <rect width="400" height="300" fill="url(#blocks)" />
      <path d="M-10 210 C 80 180, 160 240, 250 200 S 380 150, 420 170" stroke="#cfe3f2" strokeWidth="16" fill="none" />
      <path d="M0 110 H400" stroke="#fff" strokeWidth="9" />
      <path d="M130 0 V300" stroke="#fff" strokeWidth="9" />
      <path d="M290 0 L250 300" stroke="#fff" strokeWidth="7" />
      <path d="M0 40 L400 260" stroke="#fdf3d9" strokeWidth="10" />
      <circle cx="330" cy="70" r="30" fill="#d7ead0" />
    </svg>
  );
}

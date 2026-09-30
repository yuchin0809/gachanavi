"use client";

import "leaflet/dist/leaflet.css";
import type { LatLngBounds, Map as LeafletMap, Marker } from "leaflet";
import { useEffect, useRef } from "react";
import type { GeoPoint, StockStatus } from "@/types";

/** 地図上の店舗ピン */
export interface StorePin extends GeoPoint {
  id: string;
  label: string;
  /** ピンの色（その店舗の設置商品で最も良い在庫状態。設置情報が無い店舗は null） */
  status: StockStatus | null;
}

export interface ViewBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** ピンの色（src/app/globals.css の在庫トークンと同じ色） */
const PIN_COLOR: Record<StockStatus | "none", string> = {
  in_stock: "#16a34a",
  low: "#f59e0b",
  sold_out: "#e11d48",
  unknown: "#a8a29e",
  none: "#ffffff",
};

/**
 * Leaflet + OpenStreetMap の店舗地図（APIキー不要）。
 * - 店舗ごとにピンを 1 つだけ置く（同じ ID のピンは作り直さず位置・色・選択状態だけ更新）
 * - 現在地（または基準地点）を青い点で表示する。現在地は地図の表示にだけ使い、送信・保存しない
 * - 地図の移動・ズームで表示範囲を親に知らせる（表示範囲内の店舗だけを描く）
 * - OpenStreetMap のクレジットを常に表示する
 */
export function LeafletStoreMap({
  center,
  pins,
  selectedId,
  focus,
  onSelect,
  onBoundsChange,
  className = "",
}: {
  center: GeoPoint;
  pins: StorePin[];
  selectedId: string | null;
  /** 地図を移動する目標（店舗一覧から選んだとき・現在地が変わったとき）。key が変わった時だけ移動する */
  focus: { key: string; point: GeoPoint; zoom?: number } | null;
  onSelect: (id: string) => void;
  onBoundsChange: (bounds: ViewBounds) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markersRef = useRef(new Map<string, Marker>());
  const hereRef = useRef<Marker | null>(null);
  const callbacks = useRef({ onSelect, onBoundsChange });
  const initial = useRef({ center });

  useEffect(() => {
    callbacks.current = { onSelect, onBoundsChange };
  }, [onSelect, onBoundsChange]);

  // 地図の作成（ブラウザでのみ Leaflet を読み込む）
  useEffect(() => {
    let disposed = false;
    const markers = markersRef.current;
    import("leaflet").then((L) => {
      if (disposed || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        center: [initial.current.center.lat, initial.current.center.lng],
        zoom: 14,
        zoomControl: true,
        attributionControl: true,
      });
      map.attributionControl.setPrefix(false);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      }).addTo(map);
      const report = () => {
        const b: LatLngBounds = map.getBounds();
        callbacks.current.onBoundsChange({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
      };
      map.on("moveend", report);
      mapRef.current = map;
      report();
    });
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markers.clear();
      hereRef.current = null;
    };
  }, []);

  // 現在地（基準地点）の点
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const icon = L.divIcon({
      className: "",
      html: '<span class="gn-here" aria-hidden="true"></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    if (!hereRef.current) {
      hereRef.current = L.marker([center.lat, center.lng], { icon, interactive: false, keyboard: false, zIndexOffset: -100 }).addTo(map);
    } else {
      hereRef.current.setLatLng([center.lat, center.lng]);
    }
  });

  // 地図の移動（focus の key が変わった時だけ）
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || focus.key === lastFocus.current) return;
    lastFocus.current = focus.key;
    map.setView([focus.point.lat, focus.point.lng], focus.zoom ?? Math.max(map.getZoom(), 15), { animate: true });
  });

  // 店舗ピンの差分更新
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const markers = markersRef.current;
    const next = new Set(pins.map((p) => p.id));
    for (const [id, marker] of markers) {
      if (!next.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
    for (const pin of pins) {
      const selected = pin.id === selectedId;
      const color = PIN_COLOR[pin.status ?? "none"];
      const icon = L.divIcon({
        className: "",
        html: `<span class="gn-pin${selected ? " gn-pin--selected" : ""}${pin.status ? "" : " gn-pin--empty"}" style="--pin:${color}"></span>`,
        iconSize: selected ? [34, 34] : [26, 26],
        iconAnchor: selected ? [17, 32] : [13, 24],
      });
      const existing = markers.get(pin.id);
      if (existing) {
        existing.setIcon(icon);
        existing.setZIndexOffset(selected ? 1000 : 0);
      } else {
        const marker = L.marker([pin.lat, pin.lng], { icon, title: pin.label, alt: pin.label, keyboard: true, riseOnHover: true })
          .on("click", () => callbacks.current.onSelect(pin.id))
          .addTo(map);
        marker.setZIndexOffset(selected ? 1000 : 0);
        markers.set(pin.id, marker);
      }
    }
  });

  return (
    <div
      ref={containerRef}
      className={`relative z-0 h-[340px] w-full overflow-hidden rounded-2xl border border-line bg-[#eef3ec] sm:h-[400px] ${className}`}
      role="region"
      aria-label="近くのガチャガチャ店舗の地図"
    />
  );
}

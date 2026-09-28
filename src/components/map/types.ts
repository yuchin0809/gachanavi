import type { GeoPoint, StockStatus } from "@/types";

/** 地図に表示するピン */
export interface MapMarker extends GeoPoint {
  id: string;
  label: string;
  /** ピンの色分けに使う在庫状態（店舗そのものを示す場合は省略） */
  status?: StockStatus;
}

/**
 * 地図コンポーネントの共通 props。
 * Google Maps / Mapbox などの実装に差し替える場合も、この props を満たすように作る。
 */
export interface LocationMapProps {
  markers: MapMarker[];
  /** 現在地（任意） */
  currentPosition?: GeoPoint;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}

import type { GeoPoint } from "@/types";

const EARTH_RADIUS_M = 6_371_000;

/** 2点間の距離（メートル、ハヴァサイン公式） */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** APIキー不要の Google マップ検索URL（外部アプリで開く用） */
export function googleMapsUrl(point: GeoPoint, label?: string): string {
  const query = label ? `${label} ${point.lat},${point.lng}` : `${point.lat},${point.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

import type { GeoPoint, ID, LocatedLocation, Location, NearbyFind, NearbyFindCandidate } from "@/types";

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

/** 座標が分かっている場所か（null や数値でない座標は 0 として扱わず、対象外にする） */
export function hasCoordinates<T extends Pick<Location, "lat" | "lng">>(l: T): l is T & GeoPoint {
  return typeof l.lat === "number" && Number.isFinite(l.lat) && typeof l.lng === "number" && Number.isFinite(l.lng);
}

/** 距離（座標が不明なら null） */
export function distanceOrNull(origin: GeoPoint, location: Pick<Location, "lat" | "lng">): number | null {
  return hasCoordinates(location) ? distanceMeters(origin, location) : null;
}

/** APIキー不要の Google マップ検索URL（外部アプリで開く用）。座標が不明な場合は店名・住所で検索する */
export function googleMapsUrl(location: Pick<Location, "lat" | "lng"> & { name?: string; address?: string }): string {
  const query = hasCoordinates(location)
    ? `${location.name ? `${location.name} ` : ""}${location.lat},${location.lng}`
    : [location.name, location.address].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** 候補を現在地から近い順に並べ、同じ商品は最寄りの1件だけ残して上位 limit 件を返す（座標不明の場所は除く） */
export function pickNearbyFinds(candidates: NearbyFindCandidate[], origin: GeoPoint, limit = 6): NearbyFind[] {
  const seen = new Set<ID>();
  return candidates
    .filter((c): c is NearbyFindCandidate & { location: LocatedLocation } => hasCoordinates(c.location))
    .map((c) => ({ ...c, distanceMeters: distanceMeters(origin, c.location) }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .filter((f) => (seen.has(f.product.id) ? false : (seen.add(f.product.id), true)))
    .slice(0, limit);
}

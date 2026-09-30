import type { Favorite, ID, Location, PlacementWithStock, StockAlert, StockAlertLocation } from "@/types";

/**
 * 在庫通知の判定（サーバー・テストで共通）。
 *
 * 通知の対象：
 * - 「在庫報告があったら通知」が ON のお気に入り商品
 * - その商品の設置店舗で、最新の在庫報告が「在庫あり」または「残りわずか」（どちらも「今買える」報告。
 *   商品詳細の「在庫あり報告 N店舗」と同じ扱い）。売り切れの報告だけでは通知しない
 * - 通知を ON にした後・前回の通知の後に報告されたもの（同じ報告で何度も通知しない）
 * - 報告から STOCK_ALERT_MAX_AGE_MS 以内（古い報告では通知しない）
 */
export const STOCK_ALERT_STATUSES = ["in_stock", "low"] as const;
export const STOCK_ALERT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** お気に入りとして読み込む上限（読み取り件数の上限にもなる） */
export const FAVORITES_LIMIT = 200;

/** これより後の報告だけを通知する基準時刻（ミリ秒）。通知 OFF なら null */
export function stockAlertBaseline(favorite: Favorite): number | null {
  if (!favorite.notifyInStock) return null;
  const times = [favorite.notifyEnabledAt, favorite.lastNotifiedAt, favorite.createdAt]
    .filter((v): v is string => v !== null)
    .map((v) => Date.parse(v));
  return Math.max(...times);
}

export function findStockAlerts(
  favorites: Favorite[],
  placements: PlacementWithStock[],
  names: { product: (id: ID) => string | undefined; location: (id: ID) => Pick<Location, "name"> | undefined },
  now: number = Date.now(),
): StockAlert[] {
  const alerts: StockAlert[] = [];
  for (const favorite of favorites) {
    const baseline = stockAlertBaseline(favorite);
    if (baseline === null) continue;
    const productName = names.product(favorite.productId);
    if (!productName) continue;
    const locations: StockAlertLocation[] = [];
    for (const { placement, stock } of placements) {
      if (placement.productId !== favorite.productId || !stock.lastCheckedAt) continue;
      if (!(STOCK_ALERT_STATUSES as readonly string[]).includes(stock.status)) continue;
      const at = Date.parse(stock.lastCheckedAt);
      if (at <= baseline || now - at > STOCK_ALERT_MAX_AGE_MS) continue;
      const location = names.location(placement.locationId);
      if (!location) continue;
      locations.push({
        locationId: placement.locationId,
        locationName: location.name,
        status: stock.status as StockAlertLocation["status"],
        reportedAt: stock.lastCheckedAt,
      });
    }
    if (locations.length) {
      locations.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
      alerts.push({ productId: favorite.productId, productName, locations });
    }
  }
  return alerts;
}

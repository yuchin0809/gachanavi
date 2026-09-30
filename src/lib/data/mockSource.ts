import { createMockDatabase } from "@/data/mock";
import { toCatalogProduct } from "@/lib/catalog/index-format";
import { latestSnapshot } from "@/lib/stock";
import { memoryFavorites } from "./memoryFavorites";
import { checkMemoryThrottle } from "./memoryThrottle";
import type { DataSource } from "./source";
import { PlacementNotFoundError } from "./source";

const HOUR = 60 * 60 * 1000;

/**
 * src/data/mock.ts のモックデータを返す DataSource 実装。
 * 書き込み（在庫報告）は保存せず、作成されたかのような StockReport を返すだけ。
 * 連投制限は Firestore 版と同じ動きを確認できるよう、サーバーのメモリ上で判定する。
 */
export function createMockDataSource(): DataSource {
  // 相対時刻（「12分前」など）を保つため、呼び出しのたびに現在時刻基準で生成する
  const db = () => createMockDatabase(new Date());

  return {
    persistent: false,

    async listCatalogProducts() {
      return db().products.map(toCatalogProduct);
    },
    async getProduct(id) {
      return db().products.find((p) => p.id === id) ?? null;
    },
    async listLocations() {
      return db().locations;
    },
    async getLocation(id) {
      return db().locations.find((l) => l.id === id) ?? null;
    },
    async listPlacementsWithStock(filter = {}) {
      const { placements, stockReports } = db();
      return placements
        .filter(
          (pl) =>
            (!filter.productId || pl.productId === filter.productId) &&
            (!filter.locationId || pl.locationId === filter.locationId),
        )
        .map((placement) => ({
          placement,
          stock: latestSnapshot(
            stockReports.filter(
              (r) => r.productId === placement.productId && r.locationId === placement.locationId,
            ),
          ),
        }));
    },
    async countRecentReportsByProduct(windowHours) {
      const since = Date.now() - windowHours * HOUR;
      const counts: Record<string, number> = {};
      for (const r of db().stockReports) {
        if (new Date(r.reportedAt).getTime() >= since) {
          counts[r.productId] = (counts[r.productId] ?? 0) + 1;
        }
      }
      return counts;
    },
    async listStockReports({ productId, locationId, limit = 20 }) {
      return db()
        .stockReports.filter((r) => r.productId === productId && r.locationId === locationId)
        .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))
        .slice(0, limit);
    },
    async getUser(id) {
      return db().users.find((u) => u.id === id) ?? null;
    },
    async addStockReport(input) {
      // 設置情報が無くても、商品と設置場所が存在すれば報告できる（Firestore 版と同じ条件）
      const { products, locations, placements } = db();
      const exists =
        products.some((p) => p.id === input.productId) && locations.some((l) => l.id === input.locationId);
      if (!exists) throw new PlacementNotFoundError(input.productId, input.locationId);

      checkMemoryThrottle(input);

      return {
        placementCreated: !placements.some((pl) => pl.productId === input.productId && pl.locationId === input.locationId),
        id: `local-${Date.now()}`,
        productId: input.productId,
        locationId: input.locationId,
        userId: input.userId,
        status: input.status,
        reportedAt: input.reportedAt ?? new Date().toISOString(),
      };
    },
    ...memoryFavorites,
  };
}

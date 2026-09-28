import { createMockDatabase } from "@/data/mock";
import type { DataSource } from "./source";

/** src/data/mock.ts のモックデータを返す DataSource 実装 */
export function createMockDataSource(): DataSource {
  // 相対時刻（「12分前」など）を保つため、呼び出しのたびに現在時刻基準で生成する
  const db = () => createMockDatabase(new Date());

  return {
    async listProducts() {
      return db().products;
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
    async listPlacements(filter = {}) {
      return db().placements.filter(
        (pl) =>
          (!filter.productId || pl.productId === filter.productId) &&
          (!filter.locationId || pl.locationId === filter.locationId),
      );
    },
    async listStockReports(filter = {}) {
      return db().stockReports.filter(
        (r) =>
          (!filter.productId || r.productId === filter.productId) &&
          (!filter.locationId || r.locationId === filter.locationId),
      );
    },
    async getUser(id) {
      return db().users.find((u) => u.id === id) ?? null;
    },
  };
}

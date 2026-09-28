import type { GachaProduct, ID, Location, Placement, StockReport, User } from "@/types";

/**
 * データ取得の抽象インターフェース。
 *
 * 現在はモック実装（mockSource.ts）のみ。Firebase / 独自API などに移行する際は
 * このインターフェースを実装したクラスを用意し、index.ts の dataSource を差し替える。
 * 画面側はこのインターフェースを直接使わず、index.ts のクエリ関数を経由する。
 */
export interface DataSource {
  listProducts(): Promise<GachaProduct[]>;
  getProduct(id: ID): Promise<GachaProduct | null>;
  listLocations(): Promise<Location[]>;
  getLocation(id: ID): Promise<Location | null>;
  listPlacements(filter?: { productId?: ID; locationId?: ID }): Promise<Placement[]>;
  listStockReports(filter?: { productId?: ID; locationId?: ID }): Promise<StockReport[]>;
  getUser(id: ID): Promise<User | null>;
}

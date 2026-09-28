import type {
  GachaProduct,
  ID,
  Location,
  PlacementWithStock,
  ReportableStockStatus,
  StockReport,
  User,
} from "@/types";

export interface PlacementFilter {
  productId?: ID;
  locationId?: ID;
}

export interface StockReportHistoryFilter {
  productId: ID;
  locationId: ID;
  /** 取得件数の上限（新しい順） */
  limit?: number;
}

/** 在庫報告の新規作成入力 */
export interface NewStockReport {
  productId: ID;
  locationId: ID;
  userId: ID;
  status: ReportableStockStatus;
  /** 報告日時。省略時はサーバーの現在時刻 */
  reportedAt?: string;
}

/**
 * データ取得・保存の抽象インターフェース。
 *
 * - mock      : src/data/mock.ts のダミーデータ（mockSource.ts）
 * - firestore : Cloud Firestore（firestoreSource.ts）
 *
 * どちらを使うかは環境変数 DATA_SOURCE で切り替える（src/lib/data/config.ts）。
 * 画面側はこのインターフェースを直接使わず、index.ts のクエリ関数を経由する。
 */
export interface DataSource {
  /** 報告などの書き込みが永続化されるか（モックでは false） */
  readonly persistent: boolean;

  listProducts(): Promise<GachaProduct[]>;
  getProduct(id: ID): Promise<GachaProduct | null>;
  listLocations(): Promise<Location[]>;
  getLocation(id: ID): Promise<Location | null>;

  /**
   * 設置情報を最新の在庫状態付きで取得する。
   * 在庫状態のために StockReport の履歴を読まずに済むよう、
   * Firestore では placements.latestStock を利用する。
   */
  listPlacementsWithStock(filter?: PlacementFilter): Promise<PlacementWithStock[]>;

  /** 直近 windowHours 時間の在庫報告件数を商品ごとに集計する（🔥話題のガチャ用） */
  countRecentReportsByProduct(windowHours: number): Promise<Record<ID, number>>;

  /** ある「商品×場所」の在庫報告履歴（新しい順） */
  listStockReports(filter: StockReportHistoryFilter): Promise<StockReport[]>;

  getUser(id: ID): Promise<User | null>;

  /**
   * 在庫報告を履歴として追加し、placements.latestStock を更新する。
   * latestStock は、既存の最新報告より新しい報告の場合のみ上書きする。
   */
  addStockReport(input: NewStockReport): Promise<StockReport>;
}

/** 報告対象の「商品×場所」の設置情報が存在しない */
export class PlacementNotFoundError extends Error {
  constructor(productId: ID, locationId: ID) {
    super(`Placement not found: ${productId} × ${locationId}`);
    this.name = "PlacementNotFoundError";
  }
}

/** placements のドキュメントID（同じ商品×場所の重複登録を防ぐため決定的に作る） */
export function placementIdOf(productId: ID, locationId: ID): ID {
  return `${productId}__${locationId}`;
}

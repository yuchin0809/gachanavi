import type {
  CatalogProduct,
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
 * - local     : 収集した実データ data/collected/*.json を読むローカル確認用（localSource.ts。Firestore にアクセスしない）
 * - firestore : Cloud Firestore（firestoreSource.ts）
 *
 * 商品が数万件になっても動くよう、products を全件読む API は持たない。
 * 一覧・検索はカタログ索引（軽量な商品情報。src/lib/catalog/index-format.ts）で行い、
 * 詳細は getProduct で 1 件だけ取得する。
 *
 * どちらを使うかは環境変数 DATA_SOURCE で切り替える（src/lib/data/config.ts）。
 * 画面側はこのインターフェースを直接使わず、index.ts のクエリ関数を経由する。
 */
export interface DataSource {
  /** 報告などの書き込みが永続化されるか（モックでは false） */
  readonly persistent: boolean;

  /**
   * 一覧・検索用の軽量な商品一覧（カタログ索引）。
   * Firestore では catalogIndex の数ドキュメントだけを読み、products コレクションは読まない。
   * 索引に載っていない商品（既存のモックデータなど）は含まれない。
   */
  listCatalogProducts(): Promise<CatalogProduct[]>;
  /** 商品詳細（1 件だけ取得する） */
  getProduct(id: ID): Promise<GachaProduct | null>;
  /** 設置場所の一覧（索引。座標が不明な場所も含む） */
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
   *
   * その「商品×場所」の設置情報（placement）がまだ無い場合は、商品と設置場所の両方が存在すれば
   * 設置情報を作成してから報告を登録する（「この店舗でこの商品を見つけた」という報告を兼ねる）。
   * どちらかが存在しない場合は PlacementNotFoundError。
   *
   * - 同じユーザーが同じ「商品×場所」に REPORT_COOLDOWN_MS 以内に再度報告した場合は ReportRateLimitedError
   * - 報告者の users ドキュメントが無ければ作成する（匿名ユーザーの初回報告時など）
   */
  addStockReport(input: NewStockReport): Promise<StockReport>;
}

/** 報告対象の商品または設置場所が存在しない（設置情報を作れない） */
export class PlacementNotFoundError extends Error {
  constructor(productId: ID, locationId: ID) {
    super(`Placement not found: ${productId} × ${locationId}`);
    this.name = "PlacementNotFoundError";
  }
}

/** 同じユーザーが同じ「商品×場所」に続けて報告できるまでの間隔（連投対策） */
export const REPORT_COOLDOWN_MS = 10 * 60 * 1000;

/** 連投制限：同じ「商品×場所」への前回の報告から REPORT_COOLDOWN_MS が経っていない */
export class ReportRateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Report rate limited: retry after ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = "ReportRateLimitedError";
  }
}

/** placements のドキュメントID（同じ商品×場所の重複登録を防ぐため決定的に作る） */
export function placementIdOf(productId: ID, locationId: ID): ID {
  return `${productId}__${locationId}`;
}

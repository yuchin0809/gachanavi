/**
 * GachaNavi のドメインモデル。
 *
 * 「ガチャ商品 (GachaProduct)」と「設置場所 (Location)」は独立したエンティティとして扱い、
 * 両者の関係は Placement（どの商品がどの場所に設置されているか）で表現する。
 * 在庫状況は StockReport（ユーザーからの報告）の履歴から算出する。
 *
 * すべての ID は文字列、日時は ISO 8601 文字列で保持する。
 * （Firestore 等に移行した際にそのままシリアライズできる形にしている）
 */

export type ID = string;
export type ISODateString = string;

/** ガチャ商品（シリーズ内の1商品ラインナップ単位） */
export interface GachaProduct {
  id: ID;
  name: string;
  series: string;
  maker: string;
  /** 1回あたりの価格（円） */
  price: number;
  /** 発売時期（"YYYY-MM"） */
  releaseMonth: string;
  imageUrl: string | null;
  description: string;
  /** 検索対象となるキャラクター名 */
  characters: string[];
  /** 検索補助用のタグ（ジャンル・別名など） */
  tags: string[];
}

/** 設置場所（ガチャ専門店・商業施設内のコーナーなど） */
export interface Location {
  id: ID;
  name: string;
  address: string;
  /** 最寄り駅・エリア名などの短い表示用ラベル */
  area: string;
  lat: number;
  lng: number;
  openingHours: string | null;
}

/** 商品と設置場所の関連（1つの商品が複数の場所に設置される） */
export interface Placement {
  id: ID;
  productId: ID;
  locationId: ID;
  /** 設置が最初に確認された日時 */
  firstSeenAt: ISODateString;
}

/** ユーザーが報告できる在庫状態 */
export type ReportableStockStatus = "in_stock" | "low" | "sold_out";

/** 画面表示用の在庫状態（報告が無い場合は unknown） */
export type StockStatus = ReportableStockStatus | "unknown";

/** 在庫報告 */
export interface StockReport {
  id: ID;
  productId: ID;
  locationId: ID;
  userId: ID;
  status: ReportableStockStatus;
  reportedAt: ISODateString;
}

export interface User {
  id: ID;
  displayName: string;
  createdAt: ISODateString;
}

/* ------------------------------------------------------------------
 * 画面表示用に組み立てた View Model
 * ------------------------------------------------------------------ */

/** ある場所における、ある商品の最新在庫状態 */
export interface StockSnapshot {
  status: StockStatus;
  /** 最終確認日時（報告が無い場合は null） */
  lastCheckedAt: ISODateString | null;
}

/**
 * 設置情報 + その「商品×場所」の最新在庫状態。
 * Firestore では placements ドキュメントの latestStock フィールドから、
 * モックでは StockReport の履歴から算出する。
 */
export interface PlacementWithStock {
  placement: Placement;
  stock: StockSnapshot;
}

/** 商品一覧・検索結果用の集計付き商品 */
export interface GachaProductSummary {
  product: GachaProduct;
  /** 設置が確認されている店舗数 */
  locationCount: number;
  /** 最新報告が「在庫あり」または「残りわずか」の店舗数 */
  availableLocationCount: number;
  /** 直近24時間の報告件数（話題度の指標） */
  recentReportCount: number;
}

/** 商品詳細ページ用：設置場所 + その場所での在庫状態 */
export interface ProductLocationEntry {
  location: Location;
  stock: StockSnapshot;
}

/** 設置場所詳細ページ用：商品 + その場所での在庫状態 */
export interface LocationProductEntry {
  product: GachaProduct;
  stock: StockSnapshot;
}

/** 近くで見つかったガチャ */
export interface NearbyFind {
  product: GachaProduct;
  location: Location;
  stock: StockSnapshot;
  distanceMeters: number;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

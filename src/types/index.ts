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

/**
 * 発売状況（保存せず、表示時に発売月・再発売月から求める。src/lib/release.ts）
 * - upcoming: 発売予定 / current: 現在の商品（発売から一定期間内）/ past: 過去の商品 / unknown: 発売時期不明
 */
export type ReleaseStatus = "upcoming" | "current" | "past" | "unknown";

/**
 * 商品一覧・検索に使う軽量な商品情報（カタログ索引の1件）。
 * 商品説明や出典など、詳細ページでしか使わない項目は含めない。
 */
export interface CatalogProduct {
  id: ID;
  name: string;
  /** 公式にシリーズ名が無い場合は空文字 */
  series: string;
  maker: string;
  /** 1回あたりの価格（円）。公式に記載が無い場合は null */
  price: number | null;
  /** 価格が税込か（true）税抜か（false）。不明は null */
  priceTaxIncluded: boolean | null;
  /** 発売時期（"YYYY-MM"）。不明は null */
  releaseMonth: string | null;
  /** 再発売の時期（"YYYY-MM"）。無ければ null */
  resaleMonth: string | null;
  /** 画像 URL。表示してよいかは src/lib/images.ts の判定に従う */
  imageUrl: string | null;
  /** 検索対象となるキャラクター名 */
  characters: string[];
  /** 検索補助用のタグ（ジャンル・別名・【再販】などの区分） */
  tags: string[];
}

/** ガチャ商品（シリーズ内の1商品ラインナップ単位） */
export interface GachaProduct extends CatalogProduct {
  description: string;
  /** メーカー公式の商品ページ */
  officialUrl: string | null;
  /** 情報源（収集元）の URL */
  sourceUrl: string | null;
  /** 情報源から取得した日時（ISO 8601） */
  fetchedAt: string | null;
  /** 種類数（例: 全5種） */
  lineupCount: string | null;
}

/** 設置場所（ガチャ専門店・商業施設内のコーナーなど） */
export interface Location {
  id: ID;
  name: string;
  address: string;
  /** 最寄り駅・エリア名などの短い表示用ラベル */
  area: string;
  /** 緯度・経度。不明な場合は null（0 として扱わない。距離計算・地図の対象外） */
  lat: number | null;
  lng: number | null;
  openingHours: string | null;
  /** 店舗の公式サイト（データにある場合のみ。推測して作らない） */
  officialUrl?: string | null;
}

/** 座標が分かっている設置場所 */
export type LocatedLocation = Location & GeoPoint;

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
  product: CatalogProduct;
  releaseStatus: ReleaseStatus;
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
  product: CatalogProduct;
  stock: StockSnapshot;
}

/** 近くで見つかったガチャ（座標が分かっている場所のみ） */
export interface NearbyFind {
  product: CatalogProduct;
  location: LocatedLocation;
  stock: StockSnapshot;
  distanceMeters: number;
}

/** 近くで見つかったガチャの候補（距離は現在地が分かるブラウザ側で計算する） */
export interface NearbyFindCandidate {
  product: CatalogProduct;
  location: Location;
  stock: StockSnapshot;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * トップの地図に表示する店舗（軽量版）。在庫の集計は placements.latestStock から求める。
 * 設置情報（placement）の有無と在庫状態（在庫報告）は別に数える。
 */
export interface StoreMapEntry {
  id: ID;
  name: string;
  lat: number;
  lng: number;
  /** この店舗の設置情報の数（設置・取扱いが確認された商品数） */
  placementCount: number;
  /** 設置情報ごとの最新の在庫状態の件数（報告が無いものは unknown） */
  stockCounts: Record<StockStatus, number>;
}

/**
 * お気に入り（Firestore: users/{uid}/favorites/{productId}）。
 * 商品名・価格などは複製せず productId だけを持ち、表示時にカタログ索引から引く。
 */
export interface Favorite {
  productId: ID;
  createdAt: ISODateString;
  /** 「在庫報告があったら通知」が ON か */
  notifyInStock: boolean;
  /** 通知を ON にした日時（これより前の報告では通知しない） */
  notifyEnabledAt: ISODateString | null;
  /** 最後に通知した日時（これより前の報告では再通知しない） */
  lastNotifiedAt: ISODateString | null;
}

/** 在庫通知の対象になった報告（お気に入り商品 × 店舗） */
export interface StockAlertLocation {
  locationId: ID;
  locationName: string;
  status: "in_stock" | "low";
  reportedAt: ISODateString;
}

export interface StockAlert {
  productId: ID;
  productName: string;
  locations: StockAlertLocation[];
}

/** お気に入り一覧の 1 件（商品情報はカタログ索引から、在庫の集計は placements.latestStock から） */
export interface FavoriteView {
  favorite: Favorite;
  product: CatalogProduct;
  /** 設置が確認されている店舗数 */
  locationCount: number;
  /** 最新報告が「在庫あり」「残りわずか」の店舗数 */
  availableLocationCount: number;
}

/**
 * Firestore のコレクション構造と、ドメイン型との変換。
 *
 *   products/{productId}          GachaProduct（詳細ページで 1 件ずつ読む。一覧・検索では読まない）
 *   locations/{locationId}        Location
 *   catalogIndex/{meta|products-NNN|locations-NNN}
 *                                 一覧・検索用の軽量な索引（src/lib/catalog/index-format.ts）
 *   placements/{productId__locationId}
 *                                 Placement + latestStock（最新在庫状態のキャッシュ）
 *   stockReports/{autoId}         StockReport（履歴。削除・更新しない。userId = 報告者の Firebase Auth uid）
 *   users/{uid}                   User（ドキュメントID = Firebase Auth の uid。匿名ユーザーは初回報告時に作成）
 *   users/{uid}/reportThrottles/{placementId}
 *                                 連投対策用：その「商品×場所」に最後に報告した日時
 *   users/{uid}/favorites/{productId}
 *                                 お気に入り（productId・登録日時・在庫通知の設定だけ。商品情報は複製しない）。
 *                                 ドキュメント ID = productId のため同じ商品は 1 件しか作られない
 *
 * GachaProduct 1 ── * Placement * ── 1 Location の関係を placements で表す。
 * 日時は Firestore では Timestamp、ドメイン型では ISO 文字列で扱う。
 */
import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { isValidMonth } from "@/lib/release";
import type {
  CatalogProduct,
  Favorite,
  GachaProduct,
  Location,
  Placement,
  ReportableStockStatus,
  StockReport,
  StockSnapshot,
  User,
} from "@/types";

export const COLLECTIONS = {
  products: "products",
  locations: "locations",
  placements: "placements",
  stockReports: "stockReports",
  users: "users",
  /** users/{uid} のサブコレクション */
  reportThrottles: "reportThrottles",
  favorites: "favorites",
} as const;

/* ------------------------------------------------------------------
 * 保存形式
 * ------------------------------------------------------------------ */

export type ProductDoc = Omit<GachaProduct, "id"> & {
  /** 架空のサンプルデータ（true の商品は一覧・検索に出さない） */
  isSample?: boolean;
};

export type LocationDoc = Omit<Location, "id"> & {
  /** 架空のサンプルデータ（true の場所は一覧に出さない） */
  isSample?: boolean;
};

/** placements.latestStock：その「商品×場所」の最新の在庫報告 */
export interface LatestStockDoc {
  status: ReportableStockStatus;
  reportedAt: Timestamp;
  reportId: string;
}

export interface PlacementDoc {
  productId: string;
  locationId: string;
  firstSeenAt: Timestamp;
  /** 報告がまだ無い場合は null（= 未確認） */
  latestStock: LatestStockDoc | null;
  /**
   * 設置情報の出典（docs/placement-sources.md）。ユーザーの「この店舗で見つけた」報告で作成したものは "user_report"。
   * 既存のドキュメントには無い（任意項目）
   */
  source?: "user_report" | "official_licensed" | "operator" | "open_data";
}

export interface StockReportDoc {
  productId: string;
  locationId: string;
  /** 対応する placements のドキュメントID（= productId__locationId） */
  placementId: string;
  userId: string;
  status: ReportableStockStatus;
  reportedAt: Timestamp;
}

export interface UserDoc {
  displayName: string;
  createdAt: Timestamp;
}

/** users/{uid}/favorites/{productId} */
export interface FavoriteDoc {
  productId: string;
  createdAt: Timestamp;
  notifyInStock: boolean;
  notifyEnabledAt: Timestamp | null;
  lastNotifiedAt: Timestamp | null;
}

/** users/{uid}/reportThrottles/{placementId} */
export interface ReportThrottleDoc {
  lastReportedAt: Timestamp;
}

/* ------------------------------------------------------------------
 * 読み取り時の変換（Firebase コンソールから手入力されたデータにも耐えるよう、型を確認する）
 * ------------------------------------------------------------------ */

const REPORTABLE: readonly string[] = ["in_stock", "low", "sold_out"];

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function monthOrNull(value: unknown): string | null {
  return isValidMonth(value) ? value : null;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function toIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

function status(value: unknown): ReportableStockStatus | null {
  return typeof value === "string" && REPORTABLE.includes(value) ? (value as ReportableStockStatus) : null;
}

/** 一覧・検索用の軽量な商品（products ドキュメント・カタログ索引の両方から作る） */
export function catalogProductFromData(id: string, d: Record<string, unknown>): CatalogProduct {
  return {
    id,
    name: str(d.name),
    series: str(d.series),
    maker: str(d.maker),
    // 価格・発売時期が無い場合は 0 や空文字にせず null のまま扱う
    price: numOrNull(d.price),
    priceTaxIncluded: boolOrNull(d.priceTaxIncluded),
    releaseMonth: monthOrNull(d.releaseMonth),
    resaleMonth: monthOrNull(d.resaleMonth),
    imageUrl: strOrNull(d.imageUrl),
    characters: strArray(d.characters),
    tags: strArray(d.tags),
  };
}

export function productFromDoc(snap: DocumentSnapshot): GachaProduct {
  const d = snap.data() ?? {};
  return {
    ...catalogProductFromData(snap.id, d),
    description: str(d.description),
    officialUrl: strOrNull(d.officialUrl),
    sourceUrl: strOrNull(d.sourceUrl),
    fetchedAt: toIso(d.fetchedAt),
    lineupCount: strOrNull(d.lineupCount),
  };
}

export function locationFromData(id: string, d: Record<string, unknown>): Location {
  const lat = numOrNull(d.lat);
  const lng = numOrNull(d.lng);
  return {
    id,
    name: str(d.name),
    address: str(d.address),
    area: str(d.area),
    // 座標が無い（片方だけ・数値でない）場合は 0 にせず null
    lat: lat !== null && lng !== null ? lat : null,
    lng: lat !== null && lng !== null ? lng : null,
    openingHours: strOrNull(d.openingHours),
    // 公式サイトはデータにある場合だけ（https のみ。無い場合は項目自体を持たない）
    ...(typeof d.officialUrl === "string" && /^https:\/\//.test(d.officialUrl) ? { officialUrl: d.officialUrl } : {}),
  };
}

export function locationFromDoc(snap: DocumentSnapshot): Location {
  return locationFromData(snap.id, snap.data() ?? {});
}

export function placementFromDoc(snap: DocumentSnapshot): { placement: Placement; stock: StockSnapshot } {
  const d = snap.data() ?? {};
  const latest = d.latestStock as Partial<LatestStockDoc> | null | undefined;
  const latestStatus = status(latest?.status);
  const latestAt = toIso(latest?.reportedAt);
  return {
    placement: {
      id: snap.id,
      productId: str(d.productId),
      locationId: str(d.locationId),
      firstSeenAt: toIso(d.firstSeenAt) ?? new Date(0).toISOString(),
    },
    stock:
      latestStatus && latestAt
        ? { status: latestStatus, lastCheckedAt: latestAt }
        : { status: "unknown", lastCheckedAt: null },
  };
}

export function stockReportFromDoc(snap: DocumentSnapshot): StockReport | null {
  const d = snap.data() ?? {};
  const s = status(d.status);
  const reportedAt = toIso(d.reportedAt);
  if (!s || !reportedAt) return null;
  return {
    id: snap.id,
    productId: str(d.productId),
    locationId: str(d.locationId),
    userId: str(d.userId),
    status: s,
    reportedAt,
  };
}

export function userFromDoc(snap: DocumentSnapshot): User {
  const d = snap.data() ?? {};
  return {
    id: snap.id,
    displayName: str(d.displayName, "ゲスト"),
    createdAt: toIso(d.createdAt) ?? new Date(0).toISOString(),
  };
}

export function favoriteFromDoc(snap: DocumentSnapshot): Favorite {
  const d = snap.data() ?? {};
  return {
    productId: str(d.productId, snap.id),
    createdAt: toIso(d.createdAt) ?? new Date(0).toISOString(),
    notifyInStock: d.notifyInStock === true,
    notifyEnabledAt: toIso(d.notifyEnabledAt),
    lastNotifiedAt: toIso(d.lastNotifiedAt),
  };
}

/**
 * Firestore のコレクション構造と、ドメイン型との変換。
 *
 *   products/{productId}          GachaProduct
 *   locations/{locationId}        Location
 *   placements/{productId__locationId}
 *                                 Placement + latestStock（最新在庫状態のキャッシュ）
 *   stockReports/{autoId}         StockReport（履歴。削除・更新しない。userId = 報告者の Firebase Auth uid）
 *   users/{uid}                   User（ドキュメントID = Firebase Auth の uid。匿名ユーザーは初回報告時に作成）
 *   users/{uid}/reportThrottles/{placementId}
 *                                 連投対策用：その「商品×場所」に最後に報告した日時
 *
 * GachaProduct 1 ── * Placement * ── 1 Location の関係を placements で表す。
 * 日時は Firestore では Timestamp、ドメイン型では ISO 文字列で扱う。
 */
import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import type {
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
} as const;

/* ------------------------------------------------------------------
 * 保存形式
 * ------------------------------------------------------------------ */

export type ProductDoc = Omit<GachaProduct, "id">;

export type LocationDoc = Omit<Location, "id">;

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

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

export function productFromDoc(snap: DocumentSnapshot): GachaProduct {
  const d = snap.data() ?? {};
  return {
    id: snap.id,
    name: str(d.name),
    series: str(d.series),
    maker: str(d.maker),
    price: num(d.price),
    releaseMonth: str(d.releaseMonth),
    imageUrl: typeof d.imageUrl === "string" && d.imageUrl ? d.imageUrl : null,
    description: str(d.description),
    characters: strArray(d.characters),
    tags: strArray(d.tags),
  };
}

export function locationFromDoc(snap: DocumentSnapshot): Location {
  const d = snap.data() ?? {};
  return {
    id: snap.id,
    name: str(d.name),
    address: str(d.address),
    area: str(d.area),
    lat: num(d.lat),
    lng: num(d.lng),
    openingHours: typeof d.openingHours === "string" && d.openingHours ? d.openingHours : null,
  };
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

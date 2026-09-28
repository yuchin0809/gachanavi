/**
 * 画面から利用するデータ取得関数群（Server Component / Server Action から呼び出す）。
 * 集計・検索ロジックはここにまとめ、生データの取得は DataSource に委譲する。
 */
import "server-only";
import { cache } from "react";
import { mockCurrentPosition } from "@/data/mock";
import { matchesQuery } from "@/lib/search";
import { STOCK_STATUS_ORDER, isAvailable } from "@/lib/stock";
import type {
  GachaProduct,
  GachaProductSummary,
  GeoPoint,
  ID,
  Location,
  LocationProductEntry,
  NearbyFindCandidate,
  PlacementWithStock,
  ProductLocationEntry,
  StockSnapshot,
} from "@/types";
import { getDataSourceKind } from "./config";
import { createMockDataSource } from "./mockSource";
import type { DataSource } from "./source";

let dataSourcePromise: Promise<DataSource> | null = null;

/**
 * DATA_SOURCE に応じた DataSource を返す。
 * Firestore 実装は firebase-admin を含むため、選択された場合のみ動的に読み込む。
 */
export function getDataSource(): Promise<DataSource> {
  dataSourcePromise ??= (async () => {
    if (getDataSourceKind() === "firestore") {
      const { createFirestoreDataSource } = await import("./firestoreSource");
      return createFirestoreDataSource();
    }
    return createMockDataSource();
  })();
  return dataSourcePromise;
}

const RECENT_WINDOW_HOURS = 24;

/*
 * 同じリクエスト内で複数のセクションが同じデータを必要とする場合（トップページなど）に
 * データソースへの問い合わせを1回にまとめる（React の cache はリクエスト単位）。
 */
const loadProducts = cache(async () => (await getDataSource()).listProducts());
const loadLocations = cache(async () => (await getDataSource()).listLocations());
const loadAllPlacements = cache(async () => (await getDataSource()).listPlacementsWithStock());
const loadRecentReportCounts = cache(async () =>
  (await getDataSource()).countRecentReportsByProduct(RECENT_WINDOW_HOURS),
);

function summarize(
  products: GachaProduct[],
  placements: PlacementWithStock[],
  recentCounts: Record<ID, number>,
): GachaProductSummary[] {
  const counts = new Map<ID, { total: number; available: number }>();
  for (const { placement, stock } of placements) {
    const c = counts.get(placement.productId) ?? { total: 0, available: 0 };
    c.total += 1;
    if (isAvailable(stock.status)) c.available += 1;
    counts.set(placement.productId, c);
  }
  return products.map((product) => ({
    product,
    locationCount: counts.get(product.id)?.total ?? 0,
    availableLocationCount: counts.get(product.id)?.available ?? 0,
    recentReportCount: recentCounts[product.id] ?? 0,
  }));
}

const loadSummaries = cache(async (): Promise<GachaProductSummary[]> => {
  const [products, placements, recentCounts] = await Promise.all([
    loadProducts(),
    loadAllPlacements(),
    loadRecentReportCounts(),
  ]);
  return summarize(products, placements, recentCounts);
});

export interface SearchOptions {
  /** 在庫あり（残りわずか含む）の店舗がある商品のみ */
  availableOnly?: boolean;
}

export async function searchProducts(
  query: string,
  options: SearchOptions = {},
): Promise<GachaProductSummary[]> {
  const summaries = await loadSummaries();
  return summaries
    .filter((s) => matchesQuery(s.product, query))
    .filter((s) => !options.availableOnly || s.availableLocationCount > 0)
    .sort(
      (a, b) =>
        b.availableLocationCount - a.availableLocationCount ||
        b.recentReportCount - a.recentReportCount,
    );
}

/** 🔥 話題のガチャ：直近24時間の報告が多い順 */
export async function getTrendingProducts(limit = 6): Promise<GachaProductSummary[]> {
  const summaries = await loadSummaries();
  return summaries
    .filter((s) => s.recentReportCount > 0)
    .sort((a, b) => b.recentReportCount - a.recentReportCount)
    .slice(0, limit);
}

/** 🆕 新着ガチャ：発売時期が新しい順 */
export async function getNewProducts(limit = 6): Promise<GachaProductSummary[]> {
  const summaries = await loadSummaries();
  return [...summaries]
    .sort((a, b) => b.product.releaseMonth.localeCompare(a.product.releaseMonth))
    .slice(0, limit);
}

/**
 * 現在地を取得できないとき（位置情報を許可しない・取得失敗・非対応）に使う基準地点。
 * 実際の現在地はブラウザ側（CurrentPositionProvider）でのみ扱い、サーバーには送らない。
 */
export function getFallbackPosition(): GeoPoint & { label: string } {
  return mockCurrentPosition;
}

/**
 * 📍 近くで見つかったガチャの候補：在庫ありと報告された「商品×設置場所」をすべて返す。
 * 現在地をサーバーに送らないため、距離の計算と絞り込みはブラウザ側（pickNearbyFinds）で行う。
 */
export async function getAvailableFinds(): Promise<NearbyFindCandidate[]> {
  const [products, locations, placements] = await Promise.all([
    loadProducts(),
    loadLocations(),
    loadAllPlacements(),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const locationMap = new Map(locations.map((l) => [l.id, l]));

  const candidates: NearbyFindCandidate[] = [];
  for (const { placement, stock } of placements) {
    const product = productMap.get(placement.productId);
    const location = locationMap.get(placement.locationId);
    if (!product || !location) continue;
    if (!isAvailable(stock.status)) continue;
    candidates.push({ product, location, stock });
  }
  return candidates;
}

/** generateMetadata とページ本体で同じ詳細を2回読まないよう、リクエスト内でキャッシュする */
export const getProductDetail = cache(
  async (productId: ID): Promise<{ product: GachaProduct; locations: ProductLocationEntry[] } | null> => {
    const ds = await getDataSource();
    const product = await ds.getProduct(productId);
    if (!product) return null;
    const [locations, placements] = await Promise.all([
      loadLocations(),
      ds.listPlacementsWithStock({ productId }),
    ]);
    const locationMap = new Map(locations.map((l) => [l.id, l]));

    const entries = placements
      .map(({ placement, stock }) => {
        const location = locationMap.get(placement.locationId);
        return location ? { location, stock } : null;
      })
      .filter((e): e is ProductLocationEntry => e !== null)
      .sort(compareByStock);

    return { product, locations: entries };
  },
);

export const getLocationDetail = cache(
  async (locationId: ID): Promise<{ location: Location; products: LocationProductEntry[] } | null> => {
    const ds = await getDataSource();
    const location = await ds.getLocation(locationId);
    if (!location) return null;
    const [products, placements] = await Promise.all([
      loadProducts(),
      ds.listPlacementsWithStock({ locationId }),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p]));

    const entries = placements
      .map(({ placement, stock }) => {
        const product = productMap.get(placement.productId);
        return product ? { product, stock } : null;
      })
      .filter((e): e is LocationProductEntry => e !== null)
      .sort(compareByStock);

    return { location, products: entries };
  },
);

/** 在庫あり → 残りわずか → 未確認 → 売り切れ、同じ状態なら確認が新しい順 */
function compareByStock(a: { stock: StockSnapshot }, b: { stock: StockSnapshot }): number {
  return (
    STOCK_STATUS_ORDER[a.stock.status] - STOCK_STATUS_ORDER[b.stock.status] ||
    (b.stock.lastCheckedAt ?? "").localeCompare(a.stock.lastCheckedAt ?? "")
  );
}

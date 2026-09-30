/**
 * 画面から利用するデータ取得関数群（Server Component / Server Action から呼び出す）。
 * 集計・検索ロジックはここにまとめ、生データの取得は DataSource に委譲する。
 *
 * 商品が数万件でも動くよう、商品の一覧・検索はカタログ索引（軽量な商品情報）だけで行い、
 * products を全件読むことはしない。商品詳細は 1 件だけ取得する。
 */
import "server-only";
import { cache } from "react";
import { mockCurrentPosition } from "@/data/mock";
import { RELEASE_STATUS_ORDER, latestMonth, releaseStatusOf } from "@/lib/release";
import { matchesLocationQuery, matchesQuery, normalizeForSearch, searchTerms } from "@/lib/search";
import { findStockAlerts } from "@/lib/favorites";
import { STOCK_STATUS_ORDER, isAvailable } from "@/lib/stock";
import type {
  CatalogProduct,
  Favorite,
  FavoriteView,
  GachaProduct,
  GachaProductSummary,
  GeoPoint,
  ID,
  Location,
  LocationProductEntry,
  NearbyFindCandidate,
  PlacementWithStock,
  ProductLocationEntry,
  ReleaseStatus,
  StockAlert,
  StockSnapshot,
  StoreMapEntry,
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
    const kind = getDataSourceKind();
    if (kind === "firestore") {
      const { createFirestoreDataSource } = await import("./firestoreSource");
      return createFirestoreDataSource();
    }
    if (kind === "local") {
      const { createLocalDataSource } = await import("./localSource");
      return createLocalDataSource();
    }
    return createMockDataSource();
  })();
  return dataSourcePromise;
}

const RECENT_WINDOW_HOURS = 24;
/** 検索結果 1 ページの件数（数千件を一度に描画しない） */
export const SEARCH_PAGE_SIZE = 40;

/*
 * 同じリクエスト内で複数のセクションが同じデータを必要とする場合（トップページなど）に
 * データソースへの問い合わせを1回にまとめる（React の cache はリクエスト単位）。
 */
const loadCatalog = cache(async () => (await getDataSource()).listCatalogProducts());
const loadCatalogMap = cache(async () => new Map((await loadCatalog()).map((p) => [p.id, p])));
const loadLocations = cache(async () => (await getDataSource()).listLocations());
const loadLocationMap = cache(async () => new Map((await loadLocations()).map((l) => [l.id, l])));
const loadAllPlacements = cache(async () => (await getDataSource()).listPlacementsWithStock());
const loadRecentReportCounts = cache(async () =>
  (await getDataSource()).countRecentReportsByProduct(RECENT_WINDOW_HOURS),
);

function summarize(
  products: CatalogProduct[],
  placements: PlacementWithStock[],
  recentCounts: Record<ID, number>,
  now: Date,
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
    releaseStatus: releaseStatusOf(product, now),
    locationCount: counts.get(product.id)?.total ?? 0,
    availableLocationCount: counts.get(product.id)?.available ?? 0,
    recentReportCount: recentCounts[product.id] ?? 0,
  }));
}

const loadSummaries = cache(async (): Promise<GachaProductSummary[]> => {
  const [products, placements, recentCounts] = await Promise.all([
    loadCatalog(),
    loadAllPlacements(),
    loadRecentReportCounts(),
  ]);
  return summarize(products, placements, recentCounts, new Date());
});

/** 新しい順（発売月・再発売月の新しい方。不明は最後） */
function byLatestMonthDesc(a: GachaProductSummary, b: GachaProductSummary): number {
  return (latestMonth(b.product) ?? "").localeCompare(latestMonth(a.product) ?? "");
}

export interface SearchOptions {
  /** 在庫あり（残りわずか含む）の店舗がある商品のみ */
  availableOnly?: boolean;
  /**
   * 過去の商品を含めるか。
   * 省略時: キーワードありは含める（後ろに並ぶ）、キーワードなし（一覧）は含めない
   */
  includePast?: boolean;
  /** 1 始まりのページ番号 */
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  items: GachaProductSummary[];
  /** 条件に合う全件数 */
  total: number;
  /** includePast=false のために除外した過去の商品の件数（「過去の商品も表示」の案内用） */
  hiddenPastCount: number;
  page: number;
  pageCount: number;
  includePast: boolean;
}

/**
 * 検索・一覧。並び順は
 * 1) 発売状況（現在の商品 → 発売予定 → 発売時期不明 → 過去の商品）
 * 2) 在庫ありの店舗数 3) 直近の報告数 4) 新しい順
 */
export async function searchProducts(query: string, options: SearchOptions = {}): Promise<SearchResult> {
  const includePast = options.includePast ?? query.trim() !== "";
  const pageSize = options.pageSize ?? SEARCH_PAGE_SIZE;
  const summaries = await loadSummaries();

  const matched = summaries
    .filter((s) => matchesQuery(s.product, query))
    .filter((s) => !options.availableOnly || s.availableLocationCount > 0);
  const visible = includePast ? matched : matched.filter((s) => s.releaseStatus !== "past");
  visible.sort(
    (a, b) =>
      RELEASE_STATUS_ORDER[a.releaseStatus] - RELEASE_STATUS_ORDER[b.releaseStatus] ||
      b.availableLocationCount - a.availableLocationCount ||
      b.recentReportCount - a.recentReportCount ||
      byLatestMonthDesc(a, b),
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(options.page ?? 1)), pageCount);
  return {
    items: visible.slice((page - 1) * pageSize, page * pageSize),
    total: visible.length,
    hiddenPastCount: matched.length - visible.length,
    page,
    pageCount,
    includePast,
  };
}

/** 🔥 話題のガチャ：直近24時間の報告が多い順 */
export async function getTrendingProducts(limit = 6): Promise<GachaProductSummary[]> {
  const summaries = await loadSummaries();
  return summaries
    .filter((s) => s.recentReportCount > 0)
    .sort((a, b) => b.recentReportCount - a.recentReportCount)
    .slice(0, limit);
}

/** 🆕 新着ガチャ：発売中（current）の商品を新しい順に。過去の商品・発売予定は含めない */
export async function getNewProducts(limit = 6): Promise<GachaProductSummary[]> {
  return listByStatus("current", limit, byLatestMonthDesc);
}

/** 🗓 発売予定：発売が近い順 */
export async function getUpcomingProducts(limit = 6): Promise<GachaProductSummary[]> {
  return listByStatus("upcoming", limit, (a, b) => -byLatestMonthDesc(a, b));
}

async function listByStatus(
  status: ReleaseStatus,
  limit: number,
  compare: (a: GachaProductSummary, b: GachaProductSummary) => number,
): Promise<GachaProductSummary[]> {
  const summaries = await loadSummaries();
  return summaries
    .filter((s) => s.releaseStatus === status)
    .sort((a, b) => compare(a, b) || b.availableLocationCount - a.availableLocationCount)
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
 * 📍 近くで見つかったガチャの候補：在庫ありと報告された「商品×設置場所」を返す。
 * 現在地をサーバーに送らないため、距離の計算と絞り込みはブラウザ側（pickNearbyFinds）で行う。
 * カタログ索引に無い商品（サンプルなど）と、座標が不明な場所は除く。
 */
export async function getAvailableFinds(): Promise<NearbyFindCandidate[]> {
  const [productMap, locationMap, placements] = await Promise.all([
    loadCatalogMap(),
    loadLocationMap(),
    loadAllPlacements(),
  ]);

  const candidates: NearbyFindCandidate[] = [];
  for (const { placement, stock } of placements) {
    if (!isAvailable(stock.status)) continue;
    const product = productMap.get(placement.productId);
    const location = locationMap.get(placement.locationId);
    if (!product || !location || location.lat === null || location.lng === null) continue;
    candidates.push({ product, location, stock });
  }
  return candidates;
}

/** 店舗検索の最大件数（候補を選ぶための一覧なので多くは返さない） */
export const LOCATION_SEARCH_LIMIT = 20;

/**
 * 店舗の検索（「この店舗で見つけた」報告で店舗を選ぶため）。店舗名・住所・エリアの AND 検索。
 * 店舗の索引（Firestore では catalogIndex の店舗シャード。キャッシュ済み）だけを使い、locations は読まない。
 */
export async function searchLocations(
  query: string,
  limit = LOCATION_SEARCH_LIMIT,
): Promise<{ items: Location[]; total: number }> {
  const terms = searchTerms(query);
  if (terms.length === 0) return { items: [], total: 0 };
  const matched = (await loadLocations()).filter((l) => matchesLocationQuery(l, terms));
  // 店舗名に含まれるものを先に（住所だけの一致は後ろ）、同順位は名前順
  const nameHit = (l: Location) => terms.every((t) => normalizeForSearch(l.name).includes(t));
  matched.sort((a, b) => Number(nameHit(b)) - Number(nameHit(a)) || a.name.localeCompare(b.name, "ja"));
  return { items: matched.slice(0, limit), total: matched.length };
}

/**
 * 🗺 トップの地図用の店舗一覧（座標がある店舗のみ・軽量版）。
 * 店舗の索引（キャッシュ済み）と、トップの集計ですでに読み込んでいる設置情報から作るため、Firestore の読み取りは増えない。
 * 現在地はサーバーに送らないため、距離の計算・近い店舗の絞り込みはブラウザ側で行う。
 */
export async function getStoreMapEntries(): Promise<StoreMapEntry[]> {
  const [locations, placements] = await Promise.all([loadLocations(), loadAllPlacements()]);
  const byLocation = new Map<ID, StoreMapEntry["stockCounts"] & { total: number }>();
  for (const { placement, stock } of placements) {
    const c = byLocation.get(placement.locationId) ?? { in_stock: 0, low: 0, sold_out: 0, unknown: 0, total: 0 };
    c[stock.status] += 1;
    c.total += 1;
    byLocation.set(placement.locationId, c);
  }
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  const entries: StoreMapEntry[] = [];
  for (const l of locations) {
    if (l.lat === null || l.lng === null) continue;
    const c = byLocation.get(l.id);
    entries.push({
      id: l.id,
      name: l.name,
      lat: round(l.lat),
      lng: round(l.lng),
      placementCount: c?.total ?? 0,
      stockCounts: { in_stock: c?.in_stock ?? 0, low: c?.low ?? 0, sold_out: c?.sold_out ?? 0, unknown: c?.unknown ?? 0 },
    });
  }
  return entries;
}

/** generateMetadata とページ本体で同じ詳細を2回読まないよう、リクエスト内でキャッシュする */
export const getProductDetail = cache(
  async (productId: ID): Promise<{ product: GachaProduct; locations: ProductLocationEntry[] } | null> => {
    const ds = await getDataSource();
    const product = await ds.getProduct(productId);
    if (!product) return null;
    const placements = await ds.listPlacementsWithStock({ productId });
    const locationMap = placements.length > 0 ? await loadLocationMap() : new Map<ID, Location>();

    const entries = (
      await Promise.all(
        placements.map(async ({ placement, stock }) => {
          // 索引に無い場所（索引の更新前に登録された場所など）は 1 件だけ読む
          const location = locationMap.get(placement.locationId) ?? (await ds.getLocation(placement.locationId));
          return location ? { location, stock } : null;
        }),
      )
    )
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
    const placements = await ds.listPlacementsWithStock({ locationId });
    // この場所に設置されている商品だけを索引から引く（products は読まない）
    const productMap = placements.length > 0 ? await loadCatalogMap() : new Map<ID, CatalogProduct>();

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

function compareByStock(a: { stock: StockSnapshot }, b: { stock: StockSnapshot }): number {
  const byStatus = STOCK_STATUS_ORDER[a.stock.status] - STOCK_STATUS_ORDER[b.stock.status];
  if (byStatus !== 0) return byStatus;
  // 同じ状態なら最近確認されたものを上に
  return (b.stock.lastCheckedAt ?? "").localeCompare(a.stock.lastCheckedAt ?? "");
}

/* ------------------------------------------------------------------
 * お気に入り・在庫通知（userId はサーバーで検証済みの uid。本人の分だけを読む）
 * ------------------------------------------------------------------ */

/** お気に入りにできる商品か（商品詳細と同じキャッシュ済みの 1 件取得。サンプル商品は対象外） */
async function favoritableProduct(productId: ID): Promise<boolean> {
  return (await (await getDataSource()).getProduct(productId)) !== null;
}

/**
 * お気に入り一覧（商品情報はカタログ索引、在庫の集計は placements のキャッシュから。
 * Firestore の読み取りは本人のお気に入りの件数分だけ）
 */
export async function getFavoriteViews(userId: ID): Promise<FavoriteView[]> {
  const ds = await getDataSource();
  const [favorites, catalog, placements] = await Promise.all([
    ds.listFavorites(userId),
    loadCatalogMap(),
    loadAllPlacements(),
  ]);
  const counts = new Map<ID, { total: number; available: number }>();
  for (const { placement, stock } of placements) {
    const c = counts.get(placement.productId) ?? { total: 0, available: 0 };
    c.total += 1;
    if (isAvailable(stock.status)) c.available += 1;
    counts.set(placement.productId, c);
  }
  return favorites.flatMap((favorite) => {
    const product = catalog.get(favorite.productId);
    if (!product) return []; // 索引に無い（削除された・サンプル）商品は表示しない
    const c = counts.get(favorite.productId);
    return [{ favorite, product, locationCount: c?.total ?? 0, availableLocationCount: c?.available ?? 0 }];
  });
}

export async function setFavorite(userId: ID, productId: ID, favorite: boolean): Promise<Favorite | null> {
  if (favorite && !(await favoritableProduct(productId))) throw new ProductNotFoundError(productId);
  return (await getDataSource()).setFavorite(userId, productId, favorite);
}

export async function setStockAlert(userId: ID, productId: ID, enabled: boolean): Promise<Favorite | null> {
  if (enabled && !(await favoritableProduct(productId))) throw new ProductNotFoundError(productId);
  return (await getDataSource()).setStockAlert(userId, productId, enabled);
}

/**
 * 在庫通知の確認：通知 ON のお気に入りについて、新しい「在庫あり」「残りわずか」の報告を探す。
 * 見つかったものは lastNotifiedAt を更新し、同じ報告で再び通知しない。
 * 読み取り：通知 ON のお気に入りの件数分 + キャッシュが切れた商品の設置情報。書き込み：通知した商品の件数分
 */
export async function takeStockAlerts(userId: ID): Promise<StockAlert[]> {
  const ds = await getDataSource();
  const favorites = await ds.listFavorites(userId, { notifyOnly: true });
  if (!favorites.length) return [];
  // 商品ごとの設置情報（報告のたびに無効化されるキャッシュ。全ユーザーで共有）で最新の報告を見る
  const [catalog, locations, placements] = await Promise.all([
    loadCatalogMap(),
    loadLocationMap(),
    Promise.all(favorites.map((f) => ds.listPlacementsWithStock({ productId: f.productId }))).then((r) => r.flat()),
  ]);
  const alerts = findStockAlerts(favorites, placements, {
    product: (id) => catalog.get(id)?.name,
    location: (id) => locations.get(id),
  });
  if (alerts.length) await ds.markStockAlertsNotified(userId, alerts.map((a) => a.productId));
  return alerts;
}

/** お気に入りにできない商品（存在しない・サンプル） */
export class ProductNotFoundError extends Error {
  constructor(productId: ID) {
    super(`Product not found: ${productId}`);
    this.name = "ProductNotFoundError";
  }
}

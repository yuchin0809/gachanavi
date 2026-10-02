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
import { STOCK_ALERT_MAX_AGE_MS, findStockAlerts, isStockAlertStatus, shouldNotifyFavorite } from "@/lib/favorites";
import { prefectureCodeOf, productTitle } from "@/lib/seo/text";
import { STOCK_STATUS_META, STOCK_STATUS_ORDER, isAvailable } from "@/lib/stock";
import { seriesKeyOf } from "@/lib/visual/classify";
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
import type { AddedStockReport, DataSource } from "./source";

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

/* ------------------------------------------------------------------
 * バックグラウンド通知（FCM Web Push）
 * ------------------------------------------------------------------ */

export interface StockPushSummary {
  /** 通知の確認をしなかった理由（売り切れ・古い報告など） */
  skipped?: "status" | "not_latest" | "too_old";
  /** 通知 ON でこの商品をお気に入りにしているユーザー数 */
  watchers: number;
  /** 通知条件を満たしたユーザー数（前回の通知より新しい報告など） */
  targets: number;
  sent: number;
  failed: number;
  removedTokens: number;
  /** 1 台以上に届いたユーザー（lastNotifiedAt を更新した） */
  notifiedUsers: ID[];
}

/**
 * 在庫報告の後に、通知 ON のお気に入りユーザーへバックグラウンド通知を送る（在庫報告のトランザクションの外で呼ぶ）。
 *
 * 条件はアプリ内のお知らせと共通（isStockAlertStatus・shouldNotifyFavorite）：在庫あり・残りわずかの報告で、
 * その報告が最新の在庫状態になった場合だけ。通知 ON にした後・前回の通知の後・24 時間以内の報告だけ。
 *
 * 読み取り：通知 ON のお気に入りの件数（0 件でも 1）+ 通知するユーザーごとの端末一覧（各 1〜）+ 商品・店舗（キャッシュ）。
 * 書き込み：届いたユーザーの lastNotifiedAt + 無効になった端末の削除。
 * 送信の失敗は在庫報告に影響させない（呼び出し側で例外を握りつぶす）
 */
export async function sendStockPushNotifications(
  report: AddedStockReport,
  now: number = Date.now(),
): Promise<StockPushSummary> {
  const summary: StockPushSummary = { watchers: 0, targets: 0, sent: 0, failed: 0, removedTokens: 0, notifiedUsers: [] };
  if (!isStockAlertStatus(report.status)) return { ...summary, skipped: "status" };
  if (!report.latestUpdated) return { ...summary, skipped: "not_latest" };
  if (now - Date.parse(report.reportedAt) > STOCK_ALERT_MAX_AGE_MS) return { ...summary, skipped: "too_old" };

  const ds = await getDataSource();
  const watchers = await ds.listStockAlertWatchers(report.productId);
  summary.watchers = watchers.length;
  const targets = watchers.filter((w) => shouldNotifyFavorite(w.favorite, report.reportedAt, now));
  summary.targets = targets.length;
  if (!targets.length) return summary;

  // 商品名・店舗名（商品詳細と同じキャッシュ）。取得できなくても一般的な文言で送る
  const [product, location] = await Promise.all([
    ds.getProduct(report.productId).catch(() => null),
    ds.getLocation(report.locationId).catch(() => null),
  ]);
  const label = STOCK_STATUS_META[report.status].label;
  const data = {
    title: "GachaNavi 在庫情報",
    body: product
      ? `${product.name}に「${label}」の報告があります${location ? `（${location.name}）` : ""}`
      : `お気に入りのガチャに「${label}」の報告があります`,
    url: `/gacha/${report.productId}`,
    tag: `stock-${report.productId}`,
  };

  const tokensByUser = await Promise.all(targets.map(async (t) => ({ userId: t.userId, tokens: await ds.listPushTokens(t.userId) })));
  const owner = new Map<string, ID>();
  const messages = tokensByUser.flatMap(({ userId, tokens }) =>
    tokens.map((token) => {
      owner.set(token, userId);
      return { token, data };
    }),
  );
  if (!messages.length) return summary;

  const { getPushSender } = await import("@/lib/push/sender");
  const results = await getPushSender().send(messages);
  const delivered = new Set<ID>();
  const invalid: { userId: ID; token: string }[] = [];
  for (const r of results) {
    const userId = owner.get(r.token);
    if (!userId) continue;
    if (r.ok) {
      summary.sent++;
      delivered.add(userId);
    } else {
      summary.failed++;
      if (r.invalidToken) invalid.push({ userId, token: r.token });
    }
  }
  await Promise.all([
    ...invalid.map(({ userId, token }) => ds.deletePushToken(userId, token)),
    // 届いたユーザーだけ通知済みにする（届かなかったユーザーには、アプリを開いた時のお知らせで伝える）
    ...[...delivered].map((userId) => ds.markStockAlertsNotified(userId, [report.productId])),
  ]);
  summary.removedTokens = invalid.length;
  summary.notifiedUsers = [...delivered];
  // 送信数の確認用（Vercel のログ）。uid・トークンは出さない
  console.info(
    `[push] product=${report.productId} watchers=${summary.watchers} targets=${summary.targets} sent=${summary.sent} failed=${summary.failed} removedTokens=${summary.removedTokens}`,
  );
  return summary;
}

export async function savePushToken(userId: ID, token: string): Promise<void> {
  await (await getDataSource()).savePushToken(userId, token);
}

export async function deletePushToken(userId: ID, token: string): Promise<void> {
  await (await getDataSource()).deletePushToken(userId, token);
}

/* ------------------------------------------------------------------
 * サイトマップ（商品・店舗の索引と、キャッシュ済みの placements だけを使う。products / locations は読まない）
 * ------------------------------------------------------------------ */

export interface SitemapEntry {
  path: string;
  /** そのページの内容が最後に変わった日時（在庫報告の日時）。分からない場合は付けない */
  lastModified?: string;
}

/** 商品・店舗ごとの最新の在庫報告日時（ページに表示している「最終確認」と同じ値） */
async function latestReportTimes(): Promise<{ byProduct: Map<ID, string>; byLocation: Map<ID, string> }> {
  const byProduct = new Map<ID, string>();
  const byLocation = new Map<ID, string>();
  for (const { placement, stock } of await loadAllPlacements()) {
    const at = stock.lastCheckedAt;
    if (!at) continue;
    if ((byProduct.get(placement.productId) ?? "") < at) byProduct.set(placement.productId, at);
    if ((byLocation.get(placement.locationId) ?? "") < at) byLocation.set(placement.locationId, at);
  }
  return { byProduct, byLocation };
}

export async function getSitemapProducts(): Promise<SitemapEntry[]> {
  const [catalog, times] = await Promise.all([loadCatalog(), latestReportTimes()]);
  return catalog.map((p) => ({ path: `/gacha/${p.id}`, lastModified: times.byProduct.get(p.id) }));
}

/** サイトマップ インデックス用の商品数（索引だけ。placements は読まない） */
export async function getSitemapProductCount(): Promise<number> {
  return (await loadCatalog()).length;
}

export async function getSitemapLocations(): Promise<SitemapEntry[]> {
  const [locations, times] = await Promise.all([loadLocations(), latestReportTimes()]);
  return locations.map((l) => ({ path: `/locations/${l.id}`, lastModified: times.byLocation.get(l.id) }));
}

/** 都道府県ごとの店舗一覧（店舗の索引から。住所の先頭の都道府県名で分ける） */
export async function getLocationsByPrefecture(): Promise<Map<string, Location[]>> {
  const groups = new Map<string, Location[]>();
  for (const l of await loadLocations()) {
    const code = prefectureCodeOf(l.address);
    if (!code) continue;
    const list = groups.get(code) ?? [];
    list.push(l);
    groups.set(code, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.address.localeCompare(b.address, "ja") || a.name.localeCompare(b.name, "ja"));
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * 関連するガチャ（同じシリーズ → 同じメーカーで発売時期が近いもの）。カタログ索引（キャッシュ済み）だけで探す
 */
export async function getRelatedProducts(product: CatalogProduct, limit = 6): Promise<GachaProductSummary[]> {
  const [catalog, placements] = await Promise.all([loadCatalog(), loadAllPlacements()]);
  const key = seriesKeyOf(product);
  const month = latestMonth(product);
  const monthIndex = (m: string | null) => (m ? Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) : null);
  const target = monthIndex(month);
  const sameSeries: CatalogProduct[] = [];
  const sameMaker: { p: CatalogProduct; gap: number }[] = [];
  for (const p of catalog) {
    if (p.id === product.id) continue;
    if (key && seriesKeyOf(p) === key) {
      sameSeries.push(p);
      continue;
    }
    if (p.maker && p.maker === product.maker && target !== null) {
      const m = monthIndex(latestMonth(p));
      if (m !== null && Math.abs(m - target) <= 2) sameMaker.push({ p, gap: Math.abs(m - target) });
    }
  }
  const byNewest = (a: CatalogProduct, b: CatalogProduct) => (latestMonth(b) ?? "").localeCompare(latestMonth(a) ?? "") || a.id.localeCompare(b.id);
  const picked = [
    ...sameSeries.sort(byNewest),
    ...sameMaker.sort((a, b) => a.gap - b.gap || byNewest(a.p, b.p)).map((x) => x.p),
  ].slice(0, limit);
  return summarize(picked, placements, {}, new Date());
}

/** 商品名（タイトルに使う長さ）が同じ商品がほかにもあるか（カタログ索引だけで判定。結果は索引ごとに 1 回だけ作る） */
const titleKeyCounts = new WeakMap<CatalogProduct[], Map<string, number>>();
export async function hasAmbiguousProductTitle(product: Pick<CatalogProduct, "name">): Promise<boolean> {
  const catalog = await loadCatalog();
  let counts = titleKeyCounts.get(catalog);
  if (!counts) {
    counts = new Map();
    for (const p of catalog) counts.set(productTitle(p), (counts.get(productTitle(p)) ?? 0) + 1);
    titleKeyCounts.set(catalog, counts);
  }
  return (counts.get(productTitle({ name: product.name, releaseMonth: null })) ?? 0) > 1;
}

/** カタログ索引の 1 商品（OGP 画像など。products は読まない） */
export async function getCatalogProduct(id: ID): Promise<CatalogProduct | null> {
  return (await loadCatalogMap()).get(id) ?? null;
}

/** 都道府県の店舗一覧（店舗ごとの設置情報の件数つき。索引とキャッシュ済みの placements だけを使う） */
export async function getPrefectureStores(code: string): Promise<{ location: Location; placementCount: number }[]> {
  const [groups, placements] = await Promise.all([getLocationsByPrefecture(), loadAllPlacements()]);
  const counts = new Map<ID, number>();
  for (const { placement } of placements) counts.set(placement.locationId, (counts.get(placement.locationId) ?? 0) + 1);
  return (groups.get(code) ?? []).map((location) => ({ location, placementCount: counts.get(location.id) ?? 0 }));
}

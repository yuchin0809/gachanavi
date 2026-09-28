/**
 * 画面から利用するデータ取得関数群（Server Component から呼び出す想定）。
 * 集計・検索ロジックはここにまとめ、生データの取得は DataSource に委譲する。
 */
import { mockCurrentPosition } from "@/data/mock";
import { distanceMeters } from "@/lib/geo";
import { matchesQuery } from "@/lib/search";
import { STOCK_STATUS_ORDER, isAvailable, latestSnapshot } from "@/lib/stock";
import type {
  GachaProduct,
  GachaProductSummary,
  GeoPoint,
  ID,
  Location,
  LocationProductEntry,
  NearbyFind,
  Placement,
  ProductLocationEntry,
  StockReport,
  StockSnapshot,
} from "@/types";
import { createMockDataSource } from "./mockSource";
import type { DataSource } from "./source";

const dataSource: DataSource = createMockDataSource();

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function pairKey(productId: ID, locationId: ID) {
  return `${productId}__${locationId}`;
}

function groupReportsByPair(reports: StockReport[]): Map<string, StockReport[]> {
  const map = new Map<string, StockReport[]>();
  for (const r of reports) {
    const key = pairKey(r.productId, r.locationId);
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  return map;
}

function snapshotFor(
  reportsByPair: Map<string, StockReport[]>,
  placement: Placement,
): StockSnapshot {
  return latestSnapshot(reportsByPair.get(pairKey(placement.productId, placement.locationId)) ?? []);
}

function summarize(
  products: GachaProduct[],
  placements: Placement[],
  reports: StockReport[],
  now: Date,
): GachaProductSummary[] {
  const reportsByPair = groupReportsByPair(reports);
  return products.map((product) => {
    const own = placements.filter((pl) => pl.productId === product.id);
    const availableLocationCount = own.filter((pl) =>
      isAvailable(snapshotFor(reportsByPair, pl).status),
    ).length;
    const recentReportCount = reports.filter(
      (r) =>
        r.productId === product.id &&
        now.getTime() - new Date(r.reportedAt).getTime() <= RECENT_WINDOW_MS,
    ).length;
    return { product, locationCount: own.length, availableLocationCount, recentReportCount };
  });
}

async function loadSummaries(): Promise<GachaProductSummary[]> {
  const [products, placements, reports] = await Promise.all([
    dataSource.listProducts(),
    dataSource.listPlacements(),
    dataSource.listStockReports(),
  ]);
  return summarize(products, placements, reports, new Date());
}

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
  return summaries
    .sort((a, b) => b.product.releaseMonth.localeCompare(a.product.releaseMonth))
    .slice(0, limit);
}

/** 現在地（位置情報実装までは開発用の基準地点） */
export function getCurrentPosition(): GeoPoint & { label: string } {
  return mockCurrentPosition;
}

/** 📍 近くで見つかったガチャ：現在地から近い設置場所で、在庫ありと報告された商品 */
export async function getNearbyFinds(origin: GeoPoint, limit = 6): Promise<NearbyFind[]> {
  const [products, locations, placements, reports] = await Promise.all([
    dataSource.listProducts(),
    dataSource.listLocations(),
    dataSource.listPlacements(),
    dataSource.listStockReports(),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const locationMap = new Map(locations.map((l) => [l.id, l]));
  const reportsByPair = groupReportsByPair(reports);

  const finds: NearbyFind[] = [];
  for (const pl of placements) {
    const product = productMap.get(pl.productId);
    const location = locationMap.get(pl.locationId);
    if (!product || !location) continue;
    const stock = snapshotFor(reportsByPair, pl);
    if (!isAvailable(stock.status)) continue;
    finds.push({ product, location, stock, distanceMeters: distanceMeters(origin, location) });
  }

  // 同じ商品は最寄りの1件だけ残す
  const seen = new Set<ID>();
  return finds
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .filter((f) => (seen.has(f.product.id) ? false : (seen.add(f.product.id), true)))
    .slice(0, limit);
}

export async function getProductDetail(
  productId: ID,
): Promise<{ product: GachaProduct; locations: ProductLocationEntry[] } | null> {
  const product = await dataSource.getProduct(productId);
  if (!product) return null;
  const [locations, placements, reports] = await Promise.all([
    dataSource.listLocations(),
    dataSource.listPlacements({ productId }),
    dataSource.listStockReports({ productId }),
  ]);
  const locationMap = new Map(locations.map((l) => [l.id, l]));
  const reportsByPair = groupReportsByPair(reports);

  const entries = placements
    .map((pl) => {
      const location = locationMap.get(pl.locationId);
      return location ? { location, stock: snapshotFor(reportsByPair, pl) } : null;
    })
    .filter((e): e is ProductLocationEntry => e !== null)
    .sort(compareByStock);

  return { product, locations: entries };
}

export async function getLocationDetail(
  locationId: ID,
): Promise<{ location: Location; products: LocationProductEntry[] } | null> {
  const location = await dataSource.getLocation(locationId);
  if (!location) return null;
  const [products, placements, reports] = await Promise.all([
    dataSource.listProducts(),
    dataSource.listPlacements({ locationId }),
    dataSource.listStockReports({ locationId }),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const reportsByPair = groupReportsByPair(reports);

  const entries = placements
    .map((pl) => {
      const product = productMap.get(pl.productId);
      return product ? { product, stock: snapshotFor(reportsByPair, pl) } : null;
    })
    .filter((e): e is LocationProductEntry => e !== null)
    .sort(compareByStock);

  return { location, products: entries };
}

/** 在庫あり → 残りわずか → 未確認 → 売り切れ、同じ状態なら確認が新しい順 */
function compareByStock(a: { stock: StockSnapshot }, b: { stock: StockSnapshot }): number {
  return (
    STOCK_STATUS_ORDER[a.stock.status] - STOCK_STATUS_ORDER[b.stock.status] ||
    (b.stock.lastCheckedAt ?? "").localeCompare(a.stock.lastCheckedAt ?? "")
  );
}

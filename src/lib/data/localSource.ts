/**
 * 収集した実データ（data/collected/products.json・locations.json）を読むローカル確認用の DataSource。
 *
 *   DATA_SOURCE=local npm run dev
 *
 * - Firestore には一切アクセスしない（Firestore 投入前に、実データ規模で画面・検索を確認するため）
 * - 商品・店舗の変換と ID は投入スクリプトと共通（src/lib/catalog/collected.ts）
 * - 設置情報・在庫報告はサーバーのメモリ上にだけ保存する（再起動で消える。架空の設置データは作らない）
 * - 読み込み元は COLLECTED_DATA_DIR（既定: data/collected）
 */
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type CollectedLocation,
  type CollectedProduct,
  toGachaProduct,
  toLocation,
} from "@/lib/catalog/collected";
import { toCatalogProduct } from "@/lib/catalog/index-format";
import type { CatalogProduct, GachaProduct, ID, Location, Placement, StockReport } from "@/types";
import { memoryFavorites } from "./memoryFavorites";
import { checkMemoryThrottle } from "./memoryThrottle";
import type { DataSource } from "./source";
import { PlacementNotFoundError, placementIdOf } from "./source";

interface LocalCatalog {
  products: Map<ID, GachaProduct>;
  catalog: CatalogProduct[];
  locations: Location[];
  locationMap: Map<ID, Location>;
}

let catalogPromise: Promise<LocalCatalog> | null = null;

async function loadCatalog(): Promise<LocalCatalog> {
  catalogPromise ??= (async () => {
    const dir = process.env.COLLECTED_DATA_DIR ?? path.join(process.cwd(), "data", "collected");
    const [rawProducts, rawLocations] = await Promise.all([
      readFile(path.join(dir, "products.json"), "utf8").then((t) => JSON.parse(t) as CollectedProduct[]),
      readFile(path.join(dir, "locations.json"), "utf8").then((t) => JSON.parse(t) as CollectedLocation[]),
    ]);
    const products = new Map<ID, GachaProduct>();
    for (const raw of rawProducts) {
      const p = toGachaProduct(raw);
      if (!products.has(p.id)) products.set(p.id, p);
    }
    const locationMap = new Map<ID, Location>();
    for (const raw of rawLocations) {
      const l = toLocation(raw);
      if (!locationMap.has(l.id)) locationMap.set(l.id, l);
    }
    return {
      products,
      catalog: [...products.values()].map(toCatalogProduct),
      locations: [...locationMap.values()],
      locationMap,
    };
  })();
  return catalogPromise;
}

/* 在庫報告・設置情報（メモリ上のみ） */
const placements = new Map<ID, Placement>();
const reports: StockReport[] = [];

function latestFor(productId: ID, locationId: ID): StockReport | null {
  let latest: StockReport | null = null;
  for (const r of reports) {
    if (r.productId === productId && r.locationId === locationId && (!latest || r.reportedAt > latest.reportedAt)) {
      latest = r;
    }
  }
  return latest;
}

export function createLocalDataSource(): DataSource {
  return {
    persistent: false,

    async listCatalogProducts() {
      return (await loadCatalog()).catalog;
    },
    async getProduct(id) {
      return (await loadCatalog()).products.get(id) ?? null;
    },
    async listLocations() {
      return (await loadCatalog()).locations;
    },
    async getLocation(id) {
      return (await loadCatalog()).locationMap.get(id) ?? null;
    },
    async listPlacementsWithStock(filter = {}) {
      return [...placements.values()]
        .filter(
          (pl) =>
            (!filter.productId || pl.productId === filter.productId) &&
            (!filter.locationId || pl.locationId === filter.locationId),
        )
        .map((placement) => {
          const latest = latestFor(placement.productId, placement.locationId);
          return {
            placement,
            stock: latest
              ? { status: latest.status, lastCheckedAt: latest.reportedAt }
              : { status: "unknown" as const, lastCheckedAt: null },
          };
        });
    },
    async countRecentReportsByProduct(windowHours) {
      const since = Date.now() - windowHours * 60 * 60 * 1000;
      const counts: Record<ID, number> = {};
      for (const r of reports) {
        if (Date.parse(r.reportedAt) >= since) counts[r.productId] = (counts[r.productId] ?? 0) + 1;
      }
      return counts;
    },
    async listStockReports({ productId, locationId, limit = 20 }) {
      return reports
        .filter((r) => r.productId === productId && r.locationId === locationId)
        .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))
        .slice(0, limit);
    },
    async getUser() {
      return null;
    },
    async addStockReport(input) {
      const { products, locationMap } = await loadCatalog();
      if (!products.has(input.productId) || !locationMap.has(input.locationId)) {
        throw new PlacementNotFoundError(input.productId, input.locationId);
      }
      const now = checkMemoryThrottle(input);
      const reportedAt = input.reportedAt ?? new Date(now).toISOString();
      const id = placementIdOf(input.productId, input.locationId);
      const placementCreated = !placements.has(id);
      const previous = latestFor(input.productId, input.locationId);
      if (placementCreated) {
        placements.set(id, { id, productId: input.productId, locationId: input.locationId, firstSeenAt: reportedAt });
      }
      const report: StockReport = {
        id: `local-${reports.length + 1}`,
        productId: input.productId,
        locationId: input.locationId,
        userId: input.userId,
        status: input.status,
        reportedAt,
      };
      reports.push(report);
      return { ...report, placementCreated, latestUpdated: !previous || reportedAt > previous.reportedAt };
    },
    ...memoryFavorites,
  };
}

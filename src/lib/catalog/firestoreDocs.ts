/**
 * 収集データ → Firestore ドキュメント（products / locations / catalogIndex）の変換。
 *
 * 投入スクリプト（scripts/import-collected.ts）とテストで共通に使う。firebase-admin には依存しない
 * （値は JSON で表せるものだけ。日時は ISO 文字列で保存し、読み取り側 toIso() がそのまま扱える）。
 */
import { createHash } from "node:crypto";
import type { GachaProduct, Location } from "@/types";
import type { CollectedLocation, CollectedProduct } from "./collected";
import { toGachaProduct, toLocation } from "./collected";
import {
  type CatalogMeta,
  locationShardId,
  productShardId,
  splitIntoShards,
  toCatalogProduct,
} from "./index-format";

/** 投入の識別子（どの投入で書かれたか） */
export const IMPORT_BATCH = "collected-2026-09";

export interface FirestoreDoc {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}

export function productDocOf(p: GachaProduct): FirestoreDoc {
  const { id, ...rest } = p;
  return {
    collection: "products",
    id,
    data: { ...rest, isSample: false, importBatch: IMPORT_BATCH },
  };
}

export function locationDocOf(l: Location, raw?: CollectedLocation): FirestoreDoc {
  const { id, ...rest } = l;
  return {
    collection: "locations",
    id,
    data: {
      ...rest,
      prefecture: raw?.prefecture ?? null,
      city: raw?.city ?? null,
      isSample: false,
      importBatch: IMPORT_BATCH,
    },
  };
}

export interface ConvertedCatalog {
  products: GachaProduct[];
  locations: Location[];
  productDocs: FirestoreDoc[];
  locationDocs: FirestoreDoc[];
  /** catalogIndex のシャード（meta は最後に書く） */
  indexShardDocs: FirestoreDoc[];
  indexMetaDoc: FirestoreDoc;
  duplicates: { products: string[]; locations: string[] };
}

/** 内容のハッシュ（再実行時に「変わっていないドキュメント」を書き直さないために使う） */
export function contentHash(data: unknown): string {
  return createHash("sha1").update(JSON.stringify(data)).digest("hex");
}

export function convertCollected(rawProducts: CollectedProduct[], rawLocations: CollectedLocation[]): ConvertedCatalog {
  const products: GachaProduct[] = [];
  const productIds = new Set<string>();
  const dupProducts: string[] = [];
  for (const raw of rawProducts) {
    const p = toGachaProduct(raw);
    if (productIds.has(p.id)) {
      dupProducts.push(p.id);
      continue;
    }
    productIds.add(p.id);
    products.push(p);
  }

  const locations: Location[] = [];
  const locationDocs: FirestoreDoc[] = [];
  const locationIds = new Set<string>();
  const dupLocations: string[] = [];
  for (const raw of rawLocations) {
    const l = toLocation(raw);
    if (locationIds.has(l.id)) {
      dupLocations.push(l.id);
      continue;
    }
    locationIds.add(l.id);
    locations.push(l);
    locationDocs.push(locationDocOf(l, raw));
  }

  const productShards = splitIntoShards(products.map(toCatalogProduct));
  const locationShards = splitIntoShards(locations);
  const indexShardDocs: FirestoreDoc[] = [
    ...productShards.map((items, i) => ({ collection: "catalogIndex", id: productShardId(i), data: { items } })),
    ...locationShards.map((items, i) => ({ collection: "catalogIndex", id: locationShardId(i), data: { items } })),
  ];
  // 版は索引の内容から決める（内容が同じなら同じ版 = 再実行しても meta は変わらない）
  const version = contentHash(indexShardDocs.map((d) => d.data)).slice(0, 16);
  const meta: CatalogMeta = {
    version,
    productShards: productShards.length,
    locationShards: locationShards.length,
    productCount: products.length,
    locationCount: locations.length,
    updatedAt: `import:${IMPORT_BATCH}`,
  };

  return {
    products,
    locations,
    productDocs: products.map(productDocOf),
    locationDocs,
    indexShardDocs,
    indexMetaDoc: { collection: "catalogIndex", id: "meta", data: { ...meta } },
    duplicates: { products: dupProducts, locations: dupLocations },
  };
}

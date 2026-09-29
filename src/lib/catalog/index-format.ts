/**
 * カタログ索引（商品一覧・検索用の軽量データ）の保存形式。
 *
 * Firestore では次の形で保存する（投入スクリプトが products と同時に書き込む）:
 *   catalogIndex/meta               { version, productShards, locationShards, productCount, locationCount, updatedAt }
 *   catalogIndex/products-000 …     { items: CatalogProduct[] }
 *   catalogIndex/locations-000 …    { items: Location[] }
 *
 * - 1 ドキュメントは Firestore の上限（1 MiB）と Next.js データキャッシュの上限（1 件 2MB）より十分小さくする
 * - 検索・一覧は索引だけで行い、products コレクションは全件読まない
 * - 索引に載っていない商品（既存のモックデータなど）は、一覧・検索・新着・近くの候補に出さない
 */
import type { CatalogProduct, GachaProduct, Location } from "@/types";

export const CATALOG_COLLECTION = "catalogIndex";
export const CATALOG_META_ID = "meta";
/** 1 シャードの目安の最大サイズ（JSON のバイト数） */
export const SHARD_MAX_BYTES = 700_000;

export interface CatalogMeta {
  /** 索引の版（内容が変わるたびに変える。キャッシュキーに使う） */
  version: string;
  productShards: number;
  locationShards: number;
  productCount: number;
  locationCount: number;
  updatedAt: string;
}

export const productShardId = (i: number) => `products-${String(i).padStart(3, "0")}`;
export const locationShardId = (i: number) => `locations-${String(i).padStart(3, "0")}`;

export function toCatalogProduct(p: GachaProduct | CatalogProduct): CatalogProduct {
  return {
    id: p.id,
    name: p.name,
    series: p.series,
    maker: p.maker,
    price: p.price,
    priceTaxIncluded: p.priceTaxIncluded,
    releaseMonth: p.releaseMonth,
    resaleMonth: p.resaleMonth,
    imageUrl: p.imageUrl,
    characters: p.characters,
    tags: p.tags,
  };
}

/** JSON のサイズが maxBytes を超えないように分割する */
export function splitIntoShards<T>(items: T[], maxBytes = SHARD_MAX_BYTES): T[][] {
  const shards: T[][] = [];
  let current: T[] = [];
  let size = 2;
  for (const item of items) {
    const itemSize = Buffer.byteLength(JSON.stringify(item), "utf8") + 1;
    if (current.length > 0 && size + itemSize > maxBytes) {
      shards.push(current);
      current = [];
      size = 2;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length > 0) shards.push(current);
  return shards;
}

export type { CatalogProduct, Location };

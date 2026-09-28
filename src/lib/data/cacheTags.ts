import type { ID } from "@/types";

/**
 * Firestore の読み取り結果をキャッシュする際のタグ。
 * 在庫報告の保存時に、影響する商品・場所のタグだけを無効化する。
 */
export const cacheTags = {
  products: "products",
  product: (id: ID) => `product:${id}`,
  locations: "locations",
  location: (id: ID) => `location:${id}`,
  placements: "placements",
  placementsByProduct: (productId: ID) => `placements:product:${productId}`,
  placementsByLocation: (locationId: ID) => `placements:location:${locationId}`,
  recentReports: "stockReports:recent",
} as const;

/**
 * キャッシュ保持時間（秒）。Spark プランの読み取り上限（1日 50,000 件）を意識して設定している。
 * - 商品・設置場所のマスタ：ほとんど変わらないため長め
 * - 設置情報（在庫状態）：商品詳細・設置場所詳細は報告時に即時無効化する。
 *   トップ・検索の集計は全件を読むため、報告ごとには無効化せず一定時間でのみ更新する
 * - 話題のガチャ（直近24時間の報告件数）：鮮度より読み取り件数を優先
 */
export const cacheSeconds = {
  catalog: 60 * 60,
  placements: 5 * 60,
  recentReports: 30 * 60,
} as const;

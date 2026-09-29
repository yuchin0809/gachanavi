import type { CatalogProduct } from "@/types";

/**
 * 検索用の文字列正規化。
 * - 全角英数 → 半角（NFKC）
 * - 大文字 → 小文字
 * - カタカナ → ひらがな（「ネコ」でも「ねこ」でもヒットさせる）
 * - 空白除去
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "");
}

/**
 * 商品ごとの検索用文字列。カタログ索引の商品オブジェクトは版が変わるまで同じものが使われるため、
 * 1 回だけ正規化して使い回す（数万件の検索でも毎回正規化しない）
 */
const searchableTextCache = new WeakMap<CatalogProduct, string>();

function searchableText(product: CatalogProduct): string {
  let text = searchableTextCache.get(product);
  if (text === undefined) {
    text = normalizeForSearch(
      [product.name, product.series, product.maker, ...product.characters, ...product.tags].join(" "),
    );
    searchableTextCache.set(product, text);
  }
  return text;
}

/** スペース区切りの全キーワードを含む商品にマッチ（AND検索） */
export function matchesQuery(product: CatalogProduct, query: string): boolean {
  const terms = query
    .split(/[\s　]+/)
    .map(normalizeForSearch)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = searchableText(product);
  return terms.every((term) => haystack.includes(term));
}

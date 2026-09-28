import type { GachaProduct } from "@/types";

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

function searchableText(product: GachaProduct): string {
  return normalizeForSearch(
    [product.name, product.series, product.maker, ...product.characters, ...product.tags].join(" "),
  );
}

/** スペース区切りの全キーワードを含む商品にマッチ（AND検索） */
export function matchesQuery(product: GachaProduct, query: string): boolean {
  const terms = query
    .split(/[\s　]+/)
    .map(normalizeForSearch)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = searchableText(product);
  return terms.every((term) => haystack.includes(term));
}

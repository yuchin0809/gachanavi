import { absoluteUrl } from "./site";

/**
 * サイトマップ（Google のサイトマップの仕様：1 ファイル 50,000 URL・50MB まで。サイトマップ インデックスで束ねる）
 *
 *   /sitemap.xml                 サイトマップ インデックス
 *   /sitemaps/pages.xml          トップ・検索・店舗一覧・都道府県別の店舗一覧
 *   /sitemaps/locations.xml      店舗詳細
 *   /sitemaps/products-1.xml …   商品詳細（PRODUCTS_PER_SITEMAP 件ずつ）
 */
export const PRODUCTS_PER_SITEMAP = 10_000;

/** CDN で 1 時間キャッシュ（期限切れ後 1 日は古いものを返しながら更新）。Firestore はキャッシュ済みの索引だけを読む */
export const SITEMAP_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
};

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

/** <url> / <sitemap> の要素（1 要素ずつ改行・字下げした読みやすい形） */
function entry(tag: "url" | "sitemap", loc: string, lastModified?: string): string {
  const lastmod = lastModified ? `\n    <lastmod>${escapeXml(lastModified)}</lastmod>` : "";
  return `  <${tag}>\n    <loc>${escapeXml(loc)}</loc>${lastmod}\n  </${tag}>`;
}

export function urlset(entries: { path: string; lastModified?: string }[]): string {
  const body = entries.map((e) => entry("url", absoluteUrl(e.path), e.lastModified));
  return [XML_DECLARATION, `<urlset xmlns="${SITEMAP_NS}">`, ...body, "</urlset>", ""].join("\n");
}

export function sitemapIndex(names: string[]): string {
  const body = names.map((n) => entry("sitemap", absoluteUrl(`/sitemaps/${n}`)));
  return [XML_DECLARATION, `<sitemapindex xmlns="${SITEMAP_NS}">`, ...body, "</sitemapindex>", ""].join("\n");
}

export function productSitemapNames(productCount: number): string[] {
  const n = Math.max(1, Math.ceil(productCount / PRODUCTS_PER_SITEMAP));
  return Array.from({ length: n }, (_, i) => `products-${i + 1}.xml`);
}

import type { MetadataRoute } from "next";
import { absoluteUrl, isIndexable } from "@/lib/seo/site";

/**
 * /robots.txt
 * - 本番：すべてのページのクロールを許可し、サイトマップを知らせる（お気に入り・検索条件付きの一覧は各ページの noindex で除外）
 * - 本番以外（Preview・mock / local データ）：すべてのクロールを拒否
 */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}

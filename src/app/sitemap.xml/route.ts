import { getSitemapProductCount } from "@/lib/data";
import { SITEMAP_HEADERS, productSitemapNames, sitemapIndex } from "@/lib/seo/sitemap";
import { isIndexable } from "@/lib/seo/site";

// リクエスト時に作る（ビルド時に Firestore を読まない）。CDN のキャッシュは SITEMAP_HEADERS
export const dynamic = "force-dynamic";

/** /sitemap.xml：サイトマップ インデックス */
export async function GET(): Promise<Response> {
  if (!isIndexable()) return new Response("Not Found", { status: 404 });
  const xml = sitemapIndex(["pages.xml", "locations.xml", ...productSitemapNames(await getSitemapProductCount())]);
  return new Response(xml, { headers: SITEMAP_HEADERS });
}

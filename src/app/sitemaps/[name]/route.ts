import { getLocationsByPrefecture, getSitemapLocations, getSitemapProducts } from "@/lib/data";
import { PRODUCTS_PER_SITEMAP, SITEMAP_HEADERS, urlset } from "@/lib/seo/sitemap";
import { isIndexable } from "@/lib/seo/site";

// リクエスト時に作る（ビルド時に Firestore を読まない）。CDN のキャッシュは SITEMAP_HEADERS
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not Found", { status: 404 });

/** /sitemaps/pages.xml・/sitemaps/locations.xml・/sitemaps/products-N.xml */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  if (!isIndexable()) return notFound();
  const { name } = await params;

  if (name === "pages.xml") {
    const prefectures = [...(await getLocationsByPrefecture()).keys()];
    const entries = [
      { path: "/" },
      { path: "/search" },
      { path: "/locations" },
      ...prefectures.map((code) => ({ path: `/locations/prefecture/${code}` })),
    ];
    return new Response(urlset(entries), { headers: SITEMAP_HEADERS });
  }
  if (name === "locations.xml") {
    return new Response(urlset(await getSitemapLocations()), { headers: SITEMAP_HEADERS });
  }
  const m = /^products-(\d{1,3})\.xml$/.exec(name);
  if (m) {
    const page = Number(m[1]);
    const all = await getSitemapProducts();
    const slice = all.slice((page - 1) * PRODUCTS_PER_SITEMAP, page * PRODUCTS_PER_SITEMAP);
    if (page < 1 || slice.length === 0) return notFound();
    return new Response(urlset(slice), { headers: SITEMAP_HEADERS });
  }
  return notFound();
}

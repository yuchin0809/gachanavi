import type { GachaProduct, Location } from "@/types";
import { absoluteUrl } from "./site";
import { prefectureCodeOf, prefectureName } from "./text";

/**
 * 構造化データ（JSON-LD）。ページに表示している情報だけを使う。
 *
 * GachaNavi は販売者ではない（設置店舗・在庫の報告を探すサービス）ため、商品は販売者向けの
 * マークアップ（Google の「販売者のリスティング」）にしない:
 * - offers（価格・在庫・配送・返品）は付けない。価格は画面にだけ表示する（メーカー公表の 1 回の価格）
 * - category・brand・gtin・review・aggregateRating は、確かなデータが無いため付けない
 */
type JsonLd = Record<string, unknown>;

export function productJsonLd(product: GachaProduct, description: string): JsonLd {
  const data: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    url: absoluteUrl(`/gacha/${product.id}`),
    description,
    // OGP と同じ GachaNavi オリジナルの商品ビジュアル（メーカーの画像は使わない）
    image: absoluteUrl(`/gacha/${product.id}/opengraph-image`),
  };
  if (product.maker) data.manufacturer = { "@type": "Organization", name: product.maker };
  return data;
}

export function storeJsonLd(location: Location): JsonLd {
  const pref = prefectureCodeOf(location.address);
  return {
    "@context": "https://schema.org",
    "@type": "Store",
    name: location.name,
    url: absoluteUrl(`/locations/${location.id}`),
    ...(location.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: location.address,
            ...(pref ? { addressRegion: prefectureName(pref) } : {}),
            addressCountry: "JP",
          },
        }
      : {}),
    ...(location.lat !== null && location.lng !== null
      ? { geo: { "@type": "GeoCoordinates", latitude: location.lat, longitude: location.lng } }
      : {}),
  };
}

export interface Crumb {
  name: string;
  /** 最後（現在のページ）は省略 */
  href?: string;
}

export function breadcrumbJsonLd(crumbs: Crumb[], currentPath: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.href ?? currentPath),
    })),
  };
}

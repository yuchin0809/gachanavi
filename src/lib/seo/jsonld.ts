import type { GachaProduct, Location } from "@/types";
import { absoluteUrl } from "./site";
import { prefectureCodeOf, prefectureName } from "./text";

/**
 * 構造化データ（JSON-LD）。ページに表示している情報だけを使う。
 * - レビュー・評価・在庫（availability）・SKU などは持っていないため入れない
 * - 在庫は利用者の報告にもとづく目安で、GachaNavi が確認したものではないため Offer の availability には使わない
 */
type JsonLd = Record<string, unknown>;

export function productJsonLd(product: GachaProduct, description: string): JsonLd {
  const url = absoluteUrl(`/gacha/${product.id}`);
  const data: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    url,
    description,
    category: "カプセルトイ（ガチャガチャ）",
    // OGP と同じ GachaNavi オリジナルの商品ビジュアル（メーカーの画像は使わない）
    image: absoluteUrl(`/gacha/${product.id}/opengraph-image`),
  };
  if (product.maker) data.manufacturer = { "@type": "Organization", name: product.maker };
  if (product.price !== null) {
    // 1 回の価格（メーカー公表の価格。ページの「価格」と同じ）。在庫の状態（availability）は付けない
    data.offers = {
      "@type": "Offer",
      url,
      price: product.price,
      priceCurrency: "JPY",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: product.price,
        priceCurrency: "JPY",
        ...(product.priceTaxIncluded !== null ? { valueAddedTaxIncluded: product.priceTaxIncluded } : {}),
      },
    };
  }
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

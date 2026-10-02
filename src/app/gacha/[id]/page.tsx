import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GachaImage } from "@/components/gacha/GachaImage";
import { FavoriteControls } from "@/components/favorites/FavoriteControls";
import { ProductFacts } from "@/components/gacha/ProductFacts";
import { GachaCard } from "@/components/gacha/GachaCard";
import { HorizontalScroller } from "@/components/gacha/HorizontalScroller";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { PageContainer } from "@/components/layout/PageContainer";
import { ProductLocationsView } from "@/components/location/ProductLocationsView";
import { FoundAtStoreReport } from "@/components/stock/FoundAtStoreReport";
import { getProductDetail, getRelatedProducts, hasAmbiguousProductTitle } from "@/lib/data";
import { productJsonLd } from "@/lib/seo/jsonld";
import { formatDateTime } from "@/lib/format";
import { OG_BASE } from "@/lib/seo/metadata";
import { productDescription, productTitle } from "@/lib/seo/text";
import { isAvailable } from "@/lib/stock";

export async function generateMetadata({ params }: PageProps<"/gacha/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = await getProductDetail(id); // ページ本体と同じ取得（リクエスト内で共有。読み取りは増えない）
  if (!detail) return { title: "ガチャが見つかりません" };
  const { product, locations } = detail;
  const title = productTitle(product, await hasAmbiguousProductTitle(product));
  const description = productDescription(product, locations.length);
  const url = `/gacha/${product.id}`;
  // OGP 画像は opengraph-image.tsx（GachaNavi オリジナルの商品ビジュアル）
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { ...OG_BASE, title: `${title}｜GachaNavi`, description, url },
    twitter: { card: "summary_large_image", title: `${title}｜GachaNavi`, description },
  };
}

export default async function GachaDetailPage({ params }: PageProps<"/gacha/[id]">) {
  const { id } = await params;
  const detail = await getProductDetail(id);
  if (!detail) notFound();

  const { product, locations } = detail;
  const availableCount = locations.filter((l) => isAvailable(l.stock.status)).length;
  // 同じシリーズ・同じメーカーの近い時期のガチャ（カタログ索引から。Firestore の読み取りは増えない）
  const related = await getRelatedProducts(product);

  return (
    <PageContainer>
      <Breadcrumbs
        items={[{ name: "ホーム", href: "/" }, { name: "ガチャを探す", href: "/search" }, { name: product.name }]}
        currentPath={`/gacha/${product.id}`}
      />
      <JsonLd data={productJsonLd(product, productDescription(product, locations.length))} />

      <div className="sm:grid sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] sm:gap-6">
        <GachaImage
          product={product}
          sizes="(min-width: 640px) 320px, 100vw"
          priority
          variant="full"
          className="rounded-3xl shadow-card ring-1 ring-line"
        />

        <div className="mt-4 sm:mt-0">
          {product.series && <p className="text-sm font-bold text-brand-ink">{product.series}</p>}
          <h1 className="mt-1 text-2xl font-extrabold leading-snug">{product.name}</h1>

          <div className="mt-3">
            <FavoriteControls productId={product.id} />
          </div>

          <div className="mt-3 flex gap-2">
            <div className="flex-1 rounded-2xl bg-stock-in-soft px-3 py-2 text-stock-in-ink">
              <p className="text-[11px] font-bold">在庫あり報告</p>
              <p className="text-xl font-extrabold">
                {availableCount}
                <span className="ml-0.5 text-xs">店舗</span>
              </p>
            </div>
            <div className="flex-1 rounded-2xl bg-surface px-3 py-2 ring-1 ring-line">
              <p className="text-[11px] font-bold text-muted">設置店舗</p>
              <p className="text-xl font-extrabold">
                {locations.length}
                <span className="ml-0.5 text-xs">店舗</span>
              </p>
            </div>
          </div>

          <div className="mt-3">
            <ProductFacts product={product} />
          </div>
          {/* 商品説明文は掲載の許諾（権利確認）が済むまで表示しない。データには保存している */}

          {product.tags.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="タグ">
              {product.tags.map((tag) => (
                <li key={tag} className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-bold text-muted ring-1 ring-line">
                  #{tag}
                </li>
              ))}
            </ul>
          )}

          {(product.officialUrl || product.sourceUrl) && (
            <div className="mt-4 space-y-1 text-xs text-muted">
              {product.officialUrl && (
                <a
                  href={product.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex font-bold text-ink underline"
                >
                  メーカー公式の商品ページを見る
                </a>
              )}
              <p>
                出典:{" "}
                {product.sourceUrl ? (
                  <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    {hostnameOf(product.sourceUrl)}
                  </a>
                ) : (
                  "情報なし"
                )}
                {product.fetchedAt && `（${formatDateTime(product.fetchedAt)} 時点の情報）`}
              </p>
            </div>
          )}
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-extrabold">
          <span className="mr-1.5" aria-hidden="true">
            📍
          </span>
          このガチャの設置店舗
          <span className="ml-1 text-sm font-normal text-muted">{locations.length}店舗</span>
        </h2>
        <div className="mb-4">
          <FoundAtStoreReport
            product={{ id: product.id, name: product.name, maker: product.maker }}
            knownLocations={locations
              .slice(0, 5)
              .map(({ location: { id, name, address, area, lat, lng } }) => ({ id, name, address, area, lat, lng }))}
            placedLocationIds={locations.map((l) => l.location.id)}
          />
          <p className="mt-1.5 text-center text-xs text-muted">お店でこのガチャを見つけたら、店舗と在庫の状態を教えてください</p>
        </div>
        <ProductLocationsView productId={product.id} entries={locations} />
      </section>

      {related.length > 0 && (
        <section className="mt-10" aria-labelledby="related-heading">
          <h2 id="related-heading" className="mb-3 text-lg font-extrabold">
            関連するガチャ
          </h2>
          <HorizontalScroller>
            {related.map((s) => (
              <GachaCard key={s.product.id} summary={s} />
            ))}
          </HorizontalScroller>
        </section>
      )}
    </PageContainer>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

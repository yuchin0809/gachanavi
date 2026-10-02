import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/layout/BackLink";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { PageContainer } from "@/components/layout/PageContainer";
import { LocationInfoCard } from "@/components/location/LocationInfoCard";
import { LocationProductCard } from "@/components/location/LocationProductCard";
import { getLocationDetail } from "@/lib/data";
import { DEFAULT_OG_IMAGE, OG_BASE } from "@/lib/seo/metadata";
import { storeJsonLd } from "@/lib/seo/jsonld";
import { locationDescription, locationTitle, prefectureCodeOf, prefectureName } from "@/lib/seo/text";

export async function generateMetadata({ params }: PageProps<"/locations/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = await getLocationDetail(id); // ページ本体と同じ取得（リクエスト内で共有）
  if (!detail) return { title: "設置場所が見つかりません" };
  const { location, products } = detail;
  const title = locationTitle(location);
  const description = locationDescription(location, products.length);
  // ?product=（商品詳細から来た時の強調表示）が付いても正規 URL は店舗ごとに 1 つ
  const url = `/locations/${location.id}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { ...OG_BASE, title: `${title}｜GachaNavi`, description, url, images: [DEFAULT_OG_IMAGE] },
    twitter: { card: "summary_large_image", title: `${title}｜GachaNavi`, description, images: [DEFAULT_OG_IMAGE.url] },
  };
}

export default async function LocationDetailPage({ params, searchParams }: PageProps<"/locations/[id]">) {
  const { id } = await params;
  const { product: productParam } = await searchParams;
  const targetProductId = typeof productParam === "string" ? productParam : null;

  const detail = await getLocationDetail(id);
  if (!detail) notFound();

  const { location, products } = detail;
  const pref = prefectureCodeOf(location.address);
  // 商品詳細から来た場合、その商品（対象ガチャ）を先頭に強調表示する
  const target = products.find((e) => e.product.id === targetProductId) ?? null;
  // 在庫あり → 残りわずか → 未確認 → 売り切れ（データ側で並べ済み）。商品詳細から来た場合はその商品を先頭に
  const ordered = target ? [target, ...products.filter((e) => e !== target)] : products;

  return (
    <PageContainer>
      <Breadcrumbs
        items={[
          { name: "ホーム", href: "/" },
          { name: "店舗一覧", href: "/locations" },
          ...(pref ? [{ name: prefectureName(pref)!, href: `/locations/prefecture/${pref}` }] : []),
          { name: location.name },
        ]}
        currentPath={`/locations/${location.id}`}
      />
      <JsonLd data={storeJsonLd(location)} />
      {target && <BackLink href={`/gacha/${target.product.id}`} label="ガチャ詳細に戻る" />}

      <LocationInfoCard location={location} />

      {/* 設置情報（placement）がある商品だけを表示する。報告が無いものは「未確認」（売り切れにはしない） */}
      <section className="mt-6">
        <h2 className="mb-2 text-base font-extrabold">
          この店舗のガチャ
          <span className="ml-1 text-sm font-normal text-muted">{products.length}件</span>
        </h2>
        {products.length > 0 ? (
          <ul className="space-y-2">
            {ordered.map((entry) => (
              <li key={entry.product.id}>
                <LocationProductCard locationId={location.id} entry={entry} highlighted={entry === target} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted ring-1 ring-line">
            この店舗で設置が確認されたガチャはまだありません。お店でガチャを見つけたら、商品ページの「この店舗で見つけた」から教えてください。
          </p>
        )}
      </section>
    </PageContainer>
  );
}

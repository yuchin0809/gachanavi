import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/layout/BackLink";
import { PageContainer } from "@/components/layout/PageContainer";
import { LocationInfoCard } from "@/components/location/LocationInfoCard";
import { LocationProductCard } from "@/components/location/LocationProductCard";
import { getLocationDetail } from "@/lib/data";

export async function generateMetadata({ params }: PageProps<"/locations/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = await getLocationDetail(id);
  return { title: detail ? detail.location.name : "設置場所が見つかりません" };
}

export default async function LocationDetailPage({ params, searchParams }: PageProps<"/locations/[id]">) {
  const { id } = await params;
  const { product: productParam } = await searchParams;
  const targetProductId = typeof productParam === "string" ? productParam : null;

  const detail = await getLocationDetail(id);
  if (!detail) notFound();

  const { location, products } = detail;
  // 商品詳細から来た場合、その商品（対象ガチャ）を先頭に強調表示する
  const target = products.find((e) => e.product.id === targetProductId) ?? null;
  // 在庫あり → 残りわずか → 未確認 → 売り切れ（データ側で並べ済み）。商品詳細から来た場合はその商品を先頭に
  const ordered = target ? [target, ...products.filter((e) => e !== target)] : products;

  return (
    <PageContainer>
      <BackLink href={target ? `/gacha/${target.product.id}` : "/search"} label={target ? "ガチャ詳細に戻る" : "検索に戻る"} />

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

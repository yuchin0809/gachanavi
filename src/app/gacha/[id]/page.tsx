import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GachaImage } from "@/components/gacha/GachaImage";
import { ProductFacts } from "@/components/gacha/ProductFacts";
import { BackLink } from "@/components/layout/BackLink";
import { PageContainer } from "@/components/layout/PageContainer";
import { ProductLocationsView } from "@/components/location/ProductLocationsView";
import { getProductDetail } from "@/lib/data";
import { isAvailable } from "@/lib/stock";

export async function generateMetadata({ params }: PageProps<"/gacha/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = await getProductDetail(id);
  return { title: detail ? detail.product.name : "ガチャが見つかりません" };
}

export default async function GachaDetailPage({ params }: PageProps<"/gacha/[id]">) {
  const { id } = await params;
  const detail = await getProductDetail(id);
  if (!detail) notFound();

  const { product, locations } = detail;
  const availableCount = locations.filter((l) => isAvailable(l.stock.status)).length;

  return (
    <PageContainer>
      <BackLink href="/search" label="検索に戻る" />

      <div className="sm:grid sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] sm:gap-6">
        <GachaImage
          product={product}
          sizes="(min-width: 640px) 320px, 100vw"
          priority
          className="rounded-3xl shadow-card ring-1 ring-line"
        />

        <div className="mt-4 sm:mt-0">
          <p className="text-sm font-bold text-brand-ink">{product.series}</p>
          <h1 className="mt-1 text-2xl font-extrabold leading-snug">{product.name}</h1>

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
          <p className="mt-3 text-sm leading-relaxed text-muted">{product.description}</p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-extrabold">
          <span className="mr-1.5" aria-hidden="true">
            📍
          </span>
          このガチャが見つかった場所
        </h2>
        <ProductLocationsView productId={product.id} entries={locations} />
      </section>
    </PageContainer>
  );
}

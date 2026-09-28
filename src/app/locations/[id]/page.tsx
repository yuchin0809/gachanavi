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
  const others = products.filter((e) => e !== target);

  return (
    <PageContainer>
      <BackLink href={target ? `/gacha/${target.product.id}` : "/search"} label={target ? "ガチャ詳細に戻る" : "検索に戻る"} />

      <LocationInfoCard location={location} />

      {target && (
        <section className="mt-6">
          <h2 className="mb-2 text-base font-extrabold">🎯 対象のガチャ</h2>
          <LocationProductCard locationId={location.id} entry={target} highlighted />
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-base font-extrabold">
          {target ? "この場所のほかのガチャ" : "この場所で見つかったガチャ"}
          <span className="ml-1 text-sm font-normal text-muted">{others.length}件</span>
        </h2>
        {others.length > 0 ? (
          <ul className="space-y-2">
            {others.map((entry) => (
              <li key={entry.product.id}>
                <LocationProductCard locationId={location.id} entry={entry} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted ring-1 ring-line">
            ほかに報告されているガチャはありません。
          </p>
        )}
      </section>
    </PageContainer>
  );
}

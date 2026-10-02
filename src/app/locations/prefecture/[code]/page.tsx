import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { PageContainer } from "@/components/layout/PageContainer";
import { ChevronRightIcon } from "@/components/ui/Icons";
import { getPrefectureStores } from "@/lib/data";
import { DEFAULT_OG_IMAGE, OG_BASE } from "@/lib/seo/metadata";
import { prefectureName } from "@/lib/seo/text";

// 店舗の索引（キャッシュ済み）から作る。ビルド時には Firestore を読まない
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/locations/prefecture/[code]">): Promise<Metadata> {
  const { code } = await params;
  const name = prefectureName(code);
  const stores = name ? await getPrefectureStores(code) : [];
  if (!name || stores.length === 0) return { title: "店舗が見つかりません" };
  const title = `${name}のガチャガチャ設置店舗一覧`;
  const description = `${name}のガチャガチャ・カプセルトイの店舗 ${stores.length}件。店舗ごとに設置されているガチャと在庫の報告を確認できます。`;
  const url = `/locations/prefecture/${code}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { ...OG_BASE, title: `${title}｜GachaNavi`, description, url, images: [DEFAULT_OG_IMAGE] },
  };
}

export default async function PrefectureStoresPage({ params }: PageProps<"/locations/prefecture/[code]">) {
  const { code } = await params;
  const name = prefectureName(code);
  if (!name) notFound();
  const stores = await getPrefectureStores(code);
  if (stores.length === 0) notFound();

  return (
    <PageContainer>
      <Breadcrumbs
        items={[{ name: "ホーム", href: "/" }, { name: "店舗一覧", href: "/locations" }, { name }]}
        currentPath={`/locations/prefecture/${code}`}
      />
      <h1 className="text-2xl font-extrabold">{name}のガチャガチャ設置店舗</h1>
      <p className="mt-2 text-sm text-muted">{stores.length}店舗（住所順）</p>
      <ul className="mt-4 space-y-2">
        {stores.map(({ location, placementCount }) => (
          <li key={location.id}>
            <Link
              href={`/locations/${location.id}`}
              className="flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-line hover:ring-ink/30"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-snug">{location.name}</p>
                <p className="mt-0.5 break-words text-xs text-muted">{location.address || "住所情報なし"}</p>
                <p className="mt-1 text-xs text-muted">
                  {placementCount > 0 ? `設置情報 ${placementCount}件` : "設置情報なし"}
                </p>
              </div>
              <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}

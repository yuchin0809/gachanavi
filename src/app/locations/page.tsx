import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { PageContainer } from "@/components/layout/PageContainer";
import { ChevronRightIcon } from "@/components/ui/Icons";
import { getLocationsByPrefecture } from "@/lib/data";
import { DEFAULT_OG_IMAGE, OG_BASE } from "@/lib/seo/metadata";
import { prefectureName } from "@/lib/seo/text";

// 店舗の索引（キャッシュ済み）から作る。ビルド時には Firestore を読まない
export const dynamic = "force-dynamic";

const title = "ガチャガチャの店舗一覧（都道府県別）";
const description = "ガチャガチャ・カプセルトイを設置している店舗を都道府県別に一覧できます。店舗ごとの設置情報と在庫の報告を確認できます。";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/locations" },
  openGraph: { ...OG_BASE, title: `${title}｜GachaNavi`, description, url: "/locations", images: [DEFAULT_OG_IMAGE] },
};

export default async function LocationsIndexPage() {
  const groups = await getLocationsByPrefecture();
  const total = [...groups.values()].reduce((n, l) => n + l.length, 0);
  return (
    <PageContainer>
      <Breadcrumbs items={[{ name: "ホーム", href: "/" }, { name: "店舗一覧" }]} currentPath="/locations" />
      <h1 className="text-2xl font-extrabold">{title}</h1>
      <p className="mt-2 text-sm text-muted">
        {total.toLocaleString("ja-JP")} 店舗を都道府県別に掲載しています。都道府県を選んでください。
      </p>
      <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[...groups.entries()].map(([code, list]) => (
          <li key={code}>
            <Link
              href={`/locations/prefecture/${code}`}
              className="flex min-h-12 items-center justify-between gap-2 rounded-2xl bg-surface px-3 py-2 ring-1 ring-line hover:ring-ink/30"
            >
              <span className="text-sm font-bold">{prefectureName(code)}</span>
              <span className="flex items-center gap-0.5 text-xs text-muted">
                {list.length}店舗
                <ChevronRightIcon className="h-4 w-4" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}

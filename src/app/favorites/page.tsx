import type { Metadata } from "next";
import { FavoritesList } from "@/components/favorites/FavoritesList";
import { BackLink } from "@/components/layout/BackLink";
import { PageContainer } from "@/components/layout/PageContainer";
import { NOINDEX_FOLLOW } from "@/lib/seo/metadata";

// 端末ごとの個人的な一覧のため、検索結果には出さない
export const metadata: Metadata = { title: "お気に入り", robots: NOINDEX_FOLLOW };

/** お気に入り一覧（本人のお気に入りはブラウザから Server Action で取得する。ページを開いただけでは匿名ログインしない） */
export default function FavoritesPage() {
  return (
    <PageContainer>
      <BackLink href="/" label="トップに戻る" />
      <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold">
        <span aria-hidden="true" className="text-brand">
          ♡
        </span>
        お気に入り
      </h1>
      <FavoritesList />
    </PageContainer>
  );
}

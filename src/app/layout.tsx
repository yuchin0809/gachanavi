import type { Metadata, Viewport } from "next";
import { CurrentPositionProvider } from "@/components/geo/CurrentPositionProvider";
import { StockAlertWatcher } from "@/components/favorites/StockAlertWatcher";
import { PushOnboardingSheet } from "@/components/onboarding/PushOnboardingSheet";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StockReportsProvider } from "@/components/stock/StockReportsProvider";
import { getFallbackPosition } from "@/lib/data";
import { getDataSourceKind } from "@/lib/data/config";
import { DEFAULT_OG_IMAGE, OG_BASE } from "@/lib/seo/metadata";
import { isIndexable, siteUrl } from "@/lib/seo/site";
import "./globals.css";

/** サイト共通のメタデータ（各ページで title・description・canonical などを上書きする） */
export function generateMetadata(): Metadata {
  const verification = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  return {
    metadataBase: siteUrl(),
    title: {
      default: "GachaNavi（ガチャナビ）｜ガチャガチャの設置店舗・在庫情報を探せるサイト",
      template: "%s｜GachaNavi",
    },
    description:
      "GachaNavi（ガチャナビ）は、ガチャガチャ（カプセルトイ）を商品名・キャラクター・シリーズで検索し、設置されている店舗や在庫の報告を確認できるWebアプリです。",
    applicationName: "GachaNavi",
    // 本番（本番データ・本番ドメイン）以外は検索エンジンに出さない（src/lib/seo/site.ts）
    // 本番では指定しない（既定は index, follow）。404 では Next.js が付ける noindex だけが残る。
    // 本番以外（Preview・開発・モック）は検索結果に出さない
    ...(isIndexable() ? {} : { robots: { index: false, follow: false } }),
    openGraph: { ...OG_BASE, images: [DEFAULT_OG_IMAGE] },
    twitter: { card: "summary_large_image", images: [DEFAULT_OG_IMAGE.url] },
    ...(verification ? { verification: { google: verification } } : {}),
    // iPhone / iPad でホーム画面に追加して使えるようにする（追加した GachaNavi でバックグラウンド通知を受け取れる）
    appleWebApp: { capable: true, title: "GachaNavi", statusBarStyle: "default" },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ef4550",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const dataSource = getDataSourceKind();
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <StockReportsProvider persistent={dataSource === "firestore"}>
          <CurrentPositionProvider fallback={getFallbackPosition()}>
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter dataSource={dataSource} />
            <StockAlertWatcher />
            <PushOnboardingSheet />
          </CurrentPositionProvider>
        </StockReportsProvider>
      </body>
    </html>
  );
}

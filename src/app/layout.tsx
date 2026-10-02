import type { Metadata, Viewport } from "next";
import { CurrentPositionProvider } from "@/components/geo/CurrentPositionProvider";
import { StockAlertWatcher } from "@/components/favorites/StockAlertWatcher";
import { PushOnboardingSheet } from "@/components/onboarding/PushOnboardingSheet";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StockReportsProvider } from "@/components/stock/StockReportsProvider";
import { getFallbackPosition } from "@/lib/data";
import { getDataSourceKind } from "@/lib/data/config";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GachaNavi（ガチャナビ）｜欲しいガチャを見つける。残っている場所まで分かる。",
    template: "%s｜GachaNavi",
  },
  description:
    "GachaNavi は、ガチャガチャの検索と設置場所・在庫状況の確認ができるWebアプリです。",
  // iPhone / iPad でホーム画面に追加して使えるようにする（追加した GachaNavi でバックグラウンド通知を受け取れる）
  appleWebApp: { capable: true, title: "GachaNavi", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

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

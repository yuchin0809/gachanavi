import type { Metadata, Viewport } from "next";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StockReportsProvider } from "@/components/stock/StockReportsProvider";
import { getDataSourceKind } from "@/lib/data/config";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GachaNavi（ガチャナビ）｜欲しいガチャを見つける。残っている場所まで分かる。",
    template: "%s｜GachaNavi",
  },
  description:
    "GachaNavi は、ガチャガチャの検索と設置場所・在庫状況の確認ができるWebアプリです。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ef4550",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <StockReportsProvider persistent={getDataSourceKind() === "firestore"}>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </StockReportsProvider>
      </body>
    </html>
  );
}

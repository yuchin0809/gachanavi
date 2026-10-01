import type { MetadataRoute } from "next";

/**
 * Web アプリマニフェスト。iPhone / iPad でホーム画面に追加した GachaNavi から
 * バックグラウンド通知（Web Push）を受け取るために必要（display: standalone）。
 * アイコンは GachaNavi のロゴのみ（商品画像・キャラクター画像は使わない）
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GachaNavi（ガチャナビ）",
    short_name: "GachaNavi",
    description: "ガチャガチャの検索と、設置場所・在庫状況の確認ができるWebアプリ",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fbf8f3",
    theme_color: "#ef4550",
    lang: "ja",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

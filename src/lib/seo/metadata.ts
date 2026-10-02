import type { Metadata } from "next";

/** OGP の共通項目（ページごとに openGraph を指定すると親の値は引き継がれないため、各ページで展開して使う） */
export const OG_BASE = { siteName: "GachaNavi", locale: "ja_JP", type: "website" } as const;

/** サイト共通の OGP 画像（GachaNavi のアイコン。scripts/build-icons.mjs で作成） */
export const DEFAULT_OG_IMAGE = {
  url: "/og/gachanavi.png",
  width: 1200,
  height: 630,
  alt: "GachaNavi（ガチャナビ）ガチャガチャの設置店舗・在庫情報",
};

/** 検索結果には出さないが、リンクはたどってよいページ（お気に入り・検索条件付きの一覧など） */
export const NOINDEX_FOLLOW: Metadata["robots"] = { index: false, follow: true };

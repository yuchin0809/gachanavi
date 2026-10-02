import { getDataSourceKind } from "@/lib/data/config";

/**
 * サイトの正規 URL と、検索エンジンにインデックスさせてよいか（canonical・sitemap・robots で共通）。
 *
 * 正規 URL の優先順位（Preview の URL は使わない）:
 * 1. NEXT_PUBLIC_SITE_URL（本番ドメインを明示。例: https://gachanavi.example.com）
 * 2. VERCEL_PROJECT_PRODUCTION_URL（Vercel のシステム環境変数。Preview でも本番のドメインを指す）
 * 3. http://localhost:3000（ローカル）
 */
export function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return new URL(explicit.endsWith("/") ? explicit : `${explicit}/`);
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) return new URL(`https://${vercelProd}/`);
  return new URL("http://localhost:3000/");
}

/** 絶対 URL（サイトマップ・JSON-LD 用） */
export function absoluteUrl(path: string): string {
  return new URL(path.replace(/^\//, ""), siteUrl()).toString();
}

/**
 * 検索エンジンにインデックスさせてよいか。
 * - 本番データ（DATA_SOURCE=firestore）のときだけ。mock / local のデータは検索結果に出さない
 * - Vercel では本番（VERCEL_ENV=production）だけ。Preview・Development は出さない
 * - Vercel 以外では NEXT_PUBLIC_SITE_URL が設定されているときだけ
 * - SEO_INDEXABLE=true / false で明示的に上書きできる（テスト・緊急停止用）
 */
export function isIndexable(): boolean {
  const override = process.env.SEO_INDEXABLE?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;
  if (getDataSourceKind() !== "firestore") return false;
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return Boolean(process.env.NEXT_PUBLIC_SITE_URL?.trim());
}

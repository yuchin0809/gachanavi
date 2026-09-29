/**
 * 商品画像を表示してよいかの判定。
 *
 * メーカー公式サイトの画像は、各社の利用規約（無断転載禁止など）の確認が済むまで表示しない（安全側）。
 * 表示してよいのは次のどちらかのみ:
 * - アプリ内の画像（"/" から始まるパス。モックデータのイラストなど）
 * - 権利確認が済んだホスト（環境変数 NEXT_PUBLIC_APPROVED_IMAGE_HOSTS にカンマ区切りで指定。既定は空）
 *
 * 表示しない場合もページは画像なし（プレースホルダー）で正常に表示される。
 */
const approvedHosts = (process.env.NEXT_PUBLIC_APPROVED_IMAGE_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

export function displayableImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol === "https:" && approvedHosts.includes(hostname.toLowerCase())) return url;
  } catch {
    // 不正な URL は表示しない
  }
  return null;
}

/** 外部の画像（next/image の最適化を通さない。remotePatterns の登録や画像変換の回数制限を避ける） */
export function isExternalImage(url: string): boolean {
  return !url.startsWith("/");
}

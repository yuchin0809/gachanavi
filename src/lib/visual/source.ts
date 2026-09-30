/**
 * 商品画像として何を表示するかの決定。
 *
 * 1. 権利確認が済んだ画像（src/lib/images.ts の判定。現在はアプリ内の画像のみ）
 * 2. GachaNavi オリジナルの生成ビジュアル（基本の商品画像。常に使える）
 *
 * メーカー公式画像の URL は、権利確認が済んでいない限り 1 の判定で除外される（ホットリンクもしない）。
 * 表示元はこの関数に集約しているため、将来ほかの画像（ユーザーの実物写真など）を扱う場合も、
 * ここに種類を追加するだけで表示側（GachaImage）の分岐はそのまま使える。
 */
import { displayableImageUrl } from "@/lib/images";

export type ProductImageSource = { kind: "licensed"; url: string } | { kind: "generated" };

export function resolveProductImage(product: { imageUrl?: string | null }): ProductImageSource {
  const licensed = displayableImageUrl(product.imageUrl);
  if (licensed) return { kind: "licensed", url: licensed };
  return { kind: "generated" };
}

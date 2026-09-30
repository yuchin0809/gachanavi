/**
 * 商品画像として何を表示するかの決定。
 *
 * 1. ユーザーが投稿し、確認済みの実物写真（将来の機能。userPhotoUrl）
 * 2. 権利確認が済んだ画像（src/lib/images.ts の判定。現在はアプリ内の画像のみ）
 * 3. GachaNavi オリジナルの生成ビジュアル（常に使える）
 *
 * メーカー公式画像の URL は、権利確認が済んでいない限り 2 の判定で除外される（ホットリンクもしない）。
 */
import { displayableImageUrl } from "@/lib/images";

export type ProductImageSource =
  | { kind: "user-photo"; url: string }
  | { kind: "licensed"; url: string }
  | { kind: "generated" };

export function resolveProductImage(product: {
  imageUrl?: string | null;
  userPhotoUrl?: string | null;
}): ProductImageSource {
  const photo = displayableImageUrl(product.userPhotoUrl);
  if (photo) return { kind: "user-photo", url: photo };
  const licensed = displayableImageUrl(product.imageUrl);
  if (licensed) return { kind: "licensed", url: licensed };
  return { kind: "generated" };
}

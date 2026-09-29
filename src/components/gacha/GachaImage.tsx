import Image from "next/image";
import { displayableImageUrl, isExternalImage } from "@/lib/images";
import type { CatalogProduct } from "@/types";

/**
 * 商品画像。表示してよい画像（src/lib/images.ts）が無い場合はカプセル型のプレースホルダーを表示する。
 * メーカー公式の画像は権利確認が済むまで表示しない（画像が無くてもページは正常に表示される）。
 */
export function GachaImage({
  product,
  sizes,
  priority,
  className = "",
}: {
  product: Pick<CatalogProduct, "name" | "imageUrl">;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const src = displayableImageUrl(product.imageUrl);
  return (
    <div className={`relative aspect-square overflow-hidden bg-accent-soft ${className}`}>
      {src ? (
        <Image
          src={src}
          alt={product.name}
          fill
          sizes={sizes}
          priority={priority}
          // 権利確認済みの外部画像は最適化を通さない（remotePatterns の登録・画像変換の回数制限を避ける）
          unoptimized={isExternalImage(src)}
          className="object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-4xl" role="img" aria-label={`${product.name}（画像なし）`}>
          🎁
        </div>
      )}
    </div>
  );
}

import Image from "next/image";
import type { GachaProduct } from "@/types";

/** 商品画像。画像が未登録の場合はカプセル型のプレースホルダーを表示する */
export function GachaImage({
  product,
  sizes,
  priority,
  className = "",
}: {
  product: GachaProduct;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative aspect-square overflow-hidden bg-accent-soft ${className}`}>
      {product.imageUrl ? (
        <Image
          src={product.imageUrl}
          alt={product.name}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-4xl" aria-label={product.name}>
          🎁
        </div>
      )}
    </div>
  );
}

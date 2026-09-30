import Image from "next/image";
import { formatPrice, formatReleaseMonth } from "@/lib/format";
import { isExternalImage } from "@/lib/images";
import { latestMonth } from "@/lib/release";
import { resolveProductImage } from "@/lib/visual/source";
import { lineupLabel, visualSpecOf } from "@/lib/visual/spec";
import type { CatalogProduct } from "@/types";
import { GachaVisual } from "./GachaVisual";

export type GachaImageProduct = Pick<
  CatalogProduct,
  | "id"
  | "name"
  | "series"
  | "maker"
  | "tags"
  | "characters"
  | "imageUrl"
  | "price"
  | "priceTaxIncluded"
  | "releaseMonth"
  | "resaleMonth"
> & {
  /** 種類数（商品詳細のみ。一覧の索引には無い） */
  lineupCount?: string | null;
};

/**
 * 商品画像（正方形）。
 *
 * 表示するもの: 権利確認済みの画像 → GachaNavi オリジナルの生成ビジュアル（基本の商品画像。src/lib/visual/source.ts）。
 * メーカー公式画像は権利確認が済むまで表示しない。
 *
 * - variant="full"    : 上部約 65% にビジュアル、下部約 35% に商品情報（商品名・メーカー・価格・発売月・種類数）。
 *                       トップのカード・商品詳細など、ある程度大きく表示する場所で使う
 * - variant="compact" : ビジュアルのみ。検索結果の行など、商品情報がすぐ横に文字で出ている小さなサムネイルで使う
 */
export function GachaImage({
  product,
  sizes,
  priority,
  variant = "compact",
  className = "",
}: {
  product: GachaImageProduct;
  sizes: string;
  priority?: boolean;
  variant?: "full" | "compact";
  className?: string;
}) {
  const source = resolveProductImage(product);
  const spec = visualSpecOf(product);
  const label = source.kind === "generated" ? `${product.name}（GachaNavi オリジナルイメージ）` : product.name;

  const art =
    source.kind === "generated" ? (
      <GachaVisual spec={spec} height={variant === "full" ? 130 : 200} showBrand={variant === "full"} />
    ) : (
      <Image
        src={source.url}
        alt=""
        fill
        sizes={sizes}
        priority={priority}
        // 権利確認済みの外部画像は最適化を通さない（remotePatterns の登録・画像変換の回数制限を避ける）
        unoptimized={isExternalImage(source.url)}
        className="object-cover"
      />
    );

  if (variant === "compact") {
    return (
      <div role="img" aria-label={label} className={`relative aspect-square overflow-hidden bg-canvas ${className}`}>
        {art}
      </div>
    );
  }

  const month = latestMonth(product);
  const lineup = lineupLabel(product.lineupCount);
  const meta = [
    product.price !== null ? formatPrice(product.price, product.priceTaxIncluded) : null,
    month ? formatReleaseMonth(month) : null,
  ].filter((v): v is string => v !== null);

  return (
    <div className={`@container relative flex aspect-square flex-col overflow-hidden bg-surface ${className}`}>
      <div role="img" aria-label={label} className="relative h-[65%] shrink-0 overflow-hidden">
        {art}
        {lineup && (
          <span className="absolute right-[4cqw] top-[4cqw] rounded-full bg-surface/90 px-[3cqw] py-[0.8cqw] text-[clamp(9px,4cqw,15px)] font-extrabold leading-tight text-ink shadow-sm">
            {lineup}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-[1.2cqw] border-t border-line px-[5.5cqw]">
        <p className="line-clamp-2 text-[clamp(10px,6.2cqw,24px)] font-extrabold leading-[1.22] text-ink">{product.name}</p>
        <p className="flex min-w-0 items-center gap-[1.6cqw] text-[clamp(9px,4.1cqw,15px)] leading-tight text-muted">
          <span
            aria-hidden="true"
            className="inline-block h-[2.2cqw] w-[2.2cqw] shrink-0 rounded-full"
            style={{ backgroundColor: spec.palette.capsule }}
          />
          <span className="truncate">{product.maker}</span>
        </p>
        {meta.length > 0 && (
          <p className="flex min-w-0 flex-wrap items-center gap-x-[2.4cqw] text-[clamp(9px,4.3cqw,16px)] font-bold leading-tight text-ink">
            {meta.map((m, i) => (
              <span key={m} className="inline-flex items-center gap-[2.4cqw] whitespace-nowrap">
                {i > 0 && <span aria-hidden="true" className="h-[3cqw] w-px bg-line" />}
                {m}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

import { formatPrice, formatReleaseMonth } from "@/lib/format";
import type { GachaProduct } from "@/types";

export function ProductFacts({ product }: { product: GachaProduct }) {
  const facts = [
    { label: "シリーズ", value: product.series },
    { label: "メーカー", value: product.maker },
    { label: "価格", value: `1回 ${formatPrice(product.price)}` },
    { label: "発売時期", value: formatReleaseMonth(product.releaseMonth) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2">
      {facts.map((f) => (
        <div key={f.label} className="rounded-xl bg-canvas px-3 py-2">
          <dt className="text-[11px] text-muted">{f.label}</dt>
          <dd className="truncate text-sm font-bold">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

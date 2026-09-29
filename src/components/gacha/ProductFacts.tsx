import { formatPrice, formatReleaseMonth } from "@/lib/format";
import { RELEASE_STATUS_LABEL, releaseStatusOf } from "@/lib/release";
import type { GachaProduct } from "@/types";

const NO_INFO = "情報なし";

export function ProductFacts({ product }: { product: GachaProduct }) {
  const status = releaseStatusOf(product);
  const facts = [
    { label: "シリーズ", value: product.series || NO_INFO, muted: !product.series },
    { label: "メーカー", value: product.maker || NO_INFO, muted: !product.maker },
    {
      label: "価格",
      value: product.price === null ? "価格情報なし" : `1回 ${formatPrice(product.price, product.priceTaxIncluded)}`,
      muted: product.price === null,
    },
    { label: "発売時期", value: formatReleaseMonth(product.releaseMonth), muted: !product.releaseMonth },
    ...(product.resaleMonth ? [{ label: "再発売", value: formatReleaseMonth(product.resaleMonth), muted: false }] : []),
    { label: "発売状況", value: RELEASE_STATUS_LABEL[status], muted: status === "unknown" },
    ...(product.lineupCount ? [{ label: "種類数", value: product.lineupCount, muted: false }] : []),
  ];
  return (
    <dl className="grid grid-cols-2 gap-2">
      {facts.map((f) => (
        <div key={f.label} className="rounded-xl bg-canvas px-3 py-2">
          <dt className="text-[11px] text-muted">{f.label}</dt>
          <dd className={`truncate text-sm font-bold ${f.muted ? "text-muted" : ""}`}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { ChevronRightIcon } from "@/components/ui/Icons";
import { type Crumb, breadcrumbJsonLd } from "@/lib/seo/jsonld";

/** パンくずリスト（画面の表示と構造化データ BreadcrumbList を同じ内容で出す） */
export function Breadcrumbs({ items, currentPath }: { items: Crumb[]; currentPath: string }) {
  return (
    <>
      <nav aria-label="パンくずリスト" className="py-3">
        <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted">
          {items.map((c, i) => {
            const last = i === items.length - 1;
            return (
              <li key={`${i}-${c.name}`} className={`flex min-w-0 items-center gap-1 ${last ? "max-w-full" : ""}`}>
                {c.href && !last ? (
                  <Link href={c.href} className="whitespace-nowrap font-medium hover:text-ink hover:underline">
                    {c.name}
                  </Link>
                ) : (
                  <span aria-current="page" className="line-clamp-1 font-medium text-ink">
                    {c.name}
                  </span>
                )}
                {!last && <ChevronRightIcon className="h-3 w-3 shrink-0" />}
              </li>
            );
          })}
        </ol>
      </nav>
      <JsonLd data={breadcrumbJsonLd(items, currentPath)} />
    </>
  );
}

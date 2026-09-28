import type { Metadata } from "next";
import Link from "next/link";
import { SearchResultItem } from "@/components/gacha/SearchResultItem";
import { PageContainer } from "@/components/layout/PageContainer";
import { KeywordChips } from "@/components/search/KeywordChips";
import { SearchBar } from "@/components/search/SearchBar";
import { searchProducts } from "@/lib/data";

export const metadata: Metadata = { title: "ガチャを検索" };

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const query = firstParam(params.q);
  const availableOnly = firstParam(params.stock) === "available";
  const results = await searchProducts(query, { availableOnly });

  const toggleHref = (() => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (!availableOnly) next.set("stock", "available");
    const qs = next.toString();
    return qs ? `/search?${qs}` : "/search";
  })();

  return (
    <PageContainer className="pt-4">
      <SearchBar defaultValue={query} autoFocus={!query} hiddenParams={availableOnly ? { stock: "available" } : undefined} />

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-sm">
          {query ? (
            <>
              「<span className="font-bold">{query}</span>」の検索結果
            </>
          ) : (
            "すべてのガチャ"
          )}
          <span className="ml-1 text-muted">{results.length}件</span>
        </p>
        <Link
          href={toggleHref}
          scroll={false}
          aria-pressed={availableOnly}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition ${
            availableOnly
              ? "border-stock-in bg-stock-in-soft text-stock-in-ink"
              : "border-line bg-surface text-muted hover:border-ink/40"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${availableOnly ? "bg-stock-in" : "bg-stock-unknown"}`}
            aria-hidden="true"
          />
          在庫ありのみ
        </Link>
      </div>

      {results.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {results.map((summary) => (
            <li key={summary.product.id}>
              <SearchResultItem summary={summary} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 rounded-2xl bg-surface p-8 text-center ring-1 ring-line">
          <p className="text-4xl" aria-hidden="true">
            🔍
          </p>
          <p className="mt-3 font-bold">見つかりませんでした</p>
          <p className="mt-1 text-sm text-muted">キーワードを変えるか、ひらがな・カタカナで試してみてください。</p>
          <div className="mt-4 text-left">
            <KeywordChips keywords={["ねこ", "ミニチュア", "恐竜", "ロボット", "アルパカ"]} />
          </div>
        </div>
      )}
    </PageContainer>
  );
}

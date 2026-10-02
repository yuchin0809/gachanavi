import type { Metadata } from "next";
import Link from "next/link";
import { SearchResultItem } from "@/components/gacha/SearchResultItem";
import { PageContainer } from "@/components/layout/PageContainer";
import { KeywordChips } from "@/components/search/KeywordChips";
import { SearchBar } from "@/components/search/SearchBar";
import { searchProducts } from "@/lib/data";
import { DEFAULT_OG_IMAGE, NOINDEX_FOLLOW, OG_BASE } from "@/lib/seo/metadata";

/**
 * 一覧（条件なし）だけを検索結果の対象にする。キーワード・絞り込み・ページ送りの付いた URL は
 * 組み合わせが無数にあるため noindex（リンクはたどってよい）。商品ページはサイトマップと内部リンクで見つけてもらう
 */
export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  const params = await searchParams;
  const query = firstParam(params.q);
  const hasParams = Object.values(params).some((v) => firstParam(v) !== "");
  if (hasParams) {
    return {
      title: query ? `「${query.slice(0, 40)}」のガチャ検索結果` : "ガチャを検索",
      robots: NOINDEX_FOLLOW,
    };
  }
  const title = "ガチャを探す（ガチャガチャ・カプセルトイ検索）";
  const description =
    "発売中・発売予定のガチャガチャ（カプセルトイ）の一覧。商品名・キャラクター・シリーズ名で検索して、設置店舗と在庫情報を確認できます。";
  return {
    title,
    description,
    alternates: { canonical: "/search" },
    openGraph: { ...OG_BASE, title: `${title}｜GachaNavi`, description, url: "/search", images: [DEFAULT_OG_IMAGE] },
  };
}

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const query = firstParam(params.q);
  const availableOnly = firstParam(params.stock) === "available";
  // past=include / past=exclude。省略時はキーワードありなら含める（後ろに並ぶ）、一覧なら含めない
  const pastParam = firstParam(params.past);
  const includePast = pastParam === "include" ? true : pastParam === "exclude" ? false : undefined;
  const page = Number.parseInt(firstParam(params.page), 10) || 1;

  const result = await searchProducts(query, { availableOnly, includePast, page });

  /** 現在の条件を引き継いだ URL（page はリセット） */
  const hrefWith = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (availableOnly) next.set("stock", "available");
    if (pastParam) next.set("past", pastParam);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `/search?${qs}` : "/search";
  };

  const hiddenParams: Record<string, string> = {};
  if (availableOnly) hiddenParams.stock = "available";
  if (pastParam) hiddenParams.past = pastParam;

  return (
    <PageContainer className="pt-4">
      <SearchBar
        defaultValue={query}
        autoFocus={!query}
        hiddenParams={Object.keys(hiddenParams).length > 0 ? hiddenParams : undefined}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {query ? (
            <>
              「<span className="font-bold">{query}</span>」の検索結果
            </>
          ) : result.includePast ? (
            "すべてのガチャ"
          ) : (
            "発売中・発売予定のガチャ"
          )}
          <span className="ml-1 text-muted">{result.total.toLocaleString("ja-JP")}件</span>
        </p>
        <div className="flex shrink-0 gap-1.5">
          <FilterChip
            href={hrefWith({ past: result.includePast ? "exclude" : "include", page: null })}
            active={result.includePast}
            label="過去の商品も表示"
          />
          <FilterChip
            href={hrefWith({ stock: availableOnly ? null : "available", page: null })}
            active={availableOnly}
            label="在庫ありのみ"
          />
        </div>
      </div>

      {result.hiddenPastCount > 0 && (
        <p className="mt-2 text-xs text-muted">
          過去の商品 {result.hiddenPastCount.toLocaleString("ja-JP")}件は表示していません。
          <Link href={hrefWith({ past: "include", page: null })} className="ml-1 font-bold text-ink underline">
            含めて表示する
          </Link>
        </p>
      )}

      {result.items.length > 0 ? (
        <>
          <ul className="mt-3 space-y-2">
            {result.items.map((summary) => (
              <li key={summary.product.id}>
                <SearchResultItem summary={summary} />
              </li>
            ))}
          </ul>
          {result.pageCount > 1 && (
            <nav className="mt-5 flex items-center justify-center gap-3 text-sm" aria-label="ページ送り">
              {result.page > 1 ? (
                <Link href={hrefWith({ page: String(result.page - 1) })} className="rounded-full border border-line px-4 py-1.5 font-bold">
                  前へ
                </Link>
              ) : (
                <span className="px-4 py-1.5 text-muted">前へ</span>
              )}
              <span className="text-muted">
                {result.page} / {result.pageCount}
              </span>
              {result.page < result.pageCount ? (
                <Link href={hrefWith({ page: String(result.page + 1) })} className="rounded-full border border-line px-4 py-1.5 font-bold">
                  次へ
                </Link>
              ) : (
                <span className="px-4 py-1.5 text-muted">次へ</span>
              )}
            </nav>
          )}
        </>
      ) : (
        <div className="mt-6 rounded-2xl bg-surface p-8 text-center ring-1 ring-line">
          <p className="text-4xl" aria-hidden="true">
            🔍
          </p>
          <p className="mt-3 font-bold">見つかりませんでした</p>
          <p className="mt-1 text-sm text-muted">
            キーワードを変えるか、ひらがな・カタカナで試してみてください。
            {!result.includePast && "過去の商品も表示すると見つかる場合があります。"}
          </p>
          <div className="mt-4 text-left">
            <KeywordChips keywords={["ねこ", "ミニチュア", "恐竜", "ロボット", "アルパカ"]} />
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-pressed={active}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition ${
        active ? "border-stock-in bg-stock-in-soft text-stock-in-ink" : "border-line bg-surface text-muted hover:border-ink/40"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${active ? "bg-stock-in" : "bg-stock-unknown"}`} aria-hidden="true" />
      {label}
    </Link>
  );
}

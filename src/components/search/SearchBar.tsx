import Form from "next/form";
import { SearchIcon } from "@/components/ui/Icons";

interface SearchBarProps {
  defaultValue?: string;
  /** hero: トップページ用の大きい表示 */
  size?: "hero" | "default";
  autoFocus?: boolean;
  /** 検索時に引き継ぐ追加パラメータ */
  hiddenParams?: Record<string, string>;
}

export const SEARCH_PLACEHOLDER = "ガチャ名・キャラクター・シリーズ名で検索";

export function SearchBar({ defaultValue, size = "default", autoFocus, hiddenParams }: SearchBarProps) {
  const isHero = size === "hero";
  return (
    <Form action="/search" role="search" className="w-full">
      {hiddenParams &&
        Object.entries(hiddenParams).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      <div
        className={`flex items-center gap-2 rounded-full border-2 border-ink bg-surface pl-4 shadow-card focus-within:ring-4 focus-within:ring-brand/20 ${
          isHero ? "h-14 pr-1.5" : "h-12 pr-1"
        }`}
      >
        <SearchIcon className="hidden h-5 w-5 shrink-0 text-muted sm:block" />
        <input
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder={SEARCH_PLACEHOLDER}
          aria-label={SEARCH_PLACEHOLDER}
          autoFocus={autoFocus}
          enterKeyHint="search"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[13px] placeholder:text-muted/80 sm:placeholder:text-sm"
        />
        <button
          type="submit"
          aria-label="検索"
          className={`flex shrink-0 items-center justify-center rounded-full bg-brand font-bold text-white transition hover:bg-brand-ink active:scale-95 ${
            isHero ? "h-11 w-11 sm:w-auto sm:px-5 sm:text-base" : "h-10 w-10 sm:w-auto sm:px-4 sm:text-sm"
          }`}
        >
          <SearchIcon className="h-5 w-5 sm:hidden" />
          <span className="hidden sm:inline">検索</span>
        </button>
      </div>
    </Form>
  );
}

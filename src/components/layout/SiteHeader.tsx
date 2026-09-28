import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { SearchIcon } from "@/components/ui/Icons";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
        <Link href="/" aria-label="GachaNavi トップへ">
          <Logo />
        </Link>
        <Link
          href="/search"
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-surface"
          aria-label="ガチャを検索"
        >
          <SearchIcon className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
}

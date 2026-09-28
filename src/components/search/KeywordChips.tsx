import Link from "next/link";

export function KeywordChips({ keywords }: { keywords: string[] }) {
  return (
    <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
      {keywords.map((keyword) => (
        <li key={keyword} className="shrink-0">
          <Link
            href={`/search?q=${encodeURIComponent(keyword)}`}
            className="inline-flex h-8 items-center rounded-full border border-line bg-surface px-3 text-sm font-medium text-ink hover:border-ink/40"
          >
            # {keyword}
          </Link>
        </li>
      ))}
    </ul>
  );
}

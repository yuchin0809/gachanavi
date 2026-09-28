import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center">
      <p className="text-5xl">🫙</p>
      <h1 className="mt-4 text-xl font-bold">ページが見つかりませんでした</h1>
      <p className="mt-2 text-sm text-muted">
        お探しのガチャや設置場所は削除されたか、URLが間違っている可能性があります。
      </p>
      <Link
        href="/search"
        className="mt-6 inline-flex rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white"
      >
        ガチャを検索する
      </Link>
    </div>
  );
}

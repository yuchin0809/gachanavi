"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GachaImage } from "@/components/gacha/GachaImage";
import { useReportsPersistent } from "@/components/stock/StockReportsProvider";
import { BellIcon, ChevronRightIcon, HeartIcon } from "@/components/ui/Icons";
import { formatPrice } from "@/lib/format";
import { loadFavorites } from "@/lib/favoritesClient";
import type { FavoriteView } from "@/types";

export function FavoritesList() {
  const persistent = useReportsPersistent();
  const [items, setItems] = useState<FavoriteView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadFavorites(persistent)
      .then((list) => !cancelled && setItems(list))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [persistent]);

  if (failed) {
    return (
      <p role="alert" className="rounded-2xl bg-stock-out-soft p-4 text-sm font-bold text-stock-out-ink">
        お気に入りを読み込めませんでした。通信状態を確認して、ページを再読み込みしてください。
      </p>
    );
  }
  if (!items) return <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted ring-1 ring-line">読み込み中…</p>;
  if (items.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-6 text-center ring-1 ring-line">
        <HeartIcon className="mx-auto h-10 w-10 text-line" />
        <p className="mt-2 text-base font-extrabold">まだお気に入りがありません</p>
        <p className="mt-1 text-sm text-muted">気になるガチャの詳細ページで「♡ お気に入り」を押すと、ここに表示されます。</p>
        <Link href="/search" className="mt-4 inline-flex h-11 items-center rounded-full bg-brand px-5 text-sm font-extrabold text-white">
          ガチャを探す
        </Link>
      </div>
    );
  }

  return (
    <>
      <p className="mb-2 text-sm text-muted">{items.length}件</p>
      <ul className="space-y-2">
        {items.map(({ favorite, product, locationCount, availableLocationCount }) => (
          <li key={product.id}>
            <Link
              href={`/gacha/${product.id}`}
              className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card ring-1 ring-line transition active:scale-[0.99]"
            >
              <GachaImage product={product} sizes="72px" className="w-18 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] text-muted">{product.maker}</p>
                <p className="line-clamp-2 text-sm font-bold leading-snug">{product.name}</p>
                <p className="mt-0.5 text-xs text-muted">{formatPrice(product.price, product.priceTaxIncluded)}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  {locationCount > 0 ? (
                    <span className={availableLocationCount > 0 ? "font-bold text-stock-in-ink" : "text-muted"}>
                      在庫あり報告 {availableLocationCount}/{locationCount}店舗
                    </span>
                  ) : (
                    <span className="text-muted">設置情報なし</span>
                  )}
                  {favorite.notifyInStock && (
                    <span className="inline-flex items-center gap-0.5 font-bold text-ink">
                      <BellIcon className="h-3.5 w-3.5" />
                      通知ON
                    </span>
                  )}
                </p>
              </div>
              <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

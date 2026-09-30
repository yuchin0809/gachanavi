"use client";

import { useEffect, useState } from "react";
import { ClockIcon } from "@/components/ui/Icons";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { isStockStale } from "@/lib/stock";

function checkedLabel(relative: string) {
  if (relative === "たった今") return "たった今確認";
  if (relative === "昨日") return "昨日確認";
  return `${relative}に確認`;
}

/**
 * 「12分前に確認」形式の最終確認時刻。1分ごとに表示を更新する。
 * 最終確認が古い（STOCK_STALE_AFTER_MS 以上前）場合は「情報が古い可能性があります」を添える（在庫状態は変えない）
 */
export function LastChecked({ at, className = "" }: { at: string | null; className?: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const stale = isStockStale(at, now.getTime());
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1 text-xs text-muted ${className}`}>
      <ClockIcon className="h-3.5 w-3.5" />
      {at ? (
        <time dateTime={at} title={formatDateTime(at)} suppressHydrationWarning>
          {checkedLabel(formatRelativeTime(at, now))}
        </time>
      ) : (
        <span>まだ報告がありません</span>
      )}
      {stale && (
        <span className="font-bold text-stock-low-ink" data-stale="true" suppressHydrationWarning>
          ・情報が古い可能性があります
        </span>
      )}
    </span>
  );
}

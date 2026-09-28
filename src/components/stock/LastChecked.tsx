"use client";

import { useEffect, useState } from "react";
import { ClockIcon } from "@/components/ui/Icons";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

function checkedLabel(relative: string) {
  return relative === "たった今" ? "たった今確認" : `${relative}に確認`;
}

/** 「12分前に確認」形式の最終確認時刻。1分ごとに表示を更新する */
export function LastChecked({ at, className = "" }: { at: string | null; className?: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className={`inline-flex items-center gap-1 text-xs text-muted ${className}`}>
      <ClockIcon className="h-3.5 w-3.5" />
      {at ? (
        <time dateTime={at} title={formatDateTime(at)} suppressHydrationWarning>
          {checkedLabel(formatRelativeTime(at, now))}
        </time>
      ) : (
        <span>まだ報告がありません</span>
      )}
    </span>
  );
}

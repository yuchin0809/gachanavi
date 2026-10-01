"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useReportsPersistent } from "@/components/stock/StockReportsProvider";
import { BellIcon } from "@/components/ui/Icons";
import { showBrowserNotification } from "@/lib/browserNotification";
import { formatRelativeTime } from "@/lib/format";
import { fetchStockAlerts, hasStockAlertsEnabled } from "@/lib/favoritesClient";
import { refreshBackgroundPush } from "@/lib/pushClient";
import { STOCK_STATUS_META } from "@/lib/stock";
import type { StockAlert } from "@/types";

const CHECKED_KEY = "gachanavi:stock-alerts-checked-at";
/** 確認の間隔（アプリを開いている間。読み取りを増やしすぎない） */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

function dueForCheck(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(CHECKED_KEY) ?? 0) >= CHECK_INTERVAL_MS;
  } catch {
    return false;
  }
}

function markChecked(): void {
  try {
    localStorage.setItem(CHECKED_KEY, String(Date.now()));
  } catch {
    // 保存できない環境では確認しない（dueForCheck が false）
  }
}

/**
 * 在庫通知：「在庫報告があったら通知」が ON のお気に入りがある時だけ、アプリを開いている間に
 * 15 分に 1 回サーバーへ新しい在庫報告を確認し、画面内（と、許可されていればブラウザ通知）でお知らせする。
 * 未ログインなら何もしない（匿名ログインしない）。
 * 閉じている間の通知（FCM）が届いた場合は、サーバーが lastNotifiedAt を更新するため、ここで同じ報告を重ねて知らせない。
 */
export function StockAlertWatcher() {
  const persistent = useReportsPersistent();
  const [alerts, setAlerts] = useState<StockAlert[]>([]);

  useEffect(() => {
    let running = false;
    const check = async () => {
      if (running || document.visibilityState !== "visible" || !hasStockAlertsEnabled() || !dueForCheck()) return;
      running = true;
      markChecked();
      try {
        const found = await fetchStockAlerts(persistent);
        if (found.length) {
          setAlerts(found);
          for (const a of found.slice(0, 3)) {
            const l = a.locations[0];
            showBrowserNotification(
              `在庫報告：${a.productName}`,
              `${l.locationName}で「${STOCK_STATUS_META[l.status].label}」`,
              `/gacha/${a.productId}`,
            );
          }
        }
      } catch {
        // 次の確認で再試行する
      }
      running = false;
    };
    check();
    // 閉じていても届く通知の登録を 1 日 1 回確認する（登録済みの端末だけ。許可の要求・匿名ログインはしない）
    refreshBackgroundPush(persistent).catch(() => undefined);
    const timer = setInterval(check, 60 * 1000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [persistent]);

  if (!alerts.length) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <section
        role="status"
        aria-label="在庫通知"
        className="mx-auto max-w-lg rounded-2xl bg-ink p-3 text-white shadow-card"
      >
        <div className="flex items-center gap-2">
          <BellIcon className="h-5 w-5 shrink-0 text-accent" />
          <p className="flex-1 text-sm font-extrabold">お気に入りのガチャに在庫報告がありました</p>
          <button type="button" onClick={() => setAlerts([])} className="h-9 rounded-full px-3 text-sm font-bold text-white/80">
            閉じる
          </button>
        </div>
        <ul className="mt-1 space-y-1">
          {alerts.slice(0, 3).map((a) => {
            const l = a.locations[0];
            return (
              <li key={a.productId}>
                <Link
                  href={`/gacha/${a.productId}`}
                  onClick={() => setAlerts([])}
                  className="block rounded-xl bg-white/10 px-3 py-2 text-sm"
                >
                  <span className="line-clamp-1 font-bold">{a.productName}</span>
                  <span className="text-xs text-white/80">
                    {l.locationName} ・ {STOCK_STATUS_META[l.status].label} ・ {formatRelativeTime(l.reportedAt)}
                    {a.locations.length > 1 && ` ほか${a.locations.length - 1}店舗`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

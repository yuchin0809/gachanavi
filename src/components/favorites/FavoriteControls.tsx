"use client";

import Link from "next/link";
import { useState } from "react";
import { useReportsPersistent } from "@/components/stock/StockReportsProvider";
import { BellIcon, HeartIcon } from "@/components/ui/Icons";
import { type NotificationSupport, isIOSDevice, requestNotificationPermission } from "@/lib/browserNotification";
import { FavoriteError, saveFavorite, saveStockAlert } from "@/lib/favoritesClient";
import { type PushSetupResult, disableBackgroundPushIfUnused, enableBackgroundPush } from "@/lib/pushClient";
import type { ID } from "@/types";
import { useFavoriteMirror } from "./useFavoriteMirror";

type Message = { tone: "info" | "error"; text: string };

function errorMessage(error: unknown): string {
  if (error instanceof FavoriteError) {
    if (error.code === "unauthenticated") return "利用者の確認（匿名ログイン）ができませんでした。通信状態を確認して、もう一度お試しください。";
    if (error.code === "product_not_found") return "このガチャの情報が見つかりませんでした。ページを再読み込みしてください。";
  }
  return "保存できませんでした。通信状態を確認して、もう一度お試しください。";
}

function notifyMessage(permission: NotificationSupport, push: PushSetupResult | null): string {
  if (push === "enabled") {
    return "新しく「在庫あり」「残りわずか」の報告があったら、GachaNavi を閉じていても通知します。";
  }
  if (push === "ios_needs_install") {
    return "iPhone では、ホーム画面に追加した GachaNavi から通知を ON にすると、閉じていても通知が届きます。今は GachaNavi を開いたときに画面でお知らせします。";
  }
  if (permission === "granted") {
    return "新しく「在庫あり」「残りわずか」の報告があったら、GachaNavi を開いたときに通知します。";
  }
  if (permission === "unsupported") {
    return isIOSDevice()
      ? "このブラウザでは通知を出せません（iPhone はホーム画面に追加すると使えます）。GachaNavi を開いたときに画面でお知らせします。"
      : "このブラウザでは通知を出せません。GachaNavi を開いたときに画面でお知らせします。";
  }
  return "ブラウザの通知が許可されていないため、GachaNavi を開いたときに画面でお知らせします。";
}

/**
 * 商品詳細：♡ お気に入り ＋ 在庫報告があったら通知。
 * 匿名ログインはボタンを押した時だけ。通知の許可は通知を ON にした時だけ求める。
 */
export function FavoriteControls({ productId }: { productId: ID }) {
  const persistent = useReportsPersistent();
  const mirror = useFavoriteMirror();
  const saved = mirror[productId];
  const [busy, setBusy] = useState<"favorite" | "notify" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  async function toggleFavorite() {
    setBusy("favorite");
    setMessage(null);
    try {
      await saveFavorite(productId, !saved, persistent);
      // 通知 ON のお気に入りが無くなったら、この端末のバックグラウンド通知の登録も外す
      if (saved) await disableBackgroundPushIfUnused(persistent);
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    }
    setBusy(null);
  }

  async function toggleNotify(enabled: boolean) {
    setBusy("notify");
    setMessage(null);
    // 通知の許可はユーザーの操作の直後に求める（通信の後だとブラウザに拒否されることがある）
    const permission = enabled ? await requestNotificationPermission() : null;
    try {
      await saveStockAlert(productId, enabled, persistent);
      if (enabled) {
        // 通知が許可された時だけ、この端末を閉じていても届く通知（FCM）の送り先に登録する
        const push = permission === "granted" ? await enableBackgroundPush(persistent) : null;
        setMessage(permission ? { tone: "info", text: notifyMessage(permission, push) } : null);
      } else {
        await disableBackgroundPushIfUnused(persistent);
        setMessage(null);
      }
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    }
    setBusy(null);
  }

  return (
    <div className="rounded-2xl bg-surface p-3 ring-1 ring-line" data-testid="favorite-controls">
      <button
        type="button"
        onClick={toggleFavorite}
        disabled={busy !== null}
        aria-pressed={!!saved}
        className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-extrabold transition active:scale-[0.98] disabled:opacity-60 ${
          saved ? "bg-brand-soft text-brand-ink ring-2 ring-brand" : "border-2 border-ink bg-surface text-ink"
        }`}
      >
        <HeartIcon filled={!!saved} className="h-5 w-5" />
        {busy === "favorite" ? "保存中…" : saved ? "お気に入り済み" : "お気に入り"}
      </button>

      {saved && (
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-1">
          <BellIcon className="h-5 w-5 shrink-0 text-muted" />
          <span className="flex-1 text-sm font-bold">在庫報告があったら通知</span>
          <input
            type="checkbox"
            role="switch"
            checked={saved.notify}
            disabled={busy !== null}
            onChange={(e) => toggleNotify(e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="relative h-7 w-12 shrink-0 rounded-full bg-line transition peer-checked:bg-stock-in peer-focus-visible:ring-2 peer-focus-visible:ring-ink peer-disabled:opacity-60 after:absolute after:left-0.5 after:top-0.5 after:h-6 after:w-6 after:rounded-full after:bg-surface after:shadow after:transition peer-checked:after:translate-x-5"
          />
        </label>
      )}

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`mt-2 rounded-xl p-2.5 text-xs leading-relaxed ${
            message.tone === "error" ? "bg-stock-out-soft font-bold text-stock-out-ink" : "bg-canvas text-muted"
          }`}
        >
          {message.text}
        </p>
      )}
      {saved && (
        <Link href="/favorites" className="mt-2 block text-center text-xs font-bold text-muted underline">
          お気に入り一覧を見る
        </Link>
      )}
    </div>
  );
}

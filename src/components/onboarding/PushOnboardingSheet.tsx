"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BellIcon } from "@/components/ui/Icons";

/**
 * 初回アクセス時だけ表示する「在庫通知（プッシュ通知）の案内」。
 *
 * - 表示したことをこの端末（localStorage）に記録し、以後は表示しない（リロード・ブラウザの再起動でも出さない）
 * - 案内を閉じるだけで、お気に入り・在庫通知の設定・通知の登録には一切触れない
 * - 通知の許可は求めない（許可は商品ページの「在庫報告があったら通知」を ON にした時だけ）
 * - ホーム画面への追加を自動で行ったり促すダイアログを出したりせず、手順を説明するだけ
 * - すでにこの端末でバックグラウンド通知を設定済みの人には表示しない
 */
export const ONBOARDING_KEY = "gachanavi:push-onboarding:v1";
/** バックグラウンド通知の端末登録済み（src/lib/pushClient.ts と同じキー） */
const PUSH_TOKEN_KEY = "gachanavi:push-token";
/** 画面の表示が落ち着いてから出す */
const SHOW_DELAY_MS = 1200;

type Platform = "ios" | "android";

function shouldShow(): boolean {
  try {
    if (localStorage.getItem(ONBOARDING_KEY)) return false;
    if (localStorage.getItem(PUSH_TOKEN_KEY)) {
      // すでに通知を設定済み：案内は不要。表示済みとして記録する
      localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ shownAt: new Date().toISOString(), skipped: "push_enabled" }));
      return false;
    }
    return true;
  } catch {
    // 保存できない環境（プライベートブラウズの一部など）では、毎回出てしまうため表示しない
    return false;
  }
}

function markShown(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ shownAt: new Date().toISOString() }));
  } catch {
    // shouldShow で確認済みのため通常は起きない
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function PushOnboardingSheet() {
  const [open, setOpen] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const [platform, setPlatform] = useState<Platform>("ios");
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!shouldShow()) return;
      // 「初回だけ」：表示した時点で記録する（閉じずにリロード・移動しても、もう一度は出さない）
      markShown();
      setStandalone(isStandalone());
      setPlatform(/Android/i.test(navigator.userAgent) ? "android" : "ios");
      setOpen(true);
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  // Esc で閉じる・背面のスクロールを止める・閉じるボタンにフォーカス
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!open) return null;
  const close = () => setOpen(false);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center sm:p-4">
      {/* 背景のタップでも閉じる（キーボード・読み上げでは × と「閉じる」を使う） */}
      <button type="button" aria-hidden="true" tabIndex={-1} className="absolute inset-0 cursor-default" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="push-onboarding"
        className="relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-surface shadow-card sm:max-w-md sm:rounded-3xl"
      >
        <button
          type="button"
          onClick={close}
          aria-label="案内を閉じる"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none text-muted hover:bg-canvas"
        >
          ×
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-ink">
            <BellIcon className="h-6 w-6" />
          </div>
          <h2 id={titleId} className="mt-3 text-lg font-extrabold">
            在庫通知を受け取ろう
          </h2>
          {standalone ? (
            <p className="mt-2 text-sm leading-relaxed">
              お気に入りにした商品が「在庫あり」や「残りわずか」になったら、プッシュ通知でお知らせします。
              商品ページで「♡ お気に入り」を押して、「在庫報告があったら通知」を ON にしてください。
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm leading-relaxed">
                GachaNavi をホーム画面に追加すると、お気に入りにした商品の在庫情報をプッシュ通知で受け取れます。
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                お気に入りの商品が「在庫あり」や「残りわずか」になったときにお知らせします。
              </p>
            </>
          )}

          {!standalone && howTo && (
            <section className="mt-4" aria-label="ホーム画面に追加する方法">
              <div className="grid grid-cols-2 gap-1 rounded-2xl bg-canvas p-1" role="tablist" aria-label="端末">
                {(["ios", "android"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-selected={platform === p}
                    onClick={() => setPlatform(p)}
                    className={`h-10 rounded-xl text-sm font-bold ${platform === p ? "bg-surface shadow-card" : "text-muted"}`}
                  >
                    {p === "ios" ? "iPhone" : "Android"}
                  </button>
                ))}
              </div>
              {platform === "ios" ? (
                <div role="tabpanel" aria-label="iPhone の手順" className="mt-3">
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
                    <li>Safari で GachaNavi を開く</li>
                    <li>画面下の共有ボタン（□に↑）を押す</li>
                    <li>「ホーム画面に追加」を選ぶ</li>
                    <li>ホーム画面の GachaNavi から開く</li>
                    <li>商品ページで「在庫報告があったら通知」を ON にして、通知を許可する</li>
                  </ol>
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    iPhone では iOS 16.4 以降で、ホーム画面に追加した GachaNavi から通知を許可したときだけ届きます（Safari のタブのままでは届きません）。
                  </p>
                </div>
              ) : (
                <div role="tabpanel" aria-label="Android の手順" className="mt-3">
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
                    <li>Chrome で GachaNavi を開く</li>
                    <li>右上のメニュー（︙）から「ホーム画面に追加」または「アプリをインストール」を選ぶ</li>
                    <li>ホーム画面の GachaNavi を起動する</li>
                    <li>商品ページで「在庫報告があったら通知」を ON にして、通知を許可する</li>
                  </ol>
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    Android はホーム画面に追加しなくても、Chrome で通知を許可すれば受け取れます。
                  </p>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {!standalone && !howTo && (
            <button
              type="button"
              onClick={() => setHowTo(true)}
              className="h-12 w-full rounded-2xl bg-brand text-base font-extrabold text-white"
            >
              ホーム画面に追加する方法を見る
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            className="h-12 w-full rounded-2xl border border-line text-base font-bold"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { LocateIcon } from "@/components/ui/Icons";
import { useCurrentPosition } from "./CurrentPositionProvider";

/** 距離の基準地点の表示と、「現在地を使う」ボタン */
export function CurrentPositionBar({ className = "" }: { className?: string }) {
  const { status, isCurrent, fallbackLabel, requestPosition } = useCurrentPosition();
  const locating = status === "locating";

  let message: string;
  if (isCurrent) {
    message = "現在地からの距離を表示しています";
  } else if (locating) {
    message = "現在地を取得しています…";
  } else if (status === "denied") {
    message = `位置情報が許可されていないため、${fallbackLabel}からの距離を表示しています。ブラウザの設定で許可すると現在地を使えます。`;
  } else if (status === "unavailable") {
    message = `現在地を取得できなかったため、${fallbackLabel}からの距離を表示しています。`;
  } else {
    message = `${fallbackLabel}からの距離を表示しています`;
  }

  const buttonLabel = isCurrent ? "更新" : status === "fallback" || locating ? "現在地を使う" : "再試行";

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl p-3 ring-1 ${
        isCurrent ? "bg-surface ring-line" : "bg-accent-soft/70 ring-accent/40"
      } ${className}`}
    >
      <LocateIcon className={`h-5 w-5 shrink-0 ${isCurrent ? "text-brand" : "text-muted"}`} />
      <div className="min-w-0 flex-1">
        <p aria-live="polite" className="text-xs font-bold leading-snug">
          {message}
        </p>
        {!isCurrent && (
          <p className="mt-0.5 text-[11px] text-muted">位置情報は距離の計算にだけ使い、保存しません。</p>
        )}
      </div>
      <button
        type="button"
        onClick={requestPosition}
        disabled={locating}
        className={`h-10 shrink-0 rounded-full px-4 text-sm font-bold transition active:scale-95 disabled:opacity-60 ${
          isCurrent ? "border border-line bg-surface text-ink hover:bg-canvas" : "bg-ink text-white hover:bg-ink/85"
        }`}
      >
        {locating ? "取得中…" : buttonLabel}
      </button>
    </div>
  );
}

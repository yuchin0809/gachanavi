"use client";

import { useState } from "react";
import { CheckIcon } from "@/components/ui/Icons";
import { StockReportError } from "@/lib/data/reports";
import { REPORTABLE_STATUSES, STOCK_STATUS_META } from "@/lib/stock";
import type { ID, ReportableStockStatus } from "@/types";
import { StockDot } from "./StockBadge";
import { useReportStock, useReportsPersistent } from "./StockReportsProvider";

type PanelState =
  | { kind: "idle" }
  | { kind: "submitting"; status: ReportableStockStatus }
  | { kind: "done"; status: ReportableStockStatus }
  | { kind: "error"; message: string };

/** 送信エラーをユーザー向けのメッセージにする */
function errorMessage(error: unknown): string {
  if (error instanceof StockReportError) {
    if (error.code === "rate_limited") {
      const minutes = Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60));
      return `このガチャのこの場所の在庫は、少し前に報告済みです。続けて報告できないため、あと${minutes}分ほど待ってからお試しください。`;
    }
    if (error.code === "unauthenticated") {
      return "報告者の確認ができませんでした。ページを再読み込みしてから、もう一度お試しください。";
    }
  }
  return "送信できませんでした。時間をおいて再度お試しください。";
}

/** 「在庫あり / 残りわずか / 売り切れ」の報告ボタン */
export function StockReportPanel({ productId, locationId }: { productId: ID; locationId: ID }) {
  const report = useReportStock();
  const persistent = useReportsPersistent();
  const [state, setState] = useState<PanelState>({ kind: "idle" });

  async function handleReport(status: ReportableStockStatus) {
    setState({ kind: "submitting", status });
    try {
      await report({ productId, locationId, status });
      setState({ kind: "done", status });
    } catch (error) {
      setState({ kind: "error", message: errorMessage(error) });
    }
  }

  const submitting = state.kind === "submitting";

  return (
    <div className="rounded-2xl bg-canvas p-3">
      <p className="text-sm font-bold">今の在庫を報告する</p>
      <p className="mt-0.5 text-xs text-muted">見たままの状態を教えてください。ほかのユーザーの役に立ちます。</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {REPORTABLE_STATUSES.map((status) => {
          const meta = STOCK_STATUS_META[status];
          const isSelected = (state.kind === "submitting" || state.kind === "done") && state.status === status;
          return (
            <button
              key={status}
              type="button"
              disabled={submitting}
              onClick={() => handleReport(status)}
              aria-pressed={isSelected}
              className={`flex h-12 items-center justify-center gap-1.5 rounded-xl border-2 bg-surface px-1 text-sm font-bold transition active:scale-95 disabled:opacity-60 ${meta.buttonClass} ${
                isSelected ? "ring-2 ring-current ring-offset-1" : ""
              }`}
            >
              <StockDot status={status} />
              {submitting && isSelected ? "送信中…" : meta.reportLabel}
            </button>
          );
        })}
      </div>
      <div aria-live="polite" className="min-h-5">
        {state.kind === "done" && (
          <p className="mt-2 flex items-center gap-1 text-xs font-bold text-stock-in-ink">
            <CheckIcon className="h-4 w-4" />
            「{STOCK_STATUS_META[state.status].label}」で報告しました。ありがとうございます！
          </p>
        )}
        {state.kind === "error" && (
          <p role="alert" className="mt-2 text-xs font-bold text-stock-out-ink">
            {state.message}
          </p>
        )}
      </div>
      {!persistent && (
        <p className="text-[11px] text-muted">※ 開発版のため、報告内容はこの画面にのみ反映され保存されません。</p>
      )}
    </div>
  );
}

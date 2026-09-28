"use client";

import { useState } from "react";
import { CheckIcon } from "@/components/ui/Icons";
import { REPORTABLE_STATUSES, STOCK_STATUS_META } from "@/lib/stock";
import type { ID, ReportableStockStatus } from "@/types";
import { StockDot } from "./StockBadge";
import { useReportStock } from "./StockReportsProvider";

type PanelState =
  | { kind: "idle" }
  | { kind: "submitting"; status: ReportableStockStatus }
  | { kind: "done"; status: ReportableStockStatus }
  | { kind: "error" };

/** 「在庫あり / 残りわずか / 売り切れ」の報告ボタン */
export function StockReportPanel({ productId, locationId }: { productId: ID; locationId: ID }) {
  const report = useReportStock();
  const [state, setState] = useState<PanelState>({ kind: "idle" });

  async function handleReport(status: ReportableStockStatus) {
    setState({ kind: "submitting", status });
    try {
      await report({ productId, locationId, status });
      setState({ kind: "done", status });
    } catch {
      setState({ kind: "error" });
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
          <p className="mt-2 text-xs font-bold text-stock-out-ink">送信できませんでした。時間をおいて再度お試しください。</p>
        )}
      </div>
      <p className="text-[11px] text-muted">※ 開発版のため、報告内容はこの画面にのみ反映され保存されません。</p>
    </div>
  );
}

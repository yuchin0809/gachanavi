import type { ReportableStockStatus, StockReport, StockSnapshot, StockStatus } from "@/types";

export interface StockStatusMeta {
  label: string;
  /** 報告ボタン用の短い説明 */
  reportLabel: string;
  /** Tailwind クラス */
  dotClass: string;
  badgeClass: string;
  buttonClass: string;
}

export const STOCK_STATUS_META: Record<StockStatus, StockStatusMeta> = {
  in_stock: {
    label: "在庫あり",
    reportLabel: "在庫あり",
    dotClass: "bg-stock-in",
    badgeClass: "bg-stock-in-soft text-stock-in-ink ring-stock-in/30",
    buttonClass: "border-stock-in/40 text-stock-in-ink hover:bg-stock-in-soft",
  },
  low: {
    label: "残りわずか",
    reportLabel: "残りわずか",
    dotClass: "bg-stock-low",
    badgeClass: "bg-stock-low-soft text-stock-low-ink ring-stock-low/40",
    buttonClass: "border-stock-low/50 text-stock-low-ink hover:bg-stock-low-soft",
  },
  sold_out: {
    label: "売り切れ",
    reportLabel: "売り切れ",
    dotClass: "bg-stock-out",
    badgeClass: "bg-stock-out-soft text-stock-out-ink ring-stock-out/30",
    buttonClass: "border-stock-out/40 text-stock-out-ink hover:bg-stock-out-soft",
  },
  unknown: {
    label: "未確認",
    reportLabel: "未確認",
    dotClass: "bg-stock-unknown",
    badgeClass: "bg-stock-unknown-soft text-stock-unknown-ink ring-stock-unknown/40",
    buttonClass: "",
  },
};

export const REPORTABLE_STATUSES: ReportableStockStatus[] = ["in_stock", "low", "sold_out"];

/** 在庫表示の並び順（在庫がある場所を上に） */
export const STOCK_STATUS_ORDER: Record<StockStatus, number> = {
  in_stock: 0,
  low: 1,
  unknown: 2,
  sold_out: 3,
};

/**
 * 在庫情報の鮮度。最終確認からこの時間が経った報告は「情報が古い可能性があります」と表示する。
 * 状態（在庫あり・売り切れなど）は変えない（勝手に売り切れ・未確認にしない）。
 * ガチャの在庫は 1 日で入れ替わることが多く、報告もまだ少ないため 24 時間とする。
 */
export const STOCK_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** 最終確認が古い（報告が無い「未確認」は対象外） */
export function isStockStale(lastCheckedAt: string | null, now: number = Date.now()): boolean {
  return lastCheckedAt !== null && now - Date.parse(lastCheckedAt) >= STOCK_STALE_AFTER_MS;
}

export function isAvailable(status: StockStatus): boolean {
  return status === "in_stock" || status === "low";
}

/** 報告履歴から最新の在庫状態を求める（報告が無ければ未確認） */
export function latestSnapshot(reports: StockReport[]): StockSnapshot {
  let latest: StockReport | null = null;
  for (const report of reports) {
    if (!latest || report.reportedAt > latest.reportedAt) latest = report;
  }
  return latest
    ? { status: latest.status, lastCheckedAt: latest.reportedAt }
    : { status: "unknown", lastCheckedAt: null };
}

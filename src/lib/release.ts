import type { CatalogProduct, ReleaseStatus } from "@/types";

/**
 * 発売状況の判定。
 *
 * 発売月と再発売月の新しい方（latestMonth）を基準にする（データ検証 data/collected/validation/REPORT.md と同じ方法）。
 * - upcoming: latestMonth が今月より後
 * - current : 今月を含む直近 CURRENT_WINDOW_MONTHS か月以内（店頭にある可能性が高い）
 * - past    : それより前
 * - unknown : 発売時期が不明
 *
 * 状態は保存せず表示時に計算する（月が変わっても Firestore を書き換える必要がない）。
 */
export const CURRENT_WINDOW_MONTHS = 6;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isValidMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_RE.test(value);
}

/** 日本時間の「今月」（"YYYY-MM"） */
export function currentMonth(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** 発売月と再発売月の新しい方 */
export function latestMonth(product: Pick<CatalogProduct, "releaseMonth" | "resaleMonth">): string | null {
  const months = [product.releaseMonth, product.resaleMonth].filter(isValidMonth);
  return months.length > 0 ? months.sort().at(-1)! : null;
}

export function releaseStatusOf(
  product: Pick<CatalogProduct, "releaseMonth" | "resaleMonth">,
  now: Date = new Date(),
): ReleaseStatus {
  const month = latestMonth(product);
  if (!month) return "unknown";
  const thisMonth = currentMonth(now);
  if (month > thisMonth) return "upcoming";
  if (month >= addMonths(thisMonth, -(CURRENT_WINDOW_MONTHS - 1))) return "current";
  return "past";
}

/** 並び替えの優先度（小さいほど上）。現在の商品と発売予定を優先する */
export const RELEASE_STATUS_ORDER: Record<ReleaseStatus, number> = {
  current: 0,
  upcoming: 1,
  unknown: 2,
  past: 3,
};

export const RELEASE_STATUS_LABEL: Record<ReleaseStatus, string> = {
  upcoming: "発売予定",
  current: "発売中",
  past: "過去の商品",
  unknown: "発売時期不明",
};

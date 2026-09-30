const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 「たった今」「12分前」「2時間前」「昨日」「3日前」のような相対時刻表記 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (diff < MINUTE) return "たった今";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}分前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}時間前`;
  if (diff < 2 * DAY) return "昨日";
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}日前`;
  return formatDateTime(iso);
}

/** 2026/09/28 14:05 形式（日本時間） */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "2026-09" → "2026年9月"。不明な場合は「発売時期不明」 */
export function formatReleaseMonth(releaseMonth: string | null | undefined): string {
  if (!releaseMonth || !/^\d{4}-\d{2}$/.test(releaseMonth)) return "発売時期不明";
  const [year, month] = releaseMonth.split("-");
  return `${year}年${Number(month)}月`;
}

/** 「300円」「273円（税抜）」。価格が不明な場合は「価格情報なし」 */
export function formatPrice(price: number | null | undefined, taxIncluded: boolean | null = null): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return "価格情報なし";
  return `${price.toLocaleString("ja-JP")}円${taxIncluded === false ? "（税抜）" : ""}`;
}

/** 距離。座標が不明で計算できない場合は「距離情報なし」 */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return "距離情報なし";
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

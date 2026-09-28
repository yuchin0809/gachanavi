const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 「たった今」「12分前」「2時間前」「3日前」のような相対時刻表記 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (diff < MINUTE) return "たった今";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}分前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}時間前`;
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

/** "2026-09" → "2026年9月" */
export function formatReleaseMonth(releaseMonth: string): string {
  const [year, month] = releaseMonth.split("-");
  return `${year}年${Number(month)}月`;
}

export function formatPrice(price: number): string {
  return `${price.toLocaleString("ja-JP")}円`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

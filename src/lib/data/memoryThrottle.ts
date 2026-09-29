import { REPORT_COOLDOWN_MS, ReportRateLimitedError, placementIdOf } from "./source";
import type { NewStockReport } from "./source";

/** 連投制限の確認用：「ユーザー × 商品×場所」ごとの最後の報告時刻（サーバーのメモリ上のみ。mock / local 用） */
const lastReportedAtByKey = new Map<string, number>();

/** Firestore 版と同じ連投制限をメモリ上で判定し、通過したら報告時刻を記録する */
export function checkMemoryThrottle(input: NewStockReport): number {
  const now = input.reportedAt ? Date.parse(input.reportedAt) : Date.now();
  const key = `${input.userId}:${placementIdOf(input.productId, input.locationId)}`;
  const last = lastReportedAtByKey.get(key);
  if (last !== undefined && now - last < REPORT_COOLDOWN_MS) {
    throw new ReportRateLimitedError(REPORT_COOLDOWN_MS - (now - last));
  }
  lastReportedAtByKey.set(key, now);
  return now;
}

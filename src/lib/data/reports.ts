import { reportStockAction } from "@/app/actions/stockReports";
import type { AddedStockReport } from "@/lib/data/source";
import type { ID, ReportableStockStatus } from "@/types";

export interface StockReportInput {
  productId: ID;
  locationId: ID;
  status: ReportableStockStatus;
}

export type StockReportErrorCode =
  | "invalid_input"
  | "placement_not_found"
  | "rate_limited"
  | "unauthenticated"
  | "server_error";

export class StockReportError extends Error {
  constructor(
    public readonly code: StockReportErrorCode,
    /** rate_limited のとき、再度報告できるまでの秒数 */
    public readonly retryAfterSeconds?: number,
  ) {
    super(`在庫報告に失敗しました (${code})`);
    this.name = "StockReportError";
  }
}

/**
 * 在庫報告の送信（クライアントから呼び出す）。
 * 保存処理はサーバー側の Server Action（src/app/actions/stockReports.ts）で行う。
 *
 * requireAuth（DATA_SOURCE=firestore）のときは、匿名認証の ID トークンを添えて送る。
 * DATA_SOURCE=mock の場合は保存されず、作成された報告だけが返る。
 */
export async function submitStockReport(
  input: StockReportInput,
  { requireAuth }: { requireAuth: boolean },
): Promise<AddedStockReport> {
  let idToken: string | null = null;
  if (requireAuth) {
    try {
      // 在庫報告をするときだけ Firebase Auth を読み込む
      const { getAnonymousIdToken } = await import("@/lib/firebase/clientAuth");
      idToken = await getAnonymousIdToken();
    } catch (error) {
      console.error("[submitStockReport]", error);
      throw new StockReportError("unauthenticated");
    }
  }

  const result = await reportStockAction({ ...input, idToken });
  if (!result.ok) {
    throw new StockReportError(result.error, result.error === "rate_limited" ? result.retryAfterSeconds : undefined);
  }
  return result.report;
}

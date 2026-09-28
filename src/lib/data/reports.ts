import { reportStockAction } from "@/app/actions/stockReports";
import type { ID, ReportableStockStatus, StockReport } from "@/types";

export interface StockReportInput {
  productId: ID;
  locationId: ID;
  status: ReportableStockStatus;
}

export class StockReportError extends Error {
  constructor(public readonly code: string) {
    super(`在庫報告に失敗しました (${code})`);
    this.name = "StockReportError";
  }
}

/**
 * 在庫報告の送信（クライアントから呼び出す）。
 * 保存処理はサーバー側の Server Action（src/app/actions/stockReports.ts）で行う。
 * DATA_SOURCE=mock の場合は保存されず、作成された報告だけが返る。
 */
export async function submitStockReport(input: StockReportInput): Promise<StockReport> {
  const result = await reportStockAction(input);
  if (!result.ok) throw new StockReportError(result.error);
  return result.report;
}

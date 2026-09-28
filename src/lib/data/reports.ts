import { mockCurrentUserId } from "@/data/mock";
import type { ID, ReportableStockStatus, StockReport } from "@/types";

export interface StockReportInput {
  productId: ID;
  locationId: ID;
  status: ReportableStockStatus;
}

/**
 * 在庫報告の送信。
 *
 * 現段階では保存を行わず、送信されたかのように StockReport を組み立てて返すだけ。
 * バックエンド導入時は、ここを Firestore への書き込みや API 呼び出しに置き換える。
 */
export async function submitStockReport(input: StockReportInput): Promise<StockReport> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return {
    id: `local-${Date.now()}`,
    userId: mockCurrentUserId,
    reportedAt: new Date().toISOString(),
    ...input,
  };
}

"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { submitStockReport, type StockReportInput } from "@/lib/data/reports";
import type { AddedStockReport } from "@/lib/data/source";
import type { ID, StockReport, StockSnapshot } from "@/types";

/**
 * このブラウザセッション中にユーザーが行った在庫報告を保持する。
 * サーバーから取得した在庫状態より新しい報告があれば、そちらを画面に反映する。
 * （Firestore 使用時は報告が保存され、キャッシュ無効化後の再取得でも同じ状態になる。
 *   読み取り件数を抑えるため、リアルタイム購読は行わない）
 */
interface StockReportsContextValue {
  localReports: Record<string, StockReport>;
  report: (input: StockReportInput) => Promise<AddedStockReport>;
  /** 報告が保存されるか（モック環境では false） */
  persistent: boolean;
}

const StockReportsContext = createContext<StockReportsContextValue | null>(null);

const keyOf = (productId: ID, locationId: ID) => `${productId}__${locationId}`;

export function StockReportsProvider({ children, persistent }: { children: ReactNode; persistent: boolean }) {
  const [localReports, setLocalReports] = useState<Record<string, StockReport>>({});

  const report = useCallback(async (input: StockReportInput) => {
    const created = await submitStockReport(input, { requireAuth: persistent });
    setLocalReports((prev) => ({ ...prev, [keyOf(created.productId, created.locationId)]: created }));
    return created;
  }, [persistent]);

  const value = useMemo(() => ({ localReports, report, persistent }), [localReports, report, persistent]);
  return <StockReportsContext.Provider value={value}>{children}</StockReportsContext.Provider>;
}

function useStockReportsContext() {
  const ctx = useContext(StockReportsContext);
  if (!ctx) throw new Error("StockReportsProvider が見つかりません");
  return ctx;
}

function mergeSnapshot(initial: StockSnapshot, local: StockReport | undefined): StockSnapshot {
  if (local && (!initial.lastCheckedAt || local.reportedAt > initial.lastCheckedAt)) {
    return { status: local.status, lastCheckedAt: local.reportedAt };
  }
  return initial;
}

/** サーバー側の在庫状態に、ローカルの報告を重ねた最新の在庫状態を返す */
export function useStockSnapshot(productId: ID, locationId: ID, initial: StockSnapshot): StockSnapshot {
  const { localReports } = useStockReportsContext();
  return mergeSnapshot(initial, localReports[keyOf(productId, locationId)]);
}

/** 複数の在庫状態をまとめて解決するための関数を返す（リストや地図用） */
export function useStockResolver() {
  const { localReports } = useStockReportsContext();
  return useCallback(
    (productId: ID, locationId: ID, initial: StockSnapshot) =>
      mergeSnapshot(initial, localReports[keyOf(productId, locationId)]),
    [localReports],
  );
}

export function useReportStock() {
  return useStockReportsContext().report;
}

export function useReportsPersistent() {
  return useStockReportsContext().persistent;
}

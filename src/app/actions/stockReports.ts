"use server";

import { updateTag } from "next/cache";
import { getReporterId } from "@/lib/auth/reporter";
import { getDataSource } from "@/lib/data";
import { cacheTags } from "@/lib/data/cacheTags";
import { PlacementNotFoundError } from "@/lib/data/source";
import { REPORTABLE_STATUSES } from "@/lib/stock";
import type { ReportableStockStatus, StockReport } from "@/types";

export type ReportStockResult =
  | { ok: true; report: StockReport; persisted: boolean }
  | { ok: false; error: "invalid_input" | "placement_not_found" | "server_error" };

// Firestore のドキュメントIDとして安全な形式のみ受け付ける
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isStatus(value: unknown): value is ReportableStockStatus {
  return typeof value === "string" && (REPORTABLE_STATUSES as string[]).includes(value);
}

/**
 * 在庫報告の送信（Server Action）。
 *
 * Server Action は外部から直接 POST で呼び出せるため、入力は必ずサーバー側で検証する。
 * 報告日時はクライアントから受け取らず、サーバーの現在時刻を使う。
 */
export async function reportStockAction(input: {
  productId: unknown;
  locationId: unknown;
  status: unknown;
}): Promise<ReportStockResult> {
  const { productId, locationId, status } = input ?? {};
  if (
    typeof productId !== "string" ||
    typeof locationId !== "string" ||
    !ID_PATTERN.test(productId) ||
    !ID_PATTERN.test(locationId) ||
    !isStatus(status)
  ) {
    return { ok: false, error: "invalid_input" };
  }

  try {
    const [dataSource, userId] = await Promise.all([getDataSource(), getReporterId()]);
    const report = await dataSource.addStockReport({ productId, locationId, userId, status });

    if (dataSource.persistent) {
      // 報告した商品・場所の詳細ページは次回表示時に最新の在庫状態を読み直す。
      // トップ・検索の全件集計（placements タグ）は読み取り件数を抑えるため時間経過でのみ更新する。
      updateTag(cacheTags.placementsByProduct(productId));
      updateTag(cacheTags.placementsByLocation(locationId));
    }

    return { ok: true, report, persisted: dataSource.persistent };
  } catch (error) {
    if (error instanceof PlacementNotFoundError) {
      return { ok: false, error: "placement_not_found" };
    }
    console.error("[reportStockAction]", error);
    return { ok: false, error: "server_error" };
  }
}

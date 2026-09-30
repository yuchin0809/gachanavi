"use server";

import { ReporterAuthError, getReporterId } from "@/lib/auth/reporter";
import { ProductNotFoundError, getFavoriteViews, setFavorite, setStockAlert, takeStockAlerts } from "@/lib/data";
import { getDataSourceKind } from "@/lib/data/config";
import type { Favorite, FavoriteView, StockAlert } from "@/types";

/**
 * お気に入り・在庫通知の Server Action。
 *
 * 在庫報告（stockReports.ts）と同じ方式：ブラウザは匿名認証の ID トークンだけを送り、
 * サーバーで検証した uid の users/{uid}/favorites だけを Admin SDK で読み書きする（uid は受け取らない）。
 * 日時はすべてサーバーの現在時刻。
 */

type ErrorCode = "invalid_input" | "product_not_found" | "unauthenticated" | "server_error";
export type FavoriteResult = { ok: true; favorite: Favorite | null } | { ok: false; error: ErrorCode };
export type FavoritesListResult = { ok: true; items: FavoriteView[] } | { ok: false; error: ErrorCode };
export type StockAlertsResult = { ok: true; alerts: StockAlert[] } | { ok: false; error: ErrorCode };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_ID_TOKEN_LENGTH = 8192;

function tokenOf(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_ID_TOKEN_LENGTH) return undefined; // 不正
  return value;
}

function failure(error: unknown, where: string): { ok: false; error: ErrorCode } {
  if (error instanceof ReporterAuthError) return { ok: false, error: "unauthenticated" };
  if (error instanceof ProductNotFoundError) return { ok: false, error: "product_not_found" };
  console.error(`[${where}]`, error);
  return { ok: false, error: "server_error" };
}

/** お気に入りの登録・解除（冪等） */
export async function setFavoriteAction(input: { productId: unknown; favorite: unknown; idToken?: unknown }): Promise<FavoriteResult> {
  const { productId, favorite } = input ?? {};
  const idToken = tokenOf(input?.idToken);
  if (idToken === undefined || typeof productId !== "string" || !ID_PATTERN.test(productId) || typeof favorite !== "boolean") {
    return { ok: false, error: "invalid_input" };
  }
  try {
    const userId = await getReporterId(idToken);
    return { ok: true, favorite: await setFavorite(userId, productId, favorite) };
  } catch (error) {
    return failure(error, "setFavoriteAction");
  }
}

/** 「在庫報告があったら通知」の ON / OFF（冪等。ON はお気に入りにも登録する） */
export async function setStockAlertAction(input: { productId: unknown; enabled: unknown; idToken?: unknown }): Promise<FavoriteResult> {
  const { productId, enabled } = input ?? {};
  const idToken = tokenOf(input?.idToken);
  if (idToken === undefined || typeof productId !== "string" || !ID_PATTERN.test(productId) || typeof enabled !== "boolean") {
    return { ok: false, error: "invalid_input" };
  }
  try {
    const userId = await getReporterId(idToken);
    return { ok: true, favorite: await setStockAlert(userId, productId, enabled) };
  } catch (error) {
    return failure(error, "setStockAlertAction");
  }
}

/**
 * 本人のお気に入り一覧。Firestore 使用時に ID トークンが無い（まだ一度も匿名ログインしていない）場合は、
 * ログインさせずに 0 件を返す（読み取りなし）
 */
export async function listFavoritesAction(input: { idToken?: unknown }): Promise<FavoritesListResult> {
  const idToken = tokenOf(input?.idToken);
  if (idToken === undefined) return { ok: false, error: "invalid_input" };
  if (!idToken && getDataSourceKind() === "firestore") return { ok: true, items: [] };
  try {
    return { ok: true, items: await getFavoriteViews(await getReporterId(idToken)) };
  } catch (error) {
    return failure(error, "listFavoritesAction");
  }
}

/** 在庫通知の確認（新しい「在庫あり」「残りわずか」の報告を返し、通知済みにする） */
export async function takeStockAlertsAction(input: { idToken?: unknown }): Promise<StockAlertsResult> {
  const idToken = tokenOf(input?.idToken);
  if (idToken === undefined) return { ok: false, error: "invalid_input" };
  if (!idToken && getDataSourceKind() === "firestore") return { ok: true, alerts: [] };
  try {
    return { ok: true, alerts: await takeStockAlerts(await getReporterId(idToken)) };
  } catch (error) {
    return failure(error, "takeStockAlertsAction");
  }
}

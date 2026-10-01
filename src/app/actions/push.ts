"use server";

import { ReporterAuthError, getReporterId } from "@/lib/auth/reporter";
import { deletePushToken, savePushToken } from "@/lib/data";

/**
 * バックグラウンド通知の端末登録（Server Action）。
 * 在庫報告・お気に入りと同じ方式：ブラウザは ID トークンと FCM トークンだけを送り、
 * サーバーで検証した uid の users/{uid}/pushTokens にだけ Admin SDK で保存する。位置情報・端末情報は受け取らない。
 */
export type PushTokenResult = { ok: true } | { ok: false; error: "invalid_input" | "unauthenticated" | "server_error" };

// FCM の登録トークン（英数字・記号 -_: ）。長さは通常 150〜200 文字程度
const FCM_TOKEN_PATTERN = /^[A-Za-z0-9_:-]{20,4096}$/;
const MAX_ID_TOKEN_LENGTH = 8192;

function parse(input: { token?: unknown; idToken?: unknown } | undefined) {
  const token = input?.token;
  const idToken = input?.idToken;
  if (typeof token !== "string" || !FCM_TOKEN_PATTERN.test(token)) return null;
  if (idToken !== undefined && idToken !== null && (typeof idToken !== "string" || idToken.length > MAX_ID_TOKEN_LENGTH)) return null;
  return { token, idToken: typeof idToken === "string" && idToken ? idToken : null };
}

async function run(input: { token?: unknown; idToken?: unknown }, op: typeof savePushToken, where: string): Promise<PushTokenResult> {
  const parsed = parse(input);
  if (!parsed) return { ok: false, error: "invalid_input" };
  try {
    await op(await getReporterId(parsed.idToken), parsed.token);
    return { ok: true };
  } catch (error) {
    if (error instanceof ReporterAuthError) return { ok: false, error: "unauthenticated" };
    console.error(`[${where}]`, error);
    return { ok: false, error: "server_error" };
  }
}

/** この端末をバックグラウンド通知の送り先に登録する（冪等） */
export async function savePushTokenAction(input: { token: unknown; idToken?: unknown }): Promise<PushTokenResult> {
  return run(input, savePushToken, "savePushTokenAction");
}

/** この端末をバックグラウンド通知の送り先から外す（通知 ON のお気に入りが無くなった時など） */
export async function removePushTokenAction(input: { token: unknown; idToken?: unknown }): Promise<PushTokenResult> {
  return run(input, deletePushToken, "removePushTokenAction");
}

import "server-only";
import { mockCurrentUserId } from "@/data/mock";
import { getDataSourceKind } from "@/lib/data/config";
import type { ID } from "@/types";

/** ログイン機能を実装するまでの共通ユーザーID */
export const GUEST_USER_ID = "guest";

/**
 * 在庫報告を行うユーザーのIDを返す。
 *
 * TODO(auth): Firebase Authentication 導入後は、クライアントから受け取った ID トークンを
 * Admin SDK（getAuth().verifyIdToken）で検証し、その uid を返すようにする。
 * 報告者の識別はこの関数に集約しているため、Server Action 側の変更は最小限で済む。
 */
export async function getReporterId(): Promise<ID> {
  return getDataSourceKind() === "mock" ? mockCurrentUserId : GUEST_USER_ID;
}

import "server-only";
import { mockCurrentUserId } from "@/data/mock";
import { getDataSourceKind } from "@/lib/data/config";
import { getAdminAuth } from "@/lib/firebase/admin";
import type { ID } from "@/types";

/** ID トークンが無い・検証できない（期限切れ・改ざん・別プロジェクトのトークンなど） */
export class ReporterAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReporterAuthError";
  }
}

/**
 * 在庫報告を行うユーザーのIDを返す。
 *
 * - firestore: ブラウザが Firebase Authentication（匿名認証）で取得した ID トークンを
 *   Admin SDK（verifyIdToken）で検証し、その uid を返す。クライアントが送った uid をそのまま信用しない
 * - mock     : Firebase を使わないため、開発用の仮ユーザーIDを返す
 *
 * 報告者の識別はこの関数に集約しているため、将来メール等のログインを追加しても Server Action 側は変わらない。
 */
export async function getReporterId(idToken: string | null): Promise<ID> {
  // mock / local（Firebase を使わないローカル確認）は開発用の仮ユーザー
  if (getDataSourceKind() !== "firestore") return mockCurrentUserId;
  if (!idToken) throw new ReporterAuthError("ID token is missing");

  // 設定不備（FirebaseConfigError）は認証エラーではなくサーバーエラーとして扱うため、try の外で取得する
  const auth = getAdminAuth();
  try {
    const decoded = await auth.verifyIdToken(idToken);
    return decoded.uid;
  } catch (error) {
    throw new ReporterAuthError(`ID token verification failed: ${(error as Error).message}`);
  }
}

/**
 * Emulator 統合テストの共通処理。必ず assertEmulatorOnly() を firebase-admin より先に呼ぶ。
 */
import { assertEmulatorOnly } from "../../scripts/lib/emulatorGuard";

export const guard = assertEmulatorOnly();

const base = (host: string) => `http://${host}`;

/** エミュレータのデータを全削除（エミュレータ専用の REST API。本番には存在しない） */
export async function resetEmulator(): Promise<void> {
  const fs = await fetch(
    `${base(guard.firestoreHost)}/emulator/v1/projects/${guard.projectId}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!fs.ok) throw new Error(`Firestore Emulator のリセットに失敗: ${fs.status}`);
  if (guard.authHost) {
    const au = await fetch(`${base(guard.authHost)}/emulator/v1/projects/${guard.projectId}/accounts`, { method: "DELETE" });
    if (!au.ok) throw new Error(`Auth Emulator のリセットに失敗: ${au.status}`);
  }
}

/** Auth Emulator で匿名ユーザーを作成し ID トークンを得る */
export async function emulatorIdToken(): Promise<{ idToken: string; uid: string }> {
  if (!guard.authHost) throw new Error("FIREBASE_AUTH_EMULATOR_HOST が未設定");
  const res = await fetch(
    `${base(guard.authHost)}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) },
  );
  const json = (await res.json()) as { idToken: string; localId: string };
  return { idToken: json.idToken, uid: json.localId };
}

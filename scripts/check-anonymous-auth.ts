/**
 * Firebase Authentication の匿名ログインの接続確認（開発用）。
 *
 *   npm run auth:check
 *
 * 1. Client SDK（NEXT_PUBLIC_FIREBASE_*）で匿名ログインし、ID トークンを取得する
 * 2. Admin SDK（FIREBASE_*）でその ID トークンを検証し、uid が一致するか確かめる
 * 3. 確認用に作った匿名ユーザーは削除する（--keep で残す）
 *
 * 秘密情報は表示しない。
 * ※ firebase/auth は firebase/app と同じ読み込み方式（CJS）になるよう静的に import する。
 *   動的 import にすると ESM 版が読まれ、"Component auth has not been registered yet" になる。
 */
import { getAuth, signInAnonymously, signOut } from "firebase/auth";
import { loadLocalEnv } from "./loadEnv";

loadLocalEnv();

async function main() {
  const { getFirebaseClientApp } = await import("../src/lib/firebase/client");
  const { getAdminAuth, describeAdminTarget } = await import("../src/lib/firebase/adminApp");

  const app = getFirebaseClientApp();
  if (!app) {
    throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY / PROJECT_ID / APP_ID が設定されていません");
  }
  const clientProjectId = app.options.projectId;
  const adminProjectId = describeAdminTarget().projectId;
  console.log(`クライアント側プロジェクト: ${clientProjectId}`);
  console.log(`サーバー側プロジェクト    : ${adminProjectId}`);
  if (clientProjectId !== adminProjectId) {
    console.warn("⚠ NEXT_PUBLIC_FIREBASE_PROJECT_ID と FIREBASE_PROJECT_ID が異なります。ID トークンの検証に失敗します。");
  }

  const auth = getAuth(app);
  let credential;
  try {
    credential = await signInAnonymously(auth);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
      throw new Error(
        `匿名ログインが無効です（${code}）。Firebase コンソール > Authentication > ログイン方法 で「匿名」を有効にしてください。`,
      );
    }
    throw error;
  }
  const uid = credential.user.uid;
  console.log(`✓ 匿名ログイン成功 (uid: ${uid}, isAnonymous: ${credential.user.isAnonymous})`);

  const idToken = await credential.user.getIdToken();
  const decoded = await getAdminAuth().verifyIdToken(idToken);
  if (decoded.uid !== uid) throw new Error(`uid が一致しません: ${decoded.uid} !== ${uid}`);
  console.log(`✓ Admin SDK で ID トークンを検証しました (provider: ${decoded.firebase.sign_in_provider})`);

  await signOut(auth);
  if (!process.argv.includes("--keep")) {
    await getAdminAuth().deleteUser(uid);
    console.log("✓ 確認用の匿名ユーザーを削除しました");
  }
  console.log("\n匿名ログインは正常に動作しています。");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`✗ ${(error as Error).message}`);
    process.exit(1);
  });

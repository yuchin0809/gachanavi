/**
 * Firebase Authentication の匿名認証（ブラウザ用）。
 *
 * 在庫報告の報告者を端末ごとに識別するために使う。
 * 匿名ユーザーはブラウザ（IndexedDB）に保持されるため、同じ端末・同じブラウザなら同じ uid になる。
 * サーバーには uid ではなく ID トークンを送り、サーバー側で Admin SDK により検証する。
 *
 * Firebase コンソールで「Authentication > ログイン方法 > 匿名」を有効にしておく必要がある。
 */
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  signInAnonymously,
  type Auth,
} from "firebase/auth";
import { getFirebaseClientApp } from "./client";

/** Firebase の Web 設定が無い、または匿名ログインに失敗した */
export class AnonymousAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnonymousAuthError";
  }
}

let clientAuth: Auth | null = null;

function getClientAuth(app: NonNullable<ReturnType<typeof getFirebaseClientApp>>): Auth {
  if (clientAuth) return clientAuth;
  // getAuth() はポップアップ／リダイレクトログイン用に apis.google.com のスクリプトを読み込むが、
  // 匿名認証には不要なため、ログイン状態の保存先だけを指定して初期化する
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  // ローカル開発で Auth エミュレータを使う場合（例: 127.0.0.1:9099）
  const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  if (emulatorHost) connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
  clientAuth = auth;
  return auth;
}

let signInPromise: Promise<void> | null = null;

/** 初回だけ匿名ログインする（同時に呼ばれても匿名ユーザーを1人しか作らない） */
async function ensureSignedIn(auth: Auth): Promise<void> {
  await auth.authStateReady();
  if (auth.currentUser) return;
  signInPromise ??= signInAnonymously(auth)
    .then(() => undefined)
    .finally(() => {
      signInPromise = null;
    });
  await signInPromise;
}

/** 匿名ユーザーの ID トークンを返す（期限切れの場合は SDK が自動で更新する） */
export async function getAnonymousIdToken(): Promise<string> {
  const app = getFirebaseClientApp();
  if (!app) throw new AnonymousAuthError("NEXT_PUBLIC_FIREBASE_* が設定されていません");
  const auth = getClientAuth(app);
  try {
    await ensureSignedIn(auth);
  } catch (error) {
    // 匿名認証が無効（auth/operation-not-allowed・auth/admin-restricted-operation）やネットワークエラーなど
    throw new AnonymousAuthError(`匿名ログインに失敗しました: ${(error as Error).message}`);
  }
  const user = auth.currentUser;
  if (!user) throw new AnonymousAuthError("匿名ログインに失敗しました");
  return user.getIdToken();
}

/**
 * すでに匿名ログイン済みなら ID トークンを返す。未ログインなら null（新しく匿名ログインはしない）。
 * お気に入り一覧・在庫通知の確認など、閲覧だけの画面で使う
 */
export async function getExistingIdToken(): Promise<string | null> {
  const app = getFirebaseClientApp();
  if (!app) return null;
  const auth = getClientAuth(app);
  await auth.authStateReady();
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

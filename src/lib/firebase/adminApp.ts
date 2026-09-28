/**
 * Firebase Admin SDK の初期化（サーバー専用）。
 *
 * 認証情報はすべて環境変数から読む。コードに直接書かないこと。
 *   FIREBASE_PROJECT_ID    : プロジェクトID
 *   FIREBASE_CLIENT_EMAIL  : サービスアカウントのメールアドレス
 *   FIREBASE_PRIVATE_KEY   : サービスアカウントの秘密鍵（改行は \n でエスケープ可）
 *
 * FIRESTORE_EMULATOR_HOST が設定されている場合は、ローカルのエミュレータに接続する
 * （この場合サービスアカウントは不要）。
 *
 * このファイルは Next.js 以外（scripts/seed-firestore.ts）からも使うため "server-only" を付けていない。
 * アプリ内からは server-only 付きの ./admin.ts を経由して使う。
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const APP_NAME = "gachanavi-admin";

export class FirebaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirebaseConfigError";
  }
}

function createAdminApp(): App {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) {
    throw new FirebaseConfigError(
      "FIREBASE_PROJECT_ID が設定されていません。.env.local を確認してください（README「Firebase の設定手順」参照）。",
    );
  }

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId }, APP_NAME);
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    throw new FirebaseConfigError(
      "FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY が設定されていません。サービスアカウントの鍵を .env.local に設定してください。",
    );
  }
  return initializeApp({ projectId, credential: cert({ projectId, clientEmail, privateKey }) }, APP_NAME);
}

// 開発サーバーのホットリロードでモジュールが再評価されても、settings() を二重に呼ばないよう globalThis に保持する
const globalForFirestore = globalThis as typeof globalThis & { __gachanaviFirestore?: Firestore };

export function getAdminFirestore(): Firestore {
  if (globalForFirestore.__gachanaviFirestore) return globalForFirestore.__gachanaviFirestore;
  const app = getApps().find((a) => a.name === APP_NAME) ?? createAdminApp();
  const firestore = getFirestore(app);
  firestore.settings({ ignoreUndefinedProperties: true });
  globalForFirestore.__gachanaviFirestore = firestore;
  return firestore;
}

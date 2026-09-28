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
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const APP_NAME = "gachanavi-admin";

export class FirebaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirebaseConfigError";
  }
}

/**
 * 秘密鍵の表記ゆれを吸収する。
 * - JSON からコピーした "\n"（バックスラッシュ + n）を改行に戻す
 * - 環境変数の設定画面などで値ごと "..." を貼り付けた場合の外側の引用符を外す
 */
function normalizePrivateKey(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const quoted =
    trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.endsWith(trimmed[0]);
  const unquoted = quoted ? trimmed.slice(1, -1) : trimmed;
  return unquoted.replace(/\\n/g, "\n");
}

/**
 * よくある貼り付けミスを、値そのものを表示せずに指摘する。
 * （JSON の行ごとコピーして "private_key": や末尾の , が残っている、余計な文字が前に付いている など）
 */
function validateCredentialFormat(projectId: string, clientEmail: string, privateKey: string): void {
  const problems: string[] = [];
  if (/\s/.test(projectId)) {
    problems.push("FIREBASE_PROJECT_ID に空白が含まれています（JSON の project_id の値だけを設定してください）");
  }
  if (/\s/.test(clientEmail) || !clientEmail.endsWith(".iam.gserviceaccount.com")) {
    problems.push(
      "FIREBASE_CLIENT_EMAIL の形式が正しくありません（JSON の client_email の値だけを設定してください。末尾は .iam.gserviceaccount.com）",
    );
  }
  if (!privateKey.startsWith("-----BEGIN PRIVATE KEY-----")) {
    problems.push(
      "FIREBASE_PRIVATE_KEY が -----BEGIN PRIVATE KEY----- で始まっていません（前に余計な文字が付いていないか確認してください）",
    );
  }
  if (!/-----END PRIVATE KEY-----\s*$/.test(privateKey)) {
    problems.push(
      "FIREBASE_PRIVATE_KEY が -----END PRIVATE KEY----- で終わっていません（末尾の \" や , が残っていないか確認してください）",
    );
  }
  if (problems.length > 0) {
    throw new FirebaseConfigError(`環境変数の形式に問題があります:\n  - ${problems.join("\n  - ")}`);
  }
}

/** 接続先の確認用（秘密情報は含まない） */
export function describeAdminTarget(): { projectId: string | null; emulator: string | null; clientEmail: string | null } {
  return {
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() || null,
    emulator: process.env.FIRESTORE_EMULATOR_HOST || null,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim() || null,
  };
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
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if (!clientEmail || !privateKey) {
    throw new FirebaseConfigError(
      "FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY が設定されていません。サービスアカウントの鍵を .env.local に設定してください。",
    );
  }
  validateCredentialFormat(projectId, clientEmail, privateKey);
  return initializeApp({ projectId, credential: cert({ projectId, clientEmail, privateKey }) }, APP_NAME);
}

function getAdminApp(): App {
  return getApps().find((a) => a.name === APP_NAME) ?? createAdminApp();
}

// 開発サーバーのホットリロードでモジュールが再評価されても、settings() を二重に呼ばないよう globalThis に保持する
const globalForFirestore = globalThis as typeof globalThis & { __gachanaviFirestore?: Firestore };

export function getAdminFirestore(): Firestore {
  if (globalForFirestore.__gachanaviFirestore) return globalForFirestore.__gachanaviFirestore;
  const firestore = getFirestore(getAdminApp());
  firestore.settings({ ignoreUndefinedProperties: true });
  globalForFirestore.__gachanaviFirestore = firestore;
  return firestore;
}

/**
 * ID トークンの検証に使う Firebase Authentication（Admin SDK）。
 * FIREBASE_AUTH_EMULATOR_HOST が設定されている場合は Auth エミュレータのトークンを検証する。
 */
export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

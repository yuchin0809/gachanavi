/**
 * Firestore Emulator 以外（本番 Firestore）に接続させないための安全装置。
 *
 * 投入のドライラン・統合テストは、必ずこの関数を firebase-admin の初期化より前に呼ぶ。
 * - FIRESTORE_EMULATOR_HOST が 127.0.0.1 / localhost のエミュレータを指していなければ停止
 * - プロジェクト ID は "demo-" で始まるもののみ（Firebase の仕様で本番に存在しない架空のプロジェクト）
 * - 本番用サービスアカウントの認証情報（環境変数）はプロセス内で消去し、使わない・表示しない
 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
export const EMULATOR_PROJECT_ID_DEFAULT = "demo-gachanavi";

function assertLocal(name: string, value: string | undefined, required: boolean): void {
  if (!value) {
    if (required) throw new Error(`${name} が設定されていません。Firestore Emulator 以外には接続しません。`);
    return;
  }
  const host = value.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`${name}=${value} はローカルのエミュレータではありません。本番には接続しません。`);
  }
}

export function assertEmulatorOnly(): { projectId: string; firestoreHost: string; authHost: string | null } {
  assertLocal("FIRESTORE_EMULATOR_HOST", process.env.FIRESTORE_EMULATOR_HOST, true);
  assertLocal("FIREBASE_AUTH_EMULATOR_HOST", process.env.FIREBASE_AUTH_EMULATOR_HOST, false);

  const projectId = process.env.EMULATOR_PROJECT_ID ?? EMULATOR_PROJECT_ID_DEFAULT;
  if (!projectId.startsWith("demo-")) {
    throw new Error(`プロジェクト ID "${projectId}" は demo- で始まっていません。エミュレータ専用の demo- プロジェクトのみ使用できます。`);
  }

  // 本番用の認証情報は使わない（値は表示しない）
  for (const key of [
    "FIREBASE_PRIVATE_KEY",
    "FIREBASE_CLIENT_EMAIL",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "FIREBASE_CONFIG",
  ]) {
    delete process.env[key];
  }
  // Google Cloud 上で動いているかの自動判定（メタデータサーバーへの外部問い合わせ）をしない
  process.env.METADATA_SERVER_DETECTION = "none";
  // src/lib/firebase/adminApp.ts はエミュレータ接続時にこのプロジェクト ID だけで初期化する
  process.env.FIREBASE_PROJECT_ID = projectId;
  process.env.GCLOUD_PROJECT = projectId;
  process.env.GOOGLE_CLOUD_PROJECT = projectId;

  return {
    projectId,
    firestoreHost: process.env.FIRESTORE_EMULATOR_HOST!,
    authHost: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? null,
  };
}

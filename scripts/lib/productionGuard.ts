/**
 * 本番 Firestore への投入を許可するための確認（scripts/import-collected.ts の --target=production 専用）。
 *
 * 誤って別のプロジェクトやエミュレータに書き込まないよう、次のすべてを満たす場合だけ通す。
 * 1. 投入先は PRODUCTION_PROJECT_ID（コードに固定）だけ
 * 2. コマンドの --project= が PRODUCTION_PROJECT_ID と完全一致
 * 3. 環境変数 FIREBASE_PROJECT_ID が PRODUCTION_PROJECT_ID と完全一致
 * 4. サービスアカウント（FIREBASE_CLIENT_EMAIL）がこのプロジェクトのもの（@<project>.iam.gserviceaccount.com）
 * 5. エミュレータ用の環境変数（FIRESTORE_EMULATOR_HOST など）が設定されていない
 *    （設定されていると firebase-admin がエミュレータに接続し、本番と取り違えるため）
 * 6. 秘密鍵が設定されている（値は表示しない）
 *
 * 書き込みにはさらに、ドライランで表示される確認コード（--confirm-plan=）と --max-writes= が必要（import-collected.ts 側で確認）。
 */
export const PRODUCTION_PROJECT_ID = "gachanavi-21ee8";

/** 本番投入の 1 回あたりの書き込み上限の最大値（Spark プランの無料枠 20,000 件/日） */
export const PRODUCTION_MAX_WRITES_LIMIT = 20_000;

export class ProductionGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionGuardError";
  }
}

export function assertProductionTarget(confirmProject: string | undefined): { projectId: string; firestoreHost: string } {
  const problems: string[] = [];
  if (confirmProject !== PRODUCTION_PROJECT_ID) {
    problems.push(`--project=${PRODUCTION_PROJECT_ID} を指定してください（指定値: ${confirmProject ?? "なし"}）`);
  }
  const envProject = process.env.FIREBASE_PROJECT_ID?.trim();
  if (envProject !== PRODUCTION_PROJECT_ID) {
    problems.push(`環境変数 FIREBASE_PROJECT_ID が ${PRODUCTION_PROJECT_ID} ではありません（${envProject ?? "未設定"}）`);
  }
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim() ?? "";
  if (!clientEmail.endsWith(`@${PRODUCTION_PROJECT_ID}.iam.gserviceaccount.com`)) {
    problems.push(`FIREBASE_CLIENT_EMAIL が ${PRODUCTION_PROJECT_ID} のサービスアカウントではありません`);
  }
  if (!process.env.FIREBASE_PRIVATE_KEY?.trim()) {
    problems.push("FIREBASE_PRIVATE_KEY が設定されていません");
  }
  for (const key of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "EMULATOR_PROJECT_ID", "GOOGLE_APPLICATION_CREDENTIALS"]) {
    if (process.env[key]) problems.push(`本番投入では ${key} を設定しないでください`);
  }
  if (problems.length > 0) {
    throw new ProductionGuardError(`本番投入の条件を満たしていません:\n  - ${problems.join("\n  - ")}`);
  }
  // Google Cloud 上での実行判定（メタデータサーバーへの問い合わせ）をしない
  process.env.METADATA_SERVER_DETECTION = "none";
  return { projectId: PRODUCTION_PROJECT_ID, firestoreHost: "firestore.googleapis.com" };
}

/**
 * Firestore への接続確認（読み取りのみ・書き込みは行わない）。
 *
 *   npm run firestore:check
 *
 * 各コレクションの件数を count() で取得する（読み取りはコレクションごとに 1 件分程度）。
 * 秘密鍵などの秘密情報は表示しない。
 */
import { loadLocalEnv } from "./loadEnv";

loadLocalEnv();

async function main() {
  const { COLLECTIONS } = await import("../src/lib/data/firestore/schema");
  const { describeAdminTarget, getAdminFirestore } = await import("../src/lib/firebase/adminApp");

  const target = describeAdminTarget();
  console.log(`DATA_SOURCE      : ${process.env.DATA_SOURCE ?? "(未設定 = mock)"}`);
  console.log(`プロジェクトID  : ${target.projectId ?? "(未設定)"}`);
  console.log(`接続先          : ${target.emulator ? `エミュレータ ${target.emulator}` : "Cloud Firestore"}`);
  console.log(`サービスアカウント: ${target.clientEmail ?? "(未設定)"}`);
  console.log(`秘密鍵          : ${process.env.FIREBASE_PRIVATE_KEY ? "設定あり" : "(未設定)"}`);
  console.log("");

  const db = getAdminFirestore();
  for (const name of Object.values(COLLECTIONS)) {
    const snap = await db.collection(name).count().get();
    console.log(`${name.padEnd(14)} ${snap.data().count} 件`);
  }
  console.log("\n✓ Firestore に接続できました");
  if (process.env.DATA_SOURCE !== "firestore") {
    console.log("※ アプリで Firestore を使うには DATA_SOURCE=firestore を設定してください");
  }
}

main().catch((error: unknown) => {
  const code = (error as { code?: unknown }).code;
  console.error("✗ Firestore に接続できませんでした");
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  if (code === 5 || code === "not-found") {
    console.error("  → Firestore データベースが作成されていないか、プロジェクトIDが違う可能性があります");
  } else if (code === 7 || code === 16) {
    console.error("  → サービスアカウントの権限、または FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY を確認してください");
  }
  process.exit(1);
});

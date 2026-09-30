/**
 * Emulator 統合テストの共通処理。必ず assertEmulatorOnly() を firebase-admin より先に呼ぶ。
 */
import { assertEmulatorOnly } from "../../scripts/lib/emulatorGuard";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { createMockDatabase } from "../../src/data/mock";
import { placementIdOf } from "../../src/lib/data/source";

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

/**
 * 現在の本番と同じ状態を再現する：isSample の付いていないモック
 * （products 10 / locations 8 / placements / stockReports（latestStock 付き）/ users）
 */
export async function seedProductionLikeMock(db: Firestore): Promise<void> {
  const mock = createMockDatabase(new Date());
  const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
  const batch = db.batch();
  for (const { id, ...p } of mock.products) batch.set(db.collection("products").doc(id), p);
  for (const { id, ...l } of mock.locations) batch.set(db.collection("locations").doc(id), l);
  for (const u of mock.users) batch.set(db.collection("users").doc(u.id), { displayName: u.displayName, createdAt: ts(u.createdAt) });
  const latest = new Map<string, { status: string; reportedAt: Timestamp; reportId: string }>();
  for (const r of mock.stockReports) {
    const k = placementIdOf(r.productId, r.locationId);
    if (!latest.has(k) || ts(r.reportedAt).toMillis() > latest.get(k)!.reportedAt.toMillis()) {
      latest.set(k, { status: r.status, reportedAt: ts(r.reportedAt), reportId: r.id });
    }
    batch.set(db.collection("stockReports").doc(r.id), {
      productId: r.productId, locationId: r.locationId, placementId: k, userId: r.userId, status: r.status, reportedAt: ts(r.reportedAt),
    });
  }
  for (const pl of mock.placements) {
    batch.set(db.collection("placements").doc(pl.id), {
      productId: pl.productId, locationId: pl.locationId, firstSeenAt: ts(pl.firstSeenAt), latestStock: latest.get(pl.id) ?? null,
    });
  }
  await batch.commit();
}

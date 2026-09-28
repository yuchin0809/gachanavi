/**
 * src/data/mock.ts のモックデータを Firestore に投入するスクリプト。
 *
 *   npm run seed:firestore            # products が空の場合のみ投入
 *   npm run seed:firestore -- --force # 既存データがあっても同じIDで上書き
 *
 * 認証情報は .env.local（無ければ環境変数）から読み込む（README「Firebase の設定手順」参照）。
 * 書き込み件数はモックデータ全体で約80件（Spark プランの1日の書き込み上限 20,000 件に対して十分小さい）。
 */
import { Timestamp, type WriteBatch } from "firebase-admin/firestore";
import { createMockDatabase } from "../src/data/mock";
import {
  COLLECTIONS,
  type LatestStockDoc,
  type LocationDoc,
  type PlacementDoc,
  type ProductDoc,
  type StockReportDoc,
  type UserDoc,
} from "../src/lib/data/firestore/schema";
import { placementIdOf } from "../src/lib/data/source";
import { getAdminFirestore } from "../src/lib/firebase/adminApp";
import { loadLocalEnv } from "./loadEnv";

// 認証情報は getAdminFirestore() の呼び出し時に読むため、ここで読み込めば間に合う
loadLocalEnv();

const BATCH_LIMIT = 400;

async function main() {
  const force = process.argv.includes("--force");
  const db = getAdminFirestore();

  const existing = await db.collection(COLLECTIONS.products).limit(1).get();
  if (!existing.empty && !force) {
    console.error("products コレクションに既にデータがあります。上書きする場合は --force を付けてください。");
    process.exit(1);
  }

  const data = createMockDatabase(new Date());
  const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

  // 商品×場所ごとの最新報告（placements.latestStock の初期値）
  const latestByPlacement = new Map<string, LatestStockDoc>();
  for (const r of data.stockReports) {
    const key = placementIdOf(r.productId, r.locationId);
    const current = latestByPlacement.get(key);
    if (!current || ts(r.reportedAt).toMillis() > current.reportedAt.toMillis()) {
      latestByPlacement.set(key, { status: r.status, reportedAt: ts(r.reportedAt), reportId: r.id });
    }
  }

  const writes: Array<(batch: WriteBatch) => void> = [];

  for (const { id, ...product } of data.products) {
    const doc: ProductDoc = product;
    writes.push((b) => b.set(db.collection(COLLECTIONS.products).doc(id), doc));
  }
  for (const { id, ...location } of data.locations) {
    const doc: LocationDoc = location;
    writes.push((b) => b.set(db.collection(COLLECTIONS.locations).doc(id), doc));
  }
  for (const user of data.users) {
    const doc: UserDoc = { displayName: user.displayName, createdAt: ts(user.createdAt) };
    writes.push((b) => b.set(db.collection(COLLECTIONS.users).doc(user.id), doc));
  }
  for (const pl of data.placements) {
    const doc: PlacementDoc = {
      productId: pl.productId,
      locationId: pl.locationId,
      firstSeenAt: ts(pl.firstSeenAt),
      latestStock: latestByPlacement.get(pl.id) ?? null,
    };
    writes.push((b) => b.set(db.collection(COLLECTIONS.placements).doc(pl.id), doc));
  }
  for (const r of data.stockReports) {
    const doc: StockReportDoc = {
      productId: r.productId,
      locationId: r.locationId,
      placementId: placementIdOf(r.productId, r.locationId),
      userId: r.userId,
      status: r.status,
      reportedAt: ts(r.reportedAt),
    };
    writes.push((b) => b.set(db.collection(COLLECTIONS.stockReports).doc(r.id), doc));
  }

  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    writes.slice(i, i + BATCH_LIMIT).forEach((write) => write(batch));
    await batch.commit();
  }

  console.log(
    `投入完了: products ${data.products.length} / locations ${data.locations.length} / users ${data.users.length} / ` +
      `placements ${data.placements.length} / stockReports ${data.stockReports.length}（計 ${writes.length} 件）`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

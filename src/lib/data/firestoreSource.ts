/**
 * Cloud Firestore を使う DataSource 実装（サーバー専用・Admin SDK）。
 *
 * Spark プラン（無料枠）での運用を前提に、読み取り件数を抑える工夫をしている。
 * - 在庫状態は stockReports の履歴を読まず、placements.latestStock だけで判定する
 * - 読み取り結果は Next.js のデータキャッシュに保存し、リクエストごとに Firestore を読まない
 *   （保持時間・タグは cacheTags.ts。在庫報告時に影響するタグだけ無効化する）
 * - リアルタイムリスナー（onSnapshot）は使わない
 */
import "server-only";
import { Timestamp, type Firestore, type Query } from "firebase-admin/firestore";
import { unstable_cache } from "next/cache";
import { getAdminFirestore } from "@/lib/firebase/admin";
import type { ID, PlacementWithStock, StockReport } from "@/types";
import { cacheSeconds, cacheTags } from "./cacheTags";
import {
  COLLECTIONS,
  type LatestStockDoc,
  type ReportThrottleDoc,
  type StockReportDoc,
  type UserDoc,
  locationFromDoc,
  placementFromDoc,
  productFromDoc,
  stockReportFromDoc,
  userFromDoc,
} from "./firestore/schema";
import type { DataSource, PlacementFilter } from "./source";
import { PlacementNotFoundError, REPORT_COOLDOWN_MS, ReportRateLimitedError, placementIdOf } from "./source";

/** 話題のガチャ集計で読む報告件数の上限（無料枠の読み取りを使い切らないための安全弁） */
const MAX_RECENT_REPORTS = 1000;

const db = (): Firestore => getAdminFirestore();

/* ------------------------------------------------------------------
 * キャッシュ付きの読み取り
 * unstable_cache は引数をキャッシュキーに含める。戻り値は JSON で保存されるため、
 * Timestamp はここでドメイン型（ISO 文字列）に変換しておく。
 * ------------------------------------------------------------------ */

const cachedListProducts = unstable_cache(
  async () => (await db().collection(COLLECTIONS.products).get()).docs.map(productFromDoc),
  ["fs:products"],
  { tags: [cacheTags.products], revalidate: cacheSeconds.catalog },
);

const cachedGetProduct = (id: ID) =>
  unstable_cache(
    async () => {
      const snap = await db().collection(COLLECTIONS.products).doc(id).get();
      return snap.exists ? productFromDoc(snap) : null;
    },
    ["fs:product", id],
    { tags: [cacheTags.products, cacheTags.product(id)], revalidate: cacheSeconds.catalog },
  )();

const cachedListLocations = unstable_cache(
  async () => (await db().collection(COLLECTIONS.locations).get()).docs.map(locationFromDoc),
  ["fs:locations"],
  { tags: [cacheTags.locations], revalidate: cacheSeconds.catalog },
);

const cachedGetLocation = (id: ID) =>
  unstable_cache(
    async () => {
      const snap = await db().collection(COLLECTIONS.locations).doc(id).get();
      return snap.exists ? locationFromDoc(snap) : null;
    },
    ["fs:location", id],
    { tags: [cacheTags.locations, cacheTags.location(id)], revalidate: cacheSeconds.catalog },
  )();

function placementTags(filter: PlacementFilter): string[] {
  const tags: string[] = [cacheTags.placements];
  if (filter.productId) tags.push(cacheTags.placementsByProduct(filter.productId));
  if (filter.locationId) tags.push(cacheTags.placementsByLocation(filter.locationId));
  return tags;
}

const cachedListPlacements = (filter: PlacementFilter) =>
  unstable_cache(
    async (): Promise<PlacementWithStock[]> => {
      let query: Query = db().collection(COLLECTIONS.placements);
      if (filter.productId) query = query.where("productId", "==", filter.productId);
      if (filter.locationId) query = query.where("locationId", "==", filter.locationId);
      return (await query.get()).docs.map(placementFromDoc);
    },
    ["fs:placements", filter.productId ?? "*", filter.locationId ?? "*"],
    { tags: placementTags(filter), revalidate: cacheSeconds.placements },
  )();

const cachedCountRecentReports = (windowHours: number) =>
  unstable_cache(
    async (): Promise<Record<ID, number>> => {
      const since = Timestamp.fromMillis(Date.now() - windowHours * 60 * 60 * 1000);
      const snap = await db()
        .collection(COLLECTIONS.stockReports)
        .where("reportedAt", ">=", since)
        .select("productId")
        .limit(MAX_RECENT_REPORTS)
        .get();
      const counts: Record<ID, number> = {};
      for (const doc of snap.docs) {
        const productId = doc.get("productId");
        if (typeof productId === "string") counts[productId] = (counts[productId] ?? 0) + 1;
      }
      return counts;
    },
    ["fs:recentReportCounts", String(windowHours)],
    { tags: [cacheTags.recentReports], revalidate: cacheSeconds.recentReports },
  )();

/* ------------------------------------------------------------------ */

export function createFirestoreDataSource(): DataSource {
  return {
    persistent: true,

    listProducts: () => cachedListProducts(),
    getProduct: (id) => cachedGetProduct(id),
    listLocations: () => cachedListLocations(),
    getLocation: (id) => cachedGetLocation(id),
    listPlacementsWithStock: (filter = {}) => cachedListPlacements(filter),
    countRecentReportsByProduct: (windowHours) => cachedCountRecentReports(windowHours),

    // 履歴表示用（現在の画面では未使用のためキャッシュしない）
    async listStockReports({ productId, locationId, limit = 20 }) {
      const snap = await db()
        .collection(COLLECTIONS.stockReports)
        .where("productId", "==", productId)
        .where("locationId", "==", locationId)
        .orderBy("reportedAt", "desc")
        .limit(limit)
        .get();
      return snap.docs.map(stockReportFromDoc).filter((r): r is StockReport => r !== null);
    },

    async getUser(id) {
      const snap = await db().collection(COLLECTIONS.users).doc(id).get();
      return snap.exists ? userFromDoc(snap) : null;
    },

    /**
     * 在庫報告の追加（トランザクション）
     * 読み取り3件（placement・user・連投制限）+ 書き込み最大4件
     * （stockReports 追加・latestStock 更新・連投制限の記録・初回のみ users 作成）。
     */
    async addStockReport(input) {
      const firestore = db();
      const placementId = placementIdOf(input.productId, input.locationId);
      const placementRef = firestore.collection(COLLECTIONS.placements).doc(placementId);
      const reportRef = firestore.collection(COLLECTIONS.stockReports).doc();
      const userRef = firestore.collection(COLLECTIONS.users).doc(input.userId);
      const throttleRef = userRef.collection(COLLECTIONS.reportThrottles).doc(placementId);
      const reportedAt = input.reportedAt ? Timestamp.fromDate(new Date(input.reportedAt)) : Timestamp.now();

      const reportDoc: StockReportDoc = {
        productId: input.productId,
        locationId: input.locationId,
        placementId,
        userId: input.userId,
        status: input.status,
        reportedAt,
      };

      await firestore.runTransaction(async (tx) => {
        const [placementSnap, userSnap, throttleSnap] = await tx.getAll(placementRef, userRef, throttleRef);
        if (!placementSnap.exists) throw new PlacementNotFoundError(input.productId, input.locationId);

        // 連投対策：同じユーザーが同じ「商品×場所」に短時間で繰り返し報告できないようにする
        // （トランザクション内で判定するため、同時に複数回送信されても1件だけが通る）
        const lastReportedAt = throttleSnap.get("lastReportedAt");
        if (lastReportedAt instanceof Timestamp) {
          const elapsed = reportedAt.toMillis() - lastReportedAt.toMillis();
          if (elapsed < REPORT_COOLDOWN_MS) throw new ReportRateLimitedError(REPORT_COOLDOWN_MS - elapsed);
        }

        if (!userSnap.exists) {
          const userDoc: UserDoc = { displayName: "ゲスト", createdAt: reportedAt };
          tx.create(userRef, userDoc);
        }

        // 報告は常に履歴として残す
        tx.create(reportRef, reportDoc);
        const throttleDoc: ReportThrottleDoc = { lastReportedAt: reportedAt };
        tx.set(throttleRef, throttleDoc);

        // 既存の最新報告より新しい場合のみ latestStock を更新する（古い報告で上書きしない）
        const current = placementSnap.get("latestStock") as LatestStockDoc | null | undefined;
        const currentAt = current?.reportedAt instanceof Timestamp ? current.reportedAt.toMillis() : -Infinity;
        if (reportedAt.toMillis() > currentAt) {
          const latestStock: LatestStockDoc = { status: input.status, reportedAt, reportId: reportRef.id };
          tx.update(placementRef, { latestStock });
        }
      });

      return {
        id: reportRef.id,
        productId: input.productId,
        locationId: input.locationId,
        userId: input.userId,
        status: input.status,
        reportedAt: reportedAt.toDate().toISOString(),
      };
    },
  };
}

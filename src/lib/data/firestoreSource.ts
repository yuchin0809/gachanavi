/**
 * Cloud Firestore を使う DataSource 実装（サーバー専用・Admin SDK）。
 *
 * Spark プラン（無料枠）での運用を前提に、読み取り件数を抑える工夫をしている。
 * - 商品一覧・検索は products を読まず、カタログ索引（catalogIndex の数ドキュメント）だけを読む。
 *   索引は 1 ドキュメント 700KB 以下に分割し、Next.js データキャッシュ（1 件 2MB まで）に収める
 * - 商品詳細・店舗詳細は 1 ドキュメントだけ読む
 * - 在庫状態は stockReports の履歴を読まず、placements.latestStock だけで判定する
 * - 読み取り結果は Next.js のデータキャッシュに保存し、リクエストごとに Firestore を読まない
 *   （保持時間・タグは cacheTags.ts。在庫報告時に影響するタグだけ無効化する）
 * - リアルタイムリスナー（onSnapshot）は使わない
 */
import "server-only";
import { createHash } from "node:crypto";
import { Timestamp, type Firestore, type Query } from "firebase-admin/firestore";
import { unstable_cache } from "next/cache";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  CATALOG_COLLECTION,
  CATALOG_META_ID,
  type CatalogMeta,
  locationShardId,
  productShardId,
} from "@/lib/catalog/index-format";
import { FAVORITES_LIMIT } from "@/lib/favorites";
import type { CatalogProduct, Favorite, ID, Location, PlacementWithStock, StockReport } from "@/types";
import { cacheSeconds, cacheTags } from "./cacheTags";
import {
  COLLECTIONS,
  type FavoriteDoc,
  type PushTokenDoc,
  type PlacementDoc,
  type LatestStockDoc,
  type ReportThrottleDoc,
  type StockReportDoc,
  type UserDoc,
  catalogProductFromData,
  favoriteFromDoc,
  locationFromData,
  locationFromDoc,
  placementFromDoc,
  productFromDoc,
  stockReportFromDoc,
  userFromDoc,
} from "./firestore/schema";
import type { DataSource, PlacementFilter } from "./source";
import {
  PUSH_TOKENS_PER_USER_LIMIT,
  PlacementNotFoundError,
  REPORT_COOLDOWN_MS,
  ReportRateLimitedError,
  STOCK_ALERT_WATCHERS_LIMIT,
  placementIdOf,
} from "./source";

/** 話題のガチャ集計で読む報告件数の上限（無料枠の読み取りを使い切らないための安全弁） */
const MAX_RECENT_REPORTS = 1000;

const db = (): Firestore => getAdminFirestore();

/* ------------------------------------------------------------------
 * キャッシュ付きの読み取り
 * unstable_cache は引数をキャッシュキーに含める。戻り値は JSON で保存されるため、
 * Timestamp はここでドメイン型（ISO 文字列）に変換しておく。
 * ------------------------------------------------------------------ */

/**
 * キャッシュキーに接続先（プロジェクト・エミュレータか）を含める。
 * Next.js のデータキャッシュはビルドをまたいで残るため、接続先を変えたときに別プロジェクトの結果を返さないようにする。
 */
const CACHE_SCOPE = `${process.env.FIREBASE_PROJECT_ID?.trim() ?? ""}${process.env.FIRESTORE_EMULATOR_HOST ? "@emulator" : ""}`;

/* ---------------- カタログ索引 ---------------- */

/** 索引がまだ無い（実データ投入前）場合に products / locations を直接読む件数の上限（無料枠の安全弁） */
const LEGACY_LIST_LIMIT = 300;

const cachedCatalogMeta = unstable_cache(
  async (): Promise<CatalogMeta | null> => {
    const snap = await db().collection(CATALOG_COLLECTION).doc(CATALOG_META_ID).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    return {
      version: String(d.version ?? ""),
      productShards: Number(d.productShards ?? 0),
      locationShards: Number(d.locationShards ?? 0),
      productCount: Number(d.productCount ?? 0),
      locationCount: Number(d.locationCount ?? 0),
      updatedAt: String(d.updatedAt ?? ""),
    };
  },
  [CACHE_SCOPE, "fs:catalogMeta"],
  { tags: [cacheTags.catalog], revalidate: cacheSeconds.catalogMeta },
);

/** 索引の 1 シャード（1 回の読み取り）。シャードごとにキャッシュする（1 件 2MB 未満） */
const cachedShardItems = (version: string, shardId: string) =>
  unstable_cache(
    async (): Promise<Record<string, unknown>[]> => {
      const snap = await db().collection(CATALOG_COLLECTION).doc(shardId).get();
      const items = snap.get("items");
      return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
    },
    [CACHE_SCOPE, "fs:catalogShard", version, shardId],
    { tags: [cacheTags.catalog], revalidate: cacheSeconds.catalog },
  )();

/**
 * 同じ版の索引を毎リクエスト組み立て直さないよう、サーバーのメモリに保持する
 * （キャッシュの読み出しと JSON 変換の負荷を減らす。版が変われば読み直す）
 */
const memo: { products?: { version: string; items: CatalogProduct[] }; locations?: { version: string; items: Location[] } } = {};

async function loadShards(version: string, count: number, idOf: (i: number) => string) {
  const shards = await Promise.all(Array.from({ length: count }, (_, i) => cachedShardItems(version, idOf(i))));
  return shards.flat();
}

const cachedLegacyProducts = unstable_cache(
  async () =>
    (await db().collection(COLLECTIONS.products).limit(LEGACY_LIST_LIMIT).get()).docs
      // isSample: true を付けたサンプル（架空）データは一覧・検索に出さない
      .filter((d) => d.get("isSample") !== true)
      .map((d) => catalogProductFromData(d.id, d.data())),
  [CACHE_SCOPE, "fs:legacyProducts"],
  { tags: [cacheTags.products], revalidate: cacheSeconds.catalog },
);

const cachedLegacyLocations = unstable_cache(
  async () =>
    (await db().collection(COLLECTIONS.locations).limit(LEGACY_LIST_LIMIT).get()).docs
      .filter((d) => d.get("isSample") !== true)
      .map((d) => locationFromData(d.id, d.data())),
  [CACHE_SCOPE, "fs:legacyLocations"],
  { tags: [cacheTags.locations], revalidate: cacheSeconds.catalog },
);

async function listCatalogProducts(): Promise<CatalogProduct[]> {
  const meta = await cachedCatalogMeta();
  // 索引が無い間（実データ投入前）は従来どおり products を読む（件数上限付き）
  if (!meta) return cachedLegacyProducts();
  if (memo.products?.version !== meta.version) {
    const raw = await loadShards(meta.version, meta.productShards, productShardId);
    memo.products = { version: meta.version, items: raw.map((d) => catalogProductFromData(String(d.id), d)) };
  }
  return memo.products.items;
}

async function listLocations(): Promise<Location[]> {
  const meta = await cachedCatalogMeta();
  if (!meta) return cachedLegacyLocations();
  if (memo.locations?.version !== meta.version) {
    const raw = await loadShards(meta.version, meta.locationShards, locationShardId);
    memo.locations = { version: meta.version, items: raw.map((d) => locationFromData(String(d.id), d)) };
  }
  return memo.locations.items;
}

const cachedGetProduct = (id: ID) =>
  unstable_cache(
    async () => {
      const snap = await db().collection(COLLECTIONS.products).doc(id).get();
      // isSample: true のサンプル（架空）データは詳細も表示しない（一覧・在庫報告と同じ扱い）
      return snap.exists && snap.get("isSample") !== true ? productFromDoc(snap) : null;
    },
    [CACHE_SCOPE, "fs:product", id],
    { tags: [cacheTags.products, cacheTags.product(id)], revalidate: cacheSeconds.catalog },
  )();

const cachedGetLocation = (id: ID) =>
  unstable_cache(
    async () => {
      const snap = await db().collection(COLLECTIONS.locations).doc(id).get();
      return snap.exists && snap.get("isSample") !== true ? locationFromDoc(snap) : null;
    },
    [CACHE_SCOPE, "fs:location", id],
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
    [CACHE_SCOPE, "fs:placements", filter.productId ?? "*", filter.locationId ?? "*"],
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
    [CACHE_SCOPE, "fs:recentReportCounts", String(windowHours)],
    { tags: [cacheTags.recentReports], revalidate: cacheSeconds.recentReports },
  )();

/* ------------------------------------------------------------------ */

export function createFirestoreDataSource(): DataSource {
  return {
    persistent: true,

    listCatalogProducts: () => listCatalogProducts(),
    getProduct: (id) => cachedGetProduct(id),
    listLocations: () => listLocations(),
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
     * 設置情報がまだ無い「商品×場所」の場合のみ、商品・設置場所の存在確認で読み取り +2 件、
     * 設置情報の作成で書き込み +1 件（latestStock 付きで作成するため更新は不要）。
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

      let placementCreated = false;
      let latestUpdated = false;
      await firestore.runTransaction(async (tx) => {
        placementCreated = false;
        latestUpdated = false;
        const [placementSnap, userSnap, throttleSnap] = await tx.getAll(placementRef, userRef, throttleRef);
        if (!placementSnap.exists) {
          // 設置情報が無い場合：商品と設置場所の両方が実在し、サンプルでない場合だけ作成できる
          const [productSnap, locationSnap] = await tx.getAll(
            firestore.collection(COLLECTIONS.products).doc(input.productId),
            firestore.collection(COLLECTIONS.locations).doc(input.locationId),
          );
          if (!productSnap.exists || !locationSnap.exists || productSnap.get("isSample") === true) {
            throw new PlacementNotFoundError(input.productId, input.locationId);
          }
        }

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

        const latestStock: LatestStockDoc = { status: input.status, reportedAt, reportId: reportRef.id };
        if (!placementSnap.exists) {
          const placementDoc: PlacementDoc = {
            productId: input.productId,
            locationId: input.locationId,
            firstSeenAt: reportedAt,
            latestStock,
            source: "user_report",
          };
          tx.create(placementRef, placementDoc);
          placementCreated = true;
          latestUpdated = true;
          return;
        }

        // 既存の最新報告より新しい場合のみ latestStock を更新する（古い報告で上書きしない）
        const current = placementSnap.get("latestStock") as LatestStockDoc | null | undefined;
        const currentAt = current?.reportedAt instanceof Timestamp ? current.reportedAt.toMillis() : -Infinity;
        if (reportedAt.toMillis() > currentAt) {
          tx.update(placementRef, { latestStock });
          latestUpdated = true;
        }
      });

      return {
        id: reportRef.id,
        productId: input.productId,
        locationId: input.locationId,
        userId: input.userId,
        status: input.status,
        reportedAt: reportedAt.toDate().toISOString(),
        placementCreated,
        latestUpdated,
      };
    },

    /* ---------------- お気に入り（users/{uid}/favorites/{productId}） ---------------- */

    /** 読み取り：お気に入りの件数分（最大 FAVORITES_LIMIT）。0 件でも 1 */
    async listFavorites(userId, options = {}) {
      const col = favoritesCol(userId);
      // 通知 ON のみの場合は単一フィールドの条件だけにして複合インデックスを不要にする（並べ替えはメモリ上）
      const snap = options.notifyOnly
        ? await col.where("notifyInStock", "==", true).limit(FAVORITES_LIMIT).get()
        : await col.orderBy("createdAt", "desc").limit(FAVORITES_LIMIT).get();
      return snap.docs.map(favoriteFromDoc).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    /** 登録：読み取り 1 + 書き込み（未登録の時だけ）1。解除：書き込み 1（読み取りなし） */
    async setFavorite(userId, productId, favorite) {
      const ref = favoritesCol(userId).doc(productId);
      if (!favorite) {
        await ref.delete(); // 無いドキュメントの削除はエラーにならない（冪等）
        return null;
      }
      return db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) return favoriteFromDoc(snap);
        const doc: FavoriteDoc = {
          productId,
          createdAt: Timestamp.now(),
          notifyInStock: false,
          notifyEnabledAt: null,
          lastNotifiedAt: null,
        };
        tx.create(ref, doc);
        return favoriteFromData(productId, doc);
      });
    },

    /** 読み取り 1 + 書き込み（設定が変わる時だけ）1 */
    async setStockAlert(userId, productId, enabled) {
      const ref = favoritesCol(userId).doc(productId);
      return db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = Timestamp.now();
        if (!snap.exists) {
          if (!enabled) return null;
          const doc: FavoriteDoc = { productId, createdAt: now, notifyInStock: true, notifyEnabledAt: now, lastNotifiedAt: null };
          tx.create(ref, doc);
          return favoriteFromData(productId, doc);
        }
        const current = favoriteFromDoc(snap);
        if (current.notifyInStock === enabled) return current;
        tx.update(ref, enabled ? { notifyInStock: true, notifyEnabledAt: now } : { notifyInStock: false });
        return { ...current, notifyInStock: enabled, notifyEnabledAt: enabled ? now.toDate().toISOString() : current.notifyEnabledAt };
      });
    },

    /**
     * 通知 ON でこの商品をお気に入りにしているユーザー（collectionGroup。全ユーザーは走査しない）。
     * 読み取り：該当するお気に入りの件数分（0 件でも 1）。
     * 複合インデックス（collection group: favorites / productId + notifyInStock）が必要（firestore.indexes.json）
     */
    async listStockAlertWatchers(productId) {
      const snap = await db()
        .collectionGroup(COLLECTIONS.favorites)
        .where("productId", "==", productId)
        .where("notifyInStock", "==", true)
        .limit(STOCK_ALERT_WATCHERS_LIMIT)
        .get();
      return snap.docs.flatMap((doc) => {
        const userId = doc.ref.parent.parent?.id;
        return userId ? [{ userId, favorite: favoriteFromDoc(doc) }] : [];
      });
    },

    /** 読み取り 1 + 書き込み（新しい端末・24 時間ぶりの登録の時だけ）1 */
    async savePushToken(userId, token) {
      const ref = pushTokensCol(userId).doc(pushTokenDocId(token));
      await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = Timestamp.now();
        if (!snap.exists) {
          const doc: PushTokenDoc = { token, platform: "web", createdAt: now, updatedAt: now };
          tx.create(ref, doc);
          return;
        }
        const updatedAt = snap.get("updatedAt");
        if (!(updatedAt instanceof Timestamp) || now.toMillis() - updatedAt.toMillis() > PUSH_TOKEN_REFRESH_MS) {
          tx.update(ref, { updatedAt: now });
        }
      });
    },

    /** 書き込み 1（読み取りなし） */
    async deletePushToken(userId, token) {
      await pushTokensCol(userId).doc(pushTokenDocId(token)).delete();
    },

    /** 読み取り：端末の数（最大 PUSH_TOKENS_PER_USER_LIMIT。0 件でも 1） */
    async listPushTokens(userId) {
      const snap = await pushTokensCol(userId).orderBy("updatedAt", "desc").limit(PUSH_TOKENS_PER_USER_LIMIT).get();
      return snap.docs.map((d) => d.get("token")).filter((t): t is string => typeof t === "string" && t.length > 0);
    },

    /** 書き込み：通知した商品の件数分（読み取りなし。解除済みのものは NOT_FOUND を無視） */
    async markStockAlertsNotified(userId, productIds) {
      const now = Timestamp.now();
      await Promise.all(
        productIds.map((id) =>
          favoritesCol(userId)
            .doc(id)
            .update({ lastNotifiedAt: now })
            .catch((error: { code?: number }) => {
              if (error?.code !== 5) throw error; // 5 = NOT_FOUND
            }),
        ),
      );
    },
  };
}

/* ---------------- バックグラウンド通知（FCM トークン） ---------------- */

function pushTokensCol(userId: string) {
  return db().collection(COLLECTIONS.users).doc(userId).collection(COLLECTIONS.pushTokens);
}

/** トークンそのものをドキュメント ID にしない（長さ・文字の制約と、ID が一覧に出ることを避ける） */
function pushTokenDocId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 40);
}

/** 同じ端末から何度登録しても、updatedAt の更新はこの間隔に 1 回まで（書き込みを増やさない） */
const PUSH_TOKEN_REFRESH_MS = 24 * 60 * 60 * 1000;

function favoritesCol(userId: string) {
  return db().collection(COLLECTIONS.users).doc(userId).collection(COLLECTIONS.favorites);
}

function favoriteFromData(productId: string, doc: FavoriteDoc): Favorite {
  const iso = (t: Timestamp | null) => (t ? t.toDate().toISOString() : null);
  return {
    productId,
    createdAt: doc.createdAt.toDate().toISOString(),
    notifyInStock: doc.notifyInStock,
    notifyEnabledAt: iso(doc.notifyEnabledAt),
    lastNotifiedAt: iso(doc.lastNotifiedAt),
  };
}

/**
 * お気に入り・在庫通知（ブラウザ側）。
 *
 * - 匿名ログインは、お気に入り登録・在庫通知 ON などの操作をした時だけ行う（ページを開いただけではしない）
 * - 商品詳細の「お気に入り済み」表示は、この端末に保存した控え（localStorage）から出す（ページを開くたびに Firestore を読まない）。
 *   匿名ユーザーは端末（ブラウザ）ごとなので、控えと Firestore はほぼ一致する。お気に入り一覧を開いた時に Firestore の内容で控えを更新する
 * - 保存はすべて Server Action（ID トークンをサーバーで検証 → Admin SDK）
 */
import {
  listFavoritesAction,
  setFavoriteAction,
  setStockAlertAction,
  takeStockAlertsAction,
} from "@/app/actions/favorites";
import type { Favorite, FavoriteView, ID, StockAlert } from "@/types";

export type FavoriteErrorCode = "invalid_input" | "product_not_found" | "unauthenticated" | "server_error";

export class FavoriteError extends Error {
  constructor(public readonly code: FavoriteErrorCode) {
    super(`お気に入りの操作に失敗しました (${code})`);
    this.name = "FavoriteError";
  }
}

/* ---------------- この端末の控え（productId → 通知 ON/OFF） ---------------- */

const KEY = "gachanavi:favorites:v1";
export type FavoriteMirror = Record<ID, { notify: boolean }>;
const EMPTY: FavoriteMirror = {};
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: FavoriteMirror } = { raw: null, value: EMPTY };

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function getFavoriteMirror(): FavoriteMirror {
  const raw = readRaw();
  if (raw !== cache.raw) {
    let value: FavoriteMirror = EMPTY;
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") value = parsed as FavoriteMirror;
    } catch {
      // 壊れた控えは無視する（サーバーが正）
    }
    cache = { raw, value };
  }
  return cache.value;
}

export const getServerFavoriteMirror = () => EMPTY;

function writeMirror(next: FavoriteMirror): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 保存できない環境でもサーバー側には保存済み
  }
  listeners.forEach((l) => l());
}

export function subscribeFavoriteMirror(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function applyToMirror(productId: ID, favorite: Favorite | null): void {
  const next = { ...getFavoriteMirror() };
  if (favorite) next[productId] = { notify: favorite.notifyInStock };
  else delete next[productId];
  writeMirror(next);
}

/* ---------------- 認証 ---------------- */

/**
 * requireAuth（Firestore 使用時）なら ID トークンを返す。
 * signIn=true はユーザーの操作時のみ（未ログインなら匿名ログインする）。false は既存のログインだけを使う
 */
async function idTokenFor(requireAuth: boolean, signIn: boolean): Promise<string | null> {
  if (!requireAuth) return null;
  try {
    const auth = await import("@/lib/firebase/clientAuth");
    return signIn ? await auth.getAnonymousIdToken() : await auth.getExistingIdToken();
  } catch (error) {
    console.error("[favorites] auth", error);
    throw new FavoriteError("unauthenticated");
  }
}

/* ---------------- 操作 ---------------- */

export async function saveFavorite(productId: ID, favorite: boolean, requireAuth: boolean): Promise<Favorite | null> {
  const idToken = await idTokenFor(requireAuth, true);
  const res = await setFavoriteAction({ productId, favorite, idToken });
  if (!res.ok) throw new FavoriteError(res.error);
  applyToMirror(productId, res.favorite);
  return res.favorite;
}

export async function saveStockAlert(productId: ID, enabled: boolean, requireAuth: boolean): Promise<Favorite | null> {
  const idToken = await idTokenFor(requireAuth, true);
  const res = await setStockAlertAction({ productId, enabled, idToken });
  if (!res.ok) throw new FavoriteError(res.error);
  applyToMirror(productId, res.favorite);
  return res.favorite;
}

/** お気に入り一覧（未ログインなら匿名ログインせずに 0 件）。サーバーの内容で控えを置き換える */
export async function loadFavorites(requireAuth: boolean): Promise<FavoriteView[]> {
  const idToken = await idTokenFor(requireAuth, false);
  if (requireAuth && !idToken) {
    writeMirror({});
    return [];
  }
  const res = await listFavoritesAction({ idToken });
  if (!res.ok) throw new FavoriteError(res.error);
  writeMirror(Object.fromEntries(res.items.map((v) => [v.favorite.productId, { notify: v.favorite.notifyInStock }])));
  return res.items;
}

export function hasStockAlertsEnabled(): boolean {
  return Object.values(getFavoriteMirror()).some((f) => f?.notify);
}

/** 在庫通知の確認（未ログインなら何もしない） */
export async function fetchStockAlerts(requireAuth: boolean): Promise<StockAlert[]> {
  const idToken = await idTokenFor(requireAuth, false);
  if (requireAuth && !idToken) return [];
  const res = await takeStockAlertsAction({ idToken });
  if (!res.ok) throw new FavoriteError(res.error);
  return res.alerts;
}

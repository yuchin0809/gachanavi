import { FAVORITES_LIMIT } from "@/lib/favorites";
import type { Favorite, ID } from "@/types";
import type { DataSource } from "./source";
import { PUSH_TOKENS_PER_USER_LIMIT, STOCK_ALERT_WATCHERS_LIMIT } from "./source";

/**
 * お気に入り（サーバーのメモリ上のみ。mock / local 用。再起動で消える）。
 * Firestore 版（users/{uid}/favorites/{productId}）と同じ動き（冪等・通知の基準時刻）にする。
 */
const byUser = new Map<ID, Map<ID, Favorite>>();

function favoritesOf(userId: ID): Map<ID, Favorite> {
  let map = byUser.get(userId);
  if (!map) byUser.set(userId, (map = new Map()));
  return map;
}

/** FCM トークン（ユーザー → トークン → 更新日時）。mock / local では実際には送信しない */
const pushTokens = new Map<ID, Map<string, number>>();

export const memoryFavorites: Pick<
  DataSource,
  | "listFavorites"
  | "setFavorite"
  | "setStockAlert"
  | "markStockAlertsNotified"
  | "listStockAlertWatchers"
  | "savePushToken"
  | "deletePushToken"
  | "listPushTokens"
> = {
  async listFavorites(userId, options = {}) {
    return [...favoritesOf(userId).values()]
      .filter((f) => !options.notifyOnly || f.notifyInStock)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, FAVORITES_LIMIT)
      .map((f) => ({ ...f }));
  },
  async setFavorite(userId, productId, favorite) {
    const map = favoritesOf(userId);
    if (!favorite) {
      map.delete(productId);
      return null;
    }
    const existing = map.get(productId);
    if (existing) return { ...existing };
    const created: Favorite = {
      productId,
      createdAt: new Date().toISOString(),
      notifyInStock: false,
      notifyEnabledAt: null,
      lastNotifiedAt: null,
    };
    map.set(productId, created);
    return { ...created };
  },
  async setStockAlert(userId, productId, enabled) {
    const map = favoritesOf(userId);
    const existing = map.get(productId);
    const now = new Date().toISOString();
    if (!existing) {
      if (!enabled) return null;
      const created: Favorite = { productId, createdAt: now, notifyInStock: true, notifyEnabledAt: now, lastNotifiedAt: null };
      map.set(productId, created);
      return { ...created };
    }
    if (existing.notifyInStock !== enabled) {
      existing.notifyInStock = enabled;
      if (enabled) existing.notifyEnabledAt = now;
    }
    return { ...existing };
  },
  async markStockAlertsNotified(userId, productIds) {
    const map = favoritesOf(userId);
    const now = new Date().toISOString();
    for (const id of productIds) {
      const f = map.get(id);
      if (f) f.lastNotifiedAt = now;
    }
  },
  async listStockAlertWatchers(productId) {
    const watchers = [];
    for (const [userId, map] of byUser) {
      const f = map.get(productId);
      if (f?.notifyInStock) watchers.push({ userId, favorite: { ...f } });
    }
    return watchers.slice(0, STOCK_ALERT_WATCHERS_LIMIT);
  },
  async savePushToken(userId, token) {
    let map = pushTokens.get(userId);
    if (!map) pushTokens.set(userId, (map = new Map()));
    map.set(token, Date.now());
  },
  async deletePushToken(userId, token) {
    pushTokens.get(userId)?.delete(token);
  },
  async listPushTokens(userId) {
    return [...(pushTokens.get(userId) ?? new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, PUSH_TOKENS_PER_USER_LIMIT)
      .map(([token]) => token);
  },
};

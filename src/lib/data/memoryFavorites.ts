import { FAVORITES_LIMIT } from "@/lib/favorites";
import type { Favorite, ID } from "@/types";
import type { DataSource } from "./source";

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

export const memoryFavorites: Pick<
  DataSource,
  "listFavorites" | "setFavorite" | "setStockAlert" | "markStockAlertsNotified"
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
};

"use client";

import { useSyncExternalStore } from "react";
import { getFavoriteMirror, getServerFavoriteMirror, subscribeFavoriteMirror } from "@/lib/favoritesClient";

/** この端末のお気に入りの控え（productId → 通知 ON/OFF）。サーバー描画では空 */
export function useFavoriteMirror() {
  return useSyncExternalStore(subscribeFavoriteMirror, getFavoriteMirror, getServerFavoriteMirror);
}

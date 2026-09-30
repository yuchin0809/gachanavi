"use server";

import { getLocationDetail, getStoreMapEntries } from "@/lib/data";
import type { Location, LocationProductEntry, StoreMapEntry } from "@/types";

/** Firestore のドキュメントIDとして安全な形式のみ受け付ける（在庫報告の Server Action と同じ） */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * トップの地図用の店舗一覧（Server Action）。
 * 現在地は受け取らない（距離の計算はブラウザ側）。索引とキャッシュ済みの設置情報だけを使う。
 */
export async function getStoreMapEntriesAction(): Promise<{ ok: true; stores: StoreMapEntry[] } | { ok: false }> {
  try {
    return { ok: true, stores: await getStoreMapEntries() };
  } catch (error) {
    console.error("[getStoreMapEntriesAction]", error);
    return { ok: false };
  }
}

export type StoreDetailResult =
  | { ok: true; location: Location; products: LocationProductEntry[] }
  | { ok: false; error: "invalid_input" | "not_found" | "server_error" };

/**
 * 地図で選んだ店舗の詳細と設置商品（Server Action）。店舗詳細ページと同じ取得処理・キャッシュを使う
 * （店舗 1 件 + その店舗の設置情報のみ。全店舗・全商品は読まない）。
 */
export async function getStoreDetailAction(locationId: unknown): Promise<StoreDetailResult> {
  if (typeof locationId !== "string" || !ID_PATTERN.test(locationId)) return { ok: false, error: "invalid_input" };
  try {
    const detail = await getLocationDetail(locationId);
    if (!detail) return { ok: false, error: "not_found" };
    return { ok: true, location: detail.location, products: detail.products };
  } catch (error) {
    console.error("[getStoreDetailAction]", error);
    return { ok: false, error: "server_error" };
  }
}

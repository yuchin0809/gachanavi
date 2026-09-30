"use server";

import { searchLocations } from "@/lib/data";
import type { ID } from "@/types";

/** 店舗候補（報告画面で選ぶための表示に必要な項目だけ） */
export interface LocationCandidate {
  id: ID;
  name: string;
  address: string;
  area: string;
  /** 距離の表示用（ブラウザで現在地との距離を計算する。現在地はサーバーに送らない）。不明なら null */
  lat: number | null;
  lng: number | null;
}

export type SearchLocationsResult =
  | { ok: true; items: LocationCandidate[]; total: number }
  | { ok: false; error: "invalid_input" | "server_error" };

const MAX_QUERY_LENGTH = 60;

/**
 * 店舗の検索（Server Action）。「この店舗で見つけた」報告で店舗を選ぶために使う。
 * 店舗の索引だけを検索し、Firestore の locations は読まない。
 */
export async function searchLocationsAction(query: unknown): Promise<SearchLocationsResult> {
  if (typeof query !== "string" || query.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: "invalid_input" };
  }
  try {
    const { items, total } = await searchLocations(query);
    return {
      ok: true,
      total,
      items: items.map(({ id, name, address, area, lat, lng }) => ({ id, name, address, area, lat, lng })),
    };
  } catch (error) {
    console.error("[searchLocationsAction]", error);
    return { ok: false, error: "server_error" };
  }
}

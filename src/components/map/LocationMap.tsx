"use client";

import { PlaceholderMap } from "./PlaceholderMap";
import type { LocationMapProps } from "./types";

/**
 * アプリ全体で使う地図コンポーネント。
 *
 * 現在は APIキー不要の簡易地図（PlaceholderMap）を表示している。
 * Google Maps 等を導入する際は、LocationMapProps を満たす実装（例: GoogleMap.tsx）を作り、
 * ここで切り替えるだけで各画面の変更は不要。
 * APIキーは .env.local の NEXT_PUBLIC_GOOGLE_MAPS_API_KEY などで渡し、コードには書かないこと。
 */
export function LocationMap(props: LocationMapProps) {
  return <PlaceholderMap {...props} />;
}

export type { LocationMapProps, MapMarker } from "./types";

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { GeoPoint } from "@/types";

/**
 * ブラウザの Geolocation API で取得した現在地を画面全体に共有する。
 *
 * - 位置情報はこのブラウザのメモリ上でだけ扱い、サーバー・Firestore・ストレージには保存しない
 * - 許可されない・取得に失敗した・非対応の場合は、サーバーから渡された基準地点（fallback）を使う
 * - 許可ダイアログはユーザーの操作（「現在地を使う」）を起点に出す。
 *   すでに許可済みのブラウザでは、ページを開いた時点で自動的に取得する
 */
export type PositionStatus =
  /** 基準地点を使用中（まだ現在地を求めていない） */
  | "fallback"
  | "locating"
  | "current"
  /** 位置情報の利用が許可されていない */
  | "denied"
  /** 取得に失敗した・この端末では使えない */
  | "unavailable";

interface CurrentPositionContextValue {
  /** 距離計算に使う地点（現在地、または基準地点） */
  position: GeoPoint;
  /** 画面表示用のラベル（「現在地」または基準地点の名前） */
  label: string;
  /** position が実際の現在地か */
  isCurrent: boolean;
  status: PositionStatus;
  fallbackLabel: string;
  requestPosition: () => void;
}

const CurrentPositionContext = createContext<CurrentPositionContextValue | null>(null);

const GEOLOCATION_OPTIONS: PositionOptions = {
  // 距離の目安が分かれば十分なので、電池と時間を優先して低精度で取得する
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 5 * 60 * 1000,
};

export function CurrentPositionProvider({
  fallback,
  children,
}: {
  fallback: GeoPoint & { label: string };
  children: ReactNode;
}) {
  const [status, setStatus] = useState<PositionStatus>("fallback");
  const [current, setCurrent] = useState<GeoPoint | null>(null);

  const requestPosition = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setCurrent({ lat: coords.latitude, lng: coords.longitude });
        setStatus("current");
      },
      (error) => {
        setCurrent(null);
        setStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      GEOLOCATION_OPTIONS,
    );
  }, []);

  // すでに許可済みなら、ダイアログを出さずにそのまま取得する（Permissions API 非対応の環境では何もしない）
  useEffect(() => {
    let cancelled = false;
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((permission) => {
        if (cancelled) return;
        if (permission.state === "granted") requestPosition();
        else if (permission.state === "denied") setStatus("denied");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [requestPosition]);

  const value = useMemo<CurrentPositionContextValue>(() => {
    // 「更新」で再取得している間は、直前に取得した現在地を使い続ける
    const isCurrent = current !== null && (status === "current" || status === "locating");
    return {
      position: isCurrent ? current : fallback,
      label: isCurrent ? "現在地" : fallback.label,
      isCurrent,
      status,
      fallbackLabel: fallback.label,
      requestPosition,
    };
  }, [status, current, fallback, requestPosition]);

  return <CurrentPositionContext.Provider value={value}>{children}</CurrentPositionContext.Provider>;
}

export function useCurrentPosition(): CurrentPositionContextValue {
  const ctx = useContext(CurrentPositionContext);
  if (!ctx) throw new Error("CurrentPositionProvider が見つかりません");
  return ctx;
}

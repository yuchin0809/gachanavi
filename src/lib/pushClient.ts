/**
 * バックグラウンド通知（FCM Web Push）の端末登録（ブラウザ側）。
 *
 * - ユーザーが「在庫報告があったら通知」を ON にして、通知が許可された時だけ登録する（ページを開いただけでは何もしない）
 * - 通知 ON のお気に入りが 1 件も無くなったら、この端末の登録を外す
 * - VAPID の公開鍵（NEXT_PUBLIC_FIREBASE_VAPID_KEY）だけを使う。秘密鍵・サービスアカウントはブラウザに置かない
 * - 未設定・非対応のブラウザでは登録せず、従来どおり GachaNavi を開いている間のお知らせだけになる
 */
import { removePushTokenAction, savePushTokenAction } from "@/app/actions/push";
import { isIOSDevice } from "@/lib/browserNotification";
import { hasStockAlertsEnabled } from "@/lib/favoritesClient";

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
const SW_URL = "/firebase-messaging-sw.js";
const TOKEN_KEY = "gachanavi:push-token";
const REFRESHED_KEY = "gachanavi:push-token-refreshed-at";
/** 登録済みの端末は 1 日 1 回だけ登録を確認する（トークンが更新された時のため） */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type PushSetupResult =
  /** 閉じていても通知が届く */
  | "enabled"
  /** VAPID キー・Firebase の設定が無い（アプリを開いている間のお知らせのみ） */
  | "not_configured"
  /** iPhone / iPad：ホーム画面に追加した GachaNavi から ON にする必要がある */
  | "ios_needs_install"
  | "unsupported"
  | "denied"
  | "error";

function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 保存できなくても登録自体はサーバーにある
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function backgroundPushConfigured(): boolean {
  return Boolean(VAPID_KEY);
}

/** ID トークン：signIn=true はユーザーの操作時（未ログインなら匿名ログイン）、false は既存のログインだけ */
async function idTokenFor(requireAuth: boolean, signIn: boolean): Promise<string | null> {
  if (!requireAuth) return null;
  const auth = await import("@/lib/firebase/clientAuth");
  return signIn ? auth.getAnonymousIdToken() : auth.getExistingIdToken();
}

async function messagingApp() {
  const { getFirebaseClientApp } = await import("@/lib/firebase/client");
  return getFirebaseClientApp();
}

/** 登録が通信状態などで止まっても、通知の設定画面を待たせ続けない */
const REGISTER_TIMEOUT_MS = 15_000;

/** 通知が許可された後に呼ぶ：この端末をバックグラウンド通知の送り先に登録する */
export async function enableBackgroundPush(requireAuth: boolean, options: { signIn?: boolean } = {}): Promise<PushSetupResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PushSetupResult>((resolve) => {
    timer = setTimeout(() => resolve("error"), REGISTER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([registerDevice(requireAuth, options.signIn ?? true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function registerDevice(requireAuth: boolean, signIn: boolean): Promise<PushSetupResult> {
  if (!VAPID_KEY) return "not_configured";
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!capable) return isIOSDevice() && !isStandalone() ? "ios_needs_install" : "unsupported";
  if (Notification.permission !== "granted") return "denied";
  const app = await messagingApp();
  if (!app) return "not_configured";
  try {
    const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
    if (!(await isSupported())) return isIOSDevice() && !isStandalone() ? "ios_needs_install" : "unsupported";
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
    await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) return "error";
    const idToken = await idTokenFor(requireAuth, signIn);
    if (requireAuth && !idToken) return "error";
    const res = await savePushTokenAction({ token, idToken });
    if (!res.ok) return "error";
    const previous = read(TOKEN_KEY);
    if (previous && previous !== token) await removePushTokenAction({ token: previous, idToken }).catch(() => undefined);
    store(TOKEN_KEY, token);
    store(REFRESHED_KEY, String(Date.now()));
    return "enabled";
  } catch (error) {
    console.warn("[push] 端末を登録できませんでした", error);
    return "error";
  }
}

/** 通知 ON のお気に入りが無くなったら、この端末の登録を外す（ブラウザ通知・バックグラウンド通知の両方を止める） */
export async function disableBackgroundPushIfUnused(requireAuth: boolean): Promise<void> {
  if (hasStockAlertsEnabled()) return;
  const token = read(TOKEN_KEY);
  if (!token) return;
  store(TOKEN_KEY, null);
  store(REFRESHED_KEY, null);
  try {
    const idToken = await idTokenFor(requireAuth, false);
    await removePushTokenAction({ token, idToken });
    const app = await messagingApp();
    if (app) {
      const { getMessaging, deleteToken } = await import("firebase/messaging");
      await deleteToken(getMessaging(app));
    }
  } catch (error) {
    // 登録が残っても、通知 OFF のお気に入りには送られない（サーバーで notifyInStock を確認する）
    console.warn("[push] 端末の登録を外せませんでした", error);
  }
}

/** 登録済みの端末だけ、1 日 1 回登録を確認する（新しく匿名ログイン・許可の要求はしない） */
export async function refreshBackgroundPush(requireAuth: boolean): Promise<void> {
  if (!VAPID_KEY || !read(TOKEN_KEY) || !hasStockAlertsEnabled()) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (Date.now() - Number(read(REFRESHED_KEY) ?? 0) < REFRESH_INTERVAL_MS) return;
  store(REFRESHED_KEY, String(Date.now())); // 失敗しても次の確認は 1 日後
  await enableBackgroundPush(requireAuth, { signIn: false });
}

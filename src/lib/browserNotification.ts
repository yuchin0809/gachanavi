/**
 * ブラウザ通知（Notification API）。
 *
 * - 許可の要求は、ユーザーが「在庫報告があったら通知」を ON にした時だけ行う
 * - 今回はアプリを開いている間の通知のみ（Service Worker・Push 配信サービスは使わない）。
 *   アプリを閉じている間の通知（Web Push）は、FCM などの配信の仕組みが必要なため別フェーズ
 * - iPhone / iPad の Safari は、ホーム画面に追加した Web アプリでのみ通知を使える（iOS 16.4 以降）。
 *   通知が使えない・拒否された場合も、アプリを開いた時の画面内のお知らせで伝える
 */
export type NotificationSupport = NotificationPermission | "unsupported";

export function notificationSupport(): NotificationSupport {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** ユーザーの操作の中から呼ぶこと */
export async function requestNotificationPermission(): Promise<NotificationSupport> {
  const current = notificationSupport();
  if (current !== "default") return current;
  try {
    return await Notification.requestPermission();
  } catch {
    return "unsupported";
  }
}

export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** 許可済みなら通知を出す（Android の Chrome などページからの通知に対応していない環境では何もしない） */
export function showBrowserNotification(title: string, body: string, url: string): boolean {
  if (notificationSupport() !== "granted") return false;
  try {
    // アイコンは GachaNavi のアプリアイコン（バックグラウンド通知の Service Worker と同じ）
    const n = new Notification(title, { body, tag: `gachanavi:${url}`, icon: "/icons/icon-192.png", badge: "/icons/badge-96.png" });
    n.onclick = () => {
      window.focus();
      window.location.assign(url);
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

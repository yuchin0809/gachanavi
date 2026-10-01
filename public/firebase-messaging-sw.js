/*
 * GachaNavi バックグラウンド通知（FCM Web Push）用の Service Worker。
 *
 * - 担当は「通知の表示」と「通知のタップ」だけ。fetch（ページ・画像の読み込み）には関与せず、キャッシュもしない
 * - Firebase SDK は読み込まない。サーバー（Firebase Admin SDK）が送る data だけのメッセージを受け取り、ここで表示する
 * - 通知のアイコンは GachaNavi のロゴのみ（商品画像・キャラクター画像は使わない）
 * - 位置情報は扱わない
 */
const DEFAULT_TITLE = "GachaNavi 在庫情報";
const DEFAULT_BODY = "お気に入りのガチャに在庫報告があります";
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-96.png";

/** FCM の data メッセージ（{ data: {...} }）・直接の JSON のどちらでも読めるようにする */
function readPayload(event) {
  try {
    const json = event.data ? event.data.json() : null;
    if (!json || typeof json !== "object") return {};
    return json.data && typeof json.data === "object" ? json.data : json;
  } catch (_) {
    return {};
  }
}

/** 同じサイト内のパスだけを開く（外部 URL・"//" で始まる URL は開かない） */
function safePath(url) {
  return typeof url === "string" && /^\/(?!\/)/.test(url) ? url : "/";
}

function text(value, fallback, max) {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : fallback;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const data = readPayload(event);
  const tag = text(data.tag, "gachanavi-stock", 100);
  event.waitUntil(
    self.registration.showNotification(text(data.title, DEFAULT_TITLE, 60), {
      body: text(data.body, DEFAULT_BODY, 200),
      icon: ICON,
      badge: BADGE,
      tag,
      renotify: true,
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          const focused = "focus" in client ? await client.focus() : client;
          if (focused && "navigate" in focused) {
            await focused.navigate(target);
            return;
          }
        } catch (_) {
          // このページを操作できない場合は新しいウィンドウで開く
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});

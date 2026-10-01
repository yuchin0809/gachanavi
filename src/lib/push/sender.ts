import "server-only";
import { getDataSourceKind } from "@/lib/data/config";

/**
 * バックグラウンド通知の送信（FCM Web Push）。
 *
 * - firestore：Firebase Admin SDK（サーバー側のみ。サービスアカウントの鍵はブラウザに出さない）で FCM に送る。
 *   FCM の送信は無料（Spark プランのまま利用できる。Cloud Functions は使わない）
 * - mock / local・Firestore Emulator：実際には送らず、メモリに記録するだけ（FCM にはエミュレータが無い）
 * - テストでは setPushSenderForTests で差し替える
 */
export interface PushMessage {
  token: string;
  /** Service Worker（public/firebase-messaging-sw.js）が通知の表示に使う。値はすべて文字列 */
  data: { title: string; body: string; url: string; tag: string };
}

export interface PushResult {
  token: string;
  ok: boolean;
  /** トークンが無効（アンインストール・期限切れなど）で、今後も届かない */
  invalidToken: boolean;
  error?: string;
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

/** FCM が「このトークンには今後も届かない」と返すエラー。これ以外（一時的なエラー）ではトークンを消さない */
const INVALID_TOKEN_CODES = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);

/** 1 回の sendEach で送れる上限 */
const FCM_BATCH = 500;

const fcmSender: PushSender = {
  async send(messages) {
    const { getAdminMessaging } = await import("@/lib/firebase/adminApp");
    const messaging = getAdminMessaging();
    const results: PushResult[] = [];
    for (let i = 0; i < messages.length; i += FCM_BATCH) {
      const batch = messages.slice(i, i + FCM_BATCH);
      const res = await messaging.sendEach(
        batch.map((m) => ({
          token: m.token,
          // 表示は Service Worker が行う（data のみのメッセージ）。画像・商品画像は付けない
          data: m.data,
          webpush: { headers: { TTL: String(24 * 60 * 60), Urgency: "high" } },
        })),
      );
      res.responses.forEach((r, j) => {
        const code = r.error?.code ?? "";
        results.push({ token: batch[j].token, ok: r.success, invalidToken: INVALID_TOKEN_CODES.has(code), error: code || undefined });
      });
    }
    return results;
  },
};

/** 送らずに記録するだけ（mock / local・エミュレータ） */
export const recordedPushMessages: PushMessage[] = [];
const recordingSender: PushSender = {
  async send(messages) {
    recordedPushMessages.push(...messages);
    return messages.map((m) => ({ token: m.token, ok: true, invalidToken: false }));
  },
};

let override: PushSender | null = null;

/** テスト用：送信の結果（成功・無効なトークン・一時的なエラー）を差し替える */
export function setPushSenderForTests(sender: PushSender | null): void {
  override = sender;
}

export function getPushSender(): PushSender {
  if (override) return override;
  // エミュレータ接続中は本番の FCM に送らない
  if (getDataSourceKind() !== "firestore" || process.env.FIRESTORE_EMULATOR_HOST) return recordingSender;
  return fcmSender;
}

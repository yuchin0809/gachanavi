/**
 * public/firebase-messaging-sw.js（バックグラウンド通知の表示・タップ）を、ブラウザの self を模した環境で実行して確認する。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync("public/firebase-messaging-sw.js", "utf8");
const ORIGIN = "https://gachanavi.example";

function load(windows: { url: string; navigateFails?: boolean }[] = []) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    skipWaiting: () => undefined,
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }) },
    clients: {
      claim: async () => undefined,
      openWindow: async (url: string) => void opened.push(url),
      matchAll: async () =>
        windows.map((w) => ({
          url: w.url,
          focus: async function () {
            return this;
          },
          navigate: async (url: string) => {
            if (w.navigateFails) throw new Error("not controlled");
            navigated.push(url);
          },
        })),
    },
  };
  vm.runInNewContext(SOURCE, { self, URL, console });
  // 他のイベント（fetch など）は扱わない
  assert.deepEqual(Object.keys(handlers).sort(), ["activate", "install", "notificationclick", "push"]);
  const fire = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  return { fire, shown, opened, navigated };
}

const pushEvent = (payload: unknown) => ({ data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) } });
const click = (url: unknown) => ({ notification: { close: () => undefined, data: { url } } });

test("push：FCM の data メッセージから通知を表示（GachaNavi のアイコンのみ・商品詳細の URL）", async () => {
  const sw = load();
  await sw.fire("push", pushEvent({ data: { title: "GachaNavi 在庫情報", body: "テストに「在庫あり」の報告があります（店）", url: "/gacha/tta-Y907104", tag: "stock-tta-Y907104" }, from: "123" }));
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0].title, "GachaNavi 在庫情報");
  assert.equal(sw.shown[0].options.body, "テストに「在庫あり」の報告があります（店）");
  assert.equal(sw.shown[0].options.icon, "/icons/icon-192.png");
  assert.equal(sw.shown[0].options.image, undefined); // 商品画像は使わない
  assert.equal(JSON.stringify(sw.shown[0].options.data), JSON.stringify({ url: "/gacha/tta-Y907104" }));
  assert.equal(sw.shown[0].options.tag, "stock-tta-Y907104");
});

test("push：中身が壊れていても既定の文言で表示し、外部 URL は開かない", async () => {
  const sw = load();
  await sw.fire("push", { data: { json: () => { throw new Error("bad"); } } });
  await sw.fire("push", pushEvent({ data: { url: "https://evil.example/x", title: "" } }));
  await sw.fire("push", pushEvent({ data: { url: "//evil.example/x" } }));
  assert.equal(sw.shown.length, 3);
  assert.equal(sw.shown[0].title, "GachaNavi 在庫情報");
  assert.equal(sw.shown[0].options.body, "お気に入りのガチャに在庫報告があります");
  assert.deepEqual(sw.shown.map((s) => (s.options.data as { url: string }).url), ["/", "/", "/"]);
});

test("⑫ 通知のタップ：開いている GachaNavi があればその画面で商品詳細へ、無ければ新しく開く", async () => {
  const none = load();
  await none.fire("notificationclick", click("/gacha/tta-Y907104"));
  assert.deepEqual(none.opened, [`${ORIGIN}/gacha/tta-Y907104`]);

  const open = load([{ url: `${ORIGIN}/search` }]);
  await open.fire("notificationclick", click("/gacha/tta-Y907104"));
  assert.deepEqual(open.navigated, [`${ORIGIN}/gacha/tta-Y907104`]);
  assert.deepEqual(open.opened, []);

  const uncontrolled = load([{ url: `${ORIGIN}/`, navigateFails: true }, { url: "https://other.example/" }]);
  await uncontrolled.fire("notificationclick", click("https://evil.example/"));
  assert.deepEqual(uncontrolled.opened, [`${ORIGIN}/`]);
});

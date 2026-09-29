/**
 * 画面の結合テスト：Firestore Emulator に接続した `next start` の各ページを HTTP で確認する（読み取りのみ）。
 *
 * 前提：import.test.ts を実行した後のエミュレータのデータ（実データ投入済み + 在庫報告済み）。
 * アプリは本番用の認証情報を外し、エミュレータに向けて起動しておく（README「Firestore Emulator での投入テスト」参照）。
 *
 *   GACHANAVI_APP_URL=http://127.0.0.1:3100 npm run test:emulator:app
 *
 * GACHANAVI_APP_URL が未設定の場合はスキップする。ローカル（127.0.0.1 / localhost）以外の URL は拒否する。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const APP_URL = process.env.GACHANAVI_APP_URL;
if (APP_URL && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(APP_URL)) {
  throw new Error(`GACHANAVI_APP_URL=${APP_URL} はローカルのアプリではありません`);
}
const skip = APP_URL ? false : "GACHANAVI_APP_URL が未設定";

/** ページを取得して、スクリプトとタグを除いた本文テキストを返す */
async function page(pathname: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${APP_URL}${pathname}`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"');
  return { status: res.status, text };
}

const q = (s: string) => `/search?q=${encodeURIComponent(s)}`;
/** 本番と同じモック（isSample なし）の商品名・店舗名。索引に無いため一覧・検索に出てはいけない */
const MOCK_NAMES = ["ねこだんご", "宇宙ペンギン隊", "ガチャステーション 渋谷センター街店"];

test("トップ：実データが表示され、モックが混ざらない", { skip }, async () => {
  const { status, text } = await page("/");
  assert.equal(status, 200);
  assert.match(text, /新着ガチャ/);
  for (const name of MOCK_NAMES) assert.doesNotMatch(text, new RegExp(name));
});

test("一覧（キーワードなし）：過去の商品を除外し、モックを含まない", { skip }, async () => {
  const { status, text } = await page("/search");
  assert.equal(status, 200);
  assert.match(text, /過去の商品も表示/);
  for (const name of MOCK_NAMES) assert.doesNotMatch(text, new RegExp(name));
});

test("検索：索引から検索でき、ページ送りできる。モック名は0件", { skip }, async () => {
  const pokemon = await page(q("ポケモン"));
  assert.equal(pokemon.status, 200);
  const total = Number(/「\s*ポケモン\s*」の検索結果\s*(\d+)/.exec(pokemon.text.replace(/\n/g, ""))?.[1]);
  assert.ok(total > 40, `検索件数 ${total}`);
  const page2 = await page(`${q("ポケモン")}&page=2`);
  assert.equal(page2.status, 200);
  assert.match(page2.text, /ポケモン/);
  assert.match((await page(q("ねこだんご"))).text, /見つかりませんでした/);
});

test("商品詳細：実商品・在庫報告のあった店舗・価格なし・発売予定・404", { skip }, async () => {
  const real = await page("/gacha/bandai-4570118187086000");
  assert.equal(real.status, 200);
  assert.match(real.text, /MOOMIN つまんでつなげてマスコット2/);
  assert.match(real.text, /#C-pla くずはモール店/); // import.test.ts で報告した店舗

  const noPrice = await page("/gacha/toyscabin-20260203_1377");
  assert.equal(noPrice.status, 200);
  assert.match(noPrice.text, /情報なし/);

  const upcoming = await page("/gacha/bandai-4582770068238000");
  assert.equal(upcoming.status, 200);
  assert.match(upcoming.text, /発売予定/);

  assert.equal((await page("/gacha/bandai-0000000000000")).status, 404);
  // 既存のモックは投入時に isSample: true が付くため、詳細も表示しない
  assert.equal((await page("/gacha/p-001")).status, 404);
  assert.equal((await page("/gacha/p-002")).status, 404);
});

test("商品説明文は権利確認が済むまで表示しない。フッターは実データ用の文言", { skip }, async () => {
  const { text } = await page("/gacha/bandai-4570118187086000");
  assert.doesNotMatch(text, /2弾が登場です/); // 収集データの description の一部
  assert.match(text, /この店で見つけた/);
  assert.match(text, /公式サイトに掲載された情報です/);
  assert.doesNotMatch(text, /ダミーデータ/);
});

test("店舗詳細：住所・営業時間・報告済み商品、座標なしの店舗、404", { skip }, async () => {
  const store = await page("/locations/gp-S90000893");
  assert.equal(store.status, 200);
  for (const s of ["#C-pla くずはモール店", "大阪府枚方市楠葉花園町15-1", "平日 10:00~20:00", "MOOMIN つまんでつなげてマスコット2"]) {
    assert.ok(store.text.includes(s), s);
  }

  const noCoord = await page("/locations/dream-2327");
  assert.equal(noCoord.status, 200);
  assert.match(noCoord.text, /ドリームカプセル 津チャム/);

  assert.equal((await page("/locations/gp-XXXX")).status, 404);
  assert.equal((await page("/locations/l-001")).status, 404); // isSample: true のモック店舗
});

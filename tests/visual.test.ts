/**
 * GachaNavi オリジナル商品ビジュアル（src/lib/visual・GachaVisual）のテスト。Firestore には接続しない。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Fragment, type ReactNode, isValidElement } from "react";
import { GachaVisual } from "../src/components/gacha/GachaVisual";
import { toGachaProduct } from "../src/lib/catalog/collected";
import { classifyProduct, seriesKeyOf } from "../src/lib/visual/classify";
import { PALETTES } from "../src/lib/visual/palettes";
import { resolveProductImage } from "../src/lib/visual/source";
import { lineupLabel, visualSpecOf } from "../src/lib/visual/spec";
import type { CatalogProduct } from "../src/types";

/**
 * React 要素ツリーを SVG の文字列にする（GachaVisual はフックを使わない純粋な関数のため直接呼び出せる。
 * react-dom/server は react-server 条件では使えないため、テスト用の最小限の変換）
 */
function toMarkup(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(toMarkup).join("");
  if (!isValidElement(node)) throw new Error("unexpected node");
  const { children, ...props } = node.props as Record<string, unknown> & { children?: ReactNode };
  if (node.type === Fragment) return toMarkup(children);
  if (typeof node.type === "function") return toMarkup((node.type as (p: unknown) => ReactNode)(node.props));
  const attrs = Object.entries(props)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => ` ${k}="${String(v)}"`)
    .join("");
  return `<${String(node.type)}${attrs}>${toMarkup(children)}</${String(node.type)}>`;
}

const product = (name: string, extra: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: `t-${name}`,
  name,
  series: "",
  maker: "バンダイ",
  price: 300,
  priceTaxIncluded: true,
  releaseMonth: "2026-09",
  resaleMonth: null,
  imageUrl: null,
  characters: [],
  tags: [],
  ...extra,
});

test("ジャンル判定：キャラクター・作品・動物・食べ物・ミニチュア・乗り物・ぬいぐるみ・グッズ", () => {
  const cases: [string, string, Partial<CatalogProduct>?][] = [
    ["ちいかわ カプセルステッキ", "character"],
    ["鬼滅の刃 アクリルスタンド 其ノ三", "hero"],
    ["ねこのかぶりもの しろくま", "animal"],
    ["ミニチュア喫茶 ナポリタンセット", "food"], // 題材（食べ物）を優先。モチーフはミニチュア
    ["1/64 サニートラックコレクション3", "vehicle"],
    ["カプセルプラレール 大集合スペシャル", "vehicle"],
    ["プロ野球マスコット フェイスぬいぐるみ", "plush"],
    ["平成ファンシー ミニデニムペンケース", "goods"],
    ["TOYOTOMI ミニチュアストーブコレクション", "miniature"],
    ["機動戦士ガンダム ならぶんです。", "cool"],
    ["名探偵プリキュア！ サウンドロップ", "kids"],
    ["ワンパンマン カプセルラバーキーホルダー", "goods"], // 「パン」を食べ物と誤判定しない
    ["ドズル社 あそばせ隊！", "general"], // 「そば」を食べ物と誤判定しない
    ["STARDOM アクリルマーカー", "goods"], // 「くるま」を乗り物と誤判定しない
    ["幸柴", "general"], // 特徴が無い商品
  ];
  for (const [name, genre, extra] of cases) {
    assert.equal(classifyProduct(product(name, extra)).genre, genre, name);
  }
});

test("モチーフ：テーマ（作品・題材）→ 形 → 一般の順。シリーズ内で共通になる", () => {
  assert.equal(visualSpecOf(product("ちいかわ ふわふわマスコット")).motif, "sparkle");
  assert.equal(visualSpecOf(product("ちいかわ カプセルステッキ")).motif, "sparkle");
  assert.equal(visualSpecOf(product("ミニチュア喫茶 ナポリタンセット")).motif, "waves");
  assert.equal(visualSpecOf(product("TOYOTOMI ミニチュアストーブコレクション")).motif, "tiles");
  assert.equal(visualSpecOf(product("プロ野球マスコット フェイスぬいぐるみ")).motif, "soft");
  assert.equal(visualSpecOf(product("1/64 サニートラックコレクション3")).motif, "speed");
  assert.equal(visualSpecOf(product("ラーメン赤猫 わっかチャーム")).motif, "waves");
});

test("決定的：同じ商品は常に同じ見た目。商品ごとにカプセルが変わる", () => {
  const a1 = visualSpecOf(product("ちいかわ カプセルステッキ"));
  const a2 = visualSpecOf({ ...product("ちいかわ カプセルステッキ") });
  assert.deepEqual(a1, a2);
  const specs = ["A", "B", "C", "D", "E", "F"].map((s) => visualSpecOf(product(`ちいかわ テスト${s}`)));
  const variants = new Set(specs.map((s) => `${s.capsuleTone}-${s.inner}-${s.capsuleTilt}`));
  assert.ok(variants.size >= 4, `variants ${variants.size}`);
});

test("シリーズ感：同じシリーズは同じテーマカラー・背景パターン、別シリーズは変わる", () => {
  const a = visualSpecOf(product("すみっコぐらし ならぶんです。"));
  const b = visualSpecOf(product("すみっコぐらし カプセルラバーマスコット"));
  assert.equal(seriesKeyOf(product("すみっコぐらし ならぶんです。")), seriesKeyOf(product("すみっコぐらし カプセルラバーマスコット")));
  assert.equal(a.paletteId, b.paletteId);
  assert.equal(a.motif, b.motif);
  assert.equal(a.seriesSeed, b.seriesSeed);
  const c = visualSpecOf(product("すみっコぐらし ふわふわフェイス巾着2"));
  assert.equal(c.paletteId, a.paletteId);
  assert.equal(c.motif, a.motif);
  assert.notEqual(a.productSeed, b.productSeed);
  // シリーズ名がある場合はそれを使う。先頭の【再販】などの区分は無視
  assert.equal(seriesKeyOf(product("【再販】ちいかわ マスコット")), seriesKeyOf(product("ちいかわ マスコット")));
  assert.equal(seriesKeyOf(product("x", { series: "ねこのかぶりもの" })), seriesKeyOf(product("y", { series: "ねこのかぶりもの" })));
  // 同じジャンルでも別シリーズならパレットが分かれる（ジャンルの候補の中で散らばる）
  const heroes = ["鬼滅の刃", "呪術廻戦", "ブルーロック", "ハイキュー!!", "僕のヒーローアカデミア", "東京リベンジャーズ"].map(
    (s) => visualSpecOf(product(`${s} マスコット`)).paletteId,
  );
  assert.ok(new Set(heroes).size >= 2);
});

test("種類数の表示：全N種にそろえ、数が読めなければ表示しない", () => {
  assert.equal(lineupLabel("全5種"), "全5種");
  assert.equal(lineupLabel("全12種（内シークレット1種）"), "全12種");
  assert.equal(lineupLabel("6種類"), "全6種");
  assert.equal(lineupLabel("全\nバンダイから発売される商品情報などはこちら 種"), null);
  assert.equal(lineupLabel(null), null);
});

test("表示元：メーカー公式画像は使わず生成ビジュアル。アプリ内の画像・将来のユーザー写真を優先", () => {
  assert.deepEqual(resolveProductImage({ imageUrl: "https://bandai-a.akamaihd.net/bc/img/model/b/1000.jpg" }), { kind: "generated" });
  assert.deepEqual(resolveProductImage({ imageUrl: null }), { kind: "generated" });
  assert.deepEqual(resolveProductImage({ imageUrl: "/images/gacha/p-001.svg" }), { kind: "licensed", url: "/images/gacha/p-001.svg" });
  assert.deepEqual(resolveProductImage({ imageUrl: null, userPhotoUrl: "/uploads/u1.jpg" }), { kind: "user-photo", url: "/uploads/u1.jpg" });
  assert.deepEqual(resolveProductImage({ imageUrl: null, userPhotoUrl: "https://example.com/x.jpg" }), { kind: "generated" });
});

test("SVG：外部 URL・画像を参照せず、軽量で、数値が壊れていない", () => {
  for (const spec of [
    visualSpecOf(product("ちいかわ ふわふわマスコット")),
    visualSpecOf(product("1/64 サニートラックコレクション3")),
    visualSpecOf(product("機動戦士ガンダム ならぶんです。")),
    visualSpecOf(product("ミニチュア喫茶 ナポリタンセット")),
  ]) {
    for (const height of [130, 200]) {
      const svg = toMarkup(GachaVisual({ spec, height, showBrand: height === 130 }));
      assert.match(svg, /^<svg /);
      assert.doesNotMatch(svg, /https?:\/\//);
      assert.doesNotMatch(svg, /<image|<img/);
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
      assert.ok(svg.length < 12000, `${spec.motif} ${svg.length} bytes`);
      if (height === 130) assert.match(svg, /GachaNavi/);
    }
  }
});

test("全 23,464 商品：ビジュアルを決められ、1 つのパレット・モチーフに偏りすぎない", () => {
  const raw = JSON.parse(readFileSync("data/collected/products.json", "utf8"));
  const started = Date.now();
  const palettes = new Map<string, number>();
  const motifs = new Map<string, number>();
  for (const r of raw) {
    const spec = visualSpecOf(toGachaProduct(r));
    assert.ok(PALETTES[spec.paletteId]);
    palettes.set(spec.paletteId, (palettes.get(spec.paletteId) ?? 0) + 1);
    motifs.set(spec.motif, (motifs.get(spec.motif) ?? 0) + 1);
  }
  assert.equal(raw.length, 23464);
  assert.ok(Date.now() - started < 5000);
  assert.ok(palettes.size >= 14 && [...palettes.values()].every((n) => n / raw.length < 0.2), JSON.stringify([...palettes]));
  assert.ok(motifs.size === 12 && [...motifs.values()].every((n) => n / raw.length < 0.25), JSON.stringify([...motifs]));
});

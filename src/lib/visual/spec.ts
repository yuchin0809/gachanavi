/**
 * 商品ごとのオリジナルビジュアルの仕様（テーマカラー・抽象モチーフ・カプセルの変化）を決める。
 *
 * - すべて商品情報から決定的に求める（同じ商品は常に同じ見た目。画像ファイルは作らない）
 * - テーマカラーと背景パターンの配置はシリーズ単位で決める（同じシリーズは統一感が出る）
 * - カプセルの色味・傾き・中の図形は商品単位で少し変える
 * - 結果はメモリにキャッシュする（一覧で同じ商品が何度出ても計算は 1 回）
 */
import type { CatalogProduct } from "@/types";
import { type Form, type Genre, type Theme, classifyProduct, seriesKeyOf } from "./classify";
import { LIGHT_PALETTES, PALETTES, type PaletteId, type VisualPalette } from "./palettes";

export type Motif =
  | "sparkle" // 星・円・ドット
  | "bubbles" // 丸・点
  | "waves" // 波形・丸・角丸の四角
  | "tiles" // グリッド・小さな四角
  | "speed" // スピードライン・円
  | "soft" // 大きな柔らかい丸・星
  | "diamonds" // ダイヤ・円・ライン
  | "rays" // 放射状の光・三角
  | "prism" // 幾何学の三角・細い線
  | "confetti" // 紙吹雪のような丸と四角
  | "leaves" // 葉のような楕円・弧
  | "rings"; // 同心円・ドット

export type InnerShape = "star" | "circle" | "dots" | "ring" | "diamond";

export interface VisualSpec {
  /** SVG 内の ID の接頭辞（商品ごとに一意） */
  key: string;
  genre: Genre;
  theme: Theme | null;
  form: Form | null;
  paletteId: PaletteId;
  palette: VisualPalette;
  motif: Motif;
  seriesKey: string;
  /** 背景パターンの配置（シリーズ単位） */
  seriesSeed: number;
  /** カプセルの変化（商品単位） */
  productSeed: number;
  capsuleTilt: number;
  /** カプセル下半分の色：0 = パレットのカプセル色、1 = 主色、2 = 差し色 */
  capsuleTone: 0 | 1 | 2;
  inner: InnerShape;
}

/** テーマ・形ごとの候補パレット（シリーズごとにこの中から 1 つ選ぶ） */
const GENRE_PALETTES: Record<Genre, PaletteId[]> = {
  character: ["sky", "ramune", "peach", "indigo"],
  hero: ["forest", "lagoon", "navy", "berry"],
  kids: ["citrus", "tangerine", "berry", "ramune"],
  food: ["tangerine", "berry", "citrus", "sand", "coral"],
  animal: ["mint", "lagoon", "sand", "sky"],
  nature: ["mint", "forest", "sand", "lagoon"],
  vehicle: ["navy", "steel", "graphite", "sky"],
  cool: ["graphite", "navy", "steel", "indigo"],
  plush: ["peach", "sky", "lilac", "citrus"],
  miniature: ["lilac", "indigo", "steel", "sand"],
  goods: ["coral", "lilac", "ramune", "peach"],
  figure: ["indigo", "lagoon", "coral", "sky"],
  general: LIGHT_PALETTES,
};

const THEME_MOTIF: Record<Theme, Motif> = {
  character: "sparkle",
  hero: "rays",
  kids: "confetti",
  food: "waves",
  animal: "bubbles",
  nature: "leaves",
  vehicle: "speed",
  cool: "prism",
};

const FORM_MOTIF: Record<Form, Motif> = {
  plush: "soft",
  miniature: "tiles",
  goods: "diamonds",
  figure: "rings",
};

const GENERAL_MOTIFS: Motif[] = ["sparkle", "rings", "diamonds", "bubbles", "confetti", "prism"];
const INNER: InnerShape[] = ["star", "circle", "dots", "ring", "diamond"];

/** 32bit FNV-1a（ブラウザ・サーバーの両方で同じ値になる） */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** シード付きの疑似乱数（mulberry32）。同じシードからは常に同じ列 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type SpecInput = Pick<CatalogProduct, "id" | "name" | "series" | "maker" | "tags" | "characters">;

const cache = new Map<string, VisualSpec>();
const CACHE_LIMIT = 5000;

export function visualSpecOf(product: SpecInput): VisualSpec {
  const cacheKey = `${product.id}\u0000${product.name}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const { theme, form, genre } = classifyProduct(product);
  const seriesKey = seriesKeyOf(product);
  const seriesSeed = hash32(`series:${seriesKey}`);
  const productSeed = hash32(`product:${product.id}`);

  const candidates = GENRE_PALETTES[genre];
  const paletteId = candidates[seriesSeed % candidates.length];

  // テーマ（作品・題材。シリーズ内で共通）→ 形 → 一般 の順。同じシリーズの商品は同じ背景パターンになる
  const motif: Motif = theme
    ? THEME_MOTIF[theme]
    : form
      ? FORM_MOTIF[form]
      : GENERAL_MOTIFS[seriesSeed % GENERAL_MOTIFS.length];

  const spec: VisualSpec = {
    key: `gv${productSeed.toString(36)}`,
    genre,
    theme,
    form,
    paletteId,
    palette: PALETTES[paletteId],
    motif,
    seriesKey,
    seriesSeed,
    productSeed,
    capsuleTilt: ((productSeed % 21) - 10) * 1.2,
    capsuleTone: ((productSeed >>> 5) % 3) as 0 | 1 | 2,
    inner: INNER[(productSeed >>> 9) % INNER.length],
  };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(cacheKey, spec);
  return spec;
}

/** 種類数の表示（「全5種」「全12種（内シークレット1種）」→「全5種」「全12種」）。数が読み取れなければ null */
export function lineupLabel(lineupCount: string | null | undefined): string | null {
  const m = /(\d{1,3})\s*種/.exec((lineupCount ?? "").normalize("NFKC"));
  return m ? `全${Number(m[1])}種` : null;
}

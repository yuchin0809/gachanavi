/**
 * GachaNavi オリジナル商品ビジュアルのカラーパレット。
 *
 * メーカーや作品の公式カラーを再現するものではなく、GachaNavi の UI（赤い筐体カラー・カプセルの黄色・
 * 生成りのキャンバス）と並べて違和感のないよう、彩度と明るさをそろえた独自の配色にしている。
 */
export interface VisualPalette {
  id: string;
  /** 背景グラデーション（左上 → 右下） */
  bgFrom: string;
  bgTo: string;
  /** 背景の光（大きな円のにじみ） */
  glow: string;
  /** モチーフの主色・差し色 */
  accent: string;
  accent2: string;
  /** カプセル下半分の色（明 → 暗） */
  capsule: string;
  capsuleDeep: string;
  /** 背景が暗いパレット（ブランド表記などの文字色を切り替える） */
  dark: boolean;
}

const p = (
  id: string,
  bgFrom: string,
  bgTo: string,
  glow: string,
  accent: string,
  accent2: string,
  capsule: string,
  capsuleDeep: string,
  dark = false,
): VisualPalette => ({ id, bgFrom, bgTo, glow, accent, accent2, capsule, capsuleDeep, dark });

export const PALETTES = {
  sky: p("sky", "#e3f2ff", "#b7d9fb", "#ffffff", "#3a8ee0", "#ffd45e", "#56aaf2", "#2f7fd6"),
  ramune: p("ramune", "#e2fbff", "#aee8f5", "#ffffff", "#169fc2", "#ff7fa9", "#3cc3e0", "#1b93b8"),
  lagoon: p("lagoon", "#dbf6f1", "#a4e0d7", "#ffffff", "#1d978a", "#ffb35c", "#34b5a5", "#1f8a7c"),
  mint: p("mint", "#e6f7ea", "#b6e3c2", "#ffffff", "#2e9a5a", "#f7d44c", "#48b874", "#2b8c55"),
  forest: p("forest", "#d8ece2", "#8fc3ab", "#f3fff8", "#1d6b52", "#f2c14e", "#2f8c69", "#1c6a4f"),
  citrus: p("citrus", "#fff7d6", "#ffe08c", "#ffffff", "#e79d00", "#ef4550", "#ffc83d", "#f0a51a"),
  tangerine: p("tangerine", "#ffecdc", "#ffc59e", "#ffffff", "#ec7424", "#ffd45e", "#ff8f45", "#e56a1f"),
  berry: p("berry", "#ffe5e7", "#ffb4ba", "#ffffff", "#dd3f4b", "#ffd07a", "#f05560", "#cf3440"),
  peach: p("peach", "#ffeaf1", "#ffc3d6", "#ffffff", "#e0558a", "#ffd6a5", "#f57fa7", "#dd5e8c"),
  coral: p("coral", "#ffeee7", "#ffc8b3", "#ffffff", "#e7654a", "#3fb5a8", "#f38a66", "#dc6a47"),
  lilac: p("lilac", "#f1eaff", "#d3c3fa", "#ffffff", "#7657d2", "#7fd1ff", "#9c7eea", "#7c5bd6"),
  indigo: p("indigo", "#e4e7ff", "#b4bcf4", "#ffffff", "#4852c4", "#ffcf5c", "#6470e0", "#4650c2"),
  steel: p("steel", "#e7ebf0", "#c1cbd7", "#ffffff", "#4b6280", "#ffb14e", "#6d86a5", "#4f6886"),
  sand: p("sand", "#f8f0e3", "#e8d4b3", "#fffaf1", "#ad7536", "#5bb1a8", "#d49c58", "#b87f3c"),
  navy: p("navy", "#22304f", "#34497a", "#6f8fd6", "#8fbaff", "#ffd45e", "#4a7ae0", "#2f5cc0", true),
  graphite: p("graphite", "#2a2d36", "#454a57", "#8b93a8", "#aab3c6", "#ef4550", "#646d82", "#474e60", true),
} satisfies Record<string, VisualPalette>;

export type PaletteId = keyof typeof PALETTES;

/** 明るい背景のパレット（特徴が判定できない商品に使う） */
export const LIGHT_PALETTES: PaletteId[] = [
  "sky",
  "ramune",
  "lagoon",
  "mint",
  "citrus",
  "tangerine",
  "berry",
  "peach",
  "coral",
  "lilac",
  "indigo",
  "steel",
  "sand",
];

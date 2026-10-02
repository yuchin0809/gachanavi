import { formatPrice, formatReleaseMonth } from "@/lib/format";
import { lineupLabel } from "@/lib/visual/spec";
import type { CatalogProduct, GachaProduct, Location } from "@/types";

/**
 * 検索結果に表示されるタイトル・説明文（商品・店舗ごとに、実際のデータだけから作る）。
 * キーワードを詰め込んだり、データに無い情報を足したりしない。
 */

/** 文字数（コードポイント）で切り詰める */
export function truncate(text: string, max: number): string {
  const chars = [...text.trim()];
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("")}…`;
}

/** 価格・発売時期・種類数など、分かっている事実だけを「・」でつなぐ */
export function productFacts(product: Pick<GachaProduct, "maker" | "price" | "priceTaxIncluded" | "releaseMonth" | "resaleMonth"> & { lineupCount?: string | null }): string[] {
  const facts: string[] = [];
  if (product.maker) facts.push(product.maker);
  if (product.price !== null) facts.push(`1回${formatPrice(product.price, product.priceTaxIncluded)}`);
  if (product.releaseMonth) facts.push(`${formatReleaseMonth(product.releaseMonth)}発売`);
  if (product.resaleMonth && product.resaleMonth !== product.releaseMonth) facts.push(`${formatReleaseMonth(product.resaleMonth)}再販`);
  const lineup = lineupLabel(product.lineupCount);
  if (lineup) facts.push(lineup);
  return facts;
}

/**
 * 商品ページのタイトル。テンプレート（layout.tsx）で「｜GachaNavi」が付く。
 * 同じ名前の商品（再販・別バージョン）があるときだけ発売時期を添えて区別する（ambiguous）
 */
export function productTitle(product: Pick<CatalogProduct, "name" | "releaseMonth">, ambiguous = false): string {
  const when = ambiguous && product.releaseMonth ? `（${formatReleaseMonth(product.releaseMonth)}発売）` : "";
  return `${truncate(product.name, 48)}${when}｜設置店舗・在庫情報`;
}

export function productDescription(
  product: Parameters<typeof productFacts>[0] & Pick<CatalogProduct, "name">,
  placementCount: number,
): string {
  const facts = productFacts(product);
  const parts = [
    `「${truncate(product.name, 60)}」の設置店舗と在庫情報。`,
    facts.length ? `${facts.join("・")}。` : "",
    placementCount > 0
      ? `${placementCount}店舗で設置が報告されています。`
      : "現在、設置店舗の情報は登録されていません。",
    "ガチャガチャ（カプセルトイ）の設置場所をGachaNaviで確認できます。",
  ];
  return truncate(parts.join(""), 160);
}

export function locationTitle(location: Pick<Location, "name">): string {
  return `${truncate(location.name, 48)}｜ガチャガチャの設置情報`;
}

export function locationDescription(location: Pick<Location, "name" | "address">, productCount: number): string {
  const parts = [
    `${truncate(location.name, 50)}${location.address ? `（${truncate(location.address, 50)}）` : ""}のガチャガチャ・カプセルトイの設置情報。`,
    productCount > 0
      ? `${productCount}種類のガチャの設置が報告されています。在庫状況と最終確認日時を確認できます。`
      : "現在、この店舗に設置されているガチャの情報は登録されていません。",
  ];
  return truncate(parts.join(""), 160);
}

/* ---------------- 都道府県（店舗一覧のページ分け） ---------------- */

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

/** JIS の都道府県コード（"01"〜"47"）。住所の先頭が都道府県名でなければ null */
export function prefectureCodeOf(address: string): string | null {
  const a = address.trim();
  const i = PREFECTURES.findIndex((p) => a.startsWith(p));
  return i < 0 ? null : String(i + 1).padStart(2, "0");
}

export function prefectureName(code: string): string | null {
  const i = Number(code);
  return /^\d{2}$/.test(code) && i >= 1 && i <= 47 ? PREFECTURES[i - 1] : null;
}

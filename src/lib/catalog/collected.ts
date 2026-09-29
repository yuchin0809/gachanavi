/**
 * 収集データ（data/collected/*.json）をアプリの型に変換する。
 *
 * 将来の Firestore 投入スクリプトと、ローカル確認用のデータソース（DATA_SOURCE=local）で共通に使う。
 * ID は公式の識別子から作る（再収集・再投入しても同じ ID になる）。設計は data/collected/validation/REPORT.md 参照。
 * Firestore にはアクセスしない（純粋な変換のみ）。
 */
import { createHash } from "node:crypto";
import { isValidMonth } from "@/lib/release";
import type { GachaProduct, Location } from "@/types";

/** data/collected/products.json の1件（使う項目のみ） */
export interface CollectedProduct {
  id: string;
  name: string;
  maker: string;
  brand?: string | null;
  series?: string | null;
  tags?: string[] | null;
  janCode?: string | null;
  makerItemCode?: string | null;
  releaseYearMonth?: string | null;
  releaseText?: string | null;
  price?: number | null;
  priceText?: string | null;
  priceTaxIncluded?: boolean | null;
  lineupCount?: string | null;
  description?: string | null;
  officialUrl?: string | null;
  imageUrl?: string | null;
  sourceUrl: string;
  fetchedAt?: string | null;
}

/** data/collected/locations.json の1件（使う項目のみ） */
export interface CollectedLocation {
  id: string;
  name: string;
  address: string;
  prefecture?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  openingHours?: string | null;
  sources?: { name?: string | null; url?: string | null; shopCode?: string | null }[];
}

const MAKER_SLUG: Record<string, string> = {
  バンダイ: "bandai",
  タカラトミーアーツ: "tta",
  キタンクラブ: "kitan",
  アイピーフォー: "ip4",
  ブシロードクリエイティブ: "bushi",
  Qualia: "qualia",
  "スタンド・ストーンズ": "stasto",
  "SO-TA": "sota",
  トイズキャビン: "toyscabin",
  トイズスピリッツ: "toysp",
  Jドリーム: "jdream",
};

/** src/app/actions/stockReports.ts の ID 検証と同じ形式（placements の ID にも使うため 120 文字以内） */
const ID_OK = /^[A-Za-z0-9_-]{1,120}$/;

const shortHash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

function nfkc(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC");
}

function lastPathSegment(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const seg = decodeURIComponent(new URL(url).pathname).replace(/\/+$/, "").split("/").pop() ?? "";
    return seg.replace(/\.(php|html?)$/, "");
  } catch {
    return "";
  }
}

/** 商品 ID（例: bandai-4570118187086000 / tta-Y907104 / kitan-aip_moomin2） */
export function productIdOf(p: CollectedProduct): string {
  const m = MAKER_SLUG[p.maker] ?? "maker";
  const url = p.officialUrl ?? "";
  if (p.maker === "バンダイ") {
    const jan = /jan_code=(\d+)/.exec(url);
    if (jan) return `${m}-${jan[1]}`;
  }
  if (p.makerItemCode && ID_OK.test(`${m}-${p.makerItemCode}`)) return `${m}-${p.makerItemCode}`;
  if (p.maker === "Jドリーム" && p.janCode) return `${m}-${p.janCode}`;
  const slug = lastPathSegment(url);
  if (slug && ID_OK.test(`${m}-${slug}`)) return `${m}-${slug}`;
  return `${m}-h${shortHash(p.sourceUrl)}`;
}

/** 店舗 ID（例: gp-S90000893 / bnam-gbo-shijonawate / coco-1951 / dream-79 / loc-h…） */
export function locationIdOf(l: CollectedLocation): string {
  const sources = l.sources ?? [];
  const gp = sources.find((s) => s.shopCode && (s.url ?? "").includes("gashapon.jp"));
  if (gp?.shopCode && ID_OK.test(`gp-${gp.shopCode}`)) return `gp-${gp.shopCode}`;
  for (const s of sources) {
    const url = s.url ?? "";
    let m = /bandainamco-am\.co\.jp\/others\/(gashapon-bandai-officialshop|capsule-toy-store)\/store\/([^/]+)\//.exec(url);
    if (m && ID_OK.test(`bnam-x-${m[2]}`)) return `bnam-${m[1].startsWith("gashapon") ? "gbo" : "dept"}-${m[2]}`;
    m = /gashacoco\.jp\/shop-list\/(\d+)/.exec(url);
    if (m) return `coco-${m[1]}`;
    m = /dreamcapsule\.co\.jp\/shop\/(\d+)/.exec(url);
    if (m) return `dream-${m[1]}`;
  }
  const key = `${nfkc(l.address).replace(/\s+/g, "")}|${nfkc(l.name).replace(/\s+/g, "")}`;
  return `loc-h${shortHash(key)}`;
}

/** 「2026年9月28日週再発売」「再販 2026年9月」などから再発売の年月（最も新しいもの） */
export function resaleMonthOf(text: string | null | undefined): string | null {
  const t = nfkc(text);
  let latest: string | null = null;
  for (const m of t.matchAll(/(20\d{2})年(\d{1,2})月(?:\d{1,2}日週)?(?:再発売|再販|再出荷)/g)) {
    const month = `${m[1]}-${m[2].padStart(2, "0")}`;
    if (isValidMonth(month) && (!latest || month > latest)) latest = month;
  }
  return latest;
}

/** http → https（対象ホストは https で取得できることを確認済み）、仮画像は null */
function normalizeUrl(url: string | null | undefined, { placeholderToNull = false } = {}): string | null {
  if (!url) return null;
  if (placeholderToNull && /(noimage|no_image|now_printing)/i.test(url)) return null;
  try {
    const u = new URL(url);
    if (u.protocol === "http:") u.protocol = "https:";
    return u.toString(); // 日本語・空白を含むパスはエンコードされる
  } catch {
    return null;
  }
}

function cleanText(s: string | null | undefined): string {
  return (s ?? "").replace(/[ 　]+/g, " ").trim();
}

export function toGachaProduct(p: CollectedProduct): GachaProduct {
  const name = cleanText(p.name);
  const tags = new Set((p.tags ?? []).filter(Boolean));
  const label = /^\s*[【[]([^】\]]+)[】\]]/.exec(name);
  if (label) tags.add(label[1]); // 【再販】【フラットガシャポン】などの区分もタグとして検索できるようにする
  if (p.brand) tags.add(p.brand);
  return {
    id: productIdOf(p),
    name,
    series: cleanText(p.series),
    maker: p.maker,
    price: typeof p.price === "number" && Number.isFinite(p.price) && p.price > 0 ? p.price : null,
    priceTaxIncluded: typeof p.priceTaxIncluded === "boolean" ? p.priceTaxIncluded : null,
    releaseMonth: isValidMonth(p.releaseYearMonth) ? p.releaseYearMonth : null,
    resaleMonth: resaleMonthOf(p.releaseText),
    imageUrl: normalizeUrl(p.imageUrl, { placeholderToNull: true }),
    description: (p.description ?? "").trim(),
    characters: [],
    tags: [...tags],
    officialUrl: normalizeUrl(p.officialUrl),
    sourceUrl: normalizeUrl(p.sourceUrl),
    fetchedAt: p.fetchedAt ?? null,
    lineupCount: p.lineupCount ?? null,
  };
}

export function toLocation(l: CollectedLocation): Location {
  const coord = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const lat = coord(l.lat);
  const lng = coord(l.lng);
  return {
    id: locationIdOf(l),
    name: cleanText(l.name).replace(/^[＃♯]/, "#"),
    address: nfkc(l.address).replace(/\s+/g, " ").trim(),
    area: l.city ?? l.prefecture ?? "",
    // 片方だけの座標は使わない
    lat: lat !== null && lng !== null ? lat : null,
    lng: lat !== null && lng !== null ? lng : null,
    openingHours: l.openingHours ?? null,
  };
}

/**
 * 開発用モックデータ。
 *
 * モックデータはすべてこのファイルに集約している。
 * 商品名・メーカー・店舗名・住所はすべて架空のもの。
 *
 * 「〇分前に確認」を自然に見せるため、日時は「現在時刻からの差分」で定義し、
 * createMockDatabase(now) を呼んだ時点で ISO 文字列に変換する。
 */
import { placementIdOf } from "@/lib/data/source";
import type {
  GachaProduct,
  GeoPoint,
  Location,
  Placement,
  ReportableStockStatus,
  StockReport,
  User,
} from "@/types";

export const mockProducts: GachaProduct[] = [
  {
    id: "p-001",
    name: "ねこだんご ミニフィギュア",
    series: "ねこだんご",
    maker: "カプセルワークス",
    price: 300,
    releaseMonth: "2026-09",
    imageUrl: "/images/gacha/p-001.svg",
    description:
      "お団子のように丸まった猫たちの手のひらサイズフィギュア。全5種。並べて飾るとさらにかわいい。",
    characters: ["みけだんご", "しろだんご", "くろだんご", "さばだんご", "ちゃだんご"],
    tags: ["猫", "ねこ", "フィギュア", "動物"],
  },
  {
    id: "p-002",
    name: "ミニチュア喫茶 ナポリタンセット",
    series: "昭和レトロ喫茶",
    maker: "ポケットファクトリー",
    price: 400,
    releaseMonth: "2026-08",
    imageUrl: "/images/gacha/p-002.svg",
    description:
      "喫茶店の定番メニューを精巧に再現したミニチュア。ナポリタン、クリームソーダ、プリンなど全6種。",
    characters: [],
    tags: ["ミニチュア", "食品サンプル", "レトロ", "喫茶"],
  },
  {
    id: "p-003",
    name: "宇宙ペンギン隊 ラバーマスコット",
    series: "宇宙ペンギン隊",
    maker: "スターカプセル",
    price: 300,
    releaseMonth: "2026-09",
    imageUrl: "/images/gacha/p-003.svg",
    description:
      "宇宙服を着たペンギンたちのラバーマスコット。ボールチェーン付き。シークレットあり。",
    characters: ["ペンタ隊長", "ギンちゃん", "コウテイ博士"],
    tags: ["ペンギン", "宇宙", "ラバーマスコット", "キーホルダー"],
  },
  {
    id: "p-004",
    name: "ぷにぷに恐竜 キーチェーン",
    series: "ディノパーク",
    maker: "カプセルワークス",
    price: 200,
    releaseMonth: "2026-07",
    imageUrl: "/images/gacha/p-004.svg",
    description: "やわらか素材の恐竜キーチェーン。ティラノ、トリケラ、ステゴなど全5種。",
    characters: ["ティラノ", "トリケラ", "ステゴ"],
    tags: ["恐竜", "キーチェーン", "スクイーズ"],
  },
  {
    id: "p-005",
    name: "ちいさな文房具店",
    series: "ミニチュア文具コレクション",
    maker: "ポケットファクトリー",
    price: 500,
    releaseMonth: "2026-06",
    imageUrl: "/images/gacha/p-005.svg",
    description: "実際に書ける極小鉛筆や、開閉できるペンケースなど。文房具好きのためのミニチュア。",
    characters: [],
    tags: ["ミニチュア", "文房具", "文具"],
  },
  {
    id: "p-006",
    name: "ロボ侍 可動フィギュア",
    series: "ロボ侍",
    maker: "メカトイ研究所",
    price: 500,
    releaseMonth: "2026-09",
    imageUrl: "/images/gacha/p-006.svg",
    description: "関節が動く侍ロボットのフィギュア。刀・兜のパーツ付き。全4種。",
    characters: ["ムサシ", "コジロウ", "カゲマル", "ベニヒメ"],
    tags: ["ロボット", "フィギュア", "可動", "侍"],
  },
  {
    id: "p-007",
    name: "おにぎり妖精 ぷちマスコット",
    series: "おにぎり妖精",
    maker: "スターカプセル",
    price: 300,
    releaseMonth: "2026-05",
    imageUrl: "/images/gacha/p-007.svg",
    description: "具材ごとに性格が違うおにぎりの妖精たち。うめ、しゃけ、ツナマヨなど全6種。",
    characters: ["うめぼうや", "しゃけひめ", "ツナマヨ"],
    tags: ["おにぎり", "食べ物", "マスコット"],
  },
  {
    id: "p-008",
    name: "深海いきもの図鑑 ソフビ",
    series: "深海いきもの図鑑",
    maker: "メカトイ研究所",
    price: 400,
    releaseMonth: "2026-08",
    imageUrl: "/images/gacha/p-008.svg",
    description: "リアル造形の深海生物ソフビ。メンダコ、ダイオウグソクムシ、チョウチンアンコウなど。",
    characters: ["メンダコ", "ダイオウグソクムシ", "チョウチンアンコウ"],
    tags: ["深海", "生き物", "ソフビ", "リアル"],
  },
  {
    id: "p-009",
    name: "駅名標キーホルダー 環状線編",
    series: "鉄道コレクション",
    maker: "ポケットファクトリー",
    price: 300,
    releaseMonth: "2026-04",
    imageUrl: "/images/gacha/p-009.svg",
    description: "架空の環状線の駅名標をアクリルキーホルダーにしました。全10種。",
    characters: [],
    tags: ["鉄道", "電車", "駅", "キーホルダー"],
  },
  {
    id: "p-010",
    name: "ふわもこアルパカ 寝そべりぬいぐるみ",
    series: "ふわもこアルパカ",
    maker: "スターカプセル",
    price: 500,
    releaseMonth: "2026-09",
    imageUrl: "/images/gacha/p-010.svg",
    description: "手のひらサイズの寝そべりアルパカ。ふわふわの手触り。全4色。",
    characters: ["ミルク", "ココア", "ショコラ", "ミント"],
    tags: ["アルパカ", "ぬいぐるみ", "動物", "ふわふわ"],
  },
];

export const mockLocations: Location[] = [
  {
    id: "l-001",
    name: "ガチャステーション 渋谷センター街店",
    address: "東京都渋谷区宇田川町 0-0-1（デモ住所）",
    area: "渋谷",
    lat: 35.6604,
    lng: 139.6983,
    openingHours: "10:00〜22:00",
  },
  {
    id: "l-002",
    name: "カプセルの森 原宿店",
    address: "東京都渋谷区神宮前 0-0-2（デモ住所）",
    area: "原宿",
    lat: 35.6702,
    lng: 139.7027,
    openingHours: "11:00〜20:00",
  },
  {
    id: "l-003",
    name: "ガチャガチャ広場 新宿東口",
    address: "東京都新宿区新宿 0-0-3（デモ住所）",
    area: "新宿",
    lat: 35.6917,
    lng: 139.7006,
    openingHours: "10:00〜23:00",
  },
  {
    id: "l-004",
    name: "カプセルパーク 池袋サンシャイン通り",
    address: "東京都豊島区東池袋 0-0-4（デモ住所）",
    area: "池袋",
    lat: 35.7295,
    lng: 139.7109,
    openingHours: "10:00〜21:00",
  },
  {
    id: "l-005",
    name: "ガチャステーション 秋葉原電気街店",
    address: "東京都千代田区外神田 0-0-5（デモ住所）",
    area: "秋葉原",
    lat: 35.6989,
    lng: 139.7731,
    openingHours: "10:00〜21:00",
  },
  {
    id: "l-006",
    name: "ショッピングモール恵比寿 2F ガチャコーナー",
    address: "東京都渋谷区恵比寿 0-0-6（デモ住所）",
    area: "恵比寿",
    lat: 35.6467,
    lng: 139.7101,
    openingHours: "10:00〜20:00",
  },
  {
    id: "l-007",
    name: "カプセルの森 下北沢店",
    address: "東京都世田谷区北沢 0-0-7（デモ住所）",
    area: "下北沢",
    lat: 35.6613,
    lng: 139.668,
    openingHours: "12:00〜21:00",
  },
  {
    id: "l-008",
    name: "東京駅 地下街 ガチャスポット",
    address: "東京都千代田区丸の内 0-0-8（デモ住所）",
    area: "東京駅",
    lat: 35.6812,
    lng: 139.7671,
    openingHours: "9:00〜21:00",
  },
];

/** 開発用の基準地点（渋谷駅周辺）。位置情報の取得を実装するまではここを現在地とみなす */
export const mockCurrentPosition: GeoPoint & { label: string } = {
  label: "渋谷駅周辺",
  lat: 35.658,
  lng: 139.7016,
};

export const mockUsers: User[] = [
  { id: "u-001", displayName: "ガチャ探検隊", createdAt: "2026-01-10T09:00:00.000Z" },
  { id: "u-002", displayName: "カプセル好き", createdAt: "2026-03-02T12:00:00.000Z" },
  { id: "u-003", displayName: "ミニチュア収集家", createdAt: "2026-05-21T18:30:00.000Z" },
];

/** 開発中にUIから報告する際のログインユーザー（認証実装までの仮ユーザー） */
export const mockCurrentUserId = "u-001";

/** [productId, locationId, 設置確認からの経過日数] */
const placementSeeds: [string, string, number][] = [
  ["p-001", "l-001", 5],
  ["p-001", "l-002", 4],
  ["p-001", "l-003", 6],
  ["p-001", "l-005", 3],
  ["p-001", "l-006", 2],
  ["p-001", "l-008", 7],
  ["p-002", "l-001", 20],
  ["p-002", "l-004", 18],
  ["p-002", "l-007", 25],
  ["p-003", "l-002", 3],
  ["p-003", "l-003", 3],
  ["p-003", "l-005", 2],
  ["p-003", "l-007", 1],
  ["p-004", "l-001", 40],
  ["p-004", "l-004", 45],
  ["p-004", "l-006", 38],
  ["p-004", "l-008", 50],
  ["p-005", "l-003", 70],
  ["p-005", "l-005", 65],
  ["p-006", "l-005", 6],
  ["p-006", "l-004", 5],
  ["p-006", "l-003", 4],
  ["p-007", "l-002", 100],
  ["p-007", "l-006", 95],
  ["p-007", "l-008", 90],
  ["p-008", "l-004", 30],
  ["p-008", "l-005", 28],
  ["p-008", "l-001", 26],
  ["p-009", "l-008", 140],
  ["p-009", "l-003", 150],
  ["p-010", "l-001", 2],
  ["p-010", "l-002", 1],
  ["p-010", "l-007", 3],
  ["p-010", "l-006", 2],
];

/** [productId, locationId, status, 報告からの経過分数, userId] */
const reportSeeds: [string, string, ReportableStockStatus, number, string][] = [
  ["p-001", "l-001", "in_stock", 12, "u-002"],
  ["p-001", "l-001", "in_stock", 95, "u-003"],
  ["p-001", "l-002", "low", 34, "u-001"],
  ["p-001", "l-003", "sold_out", 120, "u-002"],
  ["p-001", "l-003", "low", 300, "u-003"],
  ["p-001", "l-005", "in_stock", 48, "u-003"],
  ["p-001", "l-006", "sold_out", 8, "u-002"],
  ["p-002", "l-001", "low", 180, "u-001"],
  ["p-002", "l-004", "in_stock", 60 * 26, "u-003"],
  ["p-003", "l-002", "in_stock", 5, "u-001"],
  ["p-003", "l-003", "low", 22, "u-002"],
  ["p-003", "l-005", "sold_out", 70, "u-003"],
  ["p-003", "l-007", "in_stock", 140, "u-002"],
  ["p-004", "l-001", "in_stock", 60 * 5, "u-003"],
  ["p-004", "l-006", "in_stock", 60 * 30, "u-001"],
  ["p-005", "l-005", "low", 60 * 50, "u-002"],
  ["p-006", "l-005", "in_stock", 15, "u-003"],
  ["p-006", "l-004", "low", 55, "u-001"],
  ["p-006", "l-003", "sold_out", 200, "u-002"],
  ["p-007", "l-002", "in_stock", 60 * 8, "u-002"],
  ["p-008", "l-004", "in_stock", 90, "u-001"],
  ["p-008", "l-001", "sold_out", 60 * 3, "u-002"],
  ["p-010", "l-001", "low", 18, "u-003"],
  ["p-010", "l-002", "in_stock", 3, "u-002"],
  ["p-010", "l-007", "sold_out", 42, "u-001"],
  ["p-010", "l-006", "in_stock", 75, "u-003"],
];

export interface MockDatabase {
  products: GachaProduct[];
  locations: Location[];
  placements: Placement[];
  stockReports: StockReport[];
  users: User[];
}

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** 基準時刻 now に対する相対日時で、モックの設置情報・在庫報告を生成する */
export function createMockDatabase(now: Date): MockDatabase {
  const t = now.getTime();
  return {
    products: mockProducts,
    locations: mockLocations,
    users: mockUsers,
    placements: placementSeeds.map(([productId, locationId, daysAgo]) => ({
      id: placementIdOf(productId, locationId),
      productId,
      locationId,
      firstSeenAt: new Date(t - daysAgo * DAY).toISOString(),
    })),
    stockReports: reportSeeds.map(([productId, locationId, status, minutesAgo, userId], i) => ({
      id: `sr-${String(i + 1).padStart(3, "0")}`,
      productId,
      locationId,
      userId,
      status,
      reportedAt: new Date(t - minutesAgo * MINUTE).toISOString(),
    })),
  };
}

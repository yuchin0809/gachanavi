# 設置情報（placements）の出典とデータソース

GachaNavi の「このガチャ、どこの店舗にある？」を支える設置情報（placements）を、
正式に利用できるデータだけで増やしていくための設計メモ（2026-09-30 時点）。

- 本書は設計・方針のみ。既存データの変更は行っていない（2 章の `source` のうち、ユーザー報告で新しく作る設置情報の `"user_report"` だけを実装済み。docs/favorites-and-stock-alerts.md）
- placement = 「この商品がこの店舗に設置・取扱いされていることが確認された」。在庫の有無は意味しない
- 在庫の状態は stockReports（ユーザーの在庫報告）と placements.latestStock のキャッシュで扱う（報告が無ければ「未確認」）

## 1. 保留中の候補データ

公式情報から確認した 72 件の候補は、データ利用の許諾が得られていないため**登録を保留**している。

| 項目 | 内容 |
|---|---|
| 保存場所 | `data/placements/on-hold/2026-09-30-official-candidates.json`（同じ内容の CSV あり） |
| 状態 | ファイル全体に `"status": "on_hold"`, `"doNotImport": true`、各件にも `"status": "on_hold"` |
| 各件の項目 | placementId・productId・productName・maker・locationId・locationName・officialShopName（公式表記）・prefecture・source・sourceName・sourceUrl・sourceCheckedAt・sourceNote・matchMethod・holdReason・termsUrl |
| 検証結果 | 商品 ID・店舗 ID は実在、名称一致、候補内の重複 0、本番との重複 0（2026-09-30T14:04:59Z に ID 指定の読み取りで確認） |

| 出典 | 件数 | 保留理由 |
|---|---:|---|
| gashapon.jp「この商品が売っているお店」（バンダイ） | 40 | 「本サイトに掲載されている全ての画像、文章、データの無断転用、転載をお断りします。」 |
| タカラトミーアーツ「ガチャ™取扱店舗」 | 7 | 「データなどすべての情報について、無断で転用、転載することはご遠慮ください。」 |
| Qualia 商品ページ「販売店舗マップ」 | 25 | データ利用を明確に許可する規約が無い（禁止の記載も無い） |

許諾を得られた出典の分だけ、将来 2 章の出典情報を付けて登録する（許諾の範囲・条件・連絡記録も合わせて残す）。
店舗の在庫・設置は変わるため、登録時には改めて公式情報を確認し、`sourceCheckedAt` を更新してから登録する。

## 2. 出典情報の保存方法（案）

placements ドキュメントに、任意の出典フィールドを追加する。**既存の項目は変えない**。
アプリの読み込み（`placementFromDoc`）は知らない項目を無視するため、追加しても既存の表示・データに影響しない。

```ts
// placements/{productId}__{locationId}
interface PlacementDoc {
  productId: string;
  locationId: string;
  firstSeenAt: Timestamp;
  latestStock: LatestStockDoc | null; // 在庫の状態（報告が無ければ null = 未確認）

  // ↓ 追加する出典情報（すべて任意。既存のドキュメントには無くてよい）
  source?: "user_report" | "official_licensed" | "operator" | "open_data";
  sourceName?: string;       // 例: "GachaNavi ユーザー報告" / "〇〇社 取扱店舗一覧（2026年◯月 許諾）"
  sourceUrl?: string | null; // 公式ページなど（ユーザー報告は null）
  sourceCheckedAt?: Timestamp; // 出典で最後に確認した日時
  sourceNote?: string;       // 確認方法・許諾の範囲など（個人を特定する情報は入れない）
}
```

| source | 意味 | 登録する人 |
|---|---|---|
| `user_report` | GachaNavi のユーザーが店舗で確認して報告した | 在庫報告（この店で見つけた）から自動 |
| `official_licensed` | 利用許諾を得たメーカー・店舗の公式情報 | 管理者のスクリプト（許諾の記録が必須） |
| `operator` | GachaNavi の運営者が店舗で直接確認した | 管理者のスクリプト |
| `open_data` | 二次利用が明確に許可されたオープンデータ | 管理者のスクリプト（ライセンス表記を守る） |

- 1 つの placement に複数の出典がある場合（例: ユーザー報告の後に公式情報でも確認）は、`source` は最初に作成した出典のまま残し、
  確認の履歴は 4 章の confirmations で持つ（出典を配列にしてドキュメントを肥大化させない）
- 公開画面には出典の種類と確認日時だけを出す。報告者の uid などは placements に書かない
- 導入時は型（`src/lib/data/firestore/schema.ts`）に任意項目を足し、既存ドキュメントの一括更新はしない（書き込みを増やさない）

## 3. 許可なしで使える可能性があるデータソース

| データソース | 設置情報に使えるか | 根拠・条件 |
|---|---|---|
| **GachaNavi ユーザーの在庫報告・「この店で見つけた」** | **使える（推奨・主軸）** | GachaNavi 自身が取得するデータ。ただし**利用規約とプライバシーポリシーの整備が前提**（投稿内容を GachaNavi が掲載・利用できること、報告者を公開しないこと）。現在アプリに利用規約のページは無い |
| **運営者（GachaNavi）が店舗で直接確認した情報** | **使える** | 自ら確認した事実。確認日時・確認者（内部記録）を残す。店舗内の撮影は店舗の許可が必要なため、写真は使わない |
| 店舗・メーカーから直接提供された情報（許諾・提携） | 使える（許諾があれば） | 契約・許諾の範囲内。許諾の記録を残す。保留中の 72 件もこの形で許諾が得られれば登録できる |
| OpenStreetMap | 店舗の所在地のみ（設置情報には使えない） | ODbL。「© OpenStreetMap contributors」のクレジットが必要。派生データベースを公開する場合は同じライセンスでの提供が必要になる（https://www.openstreetmap.org/copyright/ja）。商品×店舗の情報は含まれない |
| プレスリリース（PR TIMES など） | 不明（許諾なしでは使わない） | 掲載内容の権利は投稿企業に帰属し、PR TIMES の利用規約は「データの全部または一部を複製、改変または二次利用する行為」を禁止事項としている（https://prtimes.jp/main/html/kiyaku） |
| メーカー・店舗の公式サイト（gashapon.jp・タカラトミーアーツ・Qualia など） | 許諾が得られるまで使わない | 1 章のとおり |
| 第三者のまとめサイト・SNS・検索結果 | 使わない | 正確性・権利の両面で根拠にならない |

## 4. ユーザー確認型 placement の設計案

ユーザーが実際に店舗で見て報告した設置情報を、信頼度付きで蓄積する。写真機能は使わない（実装しない）。

### 4.1 現状

- 「この店で見つけた」／在庫報告（`addStockReport`）は、設置情報が無い「商品×店舗」に最初の報告があると placement を作成し、以降は `latestStock` を更新する
- 同じユーザー・同じ「商品×店舗」は 10 分に 1 回まで（`users/{uid}/reportThrottles`）
- 報告者は匿名認証の uid（サーバーで ID トークンを検証）。stockReports に uid が残る（公開はしない）

### 4.2 追加する情報（placements）

```ts
source: "user_report";          // 最初の報告で作成された placement
sourceName: "GachaNavi ユーザー報告";
sourceCheckedAt: Timestamp;     // 最後に「設置あり」と報告された日時
confirmations: {
  total: number;                // 「設置あり」の報告回数（在庫あり・残りわずか・売り切れを含む）
  reporters: number;            // 報告したユーザーの人数（重複しない）
  lastNotFoundAt?: Timestamp;   // 「設置されていなかった」の最後の報告
  notFound: number;             // 「設置されていなかった」の報告人数（最後の設置報告より後のもの）
};
hidden?: boolean;               // 運営者が非表示にした（誤報告・いたずら）
```

- 人数を数えるため `placements/{id}/reporters/{uid}`（1 ユーザー 1 ドキュメント、中身は最終報告日時のみ）を使う。
  初めてのユーザーの報告だけ書き込みが 1 件増える。公開画面からは読めない（Security Rules で拒否。サーバー経由のみ）
- 売り切れは「設置あり・在庫なし」。**「設置されていなかった（撤去）」は売り切れと別の報告**にする

### 4.3 信頼度と表示

| 状態 | 条件（案） | 表示 |
|---|---|---|
| 未確認の報告 | 報告者 1 人 | 「1人が確認」＋最終確認日時 |
| 確認済み | 30 日以内に 2 人以上 | 「3人が確認・2日前」 |
| 古い情報 | 最後の設置報告から 60 日以上 | 薄く表示「情報が古い可能性」 |
| 撤去の可能性 | 最後の設置報告より後に「設置されていなかった」が 2 人以上 | 一覧の後ろに「撤去の可能性」 |
| 非表示 | `hidden: true` | 表示しない |

在庫の表示（在庫あり / 残りわずか / 売り切れ / 未確認）は今までどおり `latestStock` から出し、設置の信頼度とは別に表示する。

### 4.4 不正・誤報告への対策

- 既存: 匿名認証の ID トークン検証、同じ「商品×店舗」は 10 分に 1 回
- 追加: 1 ユーザーが新しく作れる placement は 1 日 20 件まで（`users/{uid}` に日別カウント）
- 追加: 運営者の非表示（`hidden`）と、報告の取り消し（該当ユーザーの報告を集計から外す）
- 位置情報はサーバーに送らない方針のため、距離による検証はしない（信頼度は人数と期間で判断）

### 4.5 読み書きの見積もり（Spark プラン）

- 報告 1 件: 読み取り 4 件（placement・user・連投制限・reporters/{uid}）＋ 新規の商品×店舗は +2 件
- 書き込み: 報告・latestStock/confirmations 更新・連投制限・（初回のみ）users・（初めての報告者のみ）reporters の最大 5 件、新規 placement は +1
- 表示側は変わらない（商品詳細・店舗詳細は placements を商品・店舗で絞って読むだけ。confirmations は placement に含める）

### 4.6 導入の順序

1. 利用規約・プライバシーポリシーを作成し、報告画面から参照できるようにする（投稿の扱い・非公開の範囲）
2. `schema.ts` に出典・confirmations の任意項目を追加（既存ドキュメントの一括更新はしない。無い場合は「1人が確認」相当として表示）
3. `addStockReport` で source / sourceCheckedAt / confirmations / reporters を更新（Emulator の統合テストで確認）
4. 「設置されていなかった」の報告を追加（在庫報告とは別のボタン）
5. 商品詳細・店舗詳細に信頼度の表示を追加
6. 管理者向けの非表示・取り消しの手順（スクリプト）を用意

## 5. やらないこと

- 推測による placement の作成、全商品×全店舗の総当たり、Firestore の大量読み書き
- 許諾の無い公式情報・第三者サイト・SNS・検索結果を根拠にした登録
- ユーザー写真の機能（今回は実装しない）

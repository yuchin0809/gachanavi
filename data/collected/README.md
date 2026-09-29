# GachaNavi 初期データ（収集結果・中間データ）

Firestore へ投入する前の確認用データです。**まだ Firestore には投入していません。**

| ファイル | 内容 |
|---|---|
| `products.json` | ガチャ商品（重複排除・検証済み） |
| `locations.json` | ガチャ店舗・設置スポット（重複排除・検証済み） |
| `excluded.json` | 除外したレコードと理由（重複・情報不足・対象外） |
| `report.json` | 件数の集計（メーカー別・都道府県別など） |
| `raw/*.jsonl` | 情報源ごとの生データ（1 行 1 レコード） |
| `cache/gsi_geocode.json` | 国土地理院 住所検索 API の結果キャッシュ |
| `logs/` | 収集ログ |

再作成: `cd scripts/collect && python3 <収集スクリプト>.py` → `python3 build.py`
（取得済みページは `.collect-cache/` にキャッシュされ、再取得しません）

## 収集方針

- 各サイトへのアクセスは同一ホストにつき 1 秒 1 リクエスト以下。robots.txt で禁止されたパスは取得しない
- 商品名・住所などは公式ページの記載をそのまま使い、推測で補わない
- **「この店舗のこの筐体にこの商品が入っている」情報は収集していない**
  （gashapon.jp の店舗別在庫ページ、Qualia の商品別「販売店舗マップ」などは取得対象外）
- すべてのレコードに情報源 URL（`sourceUrl` / `sources`）と取得日時（`fetchedAt`, UTC）を記録
- `sourceType`: `official` = メーカー・店舗運営会社の公式サイト。今回は第三者サイトの情報は使っていない

## products.json の項目

| 項目 | 説明 |
|---|---|
| `id` | メーカー略号 + 情報源 URL のハッシュ（再作成しても同じ値） |
| `name` / `maker` | 商品名 / メーカー |
| `brand` | ブランド・カテゴリ（例: ガシャポン / フラット / プレミアム / ガチャ™） |
| `series` | 公式にシリーズ名が示されている場合のみ（スタンド・ストーンズのシリーズ分類など）。無い場合は null |
| `tags` | 公式ページのタグ・キャラクター分類 |
| `janCode` / `makerItemCode` | JAN コード / メーカーの商品コード（公開されている場合） |
| `releaseYearMonth` | 発売年月 `YYYY-MM` |
| `releaseDate` | 日付まで明記されている場合のみ `YYYY-MM-DD`（週・旬のみの場合は null） |
| `releaseText` | 公式の発売時期の表記そのまま（例: 「2026年9月 第1週」「2025年4月中旬」） |
| `price` / `priceText` | 1 回の価格（円）/ 公式の価格表記そのまま。金額が 1 つに決まらない場合 `price` は null |
| `priceTaxIncluded` | 税込と明記されていれば true、不明は null |
| `lineupCount` | 種類数（例: 全5種） |
| `description` | 公式の商品説明文 |
| `officialUrl` / `sourceUrl` | 公式商品ページ / 情報源（Jドリームは個別ページが無いため一覧ページ + JAN） |
| `imageUrl` / `imageUrls` | 公式サイト上の商品画像 URL（画像そのものはダウンロードしていない） |
| `alsoListedAt` | 重複として統合した別の掲載 URL |

## locations.json の項目

| 項目 | 説明 |
|---|---|
| `name` / `chain` / `operator` | 店舗名 / チェーン名 / 運営会社 |
| `address` / `postalCode` / `prefecture` / `city` | 住所（公式表記のまま）/ 郵便番号 / 都道府県 / 市区町村 |
| `lat` / `lng` | 緯度・経度（下記の `coordinateSource` を必ず確認） |
| `coordinateSource` | `gashapon.jp店舗検索（公式データ）` / `公式サイトの地図マーカー` / `国土地理院 住所検索API（住所から算出）` |
| `coordinatePrecision` | `official`（公式の座標）/ `street`（番地まで一致）/ `town`（町・丁目まで一致） |
| `geocode` | 住所検索 API で一致した住所（`matchedAddress`）など |
| `mapEmbedLat` / `mapEmbedLng` | 公式店舗ページに埋め込まれた Google マップの表示位置（参考値。座標としては使っていない） |
| `openingHours` / `phone` / `machineCount` | 営業時間 / 電話番号 / 設置台数（公式に記載がある場合のみ） |
| `sources` | 情報源の一覧（統合した場合は複数）。各要素に URL・取得日時 |

## 注意

- 店舗情報・商品の発売時期は変わることがあります。`fetchedAt` の時点の情報です
- 住所から算出した座標（`coordinatePrecision` が `street` / `town`）は建物の入口とずれることがあります
- トイズキャビンの取扱店舗一覧は「取扱の多い店舗」をメーカーが掲載したもので、店舗の所在地としてのみ使っています

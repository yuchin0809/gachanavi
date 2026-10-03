# GachaNavi SEO チェックレポート

検索エンジンがページを発見・理解しやすくするための改善の記録です。
検索順位や流入数を保証するものではありません。

- 対象ブランチ: `claude/seo-improvements`（本番ブランチ `claude/keen-darwin-lgf0bs` には未反映）
- 本番 Firestore のデータ・Firestore Rules・Storage Rules・インデックス・FCM のロジックは変更していません。
- 確認には mock / local / Firestore エミュレータを使い、本番 Firestore へのアクセスはしていません。

---

## 1. 現在の SEO 状態

### 変更前

| 項目 | 状態 |
| --- | --- |
| title | サイト共通の既定値と、商品ページは商品名のみ |
| description | サイト共通の 1 文だけ（商品・店舗ごとの説明なし） |
| robots.txt / sitemap.xml | なし |
| canonical | なし |
| OGP / Twitter Card | なし |
| JSON-LD | なし |
| パンくず | なし（「戻る」リンクのみ） |
| 店舗一覧ページ | なし。店舗ページには商品ページからしか到達できない |
| 正規 URL の環境変数 | なし |
| Preview / 開発環境の noindex | なし |

### 変更後

- 商品ページ（23,464 件）と店舗ページ（1,796 件）が、サイトマップと内部リンクの両方から見つけられます。
- ページごとの title・description・canonical・OGP・JSON-LD・パンくずを出力します。
- 公開してよいのは本番環境だけです。Preview・開発・モックでは `noindex` と `Disallow: /` を返します。

### 公開の前提（人の作業が必要）

本番デプロイは Vercel Authentication で保護されていて、検索エンジンのクローラーが到達できない状態です。
`gachanavi.vercel.app` は別のサイトです。公開ドメインの割り当てについては [16. Vercel で必要な設定](#16-vercel-で必要な設定) を参照してください。

## 2. 今回変更したファイル

### 新規

| ファイル | 内容 |
| --- | --- |
| `src/lib/seo/site.ts` | 正規 URL（`siteUrl` / `absoluteUrl`）とインデックス可否（`isIndexable`） |
| `src/lib/seo/text.ts` | 商品・店舗の title / description、都道府県コード |
| `src/lib/seo/metadata.ts` | OGP の共通項目、既定の OGP 画像、`noindex, follow` |
| `src/lib/seo/sitemap.ts` | サイトマップ XML（urlset / sitemapindex）、分割の単位、キャッシュヘッダー |
| `src/lib/seo/jsonld.ts` | JSON-LD（Product / Store / BreadcrumbList） |
| `src/components/seo/JsonLd.tsx` | JSON-LD の `<script>`（`<` をエスケープ） |
| `src/components/layout/Breadcrumbs.tsx` | 表示用のパンくずと、同じ内容の BreadcrumbList |
| `src/app/robots.ts` | `/robots.txt` |
| `src/app/sitemap.xml/route.ts` | `/sitemap.xml`（サイトマップ インデックス） |
| `src/app/sitemaps/[name]/route.ts` | `/sitemaps/pages.xml`・`locations.xml`・`products-N.xml` |
| `src/app/gacha/[id]/opengraph-image.tsx`<br>`src/app/gacha/[id]/twitter-image.tsx` | 商品ページの OGP / X カード画像（オリジナルの商品ビジュアル） |
| `src/lib/visual/svgMarkup.ts` | 商品ビジュアル（React の SVG）を SVG 文字列にする（OGP 画像用） |
| `src/app/locations/page.tsx` | 店舗一覧（都道府県別） |
| `src/app/locations/prefecture/[code]/page.tsx` | 都道府県ごとの店舗一覧 |
| `public/og/gachanavi.png` | サイト共通の OGP 画像（1200×630。`scripts/build-icons.mjs` で生成） |
| `tests/seo.test.ts` | SEO のユニットテスト |
| `docs/seo-report.md` | このレポート |

### 変更

| ファイル | 内容 |
| --- | --- |
| `src/app/layout.tsx` | `generateMetadata`（metadataBase・title・description・robots・OGP・Twitter・Search Console の確認タグ） |
| `src/app/page.tsx` | canonical・og:url、h1 の下に説明文を 1 行追加 |
| `src/app/gacha/[id]/page.tsx` | metadata・パンくず・JSON-LD・見出し「このガチャの設置店舗」・「関連するガチャ」 |
| `src/app/locations/[id]/page.tsx` | metadata（canonical から `?product=` を除く）・パンくず・JSON-LD |
| `src/app/search/page.tsx` | 条件なしは index、検索条件付きは `noindex, follow` |
| `src/app/favorites/page.tsx` | `noindex, follow` |
| `src/components/layout/SiteFooter.tsx` | ガチャを探す・店舗一覧・お気に入りへのリンク |
| `src/components/location/ProductLocationsView.tsx` | 設置店舗が無いときの文言 |
| `src/lib/data/index.ts` | サイトマップ用データ、都道府県別店舗、関連商品、同名商品の判定（いずれもキャッシュ済みの索引だけを使う） |
| `src/lib/data/firestoreSource.ts` | Firestore で使えない ID（`__x__` など）は読まずに「見つからない」（500 ではなく 404 にする） |
| `scripts/build-icons.mjs` | `public/og/gachanavi.png` も生成（既存アイコンはバイト単位で同一のまま） |
| `README.md`・`.env.example` | SEO の環境変数と説明 |

## 3. metadata の仕様

`layout.tsx` の title テンプレートは「`%s｜GachaNavi`」です。

| ページ | title | description |
| --- | --- | --- |
| トップ `/` | GachaNavi（ガチャナビ）｜ガチャガチャの設置店舗・在庫情報を探せるサイト | サイトの説明（固定） |
| 商品 `/gacha/{id}` | `{商品名}｜設置店舗・在庫情報｜GachaNavi` | 下記の組み立て |
| 店舗 `/locations/{id}` | `{店舗名}｜ガチャガチャの設置情報｜GachaNavi` | 店舗名（住所）＋設置が報告されているガチャの種類数 |
| 店舗一覧 `/locations` | ガチャガチャの店舗一覧（都道府県別）｜GachaNavi | 固定 |
| 都道府県 `/locations/prefecture/{01-47}` | `{都道府県}のガチャガチャ設置店舗一覧｜GachaNavi` | 都道府県名＋店舗数 |
| 検索 `/search`（条件なし） | ガチャを探す（ガチャガチャ・カプセルトイ検索）｜GachaNavi | 固定 |
| 検索（条件付き） | 「{q}」のガチャ検索結果｜GachaNavi | 既定（noindex） |
| お気に入り | お気に入り｜GachaNavi | 既定（noindex） |

### 商品の title

- 商品名は 48 文字で切り詰めます（「…」を付けます）。
- 同じ名前の商品があるとき（再販・別バージョン）だけ、`（2026年9月発売）` のように発売時期を添えます。判定にはカタログ索引を使い、読み取りは増えません。
- エミュレータの全カタログ（23,464 件）で、同名の商品がある title は 443 件から 8 件に減りました。残る 8 件（4 組）は、名前・発売月・価格が同じものが元データに 2 件ずつあるケースです。

### 商品の description

最大 160 文字で、実際のデータだけから組み立てます。

1. 「「{商品名}」の設置店舗と在庫情報。」
2. メーカー・1回{価格}・{発売年月}発売・{再販年月}再販・{種類数} のうち、分かっているものだけ。
3. 設置店舗について、次のどちらか。
   - 「{N}店舗で設置が報告されています。」
   - 「現在、設置店舗の情報は登録されていません。」
4. 「ガチャガチャ（カプセルトイ）の設置場所をGachaNaviで確認できます。」

- 「在庫あり」「販売中」など、確認していない状態は書きません。
- 全カタログの description は 23,463 種類です（重複 1 組は上記と同じ二重データ）。
- AI による文章生成はしていません。

### 店舗 metadata の注意

店舗の metadata にはデータにある店舗名・住所だけを使います。利用者の現在地や報告者の情報は含めません。

### 共通

- `metadataBase` は `siteUrl()` です。
- `GOOGLE_SITE_VERIFICATION` があれば `google-site-verification` を出力します。
- `appleWebApp` とアイコンの設定はそのままです。

## 4. sitemap の構造

```
/sitemap.xml                    サイトマップ インデックス
  /sitemaps/pages.xml           / ・ /search ・ /locations ・ /locations/prefecture/{01-47}（店舗がある都道府県のみ）
  /sitemaps/locations.xml       /locations/{id}（店舗の索引のすべて）
  /sitemaps/products-1.xml      /gacha/{id}（カタログ索引の 1〜10,000 件目）
  /sitemaps/products-2.xml      （10,001〜20,000 件目）
  /sitemaps/products-3.xml      （20,001 件目〜）
```

- 1 ファイルあたり 10,000 URL です（Google の上限は 50,000 URL / 50MB）。23,464 件なら 3 ファイルになり、商品が増えれば自動で増えます。
- URL の一覧は、ページに表示している一覧と同じカタログ索引（`catalogIndex`）と店舗の索引から作ります。
  - `isSample` のサンプルデータ、存在しない商品、mock の商品は含みません。
  - mock / local では、そもそも公開しません。
- `lastmod` は、その商品・店舗の最新の在庫報告日時（ページの「最終確認」と同じ値）です。報告が無いものには付けません。リクエスト時刻を `lastmod` にすることはしません。
- `changefreq` / `priority` は Google が使わないため付けていません。
- サイトマップはリクエスト時に生成します（`force-dynamic`）。ビルド時には Firestore を読みません。
- レスポンスヘッダーは `Cache-Control: public, max-age=0, s-maxage=3600, stale-while-revalidate=86400` で、CDN に 1 時間キャッシュされます。
- 範囲外の `products-0.xml` / `products-4.xml` や不明な名前は 404 です。本番以外ではすべて 404 です。

## 5. robots.txt

本番（インデックス可）:

```
User-Agent: *
Allow: /
Disallow: /api/

Sitemap: https://{本番ドメイン}/sitemap.xml
```

本番以外（Preview・開発・mock・local）:

```
User-Agent: *
Disallow: /
```

## 6. canonical

- 絶対 URL のホストは次の優先順で決まります。Preview の URL は使いません。
  1. `NEXT_PUBLIC_SITE_URL`
  2. `VERCEL_PROJECT_PRODUCTION_URL`（Vercel のシステム環境変数。Preview でも本番ドメインを指す）
  3. `http://localhost:3000`
- 各ページの canonical:
  - トップ `/`、検索 `/search`、店舗一覧 `/locations`、`/locations/prefecture/{code}`
  - 商品 `/gacha/{id}`
  - 店舗 `/locations/{id}`。商品ページから来たときの `?product=` は除きます。
- 検索条件付きの `/search?...` とお気に入りは noindex のため、canonical を出力しません。

## 7. OGP

| ページ | 画像 |
| --- | --- |
| 商品 | `/gacha/{id}/opengraph-image`（X は `/twitter-image`）。1200×630 の PNG |
| その他 | `/og/gachanavi.png`（GachaNavi のアイコンとロゴ。1200×630） |

### 商品ページの OGP 画像

- GachaNavi オリジナルの商品ビジュアル（カテゴリ・シリーズから作る SVG）、アイコン、「GachaNavi」の文字で構成します。
- メーカーの画像は使いません。
- リクエスト時に生成して CDN に 1 日キャッシュします（`s-maxage=86400`）。2.3 万件の画像ファイルは作りません。
- 商品名は og:title で表示されるため画像に入れません。日本語フォントを読み込まないので軽量です。
- 存在しない商品は 404 です。

### タグ

- `og:title`、`og:description`、`og:url`、`og:site_name=GachaNavi`、`og:locale=ja_JP`、`og:type=website`、`og:image`（width / height / alt）。
- `twitter:card=summary_large_image`、`twitter:title`、`twitter:description`、`twitter:image`。

## 8. JSON-LD

### 商品ページ：`Product`

| 項目 | 値 |
| --- | --- |
| `name` | 商品名 |
| `url` | canonical と同じ |
| `description` | meta description と同じ |
| `image` | 商品の OGP 画像（オリジナルの商品ビジュアル） |
| `manufacturer` | `Organization`。メーカーが分かる場合のみ |

GachaNavi は販売者ではない（設置店舗と在庫の報告を探すサービス）ため、販売者向けの項目は入れません。

- **入れない項目**：`offers`（価格・`availability`・`shippingDetails`・`hasMerchantReturnPolicy`）、`category`、`brand`、`gtin`、`sku`、`review`、`aggregateRating`。
- **価格**：画面には「価格 1回◯円」（メーカー公表の価格）をそのまま表示します。構造化データには入れません。
- **在庫**：利用者の報告にもとづく目安で、GachaNavi が確認したものではないため `availability` には使いません。

#### 変更履歴（2026-10-03）

当初は価格が分かる商品に `offers`（`Offer`）と `category`（「カプセルトイ（ガチャガチャ）」）を入れていました。

- その結果、Search Console の「販売者のリスティング」レポートで、グローバル ID、`hasMerchantReturnPolicy`、`category` の値、`shippingDetails`、`availability` について、重大ではない問題が検出されました。
- Google のドキュメントでは、販売者のリスティングは「Only pages where a shopper can purchase a product are eligible for merchant listing experiences, not pages with links to other sites that sell the product.」とされ、`Offer` は販売者自身が売る場合のものです。GachaNavi の商品ページには当てはまらないため、`offers` と `category` を削除しました。
- 架空の販売・在庫・配送・返品・レビュー・評価の情報で警告を埋めることはしません。
- 削除後は、商品ページが「販売者のリスティング」の対象から外れ、数日〜数週間で同レポートから消える見込みです。
- 商品スニペット（`review`・`aggregateRating`・`offers` のいずれかが必須）の対象にもなりませんが、実際のレビュー・評価が無いため想定どおりです。
- パンくずリストと店舗の構造化データは変わりません。

#### `gtin` / `brand` を入れない理由

- **JAN**：収集データの JAN は Firestore に保存しておらず、追加には再取り込み（Firestore への書き込み）が必要です。さらに、バンダイの `jan_code` は 16 桁で、GTIN の形式ではありません。
- **brand**：収集データの `brand` には「その他」などの区分も含まれ、ブランド名として確かではありません。

### 店舗ページ：`Store`

`name`、`url`、`address`（`PostalAddress`：住所・都道府県・JP。住所がある場合）、`geo`（座標がある場合）。
営業時間・電話番号・評価は、確かなデータが無いため入れません。

### 共通：`BreadcrumbList`

[9. Breadcrumb](#9-breadcrumb) を参照してください。

## 9. Breadcrumb

表示しているパンくず（`nav aria-label="パンくずリスト"`）と、同じ内容・同じ順番の `BreadcrumbList` を出力します。

| ページ | パンくず |
| --- | --- |
| 商品 | ホーム › ガチャを探す › {商品名} |
| 店舗 | ホーム › 店舗一覧 › {都道府県} › {店舗名}（住所から都道府県が分からなければ省略） |
| 店舗一覧 | ホーム › 店舗一覧 |
| 都道府県 | ホーム › 店舗一覧 › {都道府県} |

店舗ページでは、商品ページから来たときだけ「ガチャ詳細に戻る」を表示します（従来の動作）。

## 10. 内部リンク

- **フッター（全ページ）**：ガチャを探す / 店舗一覧（都道府県別）/ お気に入り。
- **商品 → 店舗**：「このガチャの設置店舗」の一覧（従来どおり）。
- **商品 → 商品**：新規の「関連するガチャ」（最大 6 件）。
  - 同じシリーズのものを優先し、次に同じメーカーで発売時期が ±2 か月以内のものを並べます。
  - カタログ索引だけで選ぶため、Firestore の読み取りは増えません。
- **店舗 → 商品**：「この店舗のガチャ」（従来どおり）。
- **店舗一覧 → 都道府県 → 店舗**：新規。これにより、商品ページを経由しなくても全店舗に到達できます。

## 11. noindex

| 対象 | robots |
| --- | --- |
| 本番以外（Preview・開発・mock・local）の全ページ | `noindex, nofollow`（robots.txt も `Disallow: /`） |
| `/favorites` | `noindex, follow` |
| `/search?q=...` など条件付きの検索 | `noindex, follow` |
| 404 | `noindex`（Next.js が付与） |
| 上記以外（本番） | 指定なし（既定の index, follow） |

- 本番かどうかは `isIndexable()` で判定します。`DATA_SOURCE=firestore` かつ `VERCEL_ENV=production` が条件です。Vercel 以外では `NEXT_PUBLIC_SITE_URL` も必要です。
- `SEO_INDEXABLE=false` で緊急停止、`true` でテスト用に上書きできます。
- 商品・店舗・トップ・検索（条件なし）・店舗一覧は noindex にしていません。

## 12. 404

- 存在しない商品・店舗、都道府県コードの誤り（`99`・`abc`）、店舗の無い都道府県は、従来どおり `notFound()` で 404 を返します。
- 存在しない商品の OGP 画像も 404 です。
- Firestore で使えない ID（`__x__`・`/` を含むものなど）は、従来は Firestore のエラーで 500 になっていました。今回、読み取りをせずに 404 を返すよう修正しました。
- 本番の 404 ページには `noindex` だけが付きます。layout が `index, follow` を出していた場合の矛盾が起きないようにしています。

## 13. ページ速度への影響

- ビルド時の Firestore 読み取りは 0 件です（エミュレータで計測）。ビルドで生成するページ数も増えていません。
- 追加の処理は、キャッシュ済みの索引（メモリ上の配列）の走査だけです。
  - 商品ページ：関連商品の選択と同名判定
  - 都道府県ページ：店舗の振り分け
- JSON-LD は 1〜2 KB 程度のインライン `<script>` です。
- OGP 画像はページの表示では読み込まれません。SNS などのクローラーが取得し、CDN にキャッシュされます。
- 390px 幅で、商品・店舗・店舗一覧・都道府県ページに横スクロールが無いことを確認しました。

## 14. Firestore read/write への影響

### write

追加はありません。

### read

エミュレータでの計測値です。`catalogIndex` は meta と 12 シャード。キャッシュは `unstable_cache` によるもので、既存ページと共有しています。

| リクエスト | キャッシュなし | キャッシュあり |
| --- | --- | --- |
| `/sitemap.xml` | 13（`catalogIndex` meta＋12 シャード） | 0 |
| `/sitemaps/pages.xml` | 1（店舗シャード） | 0 |
| `/sitemaps/products-N.xml` | placements の一覧 1 回（トップページの「話題のガチャ」と同じキャッシュ） | 0 |
| `/sitemaps/locations.xml` | 0（上記と共有） | 0 |
| 商品ページ | 従来どおり（商品 1 件＋共有の索引） | 0 |
| 商品の OGP 画像 | 0（カタログ索引のみ） | 0 |
| 店舗一覧・都道府県ページ | 店舗の索引（共有） | 0 |
| ビルド | 0 | ― |

- 商品ごと・店舗ごとの読み取り（`products/{id}` や `locations/{id}`）は、サイトマップでは一切しません。
- サイトマップは CDN に 1 時間キャッシュされるため、クローラーが何度取得しても関数の実行は 1 時間に 1 回程度です。

## 15. Google Search Console で必要な作業

1. **プロパティを追加する**：本番の公開ドメインで、ドメイン プロパティ（DNS の TXT レコード）を推奨します。HTML タグで確認する場合は、`content` の値を Vercel の `GOOGLE_SITE_VERIFICATION` に設定して再デプロイします。
2. **サイトマップを送信する**：「サイトマップ」に `https://{本番ドメイン}/sitemap.xml` を送信します。インデックスと子サイトマップ 5 件が「成功しました」になることを確認します。
3. **URL 検査**：トップ・商品ページ数件・店舗ページで「公開 URL をテスト」を実行し、次を確認します。
   - クロール可能であること
   - canonical が本番 URL であること
   - 構造化データ（パンくずリスト・商品）が検出されること
4. **ページのインデックス登録レポート**：数日〜数週間後に「検出 - インデックス未登録」「クロール済み - インデックス未登録」の推移を確認します。
5. **拡張 → パンくずリスト**：エラーが無いことを確認します。商品ページは販売者向けのマークアップを入れていないため、「販売者のリスティング」「商品スニペット」の対象外です（[8. JSON-LD](#8-json-ld)）。以前の警告は再クロール後に消えます。
6. 任意：リッチリザルト テスト（https://search.google.com/test/rich-results）で商品ページを確認します。

## 16. Vercel で必要な設定

1. **公開ドメイン（必須）**：現在の本番デプロイは Vercel Authentication で保護されていて、クローラーが到達できません。次のどちらかが必要です。
   - 独自ドメイン（または公開する `*.vercel.app`）を Production に割り当てる。
   - Deployment Protection の対象から本番を外す。

   なお、`gachanavi.vercel.app` は別のサイトのため使えません。
2. **`NEXT_PUBLIC_SITE_URL`（推奨）**：Production 環境に本番の公開 URL（例：`https://gachanavi.example.com`）を設定します。Preview 環境には設定しないでください。`NEXT_PUBLIC_*` はビルド時に埋め込まれるため、設定後に再デプロイします。
3. **`GOOGLE_SITE_VERIFICATION`（任意）**：Search Console を HTML タグで確認する場合だけ設定します。
4. **`SEO_INDEXABLE`**：通常は設定不要です。公開を止めたいときだけ `false` にします。
5. `DATA_SOURCE=firestore`、`VERCEL_ENV`、`VERCEL_PROJECT_PRODUCTION_URL` は、既存の設定や Vercel のシステム環境変数のままで構いません。

## 17. 残っている SEO 改善候補

- 商品説明文（メーカーの説明）は、権利確認が済むまで表示しない方針のままです。許諾後に表示すれば、本文の情報量が増えます。
- 同名の二重データ（4 組 8 件）は、取り込み時に統合すると title の重複が無くなります。
- 店舗ページの営業時間・公式サイトは、確かなデータがある店舗だけ表示・構造化データに追加できます。
- 都道府県ページを市区町村で分けると、店舗の多い都道府県の一覧が見やすくなります。
- シリーズ・メーカー・キャラクターの一覧ページを作れば、内部リンクと「○○ ガチャ」系の入口が増えます。ただし、中身の薄いページを大量に作らないよう、件数のしきい値が必要です。
- 公開後に Search Console のデータを見て、未登録の理由ごとに対策します。

## 18. テスト結果

確認日は 2026-10-02、環境は mock / local / Firestore エミュレータです。本番 Firestore には接続していません。

### 静的チェックとユニットテスト

| チェック | 結果 |
| --- | --- |
| `npm run lint` | エラー 0。警告 2 件は既存の `public/firebase-messaging-sw.js`（変更していない） |
| `npm run typecheck` | OK |
| `npm test` | 70 / 70 pass。SEO のテスト 15 件を含む |
| エミュレータの統合テスト（取り込み・お気に入り・通知） | 19 / 19 pass |
| アプリのページ確認（エミュレータ） | 6 / 6 pass |
| `npm run build` | OK（mock / local / エミュレータ、インデックス可・不可の両方） |

### SEO のテストが確認していること

- **ユニットテスト（`tests/seo.test.ts`）**
  - 正規 URL の優先順位と、Preview の URL を使わないこと。
  - インデックス可否（本番 / Preview / Development / mock / local / 上書き）。
  - title・description の組み立て、切り詰め、商品ごとの違い、同名時の発売時期。
  - 都道府県コード。
  - サイトマップ XML（エスケープ・lastmod・分割）。
  - JSON-LD（架空の項目が無いこと）。
  - Firestore で使えない ID。
- **E2E**：390px 幅のブラウザで次を確認しています。
  - robots.txt と sitemap（インデックス・子サイトマップ・抜き取り URL が 200・範囲外が 404）。
  - title・description・canonical・OGP・Twitter Card・robots。
  - JSON-LD の Product / Store / BreadcrumbList（表示中のパンくずと一致すること）。
  - OGP 画像（PNG 1200×630・CDN キャッシュ）。
  - 404 と noindex、横スクロールが無いこと、ページエラーが無いこと。

### E2E の結果

| モード | 結果 |
| --- | --- |
| mock・本番以外（noindex） | 102 / 102 |
| local・本番以外 | 102 / 102 |
| エミュレータ・本番以外 | 102 / 102 |
| mock・インデックス可（`SEO_INDEXABLE=true`） | 114 / 114 |
| エミュレータ・インデックス可（全カタログ 23,464 件・店舗 1,796 件） | 118 / 118 |

エミュレータ・インデックス可の内訳:

- サイトマップは合計 25,310 URL で、重複はありません。
- URL はすべて `NEXT_PUBLIC_SITE_URL` のホストで、Preview / localhost の URL はありません。

### 既存機能の回帰確認（mock / local / エミュレータ）

| 項目 | mock | local | エミュレータ |
| --- | --- | --- | --- |
| 在庫報告 | 19 | 19 | 19 |
| 地図 | 24 | 15 | 15 |
| お気に入り・在庫通知 | 37 | 35 | 36 |
| 現地確認 | 11 | 11 | 11 |
| バックグラウンド通知 | 12 | 12 | 15 |
| アイコン | 10 | 10 | 10 |
| 初回の通知案内 | 24 | 24 | 24 |
| 位置情報なしの地図 | 24 | 15 | 15 |

すべて pass です。エミュレータの Firestore に位置情報の項目が無いことも確認しました（scan-geo）。

### Firestore の読み取り計測（エミュレータ）

- ビルド時は 0 件です。
- それ以外は [14. Firestore read/write への影響](#14-firestore-readwrite-への影響) の値です。

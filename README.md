# GachaNavi（ガチャナビ）

> 欲しいガチャを見つける。残っている場所まで分かる。

ガチャガチャの検索と、設置場所・在庫状況の確認ができる Web アプリです。
現在は **MVP のフロントエンド** 段階で、データはすべて開発用のモックデータです。

## 技術構成

- [Next.js](https://nextjs.org/) 16（App Router）
- TypeScript
- Tailwind CSS v4
- スマートフォン優先のレスポンシブデザイン

## 起動方法

Node.js 20 以上が必要です。

```bash
npm install      # 依存パッケージのインストール
npm run dev      # 開発サーバー起動 → http://localhost:3000
```

その他のコマンド:

```bash
npm run build    # 本番ビルド
npm run start    # 本番ビルドの起動
npm run lint     # ESLint
```

環境変数は現時点では不要です。将来 APIキー等が必要になった場合は `.env.example` を
`.env.local` にコピーして値を設定してください（`.env.local` は Git にコミットされません）。

## 画面構成

| パス | 内容 |
| --- | --- |
| `/` | トップ。「欲しいガチャを探そう」＋検索バー、🔥話題のガチャ / 🆕新着ガチャ / 📍近くで見つかったガチャ |
| `/search?q=キーワード` | 検索結果（画像・商品名・シリーズ・メーカー・価格・設置店舗数・在庫あり報告店舗数）。「在庫ありのみ」フィルタ付き |
| `/gacha/[id]` | ガチャ詳細（画像・商品名・シリーズ・メーカー・価格・発売時期）と「このガチャが見つかった場所」（地図＋リスト） |
| `/locations/[id]?product=[商品ID]` | 設置場所詳細（店舗名・住所・営業時間・地図）、対象ガチャの在庫状態・最終確認日時、在庫報告ボタン |

- 在庫状態は 🟢在庫あり / 🟡残りわずか / 🔴売り切れ / ⚪未確認 の4種類で、必ず「12分前に確認」のような最終確認時刻を併記します。
- 検索はひらがな・カタカナ・全角半角を区別しません（「ネコ」でも「ねこ」でもヒット）。スペース区切りで AND 検索。
- 在庫報告は現段階では保存されず、同じブラウザセッション内の画面表示にのみ反映されます。
- 「近くで見つかったガチャ」は、位置情報の取得を実装するまで「渋谷駅周辺」を仮の現在地として使っています。

## ディレクトリ構成

```
src/
├── app/                      # ルーティング（App Router）
│   ├── page.tsx              # トップページ
│   ├── search/page.tsx       # 検索結果
│   ├── gacha/[id]/page.tsx   # ガチャ詳細
│   ├── locations/[id]/page.tsx # 設置場所詳細
│   ├── layout.tsx / globals.css / not-found.tsx
├── components/
│   ├── layout/               # ヘッダー・フッター・コンテナ
│   ├── search/               # 検索バー・キーワードチップ
│   ├── gacha/                # 商品画像・カード・検索結果行など
│   ├── location/             # 設置場所の情報・リスト
│   ├── stock/                # 在庫バッジ・最終確認時刻・在庫報告UI
│   ├── map/                  # 地図（差し替え可能なコンポーネント）
│   └── ui/                   # ロゴ・アイコン
├── data/
│   └── mock.ts               # ★ モックデータはすべてここに集約
├── lib/
│   ├── data/                 # データ取得層
│   │   ├── source.ts         #   DataSource インターフェース
│   │   ├── mockSource.ts     #   モック実装
│   │   ├── index.ts          #   画面から使うクエリ関数（検索・集計）
│   │   └── reports.ts        #   在庫報告の送信（現在は保存なし）
│   ├── format.ts             # 相対時刻・価格などの表示整形
│   ├── geo.ts                # 距離計算・Googleマップ URL
│   ├── search.ts             # 検索用の文字列正規化
│   └── stock.ts              # 在庫状態の定義・算出
└── types/index.ts            # ドメインモデルの型定義
public/images/gacha/          # モック用の商品画像（SVG）
```

## データモデル

「ガチャ商品」と「設置場所」は別エンティティとして扱い、多対多の関係を `Placement` で表します。

```
GachaProduct 1 ── * Placement * ── 1 Location
                        │
GachaProduct + Location ── * StockReport * ── 1 User
```

| 型 | 役割 |
| --- | --- |
| `GachaProduct` | ガチャ商品（名前・シリーズ・メーカー・価格・発売時期・画像など） |
| `Location` | 設置場所（店舗名・住所・緯度経度・営業時間） |
| `Placement` | どの商品がどの場所に設置されているか |
| `StockReport` | ユーザーによる在庫報告（在庫あり / 残りわずか / 売り切れ ＋ 報告日時） |
| `User` | 報告したユーザー |

各場所の在庫状態は、その「商品×場所」の最新の `StockReport` から算出します（報告が無ければ「未確認」）。
「在庫あり報告店舗数」は、最新報告が「在庫あり」または「残りわずか」の店舗数です。

## バックエンド・地図サービスの導入について

- **データ**: 画面は `src/lib/data/index.ts` の関数だけを使います。Firebase などへ移行する場合は
  `DataSource`（`src/lib/data/source.ts`）を実装したクラスを作り、`index.ts` の `dataSource` を差し替えます。
  在庫報告の保存は `src/lib/data/reports.ts` の `submitStockReport` を置き換えます。
- **地図**: 現在は APIキー不要の簡易地図（`PlaceholderMap`）です。Google Maps 等を使う場合は
  `LocationMapProps`（`src/components/map/types.ts`）を満たす実装を作り、`LocationMap.tsx` で切り替えます。
  APIキーは `.env.local` に置き、コードには直接書かないでください。
- 外部の Google マップで経路を開くリンク（APIキー不要）は設置場所詳細に実装済みです。

## 注意

表示している商品名・メーカー・店舗名・住所・在庫情報はすべて架空のダミーデータです。

# GachaNavi（ガチャナビ）

> 欲しいガチャを見つける。残っている場所まで分かる。

ガチャガチャの検索と、設置場所・在庫状況の確認ができる Web アプリです。
データは **モックデータ（既定）** と **Cloud Firestore** を環境変数で切り替えられます。
Firebase プロジェクトが無くても、モックデータのまま開発・ビルドできます。

## 技術構成

- [Next.js](https://nextjs.org/) 16（App Router）
- TypeScript
- Tailwind CSS v4
- Firebase（Cloud Firestore / Admin SDK）※ Spark プラン（無料枠）前提
- スマートフォン優先のレスポンシブデザイン

## 起動方法

Node.js 20.6 以上が必要です。

```bash
npm install      # 依存パッケージのインストール
npm run dev      # 開発サーバー起動 → http://localhost:3000
```

その他のコマンド:

```bash
npm run build           # 本番ビルド
npm run start           # 本番ビルドの起動
npm run lint            # ESLint
npm run firestore:check # Firestore への接続確認（読み取りのみ）
npm run seed:firestore  # モックデータを Firestore に投入（Firebase 設定後）
```

環境変数を設定しない場合は、モックデータ（`DATA_SOURCE=mock`）で動作します。

## 画面構成

| パス | 内容 |
| --- | --- |
| `/` | トップ。「欲しいガチャを探そう」＋検索バー、🔥話題のガチャ / 🆕新着ガチャ / 📍近くで見つかったガチャ |
| `/search?q=キーワード` | 検索結果（画像・商品名・シリーズ・メーカー・価格・設置店舗数・在庫あり報告店舗数）。「在庫ありのみ」フィルタ付き |
| `/gacha/[id]` | ガチャ詳細（画像・商品名・シリーズ・メーカー・価格・発売時期）と「このガチャが見つかった場所」（地図＋リスト） |
| `/locations/[id]?product=[商品ID]` | 設置場所詳細（店舗名・住所・営業時間・地図）、対象ガチャの在庫状態・最終確認日時、在庫報告ボタン |

- 在庫状態は 🟢在庫あり / 🟡残りわずか / 🔴売り切れ / ⚪未確認 の4種類で、必ず「12分前に確認」のような最終確認時刻を併記します。
- 検索はひらがな・カタカナ・全角半角を区別しません（「ネコ」でも「ねこ」でもヒット）。スペース区切りで AND 検索。
- 在庫報告は Server Action 経由で送信します。`DATA_SOURCE=firestore` のときは Firestore に保存され、
  `mock` のときは保存されず画面表示にのみ反映されます。
- 「近くで見つかったガチャ」は、位置情報の取得を実装するまで「渋谷駅周辺」を仮の現在地として使っています。

## ディレクトリ構成

```
src/
├── app/                        # ルーティング（App Router）
│   ├── page.tsx                # トップページ
│   ├── search/page.tsx         # 検索結果
│   ├── gacha/[id]/page.tsx     # ガチャ詳細
│   ├── locations/[id]/page.tsx # 設置場所詳細
│   ├── actions/stockReports.ts # 在庫報告の Server Action
│   └── layout.tsx / globals.css / not-found.tsx
├── components/                 # UI コンポーネント（layout / search / gacha / location / stock / map / ui）
├── data/
│   └── mock.ts                 # ★ モックデータはすべてここに集約（Firestore への初期投入にも使用）
├── lib/
│   ├── data/                   # データアクセス層
│   │   ├── source.ts           #   DataSource インターフェース
│   │   ├── config.ts           #   DATA_SOURCE による切り替え
│   │   ├── index.ts            #   画面から使うクエリ関数（検索・集計）
│   │   ├── mockSource.ts       #   モック実装
│   │   ├── firestoreSource.ts  #   Firestore 実装（キャッシュ付き）
│   │   ├── firestore/schema.ts #   Firestore のコレクション構造と型変換
│   │   ├── cacheTags.ts        #   キャッシュのタグ・保持時間
│   │   └── reports.ts          #   在庫報告の送信（クライアント → Server Action）
│   ├── firebase/
│   │   ├── adminApp.ts / admin.ts  # Admin SDK（サーバー専用）
│   │   └── client.ts           #   Client SDK（将来のログイン用・現在未使用）
│   ├── auth/reporter.ts        # 報告者ID（ログイン導入まではゲスト）
│   └── format.ts / geo.ts / search.ts / stock.ts
└── types/index.ts              # ドメインモデルの型定義
scripts/seed-firestore.ts       # モックデータの Firestore 投入スクリプト
scripts/check-firestore.ts      # Firestore 接続確認スクリプト
firebase.json                   # Firebase CLI 設定
firestore.rules                 # Firestore Security Rules
firestore.indexes.json          # Firestore インデックス
storage.rules                   # Storage Security Rules（現在は未使用）
public/images/gacha/            # 商品画像（SVG）
```

## データモデル

「ガチャ商品」と「設置場所」は別エンティティとして扱い、多対多の関係を `Placement` で表します。

```
GachaProduct 1 ── * Placement * ── 1 Location
                        │ latestStock（最新在庫のキャッシュ）
                        │
GachaProduct × Location ── * StockReport（履歴） * ── 1 User
```

| 型 | 役割 |
| --- | --- |
| `GachaProduct` | ガチャ商品（名前・シリーズ・メーカー・価格・発売時期・画像など） |
| `Location` | 設置場所（店舗名・住所・緯度経度・営業時間） |
| `Placement` | どの商品がどの場所に設置されているか |
| `StockReport` | ユーザーによる在庫報告（在庫あり / 残りわずか / 売り切れ ＋ 報告日時） |
| `User` | 報告したユーザー |

「在庫あり報告店舗数」は、最新報告が「在庫あり」または「残りわずか」の店舗数です。

### Firestore のコレクション

| コレクション | ドキュメントID | 主なフィールド |
| --- | --- | --- |
| `products` | 任意（モックは `p-001` など） | name, series, maker, price, releaseMonth, imageUrl, description, characters, tags |
| `locations` | 任意（モックは `l-001` など） | name, address, area, lat, lng, openingHours |
| `placements` | `{productId}__{locationId}` | productId, locationId, firstSeenAt, **latestStock**（status, reportedAt, reportId / 報告なしは null） |
| `stockReports` | 自動ID | productId, locationId, placementId, userId, status, reportedAt |
| `users` | Firebase Auth の uid（予定） | displayName, createdAt |

- `stockReports` は履歴としてすべて残し、更新・削除しません。
- 在庫報告の保存はトランザクションで「`stockReports` への追加」と「`placements.latestStock` の更新」をまとめて行います。
  既存の `latestStock` より **新しい報告のときだけ** 上書きするため、古い報告で最新状態が戻ることはありません。
- 画面の在庫表示は `placements.latestStock` だけを読み、報告履歴は読みません（読み取り件数の削減）。

## Spark プラン（無料枠）での運用方針

Firestore の無料枠（1日あたり 読み取り 50,000 件 / 書き込み 20,000 件、保存 1GiB）に収まるよう、以下の構成にしています。

- **読み取りのキャッシュ**：Firestore の読み取り結果を Next.js のデータキャッシュに保存し、アクセスごとに読みに行きません。
  - 商品・設置場所：1時間
  - 設置情報（在庫状態）：5分。ただし報告があった商品・設置場所の詳細ページは報告直後に更新
  - 話題のガチャ（直近24時間の報告件数）：30分（最大 1,000 件まで集計）
- **在庫報告1件あたり**：読み取り 1 件 + 書き込み 2 件
- **リアルタイムリスナー（onSnapshot）は不使用**
- **ブラウザから Firestore への直接アクセスは Security Rules で拒否**
  （公開される Web 用 API キーを使った不正な読み取りで無料枠が消費されるのを防ぐ）
- **Firebase Storage は未使用**：商品画像は `public/images/` に同梱しています（下記参照）

利用者やデータが増えた場合も、同じ Firebase プロジェクトのまま Blaze プランへ切り替えるだけで継続でき、コードの変更は不要です。
商品数が数千件を超える規模になったら、検索を専用サービス（Algolia など）へ移す、商品ごとの集計値を非正規化するなどを検討します。

### Firebase Storage について

2024年10月以降に作成された Firebase プロジェクトでは、Cloud Storage for Firebase の利用に Blaze プランが必要です。
そのため現時点では Storage を使わず、商品画像は `public/images/gacha/` に置いています。
`GachaProduct.imageUrl` には任意の URL を保存できるため、将来 Storage を使う場合も画像 URL を差し替えるだけで対応できます
（その際は `next.config.ts` の `images.remotePatterns` に Storage のドメインを追加し、`storage.rules` をデプロイします）。

## Firebase の設定手順

Firebase プロジェクト作成後に、以下の手順で Firestore に接続します。

### 1. Firebase プロジェクトを作成する

1. [Firebase コンソール](https://console.firebase.google.com/) を開き「プロジェクトを作成」
2. プロジェクト名を入力（例: `gachanavi`）。Google アナリティクスは不要なら無効で構いません
3. 作成後、左下の料金プランが「Spark」になっていることを確認

### 2. Cloud Firestore を作成する

1. 左メニュー「構築」→「Firestore Database」→「データベースを作成」
2. ロケーションは日本国内（`asia-northeast1` 東京 / `asia-northeast2` 大阪）を推奨（**作成後は変更できません**。
   アプリ側でロケーションを指定する設定は不要です）
3. セキュリティルールは「本番環境モード」で開始（このリポジトリの `firestore.rules` を後でデプロイします）

### 3. サービスアカウントの秘密鍵を取得する（サーバー用）

1. 歯車アイコン「プロジェクトの設定」→「サービス アカウント」タブ
2. 「Firebase Admin SDK」で「新しい秘密鍵を生成」→ JSON ファイルをダウンロード
3. **この JSON はリポジトリの外に保管し、絶対にコミットしないでください**

### 4. `.env.local` を作成する

```bash
cp .env.example .env.local
```

ダウンロードした JSON の値を設定します。

```bash
DATA_SOURCE=firestore
FIREBASE_PROJECT_ID=（JSON の project_id）
FIREBASE_CLIENT_EMAIL=（JSON の client_email）
FIREBASE_PRIVATE_KEY="（JSON の private_key。\n を含む1行のまま "" で囲む）"
```

`NEXT_PUBLIC_FIREBASE_*` は将来のログイン機能用です。「プロジェクトの設定」→「全般」→「マイアプリ」で
ウェブアプリ（`</>`）を登録すると表示される `firebaseConfig` の値を設定します（現時点では未設定でも動作します）。

`.env.local` の代わりに、シェルやホスティング先（Vercel など）・クラウド開発環境の設定画面で
同じ名前の環境変数を設定しても動作します（Next.js もスクリプトも両方に対応しています）。

### 5. 接続を確認し、初期データを投入して起動する

```bash
npm run firestore:check  # 接続確認（各コレクションの件数を表示。書き込みはしない）
npm run seed:firestore   # モックデータ（約80件）を Firestore に書き込み
npm run dev
```

### 6. Security Rules とインデックスをデプロイする

アプリは Admin SDK（Security Rules の対象外）でアクセスするため、この手順を行わなくても動作します。
「本番環境モード」で作成した場合、初期ルールはブラウザからのアクセスをすべて拒否する内容で、
`firestore.rules` とほぼ同じです。ルールをリポジトリの内容と揃える場合や、在庫報告の履歴を表示する機能
（複合インデックスが必要）を追加する際に実行してください。

```bash
npx firebase-tools login
npx firebase-tools use --add            # 作成したプロジェクトを選択（.firebaserc が作成されます）
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

在庫報告ボタンを押すと、Firestore の `stockReports` に履歴が追加され、`placements.latestStock` が更新されます。

### ローカルエミュレータを使う場合（任意）

Firebase プロジェクトの無料枠を消費せずに試せます（Java が必要です）。

```bash
npx firebase-tools emulators:start --only firestore --project demo-gachanavi
```

`.env.local` に `DATA_SOURCE=firestore`、`FIREBASE_PROJECT_ID=demo-gachanavi`、
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` を設定すると、サービスアカウント無しでエミュレータに接続します。

### デプロイ先について

Next.js のサーバー機能（Server Action・キャッシュ）を使うため、サーバーを実行できる環境が必要です。
Firebase App Hosting は Blaze プランが必要なため、Spark プランのうちは Vercel（Hobby プラン）などを想定しています。
デプロイ先の環境変数に `.env.local` と同じ値を設定してください。

## 今後の予定（未実装）

- **ログイン（Firebase Authentication）**：現在の報告者は共通の `guest` ユーザーです。
  公開前に匿名認証などを導入し、`src/lib/auth/reporter.ts` で ID トークンを検証して uid を使うようにします。
  あわせて連続投稿の制限や App Check の導入を検討します。
- 地図サービス（Google Maps など）の接続：`LocationMapProps`（`src/components/map/types.ts`）を満たす実装を作り、
  `src/components/map/LocationMap.tsx` で切り替えます。
- 位置情報による「近くで見つかったガチャ」

## 注意

表示している商品名・メーカー・店舗名・住所・在庫情報はすべて架空のダミーデータです。

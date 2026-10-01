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
npm run typecheck       # 型チェック
npm test                # テスト（Firestore には接続しない。実データは DATA_SOURCE=local で読み込む）
npm run catalog:build   # 収集データから投入予定の内容・カタログ索引をローカルに出力（Firestore には接続しない）
npm run firestore:check # Firestore への接続確認（読み取りのみ）
npm run auth:check      # 匿名ログインの動作確認（確認用の匿名ユーザーは自動で削除）
npm run seed:firestore  # モックデータを Firestore に投入（Firebase 設定後）
```

環境変数を設定しない場合は、モックデータ（`DATA_SOURCE=mock`）で動作します。

| DATA_SOURCE | データ | 在庫報告 |
|---|---|---|
| `mock`（既定） | `src/data/mock.ts` の架空データ | 保存しない |
| `local` | 収集した実データ `data/collected/*.json`（約2.3万商品・1,800店舗）。**Firestore に接続しない** | サーバーのメモリ上のみ |
| `firestore` | Cloud Firestore | 保存する |

```bash
DATA_SOURCE=local npm run dev   # 実データ規模で画面・検索を確認（Firestore 投入前の確認用）
```

## 画面構成

| パス | 内容 |
| --- | --- |
| `/` | トップ。「欲しいガチャを探そう」＋検索バー、🔥話題のガチャ / 🆕新着ガチャ / 📍近くで見つかったガチャ |
| `/search?q=キーワード` | 検索結果（画像・商品名・シリーズ・メーカー・価格・設置店舗数・在庫あり報告店舗数）。「在庫ありのみ」フィルタ付き |
| `/gacha/[id]` | ガチャ詳細（画像・商品名・シリーズ・メーカー・価格・発売時期）、「この店で見つけた」報告、「このガチャが見つかった場所」（地図＋リスト） |
| `/locations/[id]?product=[商品ID]` | 設置場所詳細（店舗名・住所・営業時間・地図）、対象ガチャの在庫状態・最終確認日時、在庫報告ボタン |

- 在庫状態は 🟢在庫あり / 🟡残りわずか / 🔴売り切れ / ⚪未確認 の4種類で、必ず「12分前に確認」のような最終確認時刻を併記します。
- 検索はひらがな・カタカナ・全角半角を区別しません（「ネコ」でも「ねこ」でもヒット）。スペース区切りで AND 検索。
- 在庫報告は Server Action 経由で送信します。`DATA_SOURCE=firestore` のときは Firestore に保存され、
  `mock` のときは保存されず画面表示にのみ反映されます（`local` はサーバーのメモリ上のみ）。
- **この店で見つけた**：商品詳細の「この店で見つけた」から、①店舗を検索して選ぶ（店舗名・地名・住所。すでに報告のある店舗は候補に表示）
  → ②在庫状態（在庫あり / 残りわずか / 売り切れ）を選ぶ → ③内容を確認して送信、の順に報告できます。
  設置情報（placement）が無い「商品×店舗」は報告と同時に作成されます。同じ商品×店舗への報告は 10 分に 1 回までで、
  待ち時間をカウントダウン表示します（判定はサーバー側。`src/components/stock/FoundAtStoreReport.tsx`）。
  店舗の検索は店舗の索引だけで行い、locations は読みません（`src/app/actions/locations.ts`）。
- 商品説明文は、掲載の許諾（権利確認）が済むまで表示しません（データには保存しています）。
- 距離の表示・距離順の並び・「近くで見つかったガチャ」は、ブラウザの位置情報（Geolocation API）で取得した現在地を使います。
  「現在地を使う」を押すと許可を求め、許可済みのブラウザでは自動で取得します。許可しない・取得に失敗した・非対応の場合は「渋谷駅周辺」を基準にします。
  現在地はブラウザ内でのみ使い、サーバーや Firestore には送信・保存しません（距離はブラウザ側で計算）。

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
│   ├── auth/reporter.ts        # 報告者ID（匿名認証の ID トークンをサーバーで検証して uid を返す）
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
| `stockReports` | 自動ID | productId, locationId, placementId, userId（報告者の Firebase Auth uid）, status, reportedAt |
| `users` | Firebase Auth の uid | displayName, createdAt（匿名ユーザーは初回報告時に「ゲスト」として作成） |
| `users/{uid}/reportThrottles` | `{productId}__{locationId}` | lastReportedAt（連投制限用） |

- `stockReports` は履歴としてすべて残し、更新・削除しません。
- 在庫報告の保存はトランザクションで「`stockReports` への追加」と「`placements.latestStock` の更新」をまとめて行います。
  既存の `latestStock` より **新しい報告のときだけ** 上書きするため、古い報告で最新状態が戻ることはありません。
- 画面の在庫表示は `placements.latestStock` だけを読み、報告履歴は読みません（読み取り件数の削減）。

### 報告者の識別と連投制限

- ブラウザは在庫報告の直前に Firebase Authentication の **匿名認証** でログインし（端末・ブラウザごとに1人）、
  ID トークンを Server Action に送ります。サーバーは Admin SDK の `verifyIdToken` で検証した uid を報告者として保存します。
- 同じユーザーが同じ「商品×場所」に **10分以内** に再度報告すると保存せず、画面に待ち時間を表示します
  （`REPORT_COOLDOWN_MS`・`src/lib/data/source.ts`）。判定は報告保存と同じトランザクション内で行います。
- 導入前の報告（userId が `guest` のもの）はそのまま残ります。

## Spark プラン（無料枠）での運用方針

Firestore の無料枠（1日あたり 読み取り 50,000 件 / 書き込み 20,000 件、保存 1GiB）に収まるよう、以下の構成にしています。

- **products を全件読まない**：商品一覧・検索は「カタログ索引」（`catalogIndex` コレクション。商品名・メーカー・価格・発売月など
  一覧に必要な項目だけを 700KB 以下のドキュメントに分割したもの）だけで行います。約2.3万商品で 12 シャード＋店舗 1 シャード。
  索引の読み込みは meta を含め 14 読み取りで、1時間キャッシュします（シャードごとに Next.js のデータキャッシュ 2MB 制限内）。
  商品詳細は 1 ドキュメントだけ読みます。索引に無い商品（モックなど）は一覧・検索に出ません。
  索引がまだ無い場合（実データ投入前）は、従来どおり products / locations を読みます（最大 300 件）
- **読み取りのキャッシュ**：Firestore の読み取り結果を Next.js のデータキャッシュに保存し、アクセスごとに読みに行きません。
  - 商品・設置場所・カタログ索引：1時間
  - 設置情報（在庫状態）：5分。ただし報告があった商品・設置場所の詳細ページは報告直後に更新
  - 話題のガチャ（直近24時間の報告件数）：30分（最大 1,000 件まで集計）
- **在庫報告1件あたり**：読み取り 3 件 + 書き込み 最大 4 件（報告の追加・在庫状態の更新・連投制限の記録・初回のみ users 作成）。
  設置情報が無い「商品×店舗」（この店で見つけた）は、商品・店舗の存在確認で読み取り +2 件、設置情報の作成で書き込み +1 件
- **店舗検索（この店で見つけた）**：キャッシュ済みの店舗索引を検索するだけで、Firestore の読み取りは発生しません
- **リアルタイムリスナー（onSnapshot）は不使用**
- **ブラウザから Firestore への直接アクセスは Security Rules で拒否**
  （公開される Web 用 API キーを使った不正な読み取りで無料枠が消費されるのを防ぐ）
- **Firebase Storage は未使用**：商品画像は `public/images/` に同梱しています（下記参照）

利用者やデータが増えた場合も、同じ Firebase プロジェクトのまま Blaze プランへ切り替えるだけで継続でき、コードの変更は不要です。
設置情報（placements）が数千件を超える規模になったら、商品ごとの集計値を非正規化するなどを検討します。

### 発売状況

商品の発売状況は保存せず、表示時に「発売月と再発売月の新しい方」から求めます（`src/lib/release.ts`）。

- 発売予定（upcoming）：今月より後 / 発売中（current）：直近6か月以内 / 過去の商品（past）：それより前 / 発売時期不明（unknown）
- 検索・一覧は発売中 → 発売予定 → 不明 → 過去の商品の順。キーワードなしの一覧は既定で過去の商品を表示しない（「過去の商品も表示」で切り替え）
- 新着は発売中の商品のみ。発売予定は別枠で表示

### 商品画像

メーカー公式サイトの画像は、各社の利用規約（無断転載禁止など）の確認が済むまで表示しません（画像なしのプレースホルダーを表示）。
権利確認が済んだホストは `NEXT_PUBLIC_APPROVED_IMAGE_HOSTS`（カンマ区切り）に指定すると表示されます（`src/lib/images.ts`）。

### サンプル（モック）データの扱い

本番の Firestore に入っている架空のモックデータ（`src/data/mock.ts` の商品 10 件・店舗 8 件）は削除しません。
実データの投入スクリプトが、投入の最初にこれらの ID のドキュメントへ `isSample: true` を付けます（ID を指定して読むだけで全件は読みません）。

- `isSample: true` の商品・店舗は、一覧・検索・商品詳細・店舗詳細・「この店で見つけた」の対象外になります（詳細は 404）
- カタログ索引には実データだけが入るため、一覧・検索・新着・話題・近くのガチャにもモックは出ません
- 既存の placements / stockReports / users は変更しません

### 収集データの検証結果（投入前）

`data/collected/validation/REPORT.md` の分類。**要確認のデータも削除せず、現時点ではすべて投入対象**です（除外推奨は 0 件）。

| | 問題なし | 修正可能 | 要確認 | 除外推奨 | 合計 |
|---|---:|---:|---:|---:|---:|
| 商品 | 21,880 | 970 | 614 | 0 | 23,464 |
| 店舗 | 1,373 | 203 | 220 | 0 | 1,796 |

- 修正可能：http→https、仮画像→null、名前先頭の区分をタグ化 など。投入時の変換（`src/lib/catalog/collected.ts`）で対応済み
- 要確認（商品 614）：重複候補（再販など）494、価格なし 47、共有画像 37、複数価格 20、発売年月なし 15、10 円単位でない価格 9 ほか。
  欠損値は「情報なし」と表示し、画面は正常に動きます
- 要確認（店舗 220）：重複候補 184、メーカーの取扱店舗一覧のみ 74、座標なし 50、公式地図とのずれ 14、営業休止・移転 3 ほか。
  座標なしの店舗は地図・距離の対象外で、詳細・報告は可能です
- 店舗の「同名・同じ市区町村」38 組の統合は未実施（そのまま別店舗として投入される）

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

在庫報告の匿名認証に `NEXT_PUBLIC_FIREBASE_*` も必要です。「プロジェクトの設定」→「全般」→「マイアプリ」で
ウェブアプリ（`</>`）を登録すると表示される `firebaseConfig` の値を設定します。
`NEXT_PUBLIC_` の値はビルド時に埋め込まれるため、設定・変更後は `npm run dev` / `npm run build` をやり直してください。

さらに Firebase コンソールの「Authentication」→「始める」→「ログイン方法」で **匿名** を有効にしてください。
無効のままだと、在庫報告時に「報告者の確認ができませんでした」と表示され保存されません。

`.env.local` の代わりに、シェルやホスティング先（Vercel など）・クラウド開発環境の設定画面で
同じ名前の環境変数を設定しても動作します（Next.js もスクリプトも両方に対応しています）。

### 5. 接続を確認し、初期データを投入して起動する

```bash
npm run firestore:check  # 接続確認（各コレクションの件数を表示。書き込みはしない）
npm run auth:check       # 匿名ログイン → サーバーでの ID トークン検証まで確認
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
npx firebase-tools emulators:start --only auth,firestore --project demo-gachanavi
```

`.env.local` に `DATA_SOURCE=firestore`、`FIREBASE_PROJECT_ID=demo-gachanavi`、
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` を設定すると、サービスアカウント無しでエミュレータに接続します。
匿名認証もエミュレータで試す場合は、`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`、
`NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`、`NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-gachanavi`、
`NEXT_PUBLIC_FIREBASE_API_KEY` と `NEXT_PUBLIC_FIREBASE_APP_ID`（エミュレータでは任意の文字列で可）も設定します。

### Firestore Emulator での投入テスト（実データ）

収集データ（`data/collected`）の投入処理は、本番に投入する前に Firestore Emulator で確認します。
本番 Firestore には接続しません（`scripts/lib/emulatorGuard.ts` が、`FIRESTORE_EMULATOR_HOST` がローカルであること・
プロジェクト ID が `demo-` で始まることを確認し、本番用の認証情報の環境変数をプロセス内で消去します）。

```bash
# 投入処理の統合テスト（エミュレータを起動 → テスト → 停止。Java が必要）
npm run test:emulator

# 手動で試す場合
npm run emulators                                                   # 別ターミナル
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run import:emulator -- --dry-run
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run import:emulator -- --max-writes=15000
```

- 書き込み順は locations → products → catalogIndex のシャード → `catalogIndex/meta`（最後）。meta が書かれるまでアプリは新しい索引を使いません
- ID は公式の識別子から決まるため、再実行しても二重登録になりません。チェックポイント（`.catalog-build/`）で、変わっていないドキュメントは書き直しません
- `--max-writes` で 1 回の書き込み件数を制限できます（無料枠 20,000 件/日。上限で止まったら翌日に同じコマンドで続きから）

画面の確認は、本番用の認証情報を外してエミュレータに向けたアプリを起動し、`test:emulator:app` を実行します
（投入テスト後のデータが前提のため、`npm run emulators` で起動したエミュレータに対して投入テストを実行しておく）。

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  npx tsx --conditions=react-server --test tests/emulator/import.test.ts
env -u FIREBASE_PRIVATE_KEY -u FIREBASE_CLIENT_EMAIL DATA_SOURCE=firestore FIREBASE_PROJECT_ID=demo-gachanavi \
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 sh -c 'npm run build && npx next start -p 3100'
GACHANAVI_APP_URL=http://127.0.0.1:3100 npm run test:emulator:app
```

### 本番 Firestore への投入（実データ）

本番投入は `--target=production` で行います（エミュレータ用のガードはそのまま。本番は `scripts/lib/productionGuard.ts` で別に確認）。
次のすべてを満たさない場合は、接続する前に停止します。

- `--project=gachanavi-21ee8`（コードに固定したプロジェクト ID と完全一致）と、環境変数 `FIREBASE_PROJECT_ID` の一致
- `FIREBASE_CLIENT_EMAIL` がこのプロジェクトのサービスアカウント、`FIREBASE_PRIVATE_KEY` が設定済み
- `FIRESTORE_EMULATOR_HOST` などエミュレータ用の環境変数が未設定
- `--max-writes=`（1〜20,000）の指定と、書き込み時はドライランで表示される確認コード `--confirm-plan=`

```bash
# 1) ドライラン（書き込みなし。Firestore の既存 ID を確認するため既存ドキュメント数だけ読み取り）
npx tsx scripts/import-collected.ts --target=production --project=gachanavi-21ee8 --max-writes=15000 --dry-run
# 2) 書き込み（1 日 1 回。上限で停止したら、翌日に同じコマンドで続きから）
npx tsx scripts/import-collected.ts --target=production --project=gachanavi-21ee8 --max-writes=15000 --confirm-plan=<確認コード>
```

- 既存ドキュメントは上書きしません（`create()`）。再開は Firestore の既存 ID で判定し、未投入の ID だけを書きます（ローカルの記録に依存しない）
- `--max-writes` はモックの `isSample` 更新（18 件）と meta を含む上限です
- 全商品・全店舗・全シャードを件数で確認してから、最後に `catalogIndex/meta` を書きます。既存の索引と内容が異なる場合は何も書かずに停止します
- placements / stockReports / users には書き込みません
- meta を書いた後、アプリは最大 5 分（meta のキャッシュ）で新しい索引に切り替わります

### バックグラウンド通知（FCM Web Push）

お気に入りの「在庫報告があったら通知」が ON のとき、GachaNavi を閉じていても在庫あり・残りわずかの報告を通知します。
**Spark（無料）プランのまま、Cloud Functions を使わずに動きます**（送信は Vercel の Server Action → Firebase Admin SDK → FCM）。
詳細は `docs/favorites-and-stock-alerts.md`。

有効にする手順（本番で行う前に内容を確認すること）:

1. Firebase コンソール > プロジェクトの設定 > Cloud Messaging > ウェブ プッシュ証明書で「鍵ペアを生成」し、
   公開鍵を Vercel の環境変数 `NEXT_PUBLIC_FIREBASE_VAPID_KEY` に設定（公開してよい値。秘密鍵はコンソールから出さない）
2. Google Cloud で「Firebase Cloud Messaging API（V1）」が有効になっていることを確認（無料。新しいプロジェクトでは通常有効）
3. 通知対象の検索に使う複合インデックスをデプロイ：`npx firebase-tools deploy --only firestore:indexes --project gachanavi-21ee8`
   （collection group `favorites`：productId + notifyInStock。既存のデータ・Rules は変わらない。インデックスの作成も無料）
4. 再デプロイ（`NEXT_PUBLIC_*` はビルド時に埋め込まれるため）

- `NEXT_PUBLIC_FIREBASE_VAPID_KEY` が未設定、またはインデックスが未作成の間は、バックグラウンド通知は送られず、
  従来どおり GachaNavi を開いている間のお知らせだけになる（在庫報告・お気に入りには影響しない）
- 通知の許可は、ユーザーが「在庫報告があったら通知」を ON にした時だけ求める。ページを開いただけでは Service Worker も登録しない
- **iPhone / iPad**：iOS 16.4 以降で、Safari の「ホーム画面に追加」で追加した GachaNavi を開き、その中で通知を ON にした場合だけ届く
  （Safari のタブのままでは Web Push を使えない。その場合はアプリを開いている間のお知らせのみ）
- **Android / PC**：Chrome・Edge・Firefox などで、ブラウザを閉じていても届く（OS・ブラウザの通知設定が ON の場合）

### デプロイ先について

Next.js のサーバー機能（Server Action・キャッシュ）を使うため、サーバーを実行できる環境が必要です。
Firebase App Hosting は Blaze プランが必要なため、Spark プランのうちは Vercel（Hobby プラン）などを想定しています。
デプロイ先の環境変数に `.env.local` と同じ値を設定してください。

`firebase-admin` は 13 系に固定しています。14 系が依存する `jwks-rsa@4` は ESM 専用の `jose@6` を
`require()` で読み込むため、`require(esm)` に対応していない Node.js で実行すると
`ERR_REQUIRE_ESM`（`Failed to load external module firebase-admin/auth`）となり全ページが 500 になります
（Vercel 本番環境で発生）。14 系に上げる場合は、実行環境の Node.js が `require(esm)` に対応しているか
（`node --no-experimental-require-module` で起動して再現しないか）を確認してください。

## 今後の予定（未実装）

- **ログイン**：現在は匿名認証のみです。ブラウザのデータを消すと別のユーザーになります。
  メール等のログインや、匿名ユーザーからのアカウント引き継ぎ、App Check の導入を検討します。
- 地図サービス（Google Maps など）の接続：`LocationMapProps`（`src/components/map/types.ts`）を満たす実装を作り、
  `src/components/map/LocationMap.tsx` で切り替えます。
- 位置情報による「近くで見つかったガチャ」

## 注意

表示している商品名・メーカー・店舗名・住所・在庫情報はすべて架空のダミーデータです。

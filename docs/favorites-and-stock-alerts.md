# お気に入り・在庫通知・「この店舗で見つけた」

## Firestore の構造（追加分）

| パス | 内容 | 書き込み |
|---|---|---|
| `users/{uid}/favorites/{productId}` | `productId`・`createdAt`・`notifyInStock`・`notifyEnabledAt`・`lastNotifiedAt`（商品名・価格は複製しない） | Server Action（ID トークンを検証した uid のみ） |
| `placements/{productId__locationId}.source` | 「この店舗で見つけた」で新しく作った設置情報は `"user_report"`（任意項目。既存ドキュメントは変更しない） | 在庫報告のトランザクション内 |

- 既存の `users/{uid}/reportThrottles` と同じく `users/{uid}` のサブコレクション。ドキュメント ID = productId のため同じ商品は 1 件だけ（登録・解除は冪等）
- `users/{uid}` ドキュメントは作らない（在庫報告の初回だけ作られる既存の動きのまま）
- Security Rules は変更なし：`users/{uid}/favorites` は「その他すべて拒否」に当たり、ブラウザから直接は読み書きできない（Admin SDK のみ）
- 新しいインデックスは不要（一覧は `createdAt` の単一フィールド、通知の確認は `notifyInStock == true` の単一条件）

## 読み取り・書き込み（Spark プラン）

| 操作 | 読み取り | 書き込み |
|---|---|---|
| ページ・地図・店舗・検索の表示 | 増えない（お気に入り状態は端末の控え localStorage から表示） | 0 |
| お気に入り登録 | 1（+ 商品の存在確認。商品詳細と同じキャッシュ） | 未登録の時だけ 1 |
| お気に入り解除 | 0 | 1 |
| 在庫通知 ON / OFF | 1 | 設定が変わる時だけ 1 |
| お気に入り一覧を開く | 本人のお気に入りの件数（上限 200）。商品情報・在庫集計はキャッシュ済みの索引・placements | 0 |
| 在庫通知の確認（通知 ON のお気に入りがある端末で、アプリを開いている間 15 分に 1 回） | 通知 ON のお気に入りの件数 + キャッシュが切れた商品の placements | 通知した商品の件数 |
| 「この店舗で見つけた」報告 | 既存と同じ（3、設置情報が無い時 +2） | 既存と同じ（最大 4、設置情報が無い時 +1） |

他のユーザーのお気に入りを読むことはない。

## 在庫通知

- 対象：通知 ON のお気に入り商品で、設置店舗の最新報告が「在庫あり」または「残りわずか」（どちらも「今買える」報告。商品詳細の「在庫あり報告」と同じ扱い）。売り切れの報告だけでは通知しない
- 通知を ON にした後・前回の通知の後の報告だけ（`notifyEnabledAt`・`lastNotifiedAt`）。報告から 24 時間を過ぎたものは通知しない
- 通知方法：アプリを開いている間の画面内のお知らせ ＋（許可されていれば）ブラウザ通知（Notification API）。許可はユーザーが通知を ON にした時だけ求める
- アプリを閉じている間の通知（FCM Web Push）は下の「バックグラウンド通知」。条件はアプリ内のお知らせと共通（`src/lib/favorites.ts` の `isStockAlertStatus`・`shouldNotifyFavorite`）

## 在庫情報の鮮度

- 最終確認から 24 時間以上たった報告には「情報が古い可能性があります」を表示する（`STOCK_STALE_AFTER_MS`）。在庫状態（在庫あり・売り切れなど）は変えない
- 相対時刻：「たった今確認」「12分前に確認」「2時間前に確認」「昨日確認」「3日前に確認」

## ルート案内

- 「📍 ここへ行く」→ Google マップ / Apple マップ（URL を開くだけ。API キー不要）。iPhone・Mac では Apple マップを先に表示
- 現在地が取れている場合は現在地 → 店舗、取れていない場合は店舗の座標を目的地として開く。現在地は選んだ地図サービスの URL にだけ入り、GachaNavi のサーバーには送らない
- 店舗の座標が無い場合は表示しない

## バックグラウンド通知（FCM Web Push）

Spark プランのまま、Cloud Functions を使わずに送る。

```
在庫報告（Server Action reportStockAction）
  └ 在庫報告のトランザクション（既存。10 分制限・古い報告で latestStock を上書きしない）
  └ レスポンスを返した後（next/server の after。トランザクションの外）
      sendStockPushNotifications（src/lib/data/index.ts）
        1. 在庫あり・残りわずか で、この報告が最新の在庫状態になった場合だけ（売り切れ・古い報告は 0 読み取り）
        2. collectionGroup("favorites") where productId == 商品 && notifyInStock == true（通知 ON の人だけを読む）
        3. shouldNotifyFavorite（通知 ON 後・前回の通知後・24 時間以内）を満たす人の users/{uid}/pushTokens
        4. Firebase Admin SDK の messaging().sendEach（data のみのメッセージ。表示は Service Worker）
        5. 届いた人の favorites.lastNotifiedAt を更新（同じ報告で再通知しない・アプリ内のお知らせとも重複しない）
        6. 無効なトークン（registration-token-not-registered / invalid-registration-token）だけ削除
```

- 送信の失敗は在庫報告に影響しない（報告は成功のまま。ログに記録）
- 受信：`public/firebase-messaging-sw.js`（push と通知のタップだけ。fetch・キャッシュには関与しない。Firebase SDK は読み込まない）。
  タップで `/gacha/{商品ID}` を開く。アイコンは GachaNavi のロゴのみ（商品画像・キャラクター画像は使わない）
- 端末の登録：通知 ON の操作で通知が許可された時だけ。通知 ON のお気に入りが無くなったら端末の登録を外す。1 日 1 回、登録済みの端末だけ登録を確認する
- `users/{uid}/pushTokens/{sha256(token) の先頭 40 文字}`：`token`・`platform`（"web"）・`createdAt`・`updatedAt` のみ。位置情報・端末情報は持たない。
  Security Rules の「その他すべて拒否」でブラウザからは読めない（Admin SDK のみ）
- インデックス：collection group `favorites`（productId ASC + notifyInStock ASC）。未作成の間は検索が失敗し、通知は送られない（報告は成功）

### 読み取り・書き込み（Firestore Emulator で計測）

| 操作 | 読み取り | 書き込み |
|---|---|---|
| 在庫報告そのもの | 3（設置情報が無い時 5）※ 変更なし | 4 ※ 変更なし |
| ＋通知処理：売り切れ・古い報告 | 0 | 0 |
| ＋通知処理：在庫あり・残りわずか（通知 ON の人 0 人） | 1 | 0 |
| ＋通知処理：通知 ON の人 W 人・そのうち条件を満たす人 T 人・各 D 台 | W + T × max(1, D)（+ 商品・店舗名 最大 2。キャッシュ） | 届いた人数 + 無効な端末の数 |
| 端末の登録（新しい端末／同じ端末・24 時間以内） | 1 | 1 ／ 0 |
| 通知 ON / OFF（変更あり／なし） | 1 | 1 ／ 0 |

例：通知 ON の人 3 人（端末 3 台）の商品に在庫あり報告 → 報告 3 読み取り・4 書き込み ＋ 通知 7 読み取り・2 書き込み、FCM 3 通。
ユーザー全体・お気に入り全体を走査することはない（1 回の報告で読む上限は 500 人 + 1 人あたり 10 台）。

### 費用

- FCM の送信は無料（Spark・Blaze とも）。Cloud Functions・Extensions・外部の Push サービスは使わない
- Vercel：在庫報告の Server Action が、レスポンス後に通知処理の分だけ長く動く（通常 1 秒未満）。Hobby プランの範囲
- Firestore：上の表のとおり。通知 ON のユーザーが非常に多い商品では読み取りが増えるため、無料枠（読み取り 5 万/日・書き込み 2 万/日）を超えないか、Firebase コンソールの使用量で確認する

/**
 * Firebase Client SDK（ブラウザ用）の初期化。
 *
 * データの読み書きはすべてサーバー（Admin SDK）で行っている。
 * ブラウザ側では、在庫報告の報告者を識別する匿名認証（./clientAuth.ts）でのみ使う。
 *
 * NEXT_PUBLIC_FIREBASE_* はブラウザに公開される値（Firebase の Web 用設定）で、秘密情報ではないが、
 * プロジェクトごとに異なるため環境変数で渡す。アクセス制御は Security Rules で行う。
 * ※ Next.js がビルド時に値を埋め込めるよう、process.env.NEXT_PUBLIC_... を1つずつ直接参照している。
 */
import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";

function readClientConfig(): FirebaseOptions | null {
  const config: FirebaseOptions = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  return config.apiKey && config.projectId && config.appId ? config : null;
}

/** Firebase の Web 設定が無い場合は null を返す（モック環境） */
export function getFirebaseClientApp(): FirebaseApp | null {
  if (getApps().length > 0) return getApp();
  const config = readClientConfig();
  return config ? initializeApp(config) : null;
}

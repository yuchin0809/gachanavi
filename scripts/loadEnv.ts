import { existsSync } from "node:fs";

/**
 * .env.local があれば読み込む（Next.js と同じファイルを使う）。
 * 無い場合は、シェルやクラウド環境の設定画面で指定された環境変数をそのまま使う。
 * すでに設定されている環境変数は .env.local の値で上書きされない。
 */
export function loadLocalEnv(): void {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
}

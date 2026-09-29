export type DataSourceKind = "mock" | "local" | "firestore";

/**
 * 使用するデータソース。環境変数 DATA_SOURCE で切り替える（未設定なら mock）。
 * Firebase プロジェクトが無くてもビルド・開発ができるよう、既定値はモックにしている。
 */
export function getDataSourceKind(): DataSourceKind {
  const value = process.env.DATA_SOURCE?.trim().toLowerCase();
  if (!value || value === "mock") return "mock";
  if (value === "firestore") return "firestore";
  if (value === "local") return "local";
  throw new Error(`DATA_SOURCE の値が不正です: "${process.env.DATA_SOURCE}"（mock / local / firestore）`);
}

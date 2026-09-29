import type { DataSourceKind } from "@/lib/data/config";

const NOTICE: Record<DataSourceKind, string> = {
  mock: "※ 開発版：表示している商品・店舗・在庫情報はすべてダミーデータです。",
  local:
    "※ ローカル確認版：商品・店舗はメーカー・運営会社の公式サイトから収集した情報です（取得時点の情報）。在庫報告は保存されません。",
  // 本番の Firestore には現在モックデータが入っているため、実データ投入時にこの文言も更新する
  firestore: "※ 開発版：表示している商品・店舗・在庫情報はすべてダミーデータです。",
};

export function SiteFooter({ dataSource }: { dataSource: DataSourceKind }) {
  return (
    <footer className="mt-12 border-t border-line py-8 text-center text-xs text-muted">
      <p>GachaNavi — 欲しいガチャを見つける。残っている場所まで分かる。</p>
      <p className="mt-1">{NOTICE[dataSource]}</p>
    </footer>
  );
}

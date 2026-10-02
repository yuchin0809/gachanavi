import Link from "next/link";
import type { DataSourceKind } from "@/lib/data/config";

const NOTICE: Record<DataSourceKind, string> = {
  mock: "※ 開発版：表示している商品・店舗・在庫情報はすべてダミーデータです。",
  local:
    "※ ローカル確認版：商品・店舗はメーカー・運営会社の公式サイトから収集した情報です（取得時点の情報）。在庫報告は保存されません。",
  firestore:
    "※ 商品・店舗はメーカー・運営会社の公式サイトに掲載された情報です（取得時点の情報）。在庫はユーザーの報告にもとづく目安のため、最新の状況は店舗でご確認ください。",
};

export function SiteFooter({ dataSource }: { dataSource: DataSourceKind }) {
  return (
    <footer className="mt-12 border-t border-line py-8 text-center text-xs text-muted">
      <nav aria-label="サイト内のページ" className="mb-3">
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 font-bold text-ink">
          <li>
            <Link href="/search" className="hover:underline">
              ガチャを探す
            </Link>
          </li>
          <li>
            <Link href="/locations" className="hover:underline">
              店舗一覧（都道府県別）
            </Link>
          </li>
          <li>
            <Link href="/favorites" className="hover:underline">
              お気に入り
            </Link>
          </li>
        </ul>
      </nav>
      <p>GachaNavi — 欲しいガチャを見つける。残っている場所まで分かる。</p>
      <p className="mt-1">{NOTICE[dataSource]}</p>
    </footer>
  );
}

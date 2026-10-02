import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GachaVisual } from "@/components/gacha/GachaVisual";
import { getCatalogProduct } from "@/lib/data";
import { svgMarkup } from "@/lib/visual/svgMarkup";
import { visualSpecOf } from "@/lib/visual/spec";

/**
 * 商品ページの OGP 画像（1200×630）：GachaNavi オリジナルの商品ビジュアル＋ GachaNavi のロゴ。
 * メーカーの画像は使わない。リクエスト時に作り、ファイルは保存しない（2.3 万件の画像ファイルを作らない）。
 * 商品名などの文字は og:title・og:description で表示されるため、画像には入れない（日本語フォントを読み込まない）
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "GachaNavi オリジナルの商品ビジュアル";
// 商品の索引は 1 時間キャッシュ。画像は CDN に 1 日キャッシュさせる（関数の実行回数を抑える）
const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

let logo: Promise<string> | null = null;
function logoDataUrl(): Promise<string> {
  logo ??= readFile(path.join(process.cwd(), "public/icons/icon-192.png")).then((b) => `data:image/png;base64,${b.toString("base64")}`);
  return logo;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getCatalogProduct(id);
  // 存在しない商品はページと同じく 404
  if (!product) return new Response("Not Found", { status: 404 });
  const spec = visualSpecOf(product);
  const visual = `data:image/svg+xml;base64,${Buffer.from(svgMarkup(GachaVisual({ spec, height: 200 }))).toString("base64")}`;
  const icon = await logoDataUrl();
  const pal = spec.palette;
  const bg = `linear-gradient(135deg, ${pal.bgFrom}, ${pal.bgTo})`;
  const ink = pal.dark ? "#ffffff" : "#1d1a2b";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: bg, gap: 64 }}>
        <img src={visual} width={520} height={520} alt="" style={{ borderRadius: 48 }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <img src={icon} width={180} height={180} alt="" style={{ borderRadius: 40 }} />
          <div style={{ fontSize: 64, fontWeight: 700, color: ink, display: "flex" }}>GachaNavi</div>
        </div>
      </div>
    ),
    { ...size, headers: { "Cache-Control": CACHE_CONTROL } },
  );
}

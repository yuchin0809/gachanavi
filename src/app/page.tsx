import { GachaCard } from "@/components/gacha/GachaCard";
import { HorizontalScroller } from "@/components/gacha/HorizontalScroller";
import { NearbyFindCard } from "@/components/gacha/NearbyFindCard";
import { SectionHeader } from "@/components/gacha/SectionHeader";
import { PageContainer } from "@/components/layout/PageContainer";
import { KeywordChips } from "@/components/search/KeywordChips";
import { SearchBar } from "@/components/search/SearchBar";
import { getCurrentPosition, getNearbyFinds, getNewProducts, getTrendingProducts } from "@/lib/data";
import { formatReleaseMonth } from "@/lib/format";

// 在庫・報告時刻は常に最新を表示したいため、リクエストごとに描画する
export const dynamic = "force-dynamic";

const POPULAR_KEYWORDS = ["ねこ", "ミニチュア", "恐竜", "ペンギン", "ぬいぐるみ", "深海"];

export default async function HomePage() {
  const position = getCurrentPosition();
  const [trending, newest, nearby] = await Promise.all([
    getTrendingProducts(),
    getNewProducts(),
    getNearbyFinds(position),
  ]);

  return (
    <>
      {/* ヒーロー：検索への導線を最優先 */}
      <section className="relative overflow-hidden border-b border-line bg-gradient-to-b from-brand-soft via-accent-soft/60 to-canvas">
        <Capsules />
        <PageContainer className="relative pb-7 pt-10 sm:pb-10 sm:pt-16">
          <p className="text-xs font-bold tracking-wider text-brand-ink">欲しいガチャを見つける。残っている場所まで分かる。</p>
          <h1 className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">欲しいガチャを探そう</h1>
          <div className="mt-5">
            <SearchBar size="hero" />
          </div>
          <div className="mt-3">
            <KeywordChips keywords={POPULAR_KEYWORDS} />
          </div>
        </PageContainer>
      </section>

      <PageContainer className="space-y-9 pt-7">
        <section>
          <SectionHeader icon="🔥" title="話題のガチャ" description="直近24時間の在庫報告が多いガチャ" moreHref="/search" />
          <HorizontalScroller>
            {trending.map((s, i) => (
              <GachaCard key={s.product.id} summary={s} badge={`${i + 1}位`} />
            ))}
          </HorizontalScroller>
        </section>

        <section>
          <SectionHeader icon="🆕" title="新着ガチャ" description="発売されたばかりのガチャ" moreHref="/search" />
          <HorizontalScroller>
            {newest.map((s) => (
              <GachaCard key={s.product.id} summary={s} badge={formatReleaseMonth(s.product.releaseMonth)} />
            ))}
          </HorizontalScroller>
        </section>

        <section>
          <SectionHeader
            icon="📍"
            title="近くで見つかったガチャ"
            description={`${position.label}（開発用の仮の現在地）で在庫ありと報告されたガチャ`}
          />
          {nearby.length > 0 ? (
            <ul className="space-y-2">
              {nearby.map((find) => (
                <li key={`${find.product.id}-${find.location.id}`}>
                  <NearbyFindCard find={find} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted ring-1 ring-line">
              近くで在庫ありの報告はまだありません。
            </p>
          )}
        </section>
      </PageContainer>
    </>
  );
}

/** ヒーロー背景の装飾カプセル */
function Capsules() {
  const capsules = [
    { className: "-right-6 top-6 h-24 w-24", top: "#ef4550" },
    { className: "right-20 -top-5 h-12 w-12", top: "#ffc83d" },
    { className: "right-6 bottom-4 h-14 w-14", top: "#5b7cfa" },
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden opacity-70 sm:block">
      {capsules.map((c, i) => (
        <svg key={i} viewBox="0 0 40 40" className={`absolute ${c.className}`}>
          <circle cx="20" cy="20" r="18" fill="#fff" stroke="#1d1a2b" strokeWidth="1.5" />
          <path d="M2 20a18 18 0 0 1 36 0Z" fill={c.top} stroke="#1d1a2b" strokeWidth="1.5" />
        </svg>
      ))}
    </div>
  );
}

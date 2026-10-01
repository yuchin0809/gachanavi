import Image from "next/image";

/**
 * GachaNavi のロゴ：アプリアイコン（カプセル＋ナビ矢印。public/icons/logo-mark-64.png）＋ワードマーク。
 * アイコンの元データは assets/brand/（scripts/build-icons.mjs で各サイズを作る）
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Image
        src="/icons/logo-mark-64.png"
        alt=""
        width={32}
        height={32}
        priority
        // 64px の小さな画像のため最適化（画像変換）を通さない
        unoptimized
        className="h-8 w-8 rounded-[9px]"
      />
      <span className="text-lg font-extrabold tracking-tight">
        Gacha<span className="text-brand">Navi</span>
      </span>
    </span>
  );
}

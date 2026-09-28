"use client";

import { useMemo } from "react";
import { NearbyFindCard } from "@/components/gacha/NearbyFindCard";
import { SectionHeader } from "@/components/gacha/SectionHeader";
import { pickNearbyFinds } from "@/lib/geo";
import type { NearbyFindCandidate } from "@/types";
import { CurrentPositionBar } from "./CurrentPositionBar";
import { useCurrentPosition } from "./CurrentPositionProvider";

/** トップの 📍 近くで見つかったガチャ（距離は現在地を使ってブラウザ側で計算する） */
export function NearbyFindsSection({ candidates }: { candidates: NearbyFindCandidate[] }) {
  const { position, label, isCurrent } = useCurrentPosition();
  const nearby = useMemo(() => pickNearbyFinds(candidates, position), [candidates, position]);

  return (
    <section>
      <SectionHeader
        icon="📍"
        title="近くで見つかったガチャ"
        description={`${isCurrent ? "現在地" : `${label}（仮の現在地）`}の近くで在庫ありと報告されたガチャ`}
      />
      <CurrentPositionBar className="mb-3" />
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
  );
}

"use client";

import { useState } from "react";
import { useCurrentPosition } from "@/components/geo/CurrentPositionProvider";
import { ExternalIcon } from "@/components/ui/Icons";
import { isIOSDevice } from "@/lib/browserNotification";
import { hasCoordinates, routeUrls } from "@/lib/geo";
import type { Location } from "@/types";

/**
 * 「📍 ここへ行く」：Google マップ / Apple マップでルートを開く。
 * 店舗の座標が無い場合は表示しない。現在地はリンク先の地図サービスにだけ渡し、GachaNavi のサーバーには送らない。
 */
export function RouteButton({ location, className = "" }: { location: Pick<Location, "lat" | "lng" | "name">; className?: string }) {
  const { position, isCurrent } = useCurrentPosition();
  const [open, setOpen] = useState(false);
  const [appleFirst, setAppleFirst] = useState(false);
  if (!hasCoordinates(location)) return null;

  const urls = routeUrls(location, isCurrent ? position : null);
  const links = [
    { key: "google", label: "Googleマップ", href: urls.google },
    { key: "apple", label: "Appleマップ", href: urls.apple },
  ];
  if (appleFirst) links.reverse();

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setAppleFirst(isIOSDevice() || /Macintosh/.test(navigator.userAgent));
          setOpen((v) => !v);
        }}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink px-4 text-base font-extrabold text-white shadow-card transition active:scale-[0.98]"
      >
        <span aria-hidden="true">📍</span>
        ここへ行く
      </button>
      {open && (
        <div className="mt-2 rounded-2xl bg-canvas p-2 ring-1 ring-line">
          <p className="px-1 pb-1.5 text-[11px] text-muted">
            {isCurrent ? "現在地から「" : "「"}
            <span className="font-bold">{location.name}</span>
            {isCurrent ? "」までのルートを開きます" : "」を目的地として開きます"}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {links.map((l) => (
              <a
                key={l.key}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${l.label}で開く`}
                className="flex h-11 items-center justify-center gap-1 whitespace-nowrap rounded-xl bg-surface px-2 text-center text-sm font-bold ring-1 ring-line hover:ring-ink/40"
              >
                {l.label}
                <ExternalIcon className="h-3.5 w-3.5 shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { LocationMap } from "@/components/map/LocationMap";
import { RouteButton } from "@/components/map/RouteButton";
import { ClockIcon, ExternalIcon, PinIcon } from "@/components/ui/Icons";
import { googleMapsUrl, hasCoordinates } from "@/lib/geo";
import type { Location } from "@/types";

/** 設置場所の基本情報（店舗名・住所・営業時間・地図） */
export function LocationInfoCard({ location }: { location: Location }) {
  return (
    <section className="overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-line">
      <div className="p-2 pb-0">
        {hasCoordinates(location) ? (
          <LocationMap
            markers={[{ id: location.id, label: location.name, lat: location.lat, lng: location.lng }]}
            selectedId={location.id}
          />
        ) : (
          <p className="flex aspect-[4/1] items-center justify-center rounded-2xl border border-dashed border-line bg-canvas text-sm text-muted">
            地図情報なし（位置情報が登録されていません）
          </p>
        )}
      </div>
      <div className="p-4">
        {location.area && <p className="text-xs font-bold text-brand-ink">{location.area}</p>}
        <h1 className="mt-0.5 text-xl font-extrabold leading-snug">{location.name}</h1>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex gap-2">
            <dt className="shrink-0 pt-0.5 text-muted">
              <PinIcon className="h-4 w-4" />
              <span className="sr-only">住所</span>
            </dt>
            <dd>{location.address}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 pt-0.5 text-muted">
              <ClockIcon className="h-4 w-4" />
              <span className="sr-only">営業時間</span>
            </dt>
            <dd className={location.openingHours ? undefined : "text-muted"}>
              {location.openingHours ?? "営業時間の情報なし"}
            </dd>
          </div>
        </dl>
        {hasCoordinates(location) ? (
          <RouteButton location={location} className="mt-4" />
        ) : (
          // 座標が無い店舗は「ここへ行く」を出さず、店舗名・住所で地図を検索するだけにする
          <a
            href={googleMapsUrl(location)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex h-11 items-center justify-center gap-1.5 rounded-full border-2 border-ink text-sm font-bold hover:bg-canvas"
          >
            Googleマップで店舗名・住所を検索
            <ExternalIcon className="h-4 w-4" />
          </a>
        )}
      </div>
    </section>
  );
}

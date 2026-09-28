import { LocationMap } from "@/components/map/LocationMap";
import { ClockIcon, ExternalIcon, PinIcon } from "@/components/ui/Icons";
import { googleMapsUrl } from "@/lib/geo";
import type { Location } from "@/types";

/** 設置場所の基本情報（店舗名・住所・営業時間・地図） */
export function LocationInfoCard({ location }: { location: Location }) {
  return (
    <section className="overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-line">
      <div className="p-2 pb-0">
        <LocationMap
          markers={[{ id: location.id, label: location.name, lat: location.lat, lng: location.lng }]}
          selectedId={location.id}
        />
      </div>
      <div className="p-4">
        <p className="text-xs font-bold text-brand-ink">{location.area}</p>
        <h1 className="mt-0.5 text-xl font-extrabold leading-snug">{location.name}</h1>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex gap-2">
            <dt className="shrink-0 pt-0.5 text-muted">
              <PinIcon className="h-4 w-4" />
              <span className="sr-only">住所</span>
            </dt>
            <dd>{location.address}</dd>
          </div>
          {location.openingHours && (
            <div className="flex gap-2">
              <dt className="shrink-0 pt-0.5 text-muted">
                <ClockIcon className="h-4 w-4" />
                <span className="sr-only">営業時間</span>
              </dt>
              <dd>{location.openingHours}</dd>
            </div>
          )}
        </dl>
        <a
          href={googleMapsUrl(location, location.name)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex h-11 items-center justify-center gap-1.5 rounded-full border-2 border-ink text-sm font-bold hover:bg-canvas"
        >
          Googleマップで経路を見る
          <ExternalIcon className="h-4 w-4" />
        </a>
      </div>
    </section>
  );
}

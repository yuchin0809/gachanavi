"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getStoreDetailAction, getStoreMapEntriesAction, type StoreDetailResult } from "@/app/actions/stores";
import { GachaImage } from "@/components/gacha/GachaImage";
import { SectionHeader } from "@/components/gacha/SectionHeader";
import type { StorePin, ViewBounds } from "@/components/map/LeafletStoreMap";
import { RouteButton } from "@/components/map/RouteButton";
import { LastChecked } from "@/components/stock/LastChecked";
import { StockBadge, StockDot } from "@/components/stock/StockBadge";
import { useStockResolver } from "@/components/stock/StockReportsProvider";
import { ChevronRightIcon, ExternalIcon, PinIcon } from "@/components/ui/Icons";
import { formatDistance } from "@/lib/format";
import { distanceMeters } from "@/lib/geo";
import { STOCK_STATUS_ORDER } from "@/lib/stock";
import type { StockStatus, StoreMapEntry } from "@/types";
import { CurrentPositionBar } from "./CurrentPositionBar";
import { useCurrentPosition } from "./CurrentPositionProvider";

// Leaflet はブラウザ専用のため、サーバーでは描画しない
const LeafletStoreMap = dynamic(() => import("@/components/map/LeafletStoreMap").then((m) => m.LeafletStoreMap), {
  ssr: false,
  loading: () => <div className="h-[340px] w-full animate-pulse rounded-2xl bg-line/60 sm:h-[400px]" />,
});

/** 近くの店舗一覧の件数 */
const LIST_LIMIT = 10;
/** 地図に最初から出す近い店舗の数 */
const NEAR_PINS = 40;
/** 表示範囲内に描くピンの上限（全国を表示したときに描きすぎない） */
const VIEW_PINS_LIMIT = 150;
const STORAGE_KEY = "gachanavi:nearby-store";

type StoreWithDistance = StoreMapEntry & { distance: number };

/** 設置商品の在庫状態の中で最も良いもの（在庫あり → 残りわずか → 売り切れ → 未確認）。設置情報が無ければ null */
function bestStatus(s: StoreMapEntry): StockStatus | null {
  if (s.placementCount === 0) return null;
  return (["in_stock", "low", "sold_out", "unknown"] as const).find((k) => s.stockCounts[k] > 0) ?? "unknown";
}

function readStored(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string | null) {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 保存できなくても動作には影響しない
  }
}

/**
 * トップの 📍 近くのガチャガチャ：地図 + 選択中の店舗 + 近くの店舗一覧。
 *
 * データの取得は段階的に行う（トップを開いただけで大量の読み取りをしない）:
 * 1. 店舗の一覧（索引・キャッシュ済み。座標と設置・在庫の件数だけの軽量版）を 1 回取得
 * 2. 距離の計算・近い店舗の絞り込みはブラウザ側（現在地はサーバーに送らない）
 * 3. 店舗を選んだときだけ、その店舗の詳細と設置商品を取得（店舗詳細ページと同じ処理・キャッシュ）
 */
export function NearbyStoresSection() {
  const { position, label, isCurrent } = useCurrentPosition();
  const [stores, setStores] = useState<StoreMapEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<ViewBounds | null>(null);
  /** 店舗を選んで地図を移動した先（その時点の現在地の key 付き。現在地が変わったら現在地へ戻る） */
  const [storeFocus, setStoreFocus] = useState<{ key: string; point: { lat: number; lng: number }; zoom?: number; at: string } | null>(null);
  const [details, setDetails] = useState<Record<string, StoreDetailResult | "loading">>({});
  const requested = useRef(new Set<string>());
  const panelRef = useRef<HTMLDivElement>(null);


  // 2. 距離（ブラウザ側）
  const sorted = useMemo<StoreWithDistance[]>(
    () =>
      (stores ?? [])
        .map((s) => ({ ...s, distance: distanceMeters(position, s) }))
        .sort((a, b) => a.distance - b.distance),
    [stores, position],
  );
  const byId = useMemo(() => new Map(sorted.map((s) => [s.id, s])), [sorted]);
  const nearest = sorted.slice(0, LIST_LIMIT);

  // 地図の移動先：店舗を選んだらその店舗、現在地（基準地点）が変わったらその周辺
  const positionKey = `${position.lat.toFixed(4)},${position.lng.toFixed(4)}`;
  const focus =
    storeFocus && storeFocus.at === positionKey ? storeFocus : { key: `here:${positionKey}`, point: position, zoom: 14 };

  // 3. 店舗を選んだら詳細を取得（1 店舗につき 1 回）
  const loadDetail = useCallback((id: string) => {
    if (requested.current.has(id)) return;
    requested.current.add(id);
    setDetails((d) => ({ ...d, [id]: "loading" }));
    getStoreDetailAction(id)
      .then((res) => setDetails((d) => ({ ...d, [id]: res })))
      .catch(() => {
        requested.current.delete(id);
        setDetails((d) => ({ ...d, [id]: { ok: false, error: "server_error" } }));
      });
  }, []);

  const select = useCallback(
    (id: string, options: { move?: boolean; scroll?: boolean } = {}) => {
      setSelectedId(id);
      writeStored(id);
      loadDetail(id);
      const store = byId.get(id);
      if (options.move && store) setStoreFocus({ key: `store:${id}:${Date.now()}`, point: store, zoom: 16, at: positionKey });
      if (options.scroll) requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    },
    [byId, loadDetail, positionKey],
  );

  // 1. 店舗の一覧（1 回だけ）。読み込めたら、商品詳細などから戻ったときの選択中の店舗を復元する
  useEffect(() => {
    let cancelled = false;
    getStoreMapEntriesAction()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setLoadFailed(true);
          return;
        }
        setStores(res.stores);
        const id = readStored();
        const store = id ? res.stores.find((s) => s.id === id) : undefined;
        if (store) {
          setSelectedId(store.id);
          loadDetail(store.id);
          setStoreFocus({ key: `store:${store.id}:restore`, point: store, zoom: 16, at: positionKey });
        }
      })
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 最初の 1 回だけ読み込む
  }, []);

  // 地図に描くピン：近い店舗 + 表示範囲内の店舗（上限あり）+ 選択中の店舗
  const pins = useMemo<StorePin[]>(() => {
    const chosen = new Map<string, StoreWithDistance>();
    for (const s of sorted.slice(0, NEAR_PINS)) chosen.set(s.id, s);
    if (bounds) {
      let n = 0;
      for (const s of sorted) {
        if (n >= VIEW_PINS_LIMIT) break;
        if (s.lat >= bounds.south && s.lat <= bounds.north && s.lng >= bounds.west && s.lng <= bounds.east) {
          chosen.set(s.id, s);
          n++;
        }
      }
    }
    if (selectedId && byId.has(selectedId)) chosen.set(selectedId, byId.get(selectedId)!);
    return [...chosen.values()].map((s) => ({ id: s.id, label: s.name, lat: s.lat, lng: s.lng, status: bestStatus(s) }));
  }, [sorted, bounds, selectedId, byId]);

  const selected = selectedId ? byId.get(selectedId) : undefined;
  const selectedDetail = selectedId ? details[selectedId] : undefined;

  return (
    <section>
      <SectionHeader
        icon="📍"
        title="近くのガチャガチャ"
        description={`${isCurrent ? "現在地" : `${label}（仮の現在地）`}の近くの店舗。ピンを押すと設置されているガチャと在庫が見られます`}
      />
      <CurrentPositionBar className="mb-3" />

      <LeafletStoreMap
        center={position}
        pins={pins}
        selectedId={selectedId}
        focus={focus}
        onSelect={(id) => select(id, { scroll: true })}
        onBoundsChange={setBounds}
      />
      <MapLegend />

      {loadFailed && (
        <p role="alert" className="mt-3 rounded-2xl bg-stock-out-soft p-3 text-sm font-bold text-stock-out-ink">
          店舗を読み込めませんでした。時間をおいてページを再読み込みしてください。
        </p>
      )}

      <div ref={panelRef} aria-live="polite" className="scroll-mt-4">
        {selected && (
          <StorePanel
            store={selected}
            detail={selectedDetail}
            onClose={() => {
              setSelectedId(null);
              writeStored(null);
            }}
          />
        )}
      </div>

      <div className="mt-5">
        <h3 className="mb-2 text-sm font-extrabold">近くの店舗</h3>
        {stores === null && !loadFailed ? (
          <p className="rounded-2xl bg-surface p-4 text-center text-sm text-muted ring-1 ring-line">店舗を読み込んでいます…</p>
        ) : nearest.length === 0 ? (
          <p className="rounded-2xl bg-surface p-4 text-center text-sm text-muted ring-1 ring-line">近くに店舗が見つかりませんでした。</p>
        ) : (
          <ol className="space-y-2">
            {nearest.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => select(s.id, { move: true, scroll: true })}
                  aria-pressed={s.id === selectedId}
                  className={`flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-left shadow-card ring-1 transition active:scale-[0.99] ${
                    s.id === selectedId ? "ring-2 ring-ink" : "ring-line hover:ring-ink/30"
                  }`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-extrabold text-muted">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-bold leading-snug">{s.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-bold text-ink">{formatDistance(s.distance)}</span>
                      <StockSummary store={s} />
                    </span>
                  </span>
                  <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** 店舗の在庫の要約（設置情報と在庫報告を分けて表示する） */
function StockSummary({ store }: { store: StoreMapEntry }) {
  const c = store.stockCounts;
  if (store.placementCount === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-muted">
        <NoPlacementDot className="h-2 w-2 border-[1.5px]" />
        設置情報なし
      </span>
    );
  }
  const parts: { status: StockStatus; text: string }[] = [];
  if (c.in_stock) parts.push({ status: "in_stock", text: `在庫あり ${c.in_stock}` });
  if (c.low) parts.push({ status: "low", text: `残りわずか ${c.low}` });
  if (c.sold_out) parts.push({ status: "sold_out", text: `売り切れ ${c.sold_out}` });
  if (c.unknown) parts.push({ status: "unknown", text: `未確認 ${c.unknown}` });
  return (
    <>
      <span className="text-muted">設置 {store.placementCount}商品</span>
      {parts.map((p) => (
        <span key={p.status} className="inline-flex items-center gap-1 text-muted">
          <StockDot status={p.status} className="h-2 w-2" />
          {p.text}
        </span>
      ))}
    </>
  );
}

/** 選択中の店舗の詳細パネル */
function StorePanel({
  store,
  detail,
  onClose,
}: {
  store: StoreWithDistance;
  detail: StoreDetailResult | "loading" | undefined;
  onClose: () => void;
}) {
  const resolve = useStockResolver();
  const location = detail && detail !== "loading" && detail.ok ? detail.location : null;
  const products =
    detail && detail !== "loading" && detail.ok
      ? detail.products
          .map((e) => ({ ...e, stock: resolve(e.product.id, store.id, e.stock) }))
          .sort(
            (a, b) =>
              STOCK_STATUS_ORDER[a.stock.status] - STOCK_STATUS_ORDER[b.stock.status] ||
              (b.stock.lastCheckedAt ?? "").localeCompare(a.stock.lastCheckedAt ?? ""),
          )
      : [];

  return (
    <article className="mt-3 rounded-2xl bg-surface p-4 shadow-card ring-2 ring-ink">
      <div className="flex items-start gap-2">
        <PinIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-extrabold leading-snug">{store.name}</h3>
          <p className="mt-0.5 text-xs font-bold text-ink">{`現在地から ${formatDistance(store.distance)}`}</p>
        </div>
        <button type="button" onClick={onClose} className="-mr-1 -mt-1 h-9 shrink-0 rounded-full px-3 text-xs font-bold text-muted hover:bg-canvas">
          閉じる
        </button>
      </div>

      {detail === "loading" || detail === undefined ? (
        <p className="mt-3 text-sm text-muted">店舗の情報を読み込んでいます…</p>
      ) : !detail.ok ? (
        <p role="alert" className="mt-3 text-sm font-bold text-stock-out-ink">
          {detail.error === "not_found" ? "この店舗の情報が見つかりませんでした。" : "店舗の情報を読み込めませんでした。時間をおいてお試しください。"}
        </p>
      ) : (
        <>
          <div className="mt-3 space-y-1 text-sm">
            {location?.address && <p className="break-words text-muted">{location.address}</p>}
            {location?.openingHours && <p className="break-words text-xs text-muted">営業時間：{location.openingHours}</p>}
          </div>
          <RouteButton location={store} className="mt-3" />
          <div className="mt-3 flex flex-wrap gap-2">
            {location?.officialUrl && (
              <a
                href={location.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 max-w-full items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-bold hover:bg-canvas"
              >
                <span className="truncate">公式サイトを見る</span>
                <ExternalIcon className="h-4 w-4 shrink-0" />
              </a>
            )}
            <Link
              href={`/locations/${store.id}`}
              className="inline-flex h-10 max-w-full items-center gap-1 rounded-xl border border-line px-3 text-sm font-bold hover:bg-canvas"
            >
              <span className="truncate">店舗ページ</span>
              <ChevronRightIcon className="h-4 w-4 shrink-0" />
            </Link>
          </div>

          <h4 className="mt-4 text-sm font-extrabold">
            この店舗のガチャ<span className="ml-1 text-xs font-normal text-muted">{products.length}件</span>
          </h4>
          {products.length === 0 ? (
            <p className="mt-2 rounded-xl bg-canvas p-3 text-xs text-muted">
              この店舗に設置されているガチャの情報はまだありません。お店でガチャを見つけたら、商品ページの「この店舗で見つけた」から教えてください。
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {products.map(({ product, stock }) => (
                <li key={product.id}>
                  <Link href={`/gacha/${product.id}`} className="flex items-center gap-3 py-2.5">
                    <GachaImage product={product} sizes="56px" className="w-14 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-bold leading-snug">{product.name}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <StockBadge status={stock.status} size="sm" />
                        <LastChecked at={stock.lastCheckedAt} />
                      </span>
                    </span>
                    <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

/** 設置情報が無い店舗の印（地図の白いピンと同じ。灰色の「未確認」と区別する） */
function NoPlacementDot({ className }: { className: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 rounded-full border-ink bg-surface ${className}`} />;
}

function MapLegend() {
  const items: { status: StockStatus | null; label: string }[] = [
    { status: "in_stock", label: "在庫あり" },
    { status: "low", label: "残りわずか" },
    { status: "sold_out", label: "売り切れ" },
    { status: "unknown", label: "未確認" },
    { status: null, label: "設置情報なし" },
  ];
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted" aria-label="ピンの色">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1">
          {it.status ? (
            <StockDot status={it.status} className="h-2.5 w-2.5" />
          ) : (
            <NoPlacementDot className="h-2.5 w-2.5 border-2" />
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

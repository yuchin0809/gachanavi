"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { searchLocationsAction, type LocationCandidate } from "@/app/actions/locations";
import { CheckIcon, ChevronLeftIcon, ClockIcon, SearchIcon, StoreIcon } from "@/components/ui/Icons";
import { StockReportError } from "@/lib/data/reports";
import { REPORT_COOLDOWN_MS, placementIdOf } from "@/lib/data/source";
import { REPORTABLE_STATUSES, STOCK_STATUS_META } from "@/lib/stock";
import type { ID, ReportableStockStatus } from "@/types";
import { StockDot } from "./StockBadge";
import { useReportStock, useReportsPersistent } from "./StockReportsProvider";

/**
 * 「この店で見つけた」報告：商品詳細から、店舗を検索・選択 → 在庫状態を選択 → 確認 → 送信。
 *
 * 保存は既存の在庫報告（Server Action reportStockAction → DataSource.addStockReport）を使う。
 * 設置情報（placement）が無い「商品×店舗」は、報告と同時に作成される。
 * 同じ商品×店舗への 10 分以内の再報告はサーバー側で拒否され、待ち時間を表示する。
 */

type Step = "store" | "status" | "confirm" | "submitting" | "result";

type Outcome =
  | { kind: "success"; status: ReportableStockStatus }
  | { kind: "rate_limited"; until: number }
  | { kind: "error"; message: string; retryable: boolean };

interface ProductSummary {
  id: ID;
  name: string;
  maker: string;
}

const STEP_LABELS: Record<"store" | "status" | "confirm", string> = {
  store: "店舗を選ぶ",
  status: "在庫を選ぶ",
  confirm: "確認",
};
const STEP_ORDER = ["store", "status", "confirm"] as const;

/* ---------------- 連投制限の表示用（サーバーの判定が正。ここは待ち時間の案内だけ） ---------------- */

const STORAGE_PREFIX = "gachanavi:reported:";

function rememberReported(productId: ID, locationId: ID, at: number): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + placementIdOf(productId, locationId), String(at));
  } catch {
    // プライベートブラウズなどで保存できなくても、サーバー側の制限で守られる
  }
}

/** この端末から最近報告していれば、再報告できる時刻を返す */
function cooldownUntil(productId: ID, locationId: ID): number | null {
  try {
    const at = Number(localStorage.getItem(STORAGE_PREFIX + placementIdOf(productId, locationId)));
    if (!at) return null;
    const until = at + REPORT_COOLDOWN_MS;
    return until > Date.now() ? until : null;
  } catch {
    return null;
  }
}

function formatWait(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}分${String(s).padStart(2, "0")}秒` : `${s}秒`;
}

/** 1 秒ごとに現在時刻を更新する（待ち時間のカウントダウン用） */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0); // 表示を開始した時点の時刻にすぐ合わせる
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active]);
  return now;
}

function errorOutcome(error: unknown): Outcome {
  if (error instanceof StockReportError) {
    switch (error.code) {
      case "rate_limited":
        return { kind: "rate_limited", until: Date.now() + (error.retryAfterSeconds ?? 600) * 1000 };
      case "unauthenticated":
        return {
          kind: "error",
          retryable: true,
          message: "報告者の確認（匿名ログイン）ができませんでした。通信状態を確認して、もう一度お試しください。",
        };
      case "placement_not_found":
        return {
          kind: "error",
          retryable: false,
          message: "このガチャまたは店舗の情報が見つかりませんでした。ページを再読み込みしてからお試しください。",
        };
      case "invalid_input":
        return { kind: "error", retryable: false, message: "報告内容に誤りがあります。最初からやり直してください。" };
    }
  }
  return {
    kind: "error",
    retryable: true,
    message: "送信できませんでした。通信状態を確認して、時間をおいてもう一度お試しください。",
  };
}

/* ------------------------------------------------------------------ */

export function FoundAtStoreReport({
  product,
  knownLocations,
}: {
  product: ProductSummary;
  /** このガチャがすでに報告されている店舗（検索しなくても選べるよう候補に出す） */
  knownLocations: LocationCandidate[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-base font-extrabold text-white shadow-card transition active:scale-[0.98]"
      >
        <StoreIcon className="h-5 w-5" />
        この店で見つけた
      </button>
      {open && <ReportSheet product={product} knownLocations={knownLocations} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportSheet({
  product,
  knownLocations,
  onClose,
}: {
  product: ProductSummary;
  knownLocations: LocationCandidate[];
  onClose: () => void;
}) {
  const router = useRouter();
  const report = useReportStock();
  const persistent = useReportsPersistent();
  const titleId = useId();

  const [step, setStep] = useState<Step>("store");
  const [store, setStore] = useState<LocationCandidate | null>(null);
  const [status, setStatus] = useState<ReportableStockStatus | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const localUntil = store ? cooldownUntil(product.id, store.id) : null;
  const waitUntil = outcome?.kind === "rate_limited" ? outcome.until : step === "confirm" ? localUntil : null;
  const now = useNow(waitUntil !== null);
  const waitMs = waitUntil !== null ? waitUntil - now : 0;
  const waiting = waitMs > 0;

  // Esc で閉じる・背面のスクロールを止める
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "submitting") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, step]);

  async function submit() {
    if (!store || !status) return;
    setStep("submitting");
    try {
      await report({ productId: product.id, locationId: store.id, status });
      rememberReported(product.id, store.id, Date.now());
      setOutcome({ kind: "success", status });
      // 新しく作られた設置情報・在庫状態を商品詳細に反映する
      router.refresh();
    } catch (error) {
      const next = errorOutcome(error);
      if (next.kind === "rate_limited") rememberReported(product.id, store.id, next.until - REPORT_COOLDOWN_MS);
      setOutcome(next);
    }
    setStep("result");
  }

  function restart() {
    setStore(null);
    setStatus(null);
    setOutcome(null);
    setStep("store");
  }

  const back = () => {
    if (step === "status") setStep("store");
    else if (step === "confirm") setStep("status");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="閉じる"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={() => step !== "submitting" && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-surface shadow-card sm:max-w-lg sm:rounded-3xl"
      >
        {/* ヘッダー */}
        <div className="flex items-center gap-2 border-b border-line px-4 pb-3 pt-4">
          {(step === "status" || step === "confirm") && (
            <button
              type="button"
              onClick={back}
              aria-label="戻る"
              className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full hover:bg-canvas"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-extrabold">
              この店で見つけた
            </h2>
            <p className="truncate text-xs text-muted">{product.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={step === "submitting"}
            className="h-9 rounded-full px-3 text-sm font-bold text-muted hover:bg-canvas disabled:opacity-40"
          >
            閉じる
          </button>
        </div>

        {step !== "result" && step !== "submitting" && (
          <ol className="flex gap-1 px-4 pt-3" aria-label="手順">
            {STEP_ORDER.map((s, i) => {
              const current = STEP_ORDER.indexOf(step as (typeof STEP_ORDER)[number]);
              return (
                <li key={s} className="flex-1" aria-current={i === current ? "step" : undefined}>
                  <div className={`h-1 rounded-full ${i <= current ? "bg-brand" : "bg-line"}`} />
                  <p className={`mt-1 text-[11px] font-bold ${i === current ? "text-ink" : "text-muted"}`}>
                    {i + 1}. {STEP_LABELS[s]}
                  </p>
                </li>
              );
            })}
          </ol>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          {step === "store" && (
            <StoreStep
              knownLocations={knownLocations}
              selectedId={store?.id ?? null}
              onSelect={(s) => {
                setStore(s);
                setStep("status");
              }}
            />
          )}

          {step === "status" && store && (
            <div>
              <SelectedStore store={store} />
              <p className="mt-4 text-sm font-bold">今の在庫はどうでしたか？</p>
              <div className="mt-2 grid gap-2">
                {REPORTABLE_STATUSES.map((s) => {
                  const meta = STOCK_STATUS_META[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setStatus(s);
                        setStep("confirm");
                      }}
                      aria-pressed={status === s}
                      className={`flex h-14 items-center gap-3 rounded-2xl border-2 bg-surface px-4 text-base font-bold transition active:scale-[0.98] ${meta.buttonClass} ${
                        status === s ? "ring-2 ring-current ring-offset-1" : ""
                      }`}
                    >
                      <StockDot status={s} className="h-3.5 w-3.5" />
                      {meta.reportLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {(step === "confirm" || step === "submitting") && store && status && (
            <div>
              <p className="text-sm font-bold">この内容で報告します。よろしいですか？</p>
              <dl className="mt-3 divide-y divide-line rounded-2xl bg-canvas px-3 text-sm">
                <div className="py-2.5">
                  <dt className="text-[11px] font-bold text-muted">ガチャ</dt>
                  <dd className="font-bold leading-snug">{product.name}</dd>
                  <dd className="text-xs text-muted">{product.maker}</dd>
                </div>
                <div className="py-2.5">
                  <dt className="text-[11px] font-bold text-muted">店舗</dt>
                  <dd className="font-bold leading-snug">{store.name}</dd>
                  <dd className="text-xs text-muted">{store.address}</dd>
                </div>
                <div className="py-2.5">
                  <dt className="text-[11px] font-bold text-muted">在庫</dt>
                  <dd className="mt-0.5 flex items-center gap-1.5 font-bold">
                    <StockDot status={status} />
                    {STOCK_STATUS_META[status].label}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                報告は匿名で送信され、ほかのユーザーに「最終確認」として表示されます。同じガチャ・同じ店舗への報告は10分に1回までです。
              </p>
              {waiting && step === "confirm" && (
                <WaitNotice waitMs={waitMs} lead="この店舗には少し前に報告済みです。" />
              )}
            </div>
          )}

          {step === "result" && outcome && store && (
            <ResultView
              outcome={outcome}
              waitMs={waitMs}
              store={store}
              productId={product.id}
              persistent={persistent}
            />
          )}
        </div>

        {/* フッターの操作ボタン（親指で押しやすい下部に固定） */}
        {(step === "confirm" || step === "submitting") && (
          <div className="border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={submit}
              disabled={step === "submitting" || waiting}
              className="h-12 w-full rounded-2xl bg-brand text-base font-extrabold text-white disabled:opacity-50"
            >
              {step === "submitting" ? "送信中…" : waiting ? `あと${formatWait(waitMs)}で報告できます` : "この内容で報告する"}
            </button>
          </div>
        )}
        {step === "result" && outcome && (
          <div className="flex gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {outcome.kind === "error" && outcome.retryable && (
              <button
                type="button"
                onClick={submit}
                className="h-12 flex-1 rounded-2xl bg-brand text-base font-extrabold text-white"
              >
                もう一度送信
              </button>
            )}
            {outcome.kind === "rate_limited" && !waiting && (
              <button
                type="button"
                onClick={() => {
                  setOutcome(null);
                  setStep("confirm");
                }}
                className="h-12 flex-1 rounded-2xl bg-brand text-base font-extrabold text-white"
              >
                もう一度報告する
              </button>
            )}
            {outcome.kind !== "error" || !outcome.retryable ? (
              <button
                type="button"
                onClick={restart}
                className="h-12 flex-1 rounded-2xl border border-line text-sm font-bold"
              >
                別の店舗を報告
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="h-12 flex-1 rounded-2xl border border-line text-sm font-bold">
              閉じる
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SelectedStore({ store }: { store: LocationCandidate }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-canvas p-3">
      <StoreIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
      <div className="min-w-0">
        <p className="text-sm font-bold leading-snug">{store.name}</p>
        <p className="text-xs text-muted">{store.address}</p>
      </div>
    </div>
  );
}

function WaitNotice({ waitMs, lead }: { waitMs: number; lead: string }) {
  return (
    <div role="status" className="mt-3 flex items-start gap-2 rounded-2xl bg-stock-low-soft p-3 text-stock-low-ink">
      <ClockIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="text-sm font-bold">
        {lead}
        <br />
        あと <span className="tabular-nums">{formatWait(waitMs)}</span> で再度報告できます。
      </p>
    </div>
  );
}

function ResultView({
  outcome,
  waitMs,
  store,
  productId,
  persistent,
}: {
  outcome: Outcome;
  waitMs: number;
  store: LocationCandidate;
  productId: ID;
  persistent: boolean;
}) {
  if (outcome.kind === "success") {
    return (
      <div role="status" className="py-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-stock-in-soft text-stock-in-ink">
          <CheckIcon className="h-8 w-8" />
        </div>
        <p className="mt-3 text-lg font-extrabold">報告しました。ありがとうございます！</p>
        <p className="mt-1 text-sm text-muted">
          {store.name} ・ 「{STOCK_STATUS_META[outcome.status].label}」
        </p>
        <Link
          href={`/locations/${store.id}?product=${productId}`}
          className="mt-3 inline-block text-sm font-bold underline"
        >
          この店舗のページを見る
        </Link>
        {!persistent && (
          <p className="mt-3 text-[11px] text-muted">※ 確認用の環境のため、報告は保存されません（サーバーの再起動で消えます）。</p>
        )}
      </div>
    );
  }
  if (outcome.kind === "rate_limited") {
    return (
      <div className="py-2">
        <p className="text-base font-extrabold">続けて報告できません</p>
        <p className="mt-1 text-sm text-muted">同じガチャ・同じ店舗への報告は10分に1回までです。</p>
        {waitMs > 0 ? (
          <WaitNotice waitMs={waitMs} lead={`${store.name} には少し前に報告済みです。`} />
        ) : (
          <p className="mt-3 text-sm font-bold text-stock-in-ink">もう一度報告できるようになりました。</p>
        )}
      </div>
    );
  }
  return (
    <div role="alert" className="py-2">
      <p className="text-base font-extrabold text-stock-out-ink">報告できませんでした</p>
      <p className="mt-1 text-sm">{outcome.message}</p>
    </div>
  );
}

/* ---------------- 店舗の検索・選択 ---------------- */

function StoreStep({
  knownLocations,
  selectedId,
  onSelect,
}: {
  knownLocations: LocationCandidate[];
  selectedId: ID | null;
  onSelect: (store: LocationCandidate) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; items: LocationCandidate[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestNo = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const runSearch = useCallback(async (q: string) => {
    const no = ++requestNo.current;
    if (!q.trim()) {
      setResult(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    setLoading(true);
    try {
      const res = await searchLocationsAction(q);
      if (no !== requestNo.current) return; // 古い検索結果は捨てる
      if (res.ok) {
        setResult({ query: q, items: res.items, total: res.total });
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      if (no === requestNo.current) setFailed(true);
    } finally {
      if (no === requestNo.current) setLoading(false);
    }
  }, []);

  // 入力が止まってから検索する
  useEffect(() => {
    const timer = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const showKnown = !query.trim() && knownLocations.length > 0;

  return (
    <div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query);
        }}
      >
        <label htmlFor="store-search" className="text-sm font-bold">
          見つけた店舗を検索
        </label>
        <div className="mt-1.5 flex h-12 items-center gap-2 rounded-2xl bg-canvas px-3 ring-1 ring-line focus-within:ring-2 focus-within:ring-ink">
          <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
          <input
            id="store-search"
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={60}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="店舗名・地名・住所（例：渋谷 ガシャポン）"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-sm placeholder:text-muted"
          />
        </div>
      </form>

      <div aria-live="polite" className="mt-3">
        {showKnown && (
          <>
            <p className="mb-2 text-xs font-bold text-muted">このガチャが報告されている店舗</p>
            <StoreList items={knownLocations} selectedId={selectedId} onSelect={onSelect} />
          </>
        )}
        {!query.trim() && knownLocations.length === 0 && (
          <p className="rounded-2xl bg-canvas p-4 text-sm text-muted">
            店舗名や地名（例：「池袋」「イオンモール」「枚方市」）で検索して、ガチャを見つけた店舗を選んでください。
          </p>
        )}
        {query.trim() && loading && !result && <p className="py-4 text-center text-sm text-muted">検索中…</p>}
        {query.trim() && failed && (
          <p role="alert" className="rounded-2xl bg-stock-out-soft p-3 text-sm font-bold text-stock-out-ink">
            店舗を検索できませんでした。通信状態を確認して、もう一度お試しください。
          </p>
        )}
        {query.trim() && result && !failed && (
          <>
            <p className="mb-2 text-xs text-muted">
              {result.total === 0
                ? ""
                : result.total > result.items.length
                  ? `${result.total}件中 ${result.items.length}件を表示（地名などを足すと絞り込めます）`
                  : `${result.total}件`}
              {loading && " ・ 更新中…"}
            </p>
            {result.items.length > 0 ? (
              <StoreList items={result.items} selectedId={selectedId} onSelect={onSelect} />
            ) : (
              <p className="rounded-2xl bg-canvas p-4 text-sm text-muted">
                「{result.query}」に一致する店舗が見つかりませんでした。店舗名の一部や市区町村名で試してください。
                <br />
                <span className="text-xs">※ 現在はメーカー・運営会社の公式サイトに掲載されている店舗のみ選べます。</span>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StoreList({
  items,
  selectedId,
  onSelect,
}: {
  items: LocationCandidate[];
  selectedId: ID | null;
  onSelect: (store: LocationCandidate) => void;
}) {
  return (
    <ul className="space-y-2">
      {items.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onSelect(s)}
            className={`w-full rounded-2xl bg-surface p-3 text-left ring-1 transition active:scale-[0.99] ${
              s.id === selectedId ? "ring-2 ring-ink" : "ring-line hover:ring-ink/30"
            }`}
          >
            <p className="text-sm font-bold leading-snug">{s.name}</p>
            <p className="mt-0.5 text-xs text-muted">{s.address || s.area || "住所情報なし"}</p>
          </button>
        </li>
      ))}
    </ul>
  );
}

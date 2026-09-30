import type { ReactNode } from "react";
import { type InnerShape, type Motif, type VisualSpec, seededRandom } from "@/lib/visual/spec";

/**
 * GachaNavi オリジナルの商品ビジュアル（インライン SVG）。
 *
 * 実在の商品・キャラクター・パッケージ・ロゴは描かない。背景の抽象モチーフと、
 * GachaNavi 独自のカプセル（中身は星や円などの抽象図形）だけで構成する。
 * 画像ファイルや外部 URL は一切参照しない（商品ごとの画像ファイルは作らない）。
 *
 * height: ビューボックスの高さ（幅は 200 固定）。商品カードの上部（65%）は 130、正方形のサムネイルは 200
 */
export function GachaVisual({
  spec,
  height,
  showBrand = false,
  className = "",
}: {
  spec: VisualSpec;
  height: number;
  showBrand?: boolean;
  className?: string;
}) {
  const { key: k, palette: pal } = spec;
  const W = 200;
  const H = height;
  const cx = W / 2;
  const cy = H * 0.52;
  const r = Math.min(H * 0.29, 50);
  const rand = seededRandom(spec.seriesSeed);
  const glowA = { x: 30 + rand() * 50, y: H * (0.15 + rand() * 0.3) };
  const glowB = { x: 130 + rand() * 50, y: H * (0.55 + rand() * 0.35) };
  const [capTop, capBottom] =
    spec.capsuleTone === 0
      ? [pal.capsule, pal.capsuleDeep]
      : spec.capsuleTone === 1
        ? [pal.accent, shade(pal.accent, -0.18)]
        : [pal.accent2, shade(pal.accent2, -0.2)];
  const soft = "#ffffff";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      className={`block h-full w-full ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${k}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={pal.bgFrom} />
          <stop offset="1" stopColor={pal.bgTo} />
        </linearGradient>
        <radialGradient id={`${k}-glow`}>
          <stop offset="0" stopColor={pal.glow} stopOpacity={pal.dark ? 0.35 : 0.85} />
          <stop offset="1" stopColor={pal.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${k}-cap`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={capTop} />
          <stop offset="1" stopColor={capBottom} />
        </linearGradient>
        <linearGradient id={`${k}-dome`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.78" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.2" />
        </linearGradient>
        <clipPath id={`${k}-clip`}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>

      <rect width={W} height={H} fill={`url(#${k}-bg)`} />
      <circle cx={glowA.x} cy={glowA.y} r={H * 0.55} fill={`url(#${k}-glow)`} />
      <circle cx={glowB.x} cy={glowB.y} r={H * 0.45} fill={`url(#${k}-glow)`} />

      <g>{motifLayer(spec.motif, rand, W, H, { cx, cy, r }, pal.accent, pal.accent2, soft, pal.dark, k)}</g>

      {/* カプセルの影 */}
      <ellipse cx={cx} cy={cy + r + H * 0.045} rx={r * 0.78} ry={r * 0.12} fill="#000000" opacity={pal.dark ? 0.35 : 0.1} />

      <g transform={`rotate(${spec.capsuleTilt.toFixed(1)} ${cx} ${cy})`}>
        {/* 下半分（カラー） */}
        <path d={`M${cx - r},${cy} A${r},${r} 0 0 0 ${cx + r},${cy} Z`} fill={`url(#${k}-cap)`} />
        {/* 下半分のつや */}
        <path
          d={`M${cx - r * 0.72},${cy + r * 0.22} Q${cx - r * 0.55},${cy + r * 0.72} ${cx - r * 0.05},${cy + r * 0.86}`}
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.45"
          strokeWidth={r * 0.07}
          strokeLinecap="round"
        />
        {/* 上半分（半透明のドーム）と中の抽象図形 */}
        <g clipPath={`url(#${k}-clip)`}>
          <rect x={cx - r} y={cy - r} width={r * 2} height={r} fill={pal.dark ? "#ffffff" : pal.bgFrom} opacity={pal.dark ? 0.16 : 0.55} />
          {innerShape(spec.inner, cx, cy - r * 0.42, r * 0.3, pal.accent, pal.accent2)}
          <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy} Z`} fill={`url(#${k}-dome)`} opacity="0.55" />
        </g>
        {/* 合わせ目 */}
        <rect x={cx - r} y={cy - r * 0.06} width={r * 2} height={r * 0.12} fill="#ffffff" opacity="0.75" />
        {/* 輪郭とハイライト */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth={r * 0.045} />
        <path
          d={`M${cx - r * 0.62},${cy - r * 0.42} A${r * 0.78},${r * 0.78} 0 0 1 ${cx - r * 0.1},${cy - r * 0.8}`}
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.9"
          strokeWidth={r * 0.09}
          strokeLinecap="round"
        />
        <circle cx={cx + r * 0.42} cy={cy - r * 0.6} r={r * 0.07} fill="#ffffff" opacity="0.9" />
      </g>

      {/* カプセルのまわりのきらめき */}
      <path d={starPath(cx + r * 1.28, cy - r * 0.78, r * 0.2)} fill={pal.accent2} />
      <path d={starPath(cx - r * 1.3, cy + r * 0.2, r * 0.13)} fill="#ffffff" opacity="0.9" />
      <circle cx={cx + r * 1.15} cy={cy + r * 0.55} r={r * 0.06} fill={pal.accent} opacity="0.8" />

      {showBrand && (
        <text
          x="10"
          y={H - 9}
          fontSize="8.5"
          fontWeight="700"
          letterSpacing="0.2"
          fill={pal.dark ? "#ffffff" : "#1d1a2b"}
          opacity={pal.dark ? 0.75 : 0.5}
          fontFamily="inherit"
        >
          GachaNavi
        </text>
      )}
    </svg>
  );
}

/* ---------------- 抽象モチーフ ---------------- */

type Capsule = { cx: number; cy: number; r: number };

function motifLayer(
  motif: Motif,
  rand: () => number,
  W: number,
  H: number,
  cap: Capsule,
  accent: string,
  accent2: string,
  soft: string,
  dark: boolean,
  k: string,
): ReactNode {
  const out: ReactNode[] = [];
  const x = () => 8 + rand() * (W - 16);
  const y = () => 8 + rand() * (H - 16);
  const fa = dark ? 0.35 : 0.55; // 白の不透明度
  let i = 0;
  const push = (node: ReactNode) => out.push(<g key={i++}>{node}</g>);

  switch (motif) {
    case "sparkle":
      for (let n = 0; n < 6; n++) push(<path d={starPath(x(), y(), 3 + rand() * 5)} fill={n % 2 ? soft : accent2} opacity={n % 2 ? fa + 0.2 : 0.85} />);
      for (let n = 0; n < 4; n++) push(<circle cx={x()} cy={y()} r={4 + rand() * 8} fill="none" stroke={soft} strokeOpacity={fa} strokeWidth="1.5" />);
      for (let n = 0; n < 10; n++) push(<circle cx={x()} cy={y()} r={1 + rand() * 1.6} fill={n % 3 ? soft : accent} opacity={0.8} />);
      break;
    case "bubbles":
      for (let n = 0; n < 9; n++) push(<circle cx={x()} cy={y()} r={3 + rand() * 13} fill={soft} opacity={fa * (0.5 + rand() * 0.6)} />);
      for (let n = 0; n < 4; n++) {
        const bx = x();
        const by = y();
        push(
          <>
            <circle cx={bx} cy={by} r="2.2" fill={accent} opacity="0.55" />
            <circle cx={bx + 5} cy={by - 2} r="1.6" fill={accent} opacity="0.55" />
            <circle cx={bx + 2.5} cy={by + 4} r="1.3" fill={accent2} opacity="0.7" />
          </>,
        );
      }
      break;
    case "waves":
      for (let n = 0; n < 3; n++) {
        const wy = H * (0.2 + n * 0.3) + rand() * 6;
        push(<path d={wavePath(0, wy, W, 5 + rand() * 3, 26 + rand() * 10)} fill="none" stroke={n === 1 ? accent : soft} strokeOpacity={n === 1 ? 0.45 : fa + 0.1} strokeWidth="3" strokeLinecap="round" />);
      }
      for (let n = 0; n < 4; n++) {
        const s = 6 + rand() * 7;
        const rx0 = x();
        const ry0 = y();
        push(<rect x={rx0} y={ry0} width={s} height={s} rx={s * 0.3} fill={n % 2 ? accent2 : soft} opacity={n % 2 ? 0.8 : fa + 0.1} transform={`rotate(${Math.round(rand() * 40 - 20)} ${f(rx0 + s / 2)} ${f(ry0 + s / 2)})`} />);
      }
      for (let n = 0; n < 6; n++) push(<circle cx={x()} cy={y()} r={2 + rand() * 3} fill={soft} opacity={fa + 0.15} />);
      break;
    case "tiles": {
      const step = 14;
      // グリッドは <pattern> で繰り返す（要素数を増やさない）
      push(
        <>
          <defs>
            <pattern id={`${k}-tile`} width={step} height={step} patternUnits="userSpaceOnUse">
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill={soft} opacity={fa * 0.7} />
            </pattern>
          </defs>
          <rect width={W} height={H} fill={`url(#${k}-tile)`} />
        </>,
      );
      // ところどころのタイルを背景色で隠して、不規則な並びにする
      for (let n = 0; n < 14; n++) {
        const gx = Math.floor(rand() * (W / step)) * step;
        const gy = Math.floor(rand() * (H / step)) * step;
        push(<rect x={gx + 2.5} y={gy + 2.5} width="9" height="9" rx="2" fill={`url(#${k}-bg)`} />);
      }
      for (let n = 0; n < 6; n++) {
        const gx = Math.floor(rand() * (W / step)) * step + step / 2;
        const gy = Math.floor(rand() * (H / step)) * step + step / 2;
        push(<rect x={gx - 3.5} y={gy - 3.5} width="7" height="7" rx="1.5" fill={n % 2 ? accent : accent2} opacity="0.8" />);
      }
      break;
    }
    case "speed":
      for (let n = 0; n < 9; n++) {
        const sx = x();
        const sy = y();
        const len = 18 + rand() * 40;
        push(<line x1={sx} y1={sy} x2={sx + len} y2={sy - len * 0.35} stroke={n % 3 === 0 ? accent2 : soft} strokeOpacity={n % 3 === 0 ? 0.85 : fa + 0.1} strokeWidth={1.5 + rand() * 2.5} strokeLinecap="round" />);
      }
      push(<circle cx={cap.cx} cy={cap.cy} r={cap.r * 1.45} fill="none" stroke={soft} strokeOpacity={fa * 0.6} strokeWidth="1.5" strokeDasharray="3 5" />);
      push(<circle cx={x()} cy={y()} r={10 + rand() * 8} fill="none" stroke={accent} strokeOpacity="0.5" strokeWidth="2" />);
      break;
    case "soft":
      for (let n = 0; n < 5; n++) push(<circle cx={x()} cy={y()} r={10 + rand() * 18} fill={soft} opacity={fa * 0.55} />);
      for (let n = 0; n < 3; n++) push(<path d={starPath(x(), y(), 3 + rand() * 3)} fill={accent2} opacity="0.85" />);
      for (let n = 0; n < 7; n++) push(<circle cx={x()} cy={y()} r={1.5 + rand() * 2} fill={n % 2 ? accent : soft} opacity={0.75} />);
      break;
    case "diamonds":
      for (let n = 0; n < 6; n++) {
        const s = 4 + rand() * 7;
        push(<path d={diamondPath(x(), y(), s)} fill={n % 3 === 0 ? accent2 : "none"} stroke={n % 3 === 0 ? "none" : soft} strokeOpacity={fa + 0.2} strokeWidth="1.5" opacity={n % 3 === 0 ? 0.85 : 1} />);
      }
      for (let n = 0; n < 3; n++) push(<circle cx={x()} cy={y()} r={3 + rand() * 6} fill={soft} opacity={fa} />);
      for (let n = 0; n < 2; n++) {
        const ly = y();
        push(<line x1={x() * 0.3} y1={ly} x2={W * 0.6 + rand() * 60} y2={ly} stroke={accent} strokeOpacity="0.35" strokeWidth="1.5" strokeLinecap="round" />);
      }
      break;
    case "rays":
      for (let n = 0; n < 12; n++) {
        const a = (n / 12) * Math.PI * 2 + rand() * 0.15;
        const a2 = a + 0.12;
        const R = W;
        push(<path d={`M${cap.cx},${cap.cy} L${cap.cx + Math.cos(a) * R},${cap.cy + Math.sin(a) * R} L${cap.cx + Math.cos(a2) * R},${cap.cy + Math.sin(a2) * R} Z`} fill={soft} opacity={dark ? 0.08 : 0.22} />);
      }
      for (let n = 0; n < 4; n++) push(<path d={trianglePath(x(), y(), 4 + rand() * 5, rand() * 360)} fill={n % 2 ? accent2 : soft} opacity={n % 2 ? 0.85 : fa + 0.2} />);
      for (let n = 0; n < 6; n++) push(<circle cx={x()} cy={y()} r={1.2 + rand() * 1.5} fill={soft} opacity="0.8" />);
      break;
    case "prism":
      for (let n = 0; n < 5; n++) push(<path d={trianglePath(x(), y(), 8 + rand() * 12, rand() * 360)} fill="none" stroke={n % 2 ? accent : soft} strokeOpacity={n % 2 ? 0.6 : fa + 0.1} strokeWidth="1.5" strokeLinejoin="round" />);
      for (let n = 0; n < 5; n++) {
        const lx = x();
        push(<line x1={lx} y1={0} x2={lx - H * 0.5} y2={H} stroke={soft} strokeOpacity={dark ? 0.08 : 0.25} strokeWidth="1" />);
      }
      for (let n = 0; n < 3; n++) push(<path d={trianglePath(x(), y(), 3 + rand() * 3, rand() * 360)} fill={accent2} opacity="0.85" />);
      break;
    case "confetti":
      for (let n = 0; n < 18; n++) {
        const c = [accent, accent2, soft][n % 3];
        const cxp = x();
        const cyp = y();
        push(
          n % 2 ? (
            <rect x={cxp} y={cyp} width={3 + rand() * 3} height={6 + rand() * 4} rx="1" fill={c} opacity={c === soft ? fa + 0.25 : 0.8} transform={`rotate(${Math.round(rand() * 180)} ${cxp} ${cyp})`} />
          ) : (
            <circle cx={cxp} cy={cyp} r={1.5 + rand() * 2.5} fill={c} opacity={c === soft ? fa + 0.25 : 0.8} />
          ),
        );
      }
      break;
    case "leaves":
      for (let n = 0; n < 7; n++) {
        const lx = x();
        const ly = y();
        const rx = 4 + rand() * 6;
        push(<ellipse cx={lx} cy={ly} rx={rx} ry={rx * 2.1} fill={n % 3 === 0 ? accent : soft} opacity={n % 3 === 0 ? 0.35 : fa} transform={`rotate(${Math.round(rand() * 120 - 60)} ${lx} ${ly})`} />);
      }
      for (let n = 0; n < 3; n++) {
        const ax = x();
        const ay = y();
        push(<path d={`M${ax},${ay} q12,-14 26,-6`} fill="none" stroke={soft} strokeOpacity={fa + 0.15} strokeWidth="1.5" strokeLinecap="round" />);
      }
      for (let n = 0; n < 5; n++) push(<circle cx={x()} cy={y()} r={1.5 + rand() * 1.5} fill={accent2} opacity="0.75" />);
      break;
    case "rings": {
      const rx = x();
      const ry = y();
      for (let n = 1; n <= 4; n++) push(<circle cx={rx} cy={ry} r={n * 9} fill="none" stroke={soft} strokeOpacity={fa * (1.1 - n * 0.18)} strokeWidth="1.5" />);
      const sx = x();
      const sy = y();
      for (let n = 1; n <= 3; n++) push(<circle cx={sx} cy={sy} r={n * 6} fill="none" stroke={accent} strokeOpacity={0.45 - n * 0.1} strokeWidth="1.5" />);
      for (let n = 0; n < 8; n++) push(<circle cx={x()} cy={y()} r={1.3 + rand() * 1.8} fill={n % 2 ? accent2 : soft} opacity="0.8" />);
      break;
    }
  }
  return out;
}

/* ---------------- カプセルの中の抽象図形 ---------------- */

function innerShape(shape: InnerShape, x: number, y: number, s: number, accent: string, accent2: string): ReactNode {
  switch (shape) {
    case "star":
      return <path d={starPath(x, y, s)} fill={accent2} />;
    case "circle":
      return (
        <>
          <circle cx={x} cy={y} r={s * 0.75} fill={accent} opacity="0.85" />
          <circle cx={x - s * 0.25} cy={y - s * 0.25} r={s * 0.22} fill="#ffffff" opacity="0.6" />
        </>
      );
    case "dots":
      return (
        <>
          <circle cx={x - s * 0.7} cy={y + s * 0.2} r={s * 0.32} fill={accent} />
          <circle cx={x} cy={y - s * 0.3} r={s * 0.38} fill={accent2} />
          <circle cx={x + s * 0.7} cy={y + s * 0.25} r={s * 0.28} fill={accent} opacity="0.7" />
        </>
      );
    case "ring":
      return <circle cx={x} cy={y} r={s * 0.7} fill="none" stroke={accent2} strokeWidth={s * 0.28} />;
    case "diamond":
      return <path d={diamondPath(x, y, s * 0.9)} fill={accent} opacity="0.9" />;
  }
}

/* ---------------- 図形のパス ---------------- */

const f = (n: number) => Math.round(n * 10) / 10;

/** 4 方向に尖った星（きらめき） */
function starPath(x: number, y: number, r: number): string {
  const i = r * 0.28;
  return `M${f(x)},${f(y - r)} Q${f(x + i)},${f(y - i)} ${f(x + r)},${f(y)} Q${f(x + i)},${f(y + i)} ${f(x)},${f(y + r)} Q${f(x - i)},${f(y + i)} ${f(x - r)},${f(y)} Q${f(x - i)},${f(y - i)} ${f(x)},${f(y - r)} Z`;
}

function diamondPath(x: number, y: number, r: number): string {
  return `M${f(x)},${f(y - r)} L${f(x + r * 0.7)},${f(y)} L${f(x)},${f(y + r)} L${f(x - r * 0.7)},${f(y)} Z`;
}

function trianglePath(x: number, y: number, r: number, deg: number): string {
  const pts = [0, 120, 240].map((d) => {
    const a = ((d + deg) * Math.PI) / 180;
    return `${f(x + Math.cos(a) * r)},${f(y + Math.sin(a) * r)}`;
  });
  return `M${pts[0]} L${pts[1]} L${pts[2]} Z`;
}

function wavePath(x0: number, y: number, width: number, amp: number, period: number): string {
  let d = `M${f(x0)},${f(y)}`;
  for (let x = x0; x < x0 + width; x += period) {
    d += ` q${f(period / 4)},${f(-amp)} ${f(period / 2)},0 t${f(period / 2)},0`;
  }
  return d;
}

/** 色を明るく（amount > 0）/ 暗く（amount < 0）する */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

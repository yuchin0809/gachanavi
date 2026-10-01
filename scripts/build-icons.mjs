/**
 * GachaNavi のアイコン一式を作る（ローカルで実行。出力はリポジトリに含める）。
 *
 *   node scripts/build-icons.mjs
 *
 * 元データ（assets/brand/）:
 * - gachanavi-icon-source.jpg … 正式アイコンのデザイン（角丸の外側は白い余白）
 * - gachanavi-icon-small.svg  … favicon の 16・32px 用に簡略化したもの（同じデザインの要素・色）
 * - gachanavi-badge.svg       … 通知バッジ用の白の単色シルエット
 *
 * 画像処理には Next.js に同梱の sharp を使う（package.json の依存には追加しない）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = path.join(ROOT, "assets/brand");
const OUT = path.join(ROOT, "public/icons");
const N = 1024;

/** 元画像の角丸の正方形（白い余白を除いた範囲） */
const CROP = { left: 4, top: 26, width: 1083, height: 1096 };
/** 角丸の縁の青（白との混ざり具合から透明度を求めるときの基準） */
const EDGE = [62, 92, 228];

/** 元画像 → 1024px。角丸の外側（四隅から続く白）だけを透明にし、縁はなめらかにする */
async function master() {
  const { data } = await sharp(path.join(BRAND, "gachanavi-icon-source.jpg"))
    .extract(CROP)
    .resize(N, N, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x, y) => (y * N + x) * 4;
  const outside = new Uint8Array(N * N);
  const stack = [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const k = y * N + x;
    const i = at(x, y);
    if (outside[k] || Math.min(data[i], data[i + 1], data[i + 2]) < 200) continue;
    outside[k] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  const nearOutside = (x, y) => {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < N && yy < N && outside[yy * N + xx]) return true;
      }
    return false;
  };
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = at(x, y);
      if (outside[y * N + x]) {
        data[i + 3] = 0;
        continue;
      }
      if (!nearOutside(x, y)) continue;
      const a = Math.max(0, Math.min(1, (255 - data[i]) / (255 - EDGE[0])));
      data[i + 3] = Math.round(a * 255);
      if (a > 0) for (let c = 0; c < 3; c++) data[i + c] = Math.round(Math.max(0, Math.min(255, (data[i + c] - 255 * (1 - a)) / a)));
    }
  return sharp(data, { raw: { width: N, height: N, channels: 4 } }).png().toBuffer();
}

/**
 * 角丸の外側まで背景で埋めた正方形（iOS・maskable 用）。
 * 1) 角丸の縁を数 px 内側に削る（元画像の縁の白い光沢・にじみを含めない）
 * 2) 外側（透明部分）を、近くの背景の色で埋める（色と不透明度を一緒にぼかして割る＝正規化畳み込み）
 * 3) 削ったアイコンをその上に重ねる。scale は全体を置く大きさ（周りは端の背景色を引き延ばす）
 */
async function filledSquare(icon) {
  const { data } = await sharp(icon).raw().toBuffer({ resolveWithObject: true });
  const px = N * N;
  // 1) 不透明度を内側へ 6px 削る（最小値フィルタ）
  const alpha = new Float32Array(px);
  for (let i = 0; i < px; i++) alpha[i] = data[i * 4 + 3] / 255;
  const ERODE = 6;
  const eroded = new Float32Array(px);
  const tmp = new Float32Array(px);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let m = 1;
      for (let d = -ERODE; d <= ERODE; d++) m = Math.min(m, alpha[y * N + Math.min(N - 1, Math.max(0, x + d))]);
      tmp[y * N + x] = m;
    }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let m = 1;
      for (let d = -ERODE; d <= ERODE; d++) m = Math.min(m, tmp[Math.min(N - 1, Math.max(0, y + d)) * N + x]);
      eroded[y * N + x] = m;
    }
  // 2) 正規化畳み込みで外側を埋める（浮動小数のぼかし。8 bit だと外側の淡い部分の精度が足りない）
  const fill = (radius) => {
    const ch = [0, 1, 2].map((c) => {
      const f = new Float32Array(px);
      for (let i = 0; i < px; i++) f[i] = data[i * 4 + c] * eroded[i];
      return boxBlur(f, radius);
    });
    return { ch, a: boxBlur(Float32Array.from(eroded), radius) };
  };
  const near = fill(20);
  const far = fill(110);
  const out = Buffer.alloc(px * 3);
  for (let i = 0; i < px; i++) {
    const src = near.a[i] > 0.05 ? near : far;
    const w = Math.max(1e-4, src.a[i]);
    const a = eroded[i];
    for (let c = 0; c < 3; c++) {
      const bg = Math.min(255, src.ch[c][i] / w);
      out[i * 3 + c] = Math.round(data[i * 4 + c] * a + bg * (1 - a));
    }
  }
  return sharp(out, { raw: { width: N, height: N, channels: 3 } }).png().toBuffer();
}

/** 箱型ぼかし（横・縦を 3 回ずつ。ガウスぼかしの近似）。端は端の値を延長 */
function boxBlur(src, radius) {
  let a = src;
  let b = new Float32Array(a.length);
  const pass = (from, to, horizontal) => {
    for (let line = 0; line < N; line++) {
      let sum = 0;
      const get = (k) => {
        const kk = Math.min(N - 1, Math.max(0, k));
        return horizontal ? from[line * N + kk] : from[kk * N + line];
      };
      for (let k = -radius; k <= radius; k++) sum += get(k);
      for (let k = 0; k < N; k++) {
        to[horizontal ? line * N + k : k * N + line] = sum / (radius * 2 + 1);
        sum += get(k + radius + 1) - get(k - radius);
      }
    }
  };
  for (let i = 0; i < 3; i++) {
    pass(a, b, true);
    [a, b] = [b, a];
    pass(a, b, false);
    [a, b] = [b, a];
  }
  return a;
}

/** 外周の 3%（背景だけの部分）は元画像の縁の光沢が残るため使わない。要素はすべてこれより内側にある */
const TRIM = Math.round(N * 0.03);

async function fullBleed(square, size, scale) {
  const inner = Math.round(size * scale);
  const offset = Math.round((size - inner) / 2);
  const body = sharp(square)
    .extract({ left: TRIM, top: TRIM, width: N - TRIM * 2, height: N - TRIM * 2 })
    .resize(inner, inner, { kernel: "lanczos3" });
  if (inner === size) return body.png().toBuffer();
  return body
    .extend({ top: offset, left: offset, bottom: size - inner - offset, right: size - inner - offset, extendWith: "copy" })
    .png()
    .toBuffer();
}

/** PNG を埋め込んだ .ico（16・32・48px） */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

(async () => {
  const icon = await master();
  const square = await filledSquare(icon);
  const png = (size) => sharp(icon).resize(size, size, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();
  const small = (size) => sharp(path.join(BRAND, "gachanavi-icon-small.svg"), { density: 600 }).resize(size, size).png().toBuffer();

  const outputs = {
    "icon-512.png": await png(512),
    "icon-192.png": await png(192),
    // ヘッダーのロゴ（表示 28〜32px・高解像度画面用）
    "logo-mark-64.png": await png(64),
    // ホーム画面（iOS は透過を黒にするため、角まで背景で埋める）
    "apple-touch-icon.png": await fullBleed(square, 180, 1),
    // Android の丸・角丸のマスクで切れないよう、ピンまで中央 80% の安全領域（円）に収める
    "icon-maskable-512.png": await fullBleed(square, 512, 0.74),
    "badge-96.png": await sharp(path.join(BRAND, "gachanavi-badge.svg"), { density: 600 }).resize(96, 96).png().toBuffer(),
  };
  for (const [name, data] of Object.entries(outputs)) fs.writeFileSync(path.join(OUT, name), data);
  fs.writeFileSync(
    path.join(ROOT, "src/app/favicon.ico"),
    ico([
      { size: 16, data: await small(16) },
      { size: 32, data: await small(32) },
      { size: 48, data: await png(48) },
    ]),
  );
  console.log("icons:", Object.keys(outputs).join(", "), "+ src/app/favicon.ico");
})();

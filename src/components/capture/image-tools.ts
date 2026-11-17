/**
 * Client-side receipt image processing (runs on the phone; no external libraries).
 *  - detectQuad: finds the receipt's four corners (largest bright region vs. darker background)
 *  - warpPerspective: straightens the receipt from four corners (perspective correction)
 *  - enhance: contrast/levels stretch ("auto") or clean black-and-white "document" mode
 * The ORIGINAL file is always uploaded unchanged; this produces a separate ENHANCED copy.
 */
export type Pt = { x: number; y: number };
export type Quad = [Pt, Pt, Pt, Pt]; // TL, TR, BR, BL
export type EnhanceMode = "none" | "auto" | "document";

export async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  // imageOrientation: "from-image" applies EXIF rotation from phone cameras
  return createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
}

export function bitmapToCanvas(bmp: ImageBitmap | HTMLCanvasElement, maxSide = 2400): HTMLCanvasElement {
  const w0 = bmp.width;
  const h0 = bmp.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement("canvas");
  c.width = Math.round(w0 * k);
  c.height = Math.round(h0 * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

export function rotate90(src: HTMLCanvasElement, clockwise = true): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.height;
  c.height = src.width;
  const g = c.getContext("2d")!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate(((clockwise ? 90 : -90) * Math.PI) / 180);
  g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export function fullQuad(w: number, h: number): Quad {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}

function otsu(hist: number[], total: number) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/** Find the receipt outline. Returns null when no clear document is found (keep the full image). */
export function detectQuad(src: HTMLCanvasElement): Quad | null {
  const S = 320;
  const k = Math.min(1, S / Math.max(src.width, src.height));
  const w = Math.max(8, Math.round(src.width * k));
  const h = Math.max(8, Math.round(src.height * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.filter = "blur(2px)";
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const lum = new Uint8Array(w * h);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < w * h; i++) {
    const v = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
    lum[i] = v; hist[v]++;
  }
  const thr = otsu(hist, w * h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = lum[i] > thr ? 1 : 0;
  // largest connected bright component (4-neighbour flood fill)
  const label = new Int32Array(w * h).fill(-1);
  let bestId = -1, bestSize = 0, id = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] !== -1) continue;
    let size = 0;
    stack.push(i); label[i] = id;
    while (stack.length) {
      const p = stack.pop()!; size++;
      const x = p % w, y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && mask[q] && label[q] === -1) { label[q] = id; stack.push(q); }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
    id++;
  }
  const frac = bestSize / (w * h);
  if (bestId < 0 || frac < 0.12 || frac > 0.97) return null;
  // extreme points of the component give the four corners of a (possibly rotated) rectangle
  let tl = { x: 0, y: 0, v: Infinity }, br = { x: 0, y: 0, v: -Infinity }, tr = { x: 0, y: 0, v: -Infinity }, bl = { x: 0, y: 0, v: -Infinity };
  for (let i = 0; i < w * h; i++) {
    if (label[i] !== bestId) continue;
    const x = i % w, y = (i / w) | 0;
    if (x + y < tl.v) tl = { x, y, v: x + y };
    if (x + y > br.v) br = { x, y, v: x + y };
    if (x - y > tr.v) tr = { x, y, v: x - y };
    if (y - x > bl.v) bl = { x, y, v: y - x };
  }
  const s = 1 / k;
  const q: Quad = [
    { x: tl.x * s, y: tl.y * s }, { x: (tr.x + 1) * s, y: tr.y * s }, { x: (br.x + 1) * s, y: (br.y + 1) * s }, { x: bl.x * s, y: (bl.y + 1) * s },
  ];
  // reject degenerate shapes
  const area = Math.abs(
    (q[0].x * q[1].y - q[1].x * q[0].y) + (q[1].x * q[2].y - q[2].x * q[1].y) + (q[2].x * q[3].y - q[3].x * q[2].y) + (q[3].x * q[0].y - q[0].x * q[3].y),
  ) / 2;
  if (area < 0.1 * src.width * src.height) return null;
  return q;
}

/** Solve the 3x3 homography mapping unit rectangle (w x h) -> quad. */
function homography(w: number, h: number, q: Quad) {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const { x: u, y: v } = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination
  const n = 8;
  for (let i = 0; i < n; i++) {
    let max = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[max][i])) max = r;
    [A[i], A[max]] = [A[max], A[i]]; [b[i], b[max]] = [b[max], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return [...x, 1];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Straighten the quad into a rectangle (bilinear sampling). */
export function warpPerspective(src: HTMLCanvasElement, q: Quad, maxSide = 2200): HTMLCanvasElement {
  let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(16, Math.round(w * k));
  h = Math.max(16, Math.round(h * k));
  const H = homography(w, h, q);
  const sctx = src.getContext("2d", { willReadFrequently: true })!;
  const sd = sctx.getImageData(0, 0, src.width, src.height).data;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d")!;
  const img = octx.createImageData(w, h);
  const od = img.data;
  const SW = src.width, SH = src.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const den = H[6] * x + H[7] * y + H[8];
      const u = (H[0] * x + H[1] * y + H[2]) / den;
      const v = (H[3] * x + H[4] * y + H[5]) / den;
      const o = (y * w + x) * 4;
      if (u < 0 || v < 0 || u >= SW - 1 || v >= SH - 1) { od[o] = od[o + 1] = od[o + 2] = 255; od[o + 3] = 255; continue; }
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
      const i00 = (y0 * SW + x0) * 4, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = sd[i00 + ch] * (1 - fx) + sd[i10 + ch] * fx;
        const bot = sd[i01 + ch] * (1 - fx) + sd[i11 + ch] * fx;
        od[o + ch] = top * (1 - fy) + bot * fy;
      }
      od[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** In-place enhancement. "auto": levels stretch (2-98 percentile) + mild gamma; "document": clean B/W-ish. */
export function enhance(c: HTMLCanvasElement, mode: EnhanceMode): HTMLCanvasElement {
  if (mode === "none") return c;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Array(256).fill(0);
  const n = c.width * c.height;
  for (let i = 0; i < n; i++) hist[(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0]++;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.02) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.02) { hi = i; break; } }
  if (hi - lo < 20) { lo = 0; hi = 255; }
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const t = Math.min(1, Math.max(0, (i - lo) / (hi - lo)));
    lut[i] = mode === "document" ? (t > 0.82 ? 255 : Math.pow(t, 1.25) * 255) : Math.pow(t, 0.9) * 255;
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (mode === "document") {
      const v = lut[(d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114) | 0];
      d[o] = d[o + 1] = d[o + 2] = v;
    } else {
      d[o] = lut[d[o]]; d[o + 1] = lut[d[o + 1]]; d[o + 2] = lut[d[o + 2]];
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function canvasToJpeg(c: HTMLCanvasElement, quality = 0.88): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode image"))), "image/jpeg", quality));
}

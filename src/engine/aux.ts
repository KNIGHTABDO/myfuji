import { toHalf } from './color';

/** Separable running-sum box blur with clamped edges. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice();
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Three box passes ≈ Gaussian. */
export const gaussBlur = (src: Float32Array, w: number, h: number, r: number) => {
  const k = Math.max(1, Math.round(r / 1.7));
  return boxBlur(boxBlur(boxBlur(src, w, h, k), w, h, k), w, h, k);
};

/** He et al. guided filter, self-guided: an edge-preserving smoother. */
export function guidedFilter(I: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = I.length, II = new Float32Array(n);
  for (let i = 0; i < n; i++) II[i] = I[i] * I[i];
  const mI = boxBlur(I, w, h, r), mII = boxBlur(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i];
    a[i] = v / (v + eps);
    b[i] = mI[i] - a[i] * mI[i];
  }
  const ma = boxBlur(a, w, h, r), mb = boxBlur(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

export interface WorkImage {
  w: number;
  h: number;
  /** linear RGB, interleaved */
  lin: Float32Array;
  /** linear luminance */
  Y: Float32Array;
}

export interface AuxCache {
  logY: Float32Array;
  base: Float32Array;
  mid: Float32Array;
}

export function auxLayers(img: WorkImage): AuxCache {
  const { w, h, Y } = img, n = w * h, L = Math.max(w, h);
  const logY = new Float32Array(n);
  for (let i = 0; i < n; i++) logY[i] = Math.log2(Math.max(Y[i], 1e-5));
  const base = guidedFilter(logY, w, h, Math.max(2, Math.round(L * 0.035)), 0.35);
  const mid = gaussBlur(logY, w, h, Math.max(2, Math.round(L * 0.012)));
  return { logY, base, mid };
}

/** Pack the auxiliary RGBA16F texture: base, mid, halation energy, subject mask. */
export function packAux(img: WorkImage, layers: AuxCache, mask: Float32Array | null, ev: number): Uint16Array {
  const { w, h, Y } = img, n = w * h;
  const gain = Math.pow(2, ev);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = Y[i] * gain - 0.72; e[i] = v > 0 ? v * v * 3 : 0; }
  const L = Math.max(w, h);
  const hal = gaussBlur(e, w, h, Math.max(2, Math.round(L * 0.012)));
  const hal2 = gaussBlur(e, w, h, Math.max(3, Math.round(L * 0.035)));
  const out = new Uint16Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = toHalf(layers.base[i]);
    out[i * 4 + 1] = toHalf(layers.mid[i]);
    out[i * 4 + 2] = toHalf(Math.min(8, hal[i] * 0.6 + hal2[i] * 0.4));
    out[i * 4 + 3] = toHalf(mask ? mask[i] : 0);
  }
  return out;
}

import { cctFromLin, clamp, hex, linToOklab, linToSrgb, luma, okHue, SRGB8_TO_LIN, tintFromLin, type RGB } from '../color';
import type { WorkImage } from '../aux';

export interface PaletteSwatch {
  hex: string;
  share: number;
  L: number;
  C: number;
  h: number;
  name: string;
}

export type SkyKind = 'none' | 'blue' | 'sunset' | 'overcast' | 'dusk' | 'night';

export interface Stats {
  hist: { r: Float32Array; g: Float32Array; b: Float32Array; l: Float32Array };
  key: number; // geometric mean linear luminance
  p: { p01: number; p05: number; p50: number; p95: number; p99: number };
  clipHigh: number;
  clipLow: number;
  drStops: number;
  contrast: number;
  colorfulness: number;
  meanChroma: number;
  hueMass: Record<'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'magenta', number>;
  illuminant: RGB;
  cct: number;
  tint: number;
  wbReliability: number;
  palette: PaletteSwatch[];
  sky: { fraction: number; kind: SkyKind; hex: string };
  pointLights: number;
  darkFrac: number;
  noise: number;
  sharpness: number;
  topVsBottom: number;
}

export function workImageFrom(data: ImageData): WorkImage {
  const { width: w, height: h } = data, n = w * h, d = data.data;
  const lin = new Float32Array(n * 3), Y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = SRGB8_TO_LIN[d[i * 4]], g = SRGB8_TO_LIN[d[i * 4 + 1]], b = SRGB8_TO_LIN[d[i * 4 + 2]];
    lin[i * 3] = r; lin[i * 3 + 1] = g; lin[i * 3 + 2] = b;
    Y[i] = luma(r, g, b);
  }
  return { w, h, lin, Y };
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function colourName(L: number, C: number, h: number): string {
  const tone = L < 0.35 ? 'deep ' : L < 0.55 ? 'dark ' : L > 0.88 ? 'pale ' : L > 0.72 ? 'light ' : '';
  if (C < 0.025) return L < 0.3 ? 'charcoal' : L < 0.55 ? 'slate grey' : L < 0.8 ? 'silver grey' : 'paper white';
  const muted = C < 0.06 ? 'muted ' : C > 0.17 ? 'vivid ' : '';
  const names: Array<[number, string]> = [
    [15, 'crimson'], [35, 'red'], [50, 'terracotta'], [65, 'amber'], [80, 'ochre'], [100, 'mustard'], [118, 'olive'],
    [135, 'leaf green'], [160, 'jade'], [185, 'teal'], [215, 'cyan'], [245, 'azure'], [270, 'blue'], [295, 'indigo'],
    [320, 'violet'], [345, 'magenta'], [361, 'crimson'],
  ];
  let base = names.find(([lim]) => h < lim)![1];
  if ((base === 'amber' || base === 'terracotta' || base === 'ochre') && C < 0.09 && L > 0.6) base = 'sand';
  if ((base === 'terracotta' || base === 'amber') && L > 0.55 && C < 0.13 && C > 0.04) base = 'skin tone';
  return (tone + muted + base).trim();
}

function kmeans(samples: Float32Array, k: number, iters = 14): { centres: Float32Array; counts: number[] } {
  const n = samples.length / 3, r = rng(42);
  const centres = new Float32Array(k * 3);
  const first = Math.floor(r() * n);
  centres.set(samples.subarray(first * 3, first * 3 + 3), 0);
  const d2 = new Float32Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const dx = samples[i * 3] - centres[(c - 1) * 3], dy = samples[i * 3 + 1] - centres[(c - 1) * 3 + 1], dz = samples[i * 3 + 2] - centres[(c - 1) * 3 + 2];
      d2[i] = Math.min(d2[i], dx * dx + dy * dy * 4 + dz * dz * 4);
      sum += d2[i];
    }
    let t = r() * sum, pick = 0;
    for (let i = 0; i < n; i++) { t -= d2[i]; if (t <= 0) { pick = i; break; } }
    centres.set(samples.subarray(pick * 3, pick * 3 + 3), c * 3);
  }
  const assign = new Int32Array(n), counts = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const acc = new Float64Array(k * 3);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = samples[i * 3] - centres[c * 3], dy = samples[i * 3 + 1] - centres[c * 3 + 1], dz = samples[i * 3 + 2] - centres[c * 3 + 2];
        const d = dx * dx + dy * dy * 4 + dz * dz * 4;
        if (d < bd) { bd = d; best = c; }
      }
      assign[i] = best; counts[best]++;
      acc[best * 3] += samples[i * 3]; acc[best * 3 + 1] += samples[i * 3 + 1]; acc[best * 3 + 2] += samples[i * 3 + 2];
    }
    for (let c = 0; c < k; c++) if (counts[c]) for (let j = 0; j < 3; j++) centres[c * 3 + j] = acc[c * 3 + j] / counts[c];
  }
  return { centres, counts };
}

/** Immerkær noise estimate + Laplacian-variance sharpness on a 1:1 crop (8-bit luma). */
export function noiseAndSharpness(crop: ImageData): { noise: number; sharpness: number } {
  const { width: w, height: h, data } = crop;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const vals: number[] = [];
  let lapSum = 0, lapSq = 0, cnt = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = L[i - w - 1] - 2 * L[i - w] + L[i - w + 1] - 2 * L[i - 1] + 4 * L[i] - 2 * L[i + 1] + L[i + w - 1] - 2 * L[i + w] + L[i + w + 1];
      const lap = L[i - w] + L[i + w] + L[i - 1] + L[i + 1] - 4 * L[i];
      // Noise only in flat areas, so edges don't read as noise.
      const grad = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]);
      if (grad < 12) vals.push(Math.abs(v));
      lapSum += lap; lapSq += lap * lap; cnt++;
    }
  const noise = vals.length > 200 ? (Math.sqrt(Math.PI / 2) / 6) * (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  const mean = lapSum / Math.max(cnt, 1);
  return { noise, sharpness: lapSq / Math.max(cnt, 1) - mean * mean };
}

export function computeStats(img: WorkImage, crop1to1: ImageData | null): Stats {
  const { w, h, lin, Y } = img, n = w * h;
  const bins = 128;
  const hist = { r: new Float32Array(bins), g: new Float32Array(bins), b: new Float32Array(bins), l: new Float32Array(bins) };
  const ys = new Float32Array(n);
  let logSum = 0, clipH = 0, clipL = 0;
  let rgS = 0, rgQ = 0, ybS = 0, ybQ = 0;
  let chromaSum = 0;
  const hueMass = { red: 0, orange: 0, yellow: 0, green: 0, cyan: 0, blue: 0, purple: 0, magenta: 0 };
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = lin[i * 3], g = lin[i * 3 + 1], b = lin[i * 3 + 2], y = Y[i];
    const er = linToSrgb(r), eg = linToSrgb(g), eb = linToSrgb(b), el = linToSrgb(y);
    hist.r[Math.min(bins - 1, (er * bins) | 0)]++;
    hist.g[Math.min(bins - 1, (eg * bins) | 0)]++;
    hist.b[Math.min(bins - 1, (eb * bins) | 0)]++;
    hist.l[Math.min(bins - 1, (el * bins) | 0)]++;
    ys[i] = y;
    logSum += Math.log(y + 1e-4);
    if (er > 0.985 || eg > 0.985 || eb > 0.985) clipH++;
    if (el < 0.012) clipL++;
    const R = er * 255, G = eg * 255, B = eb * 255;
    const rg = R - G, yb = 0.5 * (R + G) - B;
    rgS += rg; rgQ += rg * rg; ybS += yb; ybQ += yb * yb;
    const [L, a, bb] = linToOklab(r, g, b);
    lab[i * 3] = L; lab[i * 3 + 1] = a; lab[i * 3 + 2] = bb;
    const C = Math.hypot(a, bb);
    chromaSum += C;
    if (C > 0.04) {
      const hh = okHue(a, bb);
      const k = hh < 40 || hh >= 350 ? 'red' : hh < 75 ? 'orange' : hh < 120 ? 'yellow' : hh < 170 ? 'green' : hh < 225 ? 'cyan' : hh < 285 ? 'blue' : hh < 320 ? 'purple' : 'magenta';
      hueMass[k as keyof typeof hueMass]++;
    }
  }
  for (const k of Object.keys(hueMass) as Array<keyof typeof hueMass>) hueMass[k] /= n;
  for (const c of ['r', 'g', 'b', 'l'] as const) { const hh = hist[c]; let m = 0; for (const v of hh) m = Math.max(m, v); for (let i = 0; i < bins; i++) hh[i] /= m || 1; }
  const sorted = ys.slice().sort();
  const pct = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))];
  const p = { p01: pct(0.01), p05: pct(0.05), p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) };
  let lsq = 0;
  const lm = logSum / n;
  for (let i = 0; i < n; i++) { const d = Math.log2(ys[i] + 1e-4) - lm / Math.LN2; lsq += d * d; }
  const sdRG = Math.sqrt(Math.max(0, rgQ / n - (rgS / n) ** 2)), sdYB = Math.sqrt(Math.max(0, ybQ / n - (ybS / n) ** 2));
  const colorfulness = Math.sqrt(sdRG ** 2 + sdYB ** 2) + 0.3 * Math.sqrt((rgS / n) ** 2 + (ybS / n) ** 2);

  // ---- illuminant: grey-world, white-patch and iterative grey-pixel estimates ----
  const valid: number[] = [];
  for (let i = 0; i < n; i += 2) {
    const y = Y[i];
    if (y > 0.02 && y < 0.8 && lin[i * 3] < 0.97 && lin[i * 3 + 1] < 0.97 && lin[i * 3 + 2] < 0.97) valid.push(i);
  }
  const est = (idx: number[]): RGB => {
    let r = 0, g = 0, b = 0;
    for (const i of idx) { const y = Y[i] + 1e-4; r += lin[i * 3] / y; g += lin[i * 3 + 1] / y; b += lin[i * 3 + 2] / y; }
    return g > 0 ? [r / g, 1, b / g] : [1, 1, 1];
  };
  let illum: RGB = [1, 1, 1];
  let wbReliability = 0;
  if (valid.length > 50) {
    const world = est(valid);
    const bright = valid.slice().sort((a, b) => Y[b] - Y[a]).slice(0, Math.max(20, Math.floor(valid.length * 0.03)));
    const patch = est(bright);
    let g: RGB = world;
    for (let it = 0; it < 4; it++) {
      const scored = valid.map((i) => {
        const y = Y[i] + 1e-4;
        const cr = lin[i * 3] / y / g[0], cg = lin[i * 3 + 1] / y, cb = lin[i * 3 + 2] / y / g[2];
        return [Math.abs(Math.log(cr / cg)) + Math.abs(Math.log(cb / cg)), i] as [number, number];
      });
      scored.sort((a, b) => a[0] - b[0]);
      g = est(scored.slice(0, Math.max(30, Math.floor(scored.length * 0.12))).map((s) => s[1]));
    }
    illum = [0, 1, 2].map((c) => Math.exp(0.6 * Math.log(g[c]) + 0.25 * Math.log(patch[c]) + 0.15 * Math.log(world[c]))) as RGB;
    illum = [illum[0] / illum[1], 1, illum[2] / illum[1]];
    // Reliability: a scene without near-neutral surfaces (autumn foliage, a red
    // curtain) cannot tell us the light's colour. Shrink the estimate toward the
    // camera's own white balance in proportion.
    let neutral = 0;
    for (const i of valid) if (Math.hypot(lab[i * 3 + 1], lab[i * 3 + 2]) < 0.022) neutral++;
    const reliability = Math.min(1, neutral / valid.length / 0.1) * 0.85;
    illum = [Math.pow(illum[0], reliability), 1, Math.pow(illum[2], reliability)];
    wbReliability = reliability;
  }

  // ---- palette (k-means in OKLab) ----
  const step = Math.max(1, Math.floor(n / 6000));
  const samples = new Float32Array(Math.ceil(n / step) * 3);
  let sN = 0;
  for (let i = 0; i < n; i += step) { samples.set(lab.subarray(i * 3, i * 3 + 3), sN * 3); sN++; }
  const km = kmeans(samples.subarray(0, sN * 3), 6);
  const palette: PaletteSwatch[] = [];
  for (let c = 0; c < 6; c++) {
    if (!km.counts[c]) continue;
    const L = km.centres[c * 3], a = km.centres[c * 3 + 1], b = km.centres[c * 3 + 2];
    const C = Math.hypot(a, b), hh = okHue(a, b);
    const r = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const R = 4.0767416621 * r - 3.3077115913 * m + 0.2309699292 * s, G = -1.2684380046 * r + 2.6097574011 * m - 0.3413193965 * s, B = -0.0041960863 * r - 0.7034186147 * m + 1.707614701 * s;
    palette.push({ hex: hex(linToSrgb(clamp(R)), linToSrgb(clamp(G)), linToSrgb(clamp(B))), share: km.counts[c] / sN, L, C, h: hh, name: colourName(L, C, hh) });
  }
  palette.sort((a, b) => b.share - a.share);

  // ---- sky: smooth, sky-coloured pixels connected to the top edge ----
  const top = Math.floor(h * 0.4);
  const skyCounts: Record<SkyKind, number> = { none: 0, blue: 0, sunset: 0, overcast: 0, dusk: 0, night: 0 };
  let skyN = 0, sr = 0, sg = 0, sb = 0;
  const skyKindAt = (i: number): SkyKind => {
    const gm = Math.abs(Y[Math.min(n - 1, i + 1)] - Y[Math.max(0, i - 1)]) + Math.abs(Y[Math.min(n - 1, i + w)] - Y[Math.max(0, i - w)]);
    if (gm > 0.03 + Y[i] * 0.1) return 'none';
    const L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2], C = Math.hypot(a, b), hh = okHue(a, b);
    if (L < 0.3 && C < 0.08) return 'night';
    if (C > 0.02 && hh > 205 && hh < 290) return L > 0.58 ? 'blue' : L > 0.3 ? 'dusk' : 'night';
    if (C > 0.035 && ((hh > 25 && hh < 110) || hh > 330) && L > 0.62) return 'sunset';
    if (C < 0.035 && L > 0.7) return 'overcast';
    return 'none';
  };
  for (let x = 1; x < w - 1; x++) {
    // Walk down each column from the top edge while it still looks like sky.
    let misses = 0;
    for (let y = 0; y < top; y++) {
      const i = y * w + x, k = skyKindAt(i);
      if (k === 'none') { if (++misses > 2) break; continue; }
      misses = 0;
      skyCounts[k]++; skyN++;
      sr += lin[i * 3]; sg += lin[i * 3 + 1]; sb += lin[i * 3 + 2];
    }
  }
  const topPx = Math.max(1, top * (w - 2));
  let kind: SkyKind = 'none', best = 0;
  for (const k of ['blue', 'sunset', 'overcast', 'dusk', 'night'] as SkyKind[]) if (skyCounts[k] > best) { best = skyCounts[k]; kind = k; }
  const skyFraction = skyN / topPx;
  if (skyFraction < 0.12) kind = 'none';

  // How much of the frame is genuinely dark: separates night from a dark suit.
  let dark = 0;
  for (let i = 0; i < n; i++) if (Y[i] < 0.012) dark++;
  const darkFrac = dark / n;

  // ---- point light sources in dark frames ----
  let pointLights = 0;
  const key = Math.exp(lm);
  if (key < 0.08 && darkFrac > 0.3) {
    const seen = new Uint8Array(n);
    const stack: number[] = [];
    for (let i = 0; i < n; i++) {
      if (seen[i] || Y[i] < 0.75) continue;
      let size = 0;
      stack.push(i); seen[i] = 1;
      while (stack.length) {
        const j = stack.pop()!; size++;
        const x = j % w, y = (j / w) | 0;
        for (const q of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1])
          if (q >= 0 && !seen[q] && Y[q] >= 0.75) { seen[q] = 1; stack.push(q); }
      }
      if (size < n * 0.004) pointLights++;
    }
  }

  // ---- brightness of top vs bottom (backlight / sky dominance) ----
  let tS = 0, bS = 0;
  const th = Math.floor(h / 3);
  for (let y = 0; y < th; y++) for (let x = 0; x < w; x++) tS += Y[y * w + x];
  for (let y = h - th; y < h; y++) for (let x = 0; x < w; x++) bS += Y[y * w + x];

  const ns = crop1to1 ? noiseAndSharpness(crop1to1) : { noise: 0, sharpness: 0 };
  return {
    hist, key, p,
    clipHigh: clipH / n, clipLow: clipL / n,
    drStops: Math.log2((p.p99 + 1e-4) / (p.p01 + 1e-4)),
    contrast: Math.sqrt(lsq / n),
    colorfulness, meanChroma: chromaSum / n, hueMass,
    illuminant: illum, cct: cctFromLin(...illum), tint: tintFromLin(...illum), wbReliability,
    palette,
    sky: { fraction: skyFraction, kind, hex: skyN ? hex(linToSrgb(sr / skyN), linToSrgb(sg / skyN), linToSrgb(sb / skyN)) : '#000000' },
    pointLights, darkFrac, noise: ns.noise, sharpness: ns.sharpness,
    topVsBottom: Math.log2((tS + 1e-3) / (bS + 1e-3)),
  };
}

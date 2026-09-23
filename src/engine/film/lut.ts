import { clamp, linToOklab, linToSrgb, luma, monotoneCurve, okHue, oklabToLin, smoothstep, srgbToLin, toHalf } from '../color';
import { SIM_BY_ID, type SimDef } from './sims';
import type { DevelopParams } from './types';

/** Parameters that change the LUT. Everything else is applied per pixel on the GPU. */
export type LutParams = Pick<DevelopParams, 'sim' | 'monoFilter' | 'monoWC' | 'monoMG' | 'highlight' | 'shadow' | 'color' | 'cce' | 'cceBlue' | 'fade'>;

export const lutKey = (p: LutParams, skinSafe: boolean, size: number) =>
  [p.sim, p.monoFilter, p.monoWC, p.monoMG, p.highlight, p.shadow, p.color, p.cce, p.cceBlue, p.fade.toFixed(3), skinSafe ? 1 : 0, size].join('|');

const bell = (h: number, centre: number, width: number) => {
  let d = Math.abs(h - centre);
  if (d > 180) d = 360 - d;
  return d >= width ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / width);
};

/** Build the display-space tone curve for a simulation and the Fuji-style H/S tone settings. */
export function toneCurve(sim: SimDef, p: LutParams, skinSafe: boolean): (x: number) => number {
  const H = p.highlight, S = p.shadow;
  const hw: Record<string, number> = { '0.5': 0.15, '0.75': 1, '0.9': 0.8, '1': H < 0 ? 0.5 : 0 };
  const sw: Record<string, number> = { '0.1': 0.8, '0.25': 1, '0.5': 0.15 };
  let pts = sim.tone.map(([x, y]) => {
    let yy = y + H * 0.017 * (hw[String(x)] ?? 0) - S * 0.016 * (sw[String(x)] ?? 0);
    if (x === 0 && S < 0) yy += -S * 0.006;
    yy += p.fade * 0.1 * (1 - yy) * (1 - yy);
    if (skinSafe) yy = yy + (x - yy) * 0.18 + (x === 0 ? 0.004 : 0);
    return [x, yy] as [number, number];
  });
  // keep it monotone even with extreme settings
  for (let i = 1; i < pts.length; i++) if (pts[i][1] <= pts[i - 1][1]) pts[i][1] = pts[i - 1][1] + 0.004;
  pts = pts.map(([x, y]) => [x, clamp(y, 0, 1.02)]);
  const f = monotoneCurve(pts);
  const N = 2048, table = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) table[i] = clamp(f(i / N));
  return (x: number) => {
    const u = clamp(x) * N, i = Math.floor(u), t = u - i;
    return i >= N ? table[N] : table[i] + (table[i + 1] - table[i]) * t;
  };
}

function hueEdits(sim: SimDef) {
  const pts = [...sim.hue].sort((a, b) => a[0] - b[0]);
  return (h: number): [number, number, number] => {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const ha = a[0], hb = i + 1 < n ? b[0] : b[0] + 360;
      let hh = h;
      if (hh < pts[0][0]) hh += 360;
      if (hh >= ha && hh <= hb) {
        const t = (hh - ha) / (hb - ha), s = 0.5 - 0.5 * Math.cos(Math.PI * t);
        return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];
      }
    }
    return [0, 1, 0];
  };
}

const STRENGTH = { off: 0, weak: 1, strong: 2 } as const;

/**
 * Returns a size³ RGBA half-float lattice indexed [b][g][r], mapping display-encoded
 * pre-film RGB to display-encoded film RGB.
 */
export function buildLut(p: LutParams, size = 48, skinSafe = false): Uint16Array {
  const sim = SIM_BY_ID[p.sim];
  const curve = toneCurve(sim, p, skinSafe);
  const edits = hueEdits(sim);
  const colourMul = 1 + 0.09 * p.color;
  const cce = STRENGTH[p.cce] * 0.034, cceB = STRENGTH[p.cceBlue] * 0.04;
  const out = new Uint16Array(size * size * size * 4);
  const lin1 = new Float32Array(size);
  const curved = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const e = i / (size - 1);
    lin1[i] = srgbToLin(e);
    curved[i] = srgbToLin(curve(e));
  }
  const mono = sim.mono;
  const w = mono?.weights[p.monoFilter];
  let o = 0;
  for (let bi = 0; bi < size; bi++)
    for (let gi = 0; gi < size; gi++)
      for (let ri = 0; ri < size; ri++) {
        const r = lin1[ri], g = lin1[gi], b = lin1[bi];
        let R: number, G: number, B: number;
        if (mono && w) {
          const Y = Math.max(0, w[0] * r + w[1] * g + w[2] * b);
          const Yc = srgbToLin(curve(linToSrgb(Y)));
          const L = Math.cbrt(Yc);
          const mid = 0.35 + 0.65 * 4 * L * (1 - L);
          let A = 0, Bb = 0;
          if (mono.tint) { A += mono.tint[0] * mid; Bb += mono.tint[1] * mid; }
          Bb += p.monoWC * 0.0036 * mid; A += p.monoWC * 0.0009 * mid;
          A += p.monoMG * 0.0036 * mid;
          [R, G, B] = oklabToLin(L, A, Bb);
        } else {
          // Tone: blend a hue-preserving luminance curve with a per-channel curve.
          const Y = luma(r, g, b);
          const Yc = srgbToLin(curve(linToSrgb(Y)));
          const k = Y > 1e-7 ? Yc / Y : 0;
          const m = sim.channelMix;
          const tr = r * k * (1 - m) + curved[ri] * m;
          const tg = g * k * (1 - m) + curved[gi] * m;
          const tb = b * k * (1 - m) + curved[bi] * m;
          const [L0, a0, b0] = linToOklab(Math.max(tr, 0), Math.max(tg, 0), Math.max(tb, 0));
          const C = Math.hypot(a0, b0);
          const h = okHue(a0, b0);
          let [dh, sm, dL] = edits(h);
          const sk = skinSafe ? bell(h, 58, 28) * smoothstep(0.02, 0.05, C) : 0;
          if (sk > 0) { dh *= 1 - 0.75 * sk; dL *= 1 - 0.75 * sk; sm = sm + (Math.max(sm, 0.96) - sm) * sk; }
          const cw = smoothstep(0.004, 0.05, C);
          const h2 = ((h + dh * cw) * Math.PI) / 180;
          let satTotal = sim.sat * sm * colourMul * (1 - 0.15 * p.fade);
          if (sk > 0) satTotal = satTotal + (clamp(satTotal, 0.9, 1.08) - satTotal) * sk;
          let C2 = C * satTotal;
          if (C2 > 0.2) C2 = 0.2 + 0.13 * Math.tanh((C2 - 0.2) / 0.13);
          let L = L0 + dL * smoothstep(0.02, 0.15, C);
          L -= cce * (1 - sk) * smoothstep(0.07, 0.22, C2) * smoothstep(0.15, 0.45, L);
          L -= cceB * bell(h, 262, 32) * smoothstep(0.04, 0.18, C2) * smoothstep(0.15, 0.5, L);
          const sw = 1 - smoothstep(0.12, 0.6, L), hw = smoothstep(0.5, 0.96, L);
          const A = Math.cos(h2) * C2 + sim.splitShadow[0] * sw + sim.splitHighlight[0] * hw;
          const Bb = Math.sin(h2) * C2 + sim.splitShadow[1] * sw + sim.splitHighlight[1] * hw;
          [R, G, B] = oklabToLin(L, A, Bb);
          // Gamut map by reducing chroma at constant L and hue.
          if (R < 0 || G < 0 || B < 0 || R > 1 || G > 1 || B > 1) {
            if (L >= 1) { R = G = B = 1; }
            else {
              let lo = 0, hi = 1;
              for (let it = 0; it < 9; it++) {
                const s = (lo + hi) / 2;
                const [r2, g2, b2] = oklabToLin(L, A * s, Bb * s);
                if (r2 < 0 || g2 < 0 || b2 < 0 || r2 > 1 || g2 > 1 || b2 > 1) hi = s; else lo = s;
              }
              [R, G, B] = oklabToLin(L, A * lo, Bb * lo);
            }
          }
        }
        out[o++] = toHalf(linToSrgb(clamp(R)));
        out[o++] = toHalf(linToSrgb(clamp(G)));
        out[o++] = toHalf(linToSrgb(clamp(B)));
        out[o++] = 0x3c00;
      }
  return out;
}

const cache = new Map<string, Uint16Array>();
export function getLut(p: LutParams, size = 48, skinSafe = false): Uint16Array {
  const k = lutKey(p, skinSafe, size);
  let v = cache.get(k);
  if (!v) {
    v = buildLut(p, size, skinSafe);
    cache.set(k, v);
    if (cache.size > 40) cache.delete(cache.keys().next().value!);
  }
  return v;
}

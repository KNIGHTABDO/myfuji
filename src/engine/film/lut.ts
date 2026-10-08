import { clamp, linToOklab, linToSrgb, luma, monotoneCurve, okHue, oklabToLin, smoothstep, srgbToLin, toHalf, type RGB } from '../color';
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

/**
 * Periodic monotone cubic over hue (degrees). The control points are repeated one turn
 * either side, so the curve is C1 with no seam at 0/360 and no overshoot between control hues.
 */
function hueCurve(pts: Array<[number, number]>): (h: number) => number {
  const s = [...pts].sort((a, b) => a[0] - b[0]);
  const ext: Array<[number, number]> = [];
  for (let k = -1; k <= 1; k++) for (const [x, y] of s) ext.push([x + 360 * k, y]);
  const f = monotoneCurve(ext);
  return (h: number) => f(((h % 360) + 360) % 360);
}

/** Hue-selective edits (hue shift deg, saturation ×, lightness shift) as smooth functions of OKLab hue. */
function hueEdits(sim: SimDef) {
  const fH = hueCurve(sim.hue.map(([h, dh]): [number, number] => [h, dh]));
  const fS = hueCurve(sim.hue.map(([h, , s]): [number, number] => [h, s]));
  const fL = hueCurve(sim.hue.map(([h, , , dl]): [number, number] => [h, dl]));
  return (h: number): [number, number, number] => [fH(h), fS(h), fL(h)];
}

/** Lightness above this rolls off smoothly towards 1 (no hard white clip). */
const KNEE_L = 0.955;
/** Fraction of the sRGB chroma limit where chroma starts to roll off. */
const KNEE_C = 0.9;

/** Largest OKLab chroma at a fixed lightness and hue that stays inside sRGB (binary search). */
function maxChroma(L: number, cs: number, sn: number): number {
  let lo = 0, hi = 0.5;
  for (let it = 0; it < 16; it++) {
    const m = (lo + hi) / 2;
    const [r, g, b] = oklabToLin(L, m * cs, m * sn);
    if (r >= 0 && g >= 0 && b >= 0 && r <= 1 && g <= 1 && b <= 1) lo = m; else hi = m;
  }
  return lo;
}

/**
 * Final OKLab -> linear sRGB stage, shared by colour and mono paths.
 * 1. Soft highlight roll-off in lightness.
 * 2. Gamut mapping at constant L and hue: chroma is rolled off smoothly as it approaches the
 *    sRGB boundary (C1 knee at KNEE_C of the limit, asymptote to the limit). The result is in
 *    gamut by construction, so no channel is hard clipped and hue never breaks.
 */
function finish(L: number, A: number, B: number): RGB {
  L = Math.max(0, L);
  if (L > KNEE_L) L = KNEE_L + (1 - KNEE_L) * (1 - Math.exp(-(L - KNEE_L) / (1 - KNEE_L)));
  const C = Math.hypot(A, B);
  if (C <= 1e-7) return oklabToLin(L, 0, 0).map((v) => clamp(v)) as RGB;
  const cs = A / C, sn = B / C;
  const cm = maxChroma(L, cs, sn);
  let c = C;
  const k0 = KNEE_C * cm, room = cm - k0;
  if (C > k0) c = room > 1e-7 ? k0 + room * (1 - Math.exp(-(C - k0) / room)) : 0;
  const [r, g, b] = oklabToLin(L, c * cs, c * sn);
  return [clamp(r), clamp(g), clamp(b)];
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
          [R, G, B] = finish(L, A, Bb);
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
          // Lightness edits fade out in the deepest shadows so dense tones keep their detail.
          let L = L0 + dL * smoothstep(0.02, 0.15, C) * (0.35 + 0.65 * smoothstep(0.08, 0.32, L0));
          L -= cce * (1 - sk) * smoothstep(0.07, 0.22, C2) * smoothstep(0.15, 0.45, L);
          L -= cceB * bell(h, 262, 32) * smoothstep(0.04, 0.18, C2) * smoothstep(0.15, 0.5, L);
          const sw = 1 - smoothstep(0.12, 0.6, L), hw = smoothstep(0.5, 0.96, L);
          const A = Math.cos(h2) * C2 + sim.splitShadow[0] * sw + sim.splitHighlight[0] * hw;
          const Bb = Math.sin(h2) * C2 + sim.splitShadow[1] * sw + sim.splitHighlight[1] * hw;
          [R, G, B] = finish(L, A, Bb);
        }
        out[o++] = toHalf(linToSrgb(R));
        out[o++] = toHalf(linToSrgb(G));
        out[o++] = toHalf(linToSrgb(B));
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

import { illuminantRGB, type RGB } from './color';
import type { Scene } from './analyze/scene';
import type { Stats } from './analyze/stats';
import type { CropId, DevelopParams } from './film/types';
import type { RenderUniforms } from './gl/renderer';

const LW: RGB = [0.2126, 0.7152, 0.0722];

/** How much of the measured colour cast "Auto" keeps, by light type: mood is part of the picture. */
const KEEP: Record<string, number> = {
  'golden-hour': 0.78, 'blue-hour': 0.7, night: 0.6, neon: 0.9, tungsten: 0.45, fluorescent: 0.35, overcast: 0.2,
  'harsh-sun': 0.4, daylight: 0.35, backlit: 0.5, 'low-key': 0.55, 'high-key': 0.3,
};

export function wbGains(p: DevelopParams, st: Stats | null, sc: Scene | null): RGB {
  let g: RGB = [1, 1, 1];
  const rel = (k: number): RGB => { const a = illuminantRGB(5500), b = illuminantRGB(k); return [a[0] / b[0], 1, a[2] / b[2]]; };
  if (p.wbMode === 'auto' || p.wbMode === 'auto-white' || p.wbMode === 'auto-ambience') {
    if (st) {
      let keep = sc ? KEEP[sc.lighting] ?? 0.4 : 0.4;
      if (p.wbMode === 'auto-white') keep = 0.05;
      if (p.wbMode === 'auto-ambience') keep = Math.min(1, keep + 0.3);
      // The camera already balanced this file: only nudge, never overturn it.
      const k = (1 - keep) * (p.wbMode === 'auto-white' ? 0.9 : 0.65);
      g = st.illuminant.map((c) => Math.min(1.2, Math.max(0.84, Math.pow(c, -k)))) as RGB;
      // Green/magenta casts are almost never wanted.
      g[1] *= Math.pow(2, -Math.max(-0.3, Math.min(0.3, st.tint)) * keep * 0.8);
    }
  } else if (p.wbMode === 'shade') g = rel(7200);
  else if (p.wbMode === 'incandescent') g = rel(3100);
  else if (p.wbMode === 'fluorescent') g = [1.03, Math.pow(2, -0.12), 1.05];
  else if (p.wbMode === 'kelvin') g = rel(p.wbKelvin);
  g = [g[0] * Math.pow(2, 0.045 * p.wbShiftR), g[1], g[2] * Math.pow(2, 0.045 * p.wbShiftB)];
  const n = g[0] * LW[0] + g[1] * LW[1] + g[2] * LW[2];
  return [g[0] / n, g[1] / n, g[2] / n];
}

export function resolveDR(p: DevelopParams, st: Stats | null): 100 | 200 | 400 {
  if (p.dr !== 'auto') return p.dr;
  if (!st) return 100;
  if (st.drStops > 9.5 || st.clipHigh > 0.02) return 400;
  if (st.drStops > 7.5 || st.clipHigh > 0.005) return 200;
  return 100;
}

const ASPECT: Record<CropId, number | null> = { original: null, '3:2': 3 / 2, '4:3': 4 / 3, '4:5': 4 / 5, '1:1': 1, '16:9': 16 / 9, '65:24': 65 / 24 };

/** Largest rectangle of the crop's aspect, centred as close to the subject as possible. uv coords. */
export function cropRect(crop: CropId, center: [number, number], w: number, h: number, aspectOverride?: number): [number, number, number, number] {
  let a = aspectOverride ?? ASPECT[crop];
  if (!a) return [0, 0, 1, 1];
  // Follow the photo's orientation for non-square ratios, except panoramas.
  if (!aspectOverride && crop !== '65:24' && crop !== '16:9' && h > w && a > 1) a = 1 / a;
  if (!aspectOverride && crop === '4:5' && w > h) a = 5 / 4;
  const img = w / h;
  let cw = 1, ch = 1;
  if (a > img) ch = img / a; else cw = a / img;
  const cx = Math.min(1 - cw / 2, Math.max(cw / 2, center[0])), cy = Math.min(1 - ch / 2, Math.max(ch / 2, center[1] - ch * 0.08));
  return [cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2];
}

export function uniformsFor(p: DevelopParams, st: Stats | null, sc: Scene | null, size: { w: number; h: number }, hasSubjectMask: boolean): RenderUniforms {
  const dr = resolveDR(p, st);
  const ev = p.exposure;
  const drs = st ? st.drStops : 7;
  const autoCompress = Math.min(1, Math.max(0, (drs - 5.5) / 6)) * 0.32 + (dr === 400 ? 0.08 : dr === 200 ? 0.04 : 0);
  const compress = Math.min(0.6, autoCompress * p.smartLight * 2);
  const night = sc?.lighting === 'night' || sc?.lighting === 'neon';
  const shadowLift = p.smartLight * 2 * (night ? 0.05 : 0.12);
  const autoLift = sc ? Math.min(1.6, Math.max(0, sc.subjectDeficit - Math.max(ev, 0))) * 0.8 : 0;
  const maxV = Math.pow(2, Math.max(ev, 0)) * (1 + shadowLift * 0.2);
  const knee = dr === 400 ? 0.55 : dr === 200 ? 0.72 : 0.9;
  const white = dr === 400 ? maxV : dr === 200 ? 1 + 0.7 * (maxV - 1) : 1 + 0.25 * (maxV - 1);
  const mono = p.sim === 'acros' || p.sim === 'mono' || p.sim === 'sepia';
  const s = Math.max(1, Math.max(size.w, size.h) / 3500);
  return {
    wb: wbGains(p, st, sc),
    ev,
    compress,
    shadowLift,
    clarity: p.clarity * 0.12,
    subjectLift: autoLift * p.subjectLift * 2,
    shoulder: [knee, Math.max(white, knee + 0.05)],
    halation: p.halation * 0.9,
    halTint: [1.0, 0.26, 0.08],
    sharp: p.sharpness * 0.22,
    intensity: p.intensity,
    skin: p.skinProtect && !mono && hasSubjectMask,
    grain: p.grain === 'off' ? 0 : p.grain === 'weak' ? 0.026 : 0.047,
    grainSize: (p.grainSize === 'small' ? 1.2 : 2.2) * s,
    grainChroma: mono ? 0 : 0.12,
    vignette: p.vignette,
    leak: p.lightLeak,
    leakSeed: p.leakSeed,
    crop: cropRect(p.crop, p.cropCenter, size.w, size.h),
  };
}

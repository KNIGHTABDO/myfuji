// DEV-only probe hook for headless measurement (scripts/probe.mjs). Loaded from
// main.tsx only under import.meta.env.DEV, so it never ships in a production build.
// It drives the real pipeline: files go through enqueue() and exports through
// darkroom.exportPhoto(), exactly as the UI does.
import { enqueue } from './actions';
import { darkroom } from './darkroom';
import { uniformsFor, resolveDR, wbGains } from './engine/develop';
import { autoParams } from './engine/analyze/recommend';
import { SIMS } from './engine/film/sims';
import type { DevelopParams, SimId } from './engine/film/types';
import type { Photo } from './engine/pipeline';
import { activePhoto, getState, updateParams } from './state';
import { computeRegions, type RegionMaps } from './engine/regions';

const PNG = { frame: 'none', dateStamp: false, format: 'png', quality: 1, size: 'full' } as const;

const need = (): Photo => {
  const p = activePhoto();
  if (!p) throw new Error('no active photo: call load() first');
  return p;
};

const toDataURL = (b: Blob) => new Promise<string>((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result));
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(b);
});

/** Load a file (base64 payload) through the app's own queue and wait for it to be developed. */
async function load(name: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const file = new File([bytes], name, { type: name.endsWith('.png') ? 'image/png' : 'image/jpeg' });
  const before = getState().photos.length;
  enqueue([file]);
  const t0 = Date.now();
  while (getState().photos.length <= before) {
    if (Date.now() - t0 > 600_000) throw new Error('timed out developing ' + name);
    await new Promise((r) => setTimeout(r, 100));
  }
  const p = need();
  return { id: p.id, name: p.name, w: p.w, h: p.h, origW: p.origW, origH: p.origH, kind: p.kind, notes: p.notes };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Everything the analysis decided, as plain JSON. */
function analysis() {
  const p = need();
  const st = p.stats, sc = p.scene, v = p.vision;
  const u = uniformsFor(p.params, st, sc, { w: p.w, h: p.h }, !!p.mask);
  return {
    file: { name: p.name, w: p.w, h: p.h, origW: p.origW, origH: p.origH, kind: p.kind, notes: p.notes, exif: p.exif },
    stats: {
      cct: st.cct, tint: r3(st.tint), illuminant: st.illuminant.map(r3), wbReliability: r3(st.wbReliability),
      drStops: r3(st.drStops), clipHigh: r3(st.clipHigh), clipLow: r3(st.clipLow), key: r3(st.key),
      p: Object.fromEntries(Object.entries(st.p).map(([k, x]) => [k, r3(x)])),
      contrast: r3(st.contrast), colorfulness: r3(st.colorfulness), meanChroma: r3(st.meanChroma),
      hueMass: Object.fromEntries(Object.entries(st.hueMass).map(([k, x]) => [k, r3(x)])),
      sky: { ...st.sky, fraction: r3(st.sky.fraction) }, pointLights: st.pointLights, darkFrac: r3(st.darkFrac),
      noise: r3(st.noise), sharpness: r3(st.sharpness), topVsBottom: r3(st.topVsBottom),
      palette: st.palette.map((s) => ({ hex: s.hex, share: r3(s.share), name: s.name })),
    },
    vision: {
      available: v.available, error: v.error ?? null,
      faces: v.faces.map((f) => ({ x: r3(f.x), y: r3(f.y), w: r3(f.w), h: r3(f.h), score: r3(f.score) })),
      labels: v.labels.slice(0, 8).map((l) => ({ name: l.name, score: r3(l.score) })),
      objects: v.objects.slice(0, 12).map((o) => ({ name: o.name, score: r3(o.score) })),
      segFractions: Object.fromEntries(Object.entries(v.segFractions).map(([k, x]) => [k, r3(x)])),
    },
    scene: {
      subject: sc.subject, subjectScores: sc.subjectScores.slice(0, 4).map(([k, x]) => [k, r3(x)]),
      lighting: sc.lighting, lightingScores: sc.lightingScores.slice(0, 5).map(([k, x]) => [k, r3(x)]),
      time: sc.time, facts: sc.facts, story: sc.story, faceLum: sc.faceLum === null ? null : r3(sc.faceLum),
      backgroundLum: r3(sc.backgroundLum), subjectDeficit: r3(sc.subjectDeficit), saliency: sc.saliency.map(r3),
      warmLight: r3(sc.warmLight), backlight: r3(sc.backlight), inputKind: sc.inputKind, gentle: r3(sc.gentle),
    },
    rec: {
      picks: p.rec.picks.map((k) => ({ sim: k.sim, score: r3(k.score), reasons: k.reasons })),
      recipe: p.rec.recipe?.name ?? null, recipeWhy: p.rec.recipeWhy,
    },
    params: p.params,
    auto: p.auto,
    resolvedDR: resolveDR(p.params, st),
    wbGains: wbGains(p.params, st, sc).map(r3),
    uniforms: { ...u, wb: u.wb.map(r3), shoulder: u.shoulder.map(r3), halTint: u.halTint, crop: u.crop.map(r3) },
  };
}

/** Set params on the active photo (store update, exactly like the UI). Patch is merged over `base`. */
function setParams(patch: Partial<DevelopParams>, base: 'current' | 'auto' = 'current') {
  const p = need();
  const from = base === 'auto' ? p.auto : p.params;
  updateParams({ ...from, ...patch });
  return need().params;
}

/** Params the app would apply for a sim (same call as applyPick), with optional overrides. */
function autoFor(sim: SimId, patch: Partial<DevelopParams> = {}): DevelopParams {
  const p = need();
  const a = autoParams(sim, p.stats, p.scene, p.vision, p.exif, p.auto);
  return { ...a, crop: p.auto.crop, cropCenter: p.auto.cropCenter, ...patch, sim };
}

/**
 * Develop the active photo at full resolution with the given settings and return the PNG.
 * No args: the current params. sim: autoParams(sim) (+ patch). patch alone: current params + patch.
 */
async function render(sim?: SimId, patch: Partial<DevelopParams> = {}) {
  if (sim) updateParams(autoFor(sim, patch));
  else if (Object.keys(patch).length) updateParams(patch);
  const p = need();
  const blob = await darkroom.exportPhoto(p, { ...PNG }, 1);
  return { dataUrl: await toDataURL(blob), params: p.params, w: p.w, h: p.h, bytes: blob.size };
}

/** Greyscale PNG (data URL) of a 0..1 map on the analysis grid. */
function mapPNG(m: Float32Array, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const im = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(Math.min(1, Math.max(0, m[i])) * 255);
    im.data[i * 4] = v; im.data[i * 4 + 1] = v; im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * Region maps of the active photo (computeRegions on p.work + p.mask). ms is the warm
 * (second) run, coldMs the first, so JIT warm-up does not hide the steady-state cost.
 */
interface RegionsOut { w: number; h: number; ms: number; coldMs: number; hasMask: boolean; sky: string; foliage: string; ground: string; sun: string }

function regions(): RegionsOut {
  const p = need();
  let t0 = performance.now();
  computeRegions(p.work, p.mask);
  const coldMs = performance.now() - t0;
  t0 = performance.now();
  const m: RegionMaps = computeRegions(p.work, p.mask);
  const ms = performance.now() - t0;
  const { w, h } = m;
  return {
    w, h, ms: r3(ms), coldMs: r3(coldMs), hasMask: !!p.mask,
    sky: mapPNG(m.sky, w, h), foliage: mapPNG(m.foliage, w, h), ground: mapPNG(m.ground, w, h), sun: mapPNG(m.sun, w, h),
  };
}

/** Raw analysis inputs (base64 Float32 lin/Y/mask) for offline region tuning. */
function regionInputs() {
  const p = need();
  const b64 = (a: Float32Array) => {
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  return { w: p.work.w, h: p.work.h, lin: b64(p.work.lin), Y: b64(p.work.Y), mask: p.mask ? b64(p.mask) : null };
}

const sims = SIMS.map((s) => s.id);

declare global {
  interface Window { __myfuji?: unknown }
}

window.__myfuji = { load, analysis, setParams, autoFor, render, regions, regionInputs, sims, activePhoto: () => need().id };

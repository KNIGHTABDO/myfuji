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
    if (Date.now() - t0 > 240_000) throw new Error('timed out developing ' + name);
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

const sims = SIMS.map((s) => s.id);

declare global {
  interface Window { __myfuji?: unknown }
}

window.__myfuji = { load, analysis, setParams, autoFor, render, sims, activePhoto: () => need().id };

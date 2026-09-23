import { autoParams } from './engine/analyze/recommend';
import { RECIPES, type Recipe } from './engine/film/recipes';
import { SIMS } from './engine/film/sims';
import type { DevelopParams, SimId } from './engine/film/types';
import { processFile, STAGES, type Photo } from './engine/pipeline';
import { download, exportName, zip } from './engine/export';
import { darkroom } from './darkroom';
import { progress } from './progressBus';
import { activePhoto, getState, setState, toast, updateParams } from './state';
import { shutterSound } from './mosquito/buzz';

const IMG_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif|tiff?|svg|dng|cr2|cr3|crw|nef|nrw|arw|srf|sr2|raf|orf|rw2|rwl|pef|srw|x3f|3fr|iiq|erf|mef|mos|kdc|dcr)$/i;
export const isImageLike = (f: File) => f.type.startsWith('image/') || IMG_EXT.test(f.name);

let running = false;

export function enqueue(files: File[]) {
  const imgs = files.filter(isImageLike);
  const skipped = files.length - imgs.length;
  if (skipped) toast(`${skipped} file${skipped > 1 ? 's' : ''} skipped: not an image`, 'err');
  if (!imgs.length) return;
  setState((s) => ({ queue: [...s.queue, ...imgs] }));
  if (!running) void runQueue();
}

async function runQueue() {
  running = true;
  let done = 0;
  while (getState().queue.length) {
    const [file, ...rest] = getState().queue;
    const total = done + 1 + rest.length;
    setState({ developing: { name: file.name, index: done + 1, total } });
    progress.begin(`developing ${file.name.length > 34 ? file.name.slice(0, 31) + '…' : file.name}`, total > 1 ? `frame ${done + 1} of ${total}` : 'reading every pixel, on your device');
    try {
      const photo = await processFile(file, darkroom.maxEdge, (stage, v, d) => progress.update(stage, v, d));
      progress.update('develop', 1, 'ready');
      await progress.finish();
      setState((s) => ({ photos: [...s.photos, photo], activeId: photo.id, queue: s.queue.slice(1), zoom: 1, pan: [0.5, 0.5] }));
    } catch (e) {
      console.error(e);
      toast(`Couldn’t develop ${file.name}: ${(e as Error).message}`, 'err');
      setState((s) => ({ queue: s.queue.slice(1) }));
    }
    done++;
  }
  setState({ developing: null });
  running = false;
}

export const stageList = STAGES;

/** Full lab treatment for a simulation: re-tunes every setting to this photo. */
export function applyPick(sim: SimId) {
  const p = activePhoto();
  if (!p) return;
  const params = autoParams(sim, p.stats, p.scene, p.vision, p.exif, p.params);
  updateParams({ ...params, crop: p.params.crop });
}

export function applyRecipe(r: Recipe) {
  const p = activePhoto();
  if (!p) return;
  const base = autoParams(r.params.sim ?? p.params.sim, p.stats, p.scene, p.vision, p.exif, p.params);
  updateParams({ ...base, cce: 'off', cceBlue: 'off', halation: 0, vignette: 0, fade: 0, lightLeak: 0, clarity: 0, sharpness: 0, ...r.params, exposure: base.exposure + (r.params.exposure ?? 0), crop: p.params.crop });
}

export function resetAuto() {
  const p = activePhoto();
  if (!p) return;
  updateParams({ ...p.auto });
}

export function stepSim(dir: 1 | -1) {
  const p = activePhoto();
  if (!p) return;
  const i = SIMS.findIndex((s) => s.id === p.params.sim);
  updateParams({ sim: SIMS[(i + dir + SIMS.length) % SIMS.length].id });
}

export function stepPhoto(dir: 1 | -1) {
  const s = getState();
  const i = s.photos.findIndex((p) => p.id === s.activeId);
  if (i < 0 || !s.photos.length) return;
  setState({ activeId: s.photos[(i + dir + s.photos.length) % s.photos.length].id, zoom: 1, pan: [0.5, 0.5] });
}

export function removePhoto(id: string) {
  setState((s) => {
    const photos = s.photos.filter((p) => p.id !== id);
    const gone = s.photos.find((p) => p.id === id);
    if (gone) { URL.revokeObjectURL(gone.thumb); }
    return { photos, activeId: s.activeId === id ? photos[photos.length - 1]?.id ?? null : s.activeId };
  });
}

export function saveCustom(slot: number, name?: string) {
  const p = activePhoto();
  if (!p) return;
  const { crop: _c, cropCenter: _cc, exposure: _e, ...keep } = p.params;
  setState((s) => {
    const customs = [...s.customs];
    customs[slot] = { name: name || `C${slot + 1} · ${SIMS.find((x) => x.id === p.params.sim)!.name}`, params: keep };
    return { customs };
  });
  toast(`Saved to C${slot + 1}`);
}

export function applyCustom(slot: number) {
  const c = getState().customs[slot];
  if (c) updateParams(c.params as Partial<DevelopParams>);
}

export function clearCustom(slot: number) {
  setState((s) => { const customs = [...s.customs]; customs[slot] = null; return { customs }; });
}

export async function exportActive(share = false) {
  const s = getState(), p = activePhoto(s);
  if (!p) return;
  setState({ busy: 'Developing print…' });
  try {
    const idx = s.photos.findIndex((x) => x.id === p.id) + 1;
    const blob = await darkroom.exportPhoto(p, s.exportOpts, idx, (f) => setState({ busy: `Developing print… ${Math.round(f * 100)}%` }));
    const name = exportName(p.name, p.params, s.exportOpts);
    if (s.sound) shutterSound();
    if (share && navigator.canShare?.({ files: [new File([blob], name, { type: blob.type })] })) {
      await navigator.share({ files: [new File([blob], name, { type: blob.type })], title: name }).catch(() => undefined);
    } else {
      download(blob, name);
      toast(`Saved ${name} · ${(blob.size / 1e6).toFixed(1)} MB`);
    }
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`, 'err');
  } finally {
    setState({ busy: null });
  }
}

export async function exportRoll() {
  const s = getState();
  if (!s.photos.length) return;
  const files: Array<{ name: string; blob: Blob }> = [];
  try {
    for (let i = 0; i < s.photos.length; i++) {
      const p = s.photos[i];
      setState({ busy: `Developing roll · frame ${i + 1}/${s.photos.length}` });
      const blob = await darkroom.exportPhoto(p, s.exportOpts, i + 1);
      files.push({ name: `${String(i + 1).padStart(2, '0')}_${exportName(p.name, p.params, s.exportOpts)}`, blob });
    }
    setState({ busy: 'Packing the roll…' });
    download(await zip(files), `myfuji-roll-${new Date().toISOString().slice(0, 10)}.zip`);
    if (s.sound) shutterSound();
    toast(`Roll of ${files.length} exported`);
  } catch (e) {
    toast(`Roll export failed: ${(e as Error).message}`, 'err');
  } finally {
    setState({ busy: null });
  }
}

export { RECIPES };
export type { Photo };

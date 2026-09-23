// A second, small renderer that develops the same photo with every simulation
// for the contact sheet.
import { packAux } from './engine/aux';
import { uniformsFor } from './engine/develop';
import { FilmRenderer } from './engine/gl/renderer';
import { luts } from './engine/lutClient';
import type { DevelopParams, SimId } from './engine/film/types';
import type { Photo } from './engine/pipeline';

let r: FilmRenderer | null = null;
let loadedId = '';
let loadedEv = NaN;

function renderer() {
  if (!r) {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 180;
    r = new FilmRenderer(c);
  }
  return r;
}

export function renderSimThumb(photo: Photo, params: DevelopParams, sim: SimId, target: HTMLCanvasElement) {
  const R = renderer();
  if (loadedId !== photo.id) { R.setImage(photo.preview, photo.preview.width, photo.preview.height); loadedId = photo.id; loadedEv = NaN; }
  if (loadedEv !== params.exposure) { R.setAux(packAux(photo.work, photo.aux, photo.mask, params.exposure), photo.work.w, photo.work.h); loadedEv = params.exposure; }
  const p: DevelopParams = { ...params, sim, grain: 'off', lightLeak: 0 };
  const pair = luts.small({ sim, monoFilter: p.monoFilter, monoWC: p.monoWC, monoMG: p.monoMG, highlight: p.highlight, shadow: p.shadow, color: p.color, cce: p.cce, cceBlue: p.cceBlue, fade: p.fade }, 21);
  R.setLuts(pair.main, pair.skin, pair.size);
  const u = uniformsFor(p, photo.stats, photo.scene, { w: photo.w, h: photo.h }, !!photo.mask);
  // Centre-crop to the tile's 4:3.
  const a = photo.w / photo.h, t = 4 / 3;
  const view: [number, number, number, number] = a > t ? [0.5 - t / a / 2, 0, 0.5 + t / a / 2, 1] : [0, 0.5 - a / t / 2, 1, 0.5 + a / t / 2];
  const w = target.width || 240, h = target.height || 180;
  R.render(u, view, w, h);
  target.getContext('2d')!.drawImage(R.canvas as HTMLCanvasElement, 0, 0, w, h);
}

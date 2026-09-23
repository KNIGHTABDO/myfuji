// Glue between the app state and the GPU: owns the viewer's renderer, keeps
// its textures and LUTs in sync with the active photo, and runs exports.
import { packAux } from './engine/aux';
import { cropRect, uniformsFor } from './engine/develop';
import { canvasToBlob, composePrint, frameAspect, outputSize, type ExportOptions } from './engine/export';
import { FilmRenderer } from './engine/gl/renderer';
import { lutKey, type LutParams } from './engine/film/lut';
import { luts } from './engine/lutClient';
import type { DevelopParams } from './engine/film/types';
import type { Photo } from './engine/pipeline';
import { getState } from './state';

const lutParams = (p: DevelopParams): LutParams => ({ sim: p.sim, monoFilter: p.monoFilter, monoWC: p.monoWC, monoMG: p.monoMG, highlight: p.highlight, shadow: p.shadow, color: p.color, cce: p.cce, cceBlue: p.cceBlue, fade: p.fade });

class Darkroom {
  renderer: FilmRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private photoId: string | null = null;
  private photo: Photo | null = null;
  private auxEv: number | null = null;
  private lutApplied = '';
  private lutWanted = '';
  private raf = 0;
  onRendered: (() => void) | null = null;

  private probed = 0;
  get maxEdge() {
    let max = this.renderer?.maxTexture ?? this.probed;
    if (!max) {
      const gl = document.createElement('canvas').getContext('webgl2');
      max = this.probed = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }
    return Math.min(max, 8192);
  }

  attach(canvas: HTMLCanvasElement) {
    if (this.canvas === canvas && this.renderer) return;
    this.renderer?.dispose();
    this.canvas = canvas;
    this.renderer = new FilmRenderer(canvas);
    this.photoId = null;
    this.lutApplied = '';
  }

  detach() {
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas = null;
    this.photoId = null;
  }

  /** Make sure the GPU holds this photo, its aux layers for the current exposure, and the right LUTs. */
  async sync(photo: Photo): Promise<void> {
    const r = this.renderer;
    if (!r) return;
    if (this.photoId !== photo.id) {
      r.setImage(photo.full, photo.w, photo.h);
      this.photoId = photo.id;
      this.auxEv = null;
      this.lutApplied = '';
    }
    this.photo = photo;
    const ev = Math.round(photo.params.exposure * 20) / 20;
    if (this.auxEv !== ev) {
      r.setAux(packAux(photo.work, photo.aux, photo.mask, ev), photo.work.w, photo.work.h);
      this.auxEv = ev;
    }
    const lp = lutParams(photo.params);
    const key = lutKey(lp, false, 48);
    if (key !== this.lutApplied) {
      if (!this.lutApplied) {
        // First paint: a quick small LUT so something shows immediately.
        const s = luts.small(lp, 25);
        r.setLuts(s.main, s.skin, s.size);
      }
      this.lutWanted = key;
      const pair = await luts.get(lp, 48);
      if (pair && this.lutWanted === key && this.photoId === photo.id && this.renderer === r) {
        r.setLuts(pair.main, pair.skin, pair.size);
        this.lutApplied = key;
      }
    }
    this.requestRender();
  }

  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  private render() {
    const r = this.renderer, c = this.canvas, photo = this.photo;
    if (!r || !c || !photo || this.photoId !== photo.id || !r.ready) return;
    const s = getState();
    const p = s.photos.find((x) => x.id === photo.id)?.params ?? photo.params;
    const u = uniformsFor(p, photo.stats, photo.scene, { w: photo.w, h: photo.h }, !!photo.mask);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const outW = Math.max(2, Math.round(c.clientWidth * dpr)), outH = Math.max(2, Math.round(c.clientHeight * dpr));
    const [x0, y0, x1, y1] = u.crop;
    const cw = (x1 - x0) / s.zoom, ch = (y1 - y0) / s.zoom;
    const cx = Math.min(x1 - cw / 2, Math.max(x0 + cw / 2, x0 + s.pan[0] * (x1 - x0)));
    const cy = Math.min(y1 - ch / 2, Math.max(y0 + ch / 2, y0 + s.pan[1] * (y1 - y0)));
    r.render(u, [cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2], outW, outH, { split: s.split ?? -1, original: s.showOriginal });
    this.onRendered?.();
  }

  /** Develop a photo at print resolution and compose its print. */
  async exportPhoto(photo: Photo, opts: ExportOptions, frameNo: number, onProgress?: (f: number) => void): Promise<Blob> {
    const r = this.renderer;
    if (!r) throw new Error('The darkroom is not ready.');
    const prev = this.photo;
    await this.sync(photo);
    const lp = lutParams(photo.params);
    const pair = await luts.get(lp, 64) ?? luts.small(lp, 48);
    r.setLuts(pair.main, pair.skin, pair.size);
    this.lutApplied = '';
    const p = photo.params;
    const u = uniformsFor(p, photo.stats, photo.scene, { w: photo.w, h: photo.h }, !!photo.mask);
    const fa = frameAspect(opts.frame, photo.w >= photo.h);
    if (fa) u.crop = cropRect(p.crop, p.cropCenter, photo.w, photo.h, fa);
    const cropW = (u.crop[2] - u.crop[0]) * photo.w, cropH = (u.crop[3] - u.crop[1]) * photo.h;
    const [ow, oh] = outputSize(cropW, cropH, opts.size);
    const pixels = await r.renderToPixels(u, u.crop, ow, oh, (d, t) => onProgress?.(d / t));
    const print = composePrint(pixels, p, photo.exif, opts, frameNo);
    const blob = await canvasToBlob(print, opts);
    if (prev && prev.id !== photo.id) await this.sync(prev);
    else await this.sync(photo);
    return blob;
  }
}

export const darkroom = new Darkroom();

import { auxLayers, gaussBlur, type AuxCache, type WorkImage } from './aux';
import { decodeFile, downscale, toWorking, type SourceKind } from './decode';
import { readExif, type ExifInfo } from './exif';
import { computeStats, workImageFrom, type Stats } from './analyze/stats';
import { runVision, loadModels, type VisionResult } from './analyze/vision';
import { readScene, type Scene } from './analyze/scene';
import { autoParams, recommend, type Recommendation } from './analyze/recommend';
import type { DevelopParams } from './film/types';

export interface Photo {
  id: string;
  name: string;
  file: File;
  kind: SourceKind;
  notes: string[];
  full: ImageBitmap;
  /** analysis-resolution bitmap (same grid as the aux layers) for thumbnails */
  preview: ImageBitmap;
  w: number;
  h: number;
  origW: number;
  origH: number;
  work: WorkImage;
  aux: AuxCache;
  mask: Float32Array | null;
  exif: ExifInfo;
  stats: Stats;
  vision: VisionResult;
  scene: Scene;
  rec: Recommendation;
  params: DevelopParams;
  auto: DevelopParams;
  thumb: string;
  addedAt: number;
}

export interface Stage { id: string; label: string; at: number }
export const STAGES: Stage[] = [
  { id: 'open', label: 'opening the canister', at: 0.14 },
  { id: 'read', label: 'reading the light', at: 0.3 },
  { id: 'lab', label: 'waking the lab', at: 0.48 },
  { id: 'look', label: 'looking closely', at: 0.7 },
  { id: 'film', label: 'choosing the film', at: 0.84 },
  { id: 'develop', label: 'developing', at: 1 },
];

export type Progress = (stage: string, value: number, detail?: string) => void;

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function processFile(file: File, maxEdge: number, onProgress: Progress): Promise<Photo> {
  onProgress('open', 0.02, file.name);
  const exif = await readExif(file);
  const decoded = await decodeFile(file, exif.orientation);
  const origW = decoded.width, origH = decoded.height;
  const { full, w, h } = await toWorking(decoded, maxEdge);
  onProgress('open', 0.14, `${origW}×${origH} ${decoded.kind.toUpperCase()}`);
  await tick();

  const small = downscale(full, 768);
  const data = small.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, small.width, small.height);
  const work = workImageFrom(data);
  const cw = Math.min(512, w), ch = Math.min(512, h);
  const cc = new OffscreenCanvas(cw, ch);
  cc.getContext('2d')!.drawImage(full, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
  const crop = cc.getContext('2d')!.getImageData(0, 0, cw, ch);
  const stats = computeStats(work, crop);
  onProgress('read', 0.3, `${Math.round(stats.cct / 100) * 100} K · ${stats.drStops.toFixed(1)} stops`);
  await tick();

  onProgress('lab', 0.34, 'loading on-device models');
  let labOk = true;
  await loadModels((name, i, n) => onProgress('lab', 0.34 + (0.14 * i) / n, name)).catch(() => { labOk = false; });
  onProgress('lab', 0.48, labOk ? 'models ready' : 'models unavailable, using pixel analysis');
  await tick();

  const steps = ['objects', 'faces', 'scene', 'segmentation'];
  const vision: VisionResult = await runVision(small, full, (s) => onProgress('look', 0.5 + 0.05 * steps.indexOf(s), s));
  onProgress('look', 0.7, vision.faces.length ? `${vision.faces.length} face${vision.faces.length > 1 ? 's' : ''}` : vision.labels[0]?.name ?? '');
  await tick();

  const scene: Scene = readScene(work, stats, vision, exif);
  const rec: Recommendation = recommend(stats, scene);
  const params = autoParams(rec.picks[0].sim, stats, scene, vision, exif);
  onProgress('film', 0.84, rec.picks[0].sim);
  await tick();

  const aux = auxLayers(work);
  const mask = vision.subjectMask ? gaussBlur(vision.subjectMask, work.w, work.h, Math.max(2, Math.round(Math.max(work.w, work.h) * 0.006))) : null;
  const preview = await createImageBitmap(small);
  const tc = downscale(full, 360);
  const thumbBlob = await tc.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  const thumb = URL.createObjectURL(thumbBlob);
  onProgress('develop', 0.9, 'mixing chemistry');

  return {
    id: crypto.randomUUID(), name: file.name, file, kind: decoded.kind, notes: decoded.notes,
    full, preview, w, h, origW, origH, work, aux, mask, exif, stats, vision, scene, rec,
    params, auto: params, thumb, addedAt: Date.now(),
  };
}

import type { FaceDetector, ImageClassifier, ImageSegmenter, ObjectDetector } from '@mediapipe/tasks-vision';

export interface Box { x: number; y: number; w: number; h: number; score: number }
export interface Labelled { name: string; score: number }
export interface VisionResult {
  available: boolean;
  faces: Box[];
  labels: Labelled[];
  objects: Array<Labelled & Box>;
  segFractions: Record<string, number>;
  /** Soft mask (analysis resolution) of people and faces: used for skin protection and subject lift. */
  subjectMask: Float32Array | null;
  error?: string;
}

interface Models { face: FaceDetector; cls: ImageClassifier; det: ObjectDetector; seg: ImageSegmenter }
let loading: Promise<Models> | null = null;

const BASE = import.meta.env.BASE_URL;
/** Let the page paint a frame between model runs so the animation keeps moving. */
const pause = () => new Promise((r) => setTimeout(r, 16));

export function loadModels(onStep?: (name: string, i: number, n: number) => void): Promise<Models> {
  if (loading) return loading;
  loading = (async () => {
    const mp = await import('@mediapipe/tasks-vision');
    const fileset = await mp.FilesetResolver.forVisionTasks(`${BASE}mediapipe`);
    const opts = (file: string) => ({ baseOptions: { modelAssetPath: `${BASE}models/${file}`, delegate: 'CPU' as const } });
    onStep?.('faces', 1, 4);
    const face = await mp.FaceDetector.createFromOptions(fileset, { ...opts('blaze_face_short_range.tflite'), minDetectionConfidence: 0.55, runningMode: 'IMAGE' });
    onStep?.('classifier', 2, 4);
    const cls = await mp.ImageClassifier.createFromOptions(fileset, { ...opts('efficientnet_lite2.tflite'), maxResults: 12, scoreThreshold: 0.015, runningMode: 'IMAGE' });
    onStep?.('objects', 3, 4);
    const det = await mp.ObjectDetector.createFromOptions(fileset, { ...opts('efficientdet_lite0.tflite'), maxResults: 30, scoreThreshold: 0.28, runningMode: 'IMAGE' });
    onStep?.('segmenter', 4, 4);
    const seg = await mp.ImageSegmenter.createFromOptions(fileset, { ...opts('deeplab_v3.tflite'), outputCategoryMask: true, outputConfidenceMasks: true, runningMode: 'IMAGE' });
    return { face, cls, det, seg };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

const iou = (a: Box, b: Box) => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return i / (a.w * a.h + b.w * b.h - i + 1e-9);
};
function nms(boxes: Box[], thr = 0.3): Box[] {
  const out: Box[] = [];
  for (const b of [...boxes].sort((p, q) => q.score - p.score)) if (!out.some((o) => iou(o, b) > thr || (b.x >= o.x && b.y >= o.y && b.x + b.w <= o.x + o.w && b.y + b.h <= o.y + o.h))) out.push(b);
  return out;
}

function cropCanvas(src: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number, size: number) {
  const s = size / Math.max(w, h);
  const c = new OffscreenCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

/**
 * Run every model on the image. `small` is the analysis-resolution canvas, `large`
 * a higher-resolution source used for face tiles so small faces are still found.
 */
export async function runVision(small: OffscreenCanvas, large: ImageBitmap, onStep?: (label: string) => void): Promise<VisionResult> {
  let m: Models;
  try {
    m = await loadModels();
  } catch (e) {
    return { available: false, faces: [], labels: [], objects: [], segFractions: {}, subjectMask: null, error: String(e) };
  }
  const W = small.width, H = small.height;
  const src = small as unknown as HTMLCanvasElement;

  onStep?.('objects');
  const det = m.det.detect(src);
  const objects = det.detections.map((d) => {
    const b = d.boundingBox!;
    const c = d.categories[0];
    return { name: c.categoryName, score: c.score, x: b.originX / W, y: b.originY / H, w: b.width / W, h: b.height / H };
  });

  await pause();
  onStep?.('faces');
  const faces: Box[] = [];
  const addFaces = (canvas: OffscreenCanvas, ox: number, oy: number, ow: number, oh: number, minScore: number) => {
    const r = m.face.detect(canvas as unknown as HTMLCanvasElement);
    for (const d of r.detections) {
      const b = d.boundingBox!, s = d.categories[0]?.score ?? 0;
      if (s < minScore) continue;
      faces.push({ x: ox + (b.originX / canvas.width) * ow, y: oy + (b.originY / canvas.height) * oh, w: (b.width / canvas.width) * ow, h: (b.height / canvas.height) * oh, score: s });
    }
  };
  const LW = large.width, LH = large.height;
  addFaces(cropCanvas(large, 0, 0, LW, LH, 640), 0, 0, 1, 1, 0.55);
  // Overlapping 2×2 tiles.
  for (const ty of [0, 0.4]) for (const tx of [0, 0.4]) { await pause(); addFaces(cropCanvas(large, tx * LW, ty * LH, 0.6 * LW, 0.6 * LH, 640), tx, ty, 0.6, 0.6, 0.7); }
  // Head regions of every detected person.
  for (const o of objects.filter((o) => o.name === 'person' && o.score > 0.4).slice(0, 8)) {
    const side = Math.min(1, Math.max(o.w, o.h * 0.45) * 1.1);
    const cx = o.x + o.w / 2, cy = o.y + Math.min(o.h, side) * 0.45;
    const x0 = Math.max(0, cx - side / 2), y0 = Math.max(0, cy - side / 2), sw = Math.min(side, 1 - x0), sh = Math.min(side * (LW / LH), 1 - y0);
    if (sw * LW < 24 || sh * LH < 24) continue;
    addFaces(cropCanvas(large, x0 * LW, y0 * LH, sw * LW, sh * LH, 384), x0, y0, sw, sh, 0.62);
  }
  await pause();
  const mergedFaces = nms(faces).filter((f) => f.w > 0.006);

  onStep?.('scene');
  const cls = m.cls.classify(src);
  const labels = (cls.classifications[0]?.categories ?? []).map((c) => ({ name: c.categoryName, score: c.score }));

  await pause();
  onStep?.('segmentation');
  const seg = m.seg.segment(src);
  const names = m.seg.getLabels();
  const segFractions: Record<string, number> = {};
  let subjectMask: Float32Array | null = null;
  if (seg.categoryMask) {
    const cm = seg.categoryMask.getAsUint8Array();
    const counts = new Array(names.length).fill(0);
    for (const v of cm) counts[v]++;
    names.forEach((nme, i) => { if (counts[i]) segFractions[nme] = counts[i] / cm.length; });
    const pi = names.indexOf('person');
    const mw = seg.categoryMask.width, mh = seg.categoryMask.height;
    const conf = pi >= 0 && seg.confidenceMasks ? seg.confidenceMasks[pi].getAsFloat32Array() : null;
    subjectMask = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const sx = Math.min(mw - 1, Math.floor((x / W) * mw)), sy = Math.min(mh - 1, Math.floor((y / H) * mh));
        subjectMask[y * W + x] = conf ? conf[sy * mw + sx] : cm[sy * mw + sx] === pi ? 1 : 0;
      }
  }
  seg.close();
  if (!subjectMask) subjectMask = new Float32Array(W * H);
  // Faces as soft ellipses, a little larger than the detector box to include hairline and neck.
  for (const f of mergedFaces) {
    const cx = (f.x + f.w / 2) * W, cy = (f.y + f.h / 2) * H, rx = f.w * W * 0.8, ry = f.h * H * 1.0;
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(H, Math.ceil(cy + ry)); y++)
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(W, Math.ceil(cx + rx)); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d < 1) subjectMask[y * W + x] = Math.max(subjectMask[y * W + x], 1 - d * d);
      }
  }
  return { available: true, faces: mergedFaces, labels, objects, segFractions, subjectMask };
}

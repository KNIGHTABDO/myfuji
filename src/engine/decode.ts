// Turns any image file into a bitmap: web formats natively, HEIC/HEIF through
// libheif (lazy), TIFF through UTIF (lazy) and camera RAW files through their
// embedded full-size JPEG preview.

export type SourceKind = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | 'heic' | 'tiff' | 'raw' | 'bmp' | 'svg' | 'unknown';

export interface Decoded {
  image: ImageBitmap;
  width: number;
  height: number;
  kind: SourceKind;
  notes: string[];
  hasAlpha: boolean;
}

const RAW_EXT = /\.(dng|cr2|cr3|crw|nef|nrw|arw|srf|sr2|raf|orf|rw2|rwl|pef|srw|x3f|3fr|iiq|erf|mef|mos|kdc|dcr)$/i;

export async function sniff(file: File): Promise<SourceKind> {
  const b = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const s = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (RAW_EXT.test(file.name)) return 'raw';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'png';
  if (s(0, 3) === 'GIF') return 'gif';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'webp';
  if (s(0, 2) === 'BM') return 'bmp';
  if (s(0, 15) === 'FUJIFILMCCD-RAW') return 'raw';
  if (s(4, 4) === 'ftyp') {
    const brand = s(8, 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (brand === 'crx ') return 'raw';
    return 'heic';
  }
  if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return 'tiff';
  if (/svg/.test(file.type) || /^\s*</.test(s(0, 16))) return 'svg';
  if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) return 'heic';
  return 'unknown';
}

const bitmapOf = (blob: Blob) => createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none' });

async function viaImageElement(blob: Blob): Promise<ImageBitmap> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 2048, h = img.naturalHeight || 2048;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return createImageBitmap(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Find every JPEG stream in a RAW container and return the largest decodable one. */
async function rawPreview(file: File): Promise<Blob> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const candidates: Array<[number, number]> = [];
  // Fujifilm RAF: explicit offset/length of the embedded JPEG in the header.
  if (String.fromCharCode(...buf.subarray(0, 15)) === 'FUJIFILMCCD-RAW') {
    const dv = new DataView(buf.buffer);
    const off = dv.getUint32(84), len = dv.getUint32(88);
    if (off > 0 && off + len <= buf.length) candidates.push([off, off + len]);
  }
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] !== 0xff || buf[i + 1] !== 0xd8 || buf[i + 2] !== 0xff) continue;
    const m = buf[i + 3];
    if (m !== 0xe0 && m !== 0xe1 && m !== 0xdb && m !== 0xc4 && m !== 0xc0) continue;
    // Walk the marker segments to find the end of the stream precisely.
    let p = i + 2, end = -1;
    while (p + 4 < buf.length) {
      if (buf[p] !== 0xff) break;
      const marker = buf[p + 1];
      if (marker === 0xd9) { end = p + 2; break; }
      const len = (buf[p + 2] << 8) | buf[p + 3];
      if (marker === 0xda) {
        let q = p + 2 + len;
        while (q + 1 < buf.length && !(buf[q] === 0xff && buf[q + 1] === 0xd9)) q++;
        end = q + 2;
        break;
      }
      p += 2 + len;
    }
    if (end > i + 20000) { candidates.push([i, end]); i = end - 1; }
  }
  candidates.sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
  for (const [s, e] of candidates) {
    const blob = new Blob([buf.subarray(s, e)], { type: 'image/jpeg' });
    try { const bm = await createImageBitmap(blob); bm.close(); return blob; } catch { /* try next */ }
  }
  throw new Error('No usable preview found inside this RAW file.');
}

async function rotateBitmap(bm: ImageBitmap, orientation: number): Promise<ImageBitmap> {
  if (!orientation || orientation === 1) return bm;
  const swap = orientation >= 5;
  const w = swap ? bm.height : bm.width, h = swap ? bm.width : bm.height;
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d')!;
  const T: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, w, 0], 7: [0, -1, -1, 0, w, h], 8: [0, -1, 1, 0, 0, h],
  };
  g.setTransform(...(T[orientation] ?? [1, 0, 0, 1, 0, 0]));
  g.drawImage(bm, 0, 0);
  bm.close();
  return c.transferToImageBitmap();
}

async function decodeTiff(file: File): Promise<ImageBitmap> {
  const UTIF = (await import('utif')).default as any;
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  let best = ifds[0], area = 0;
  for (const ifd of ifds) {
    const w = ifd.t256?.[0] ?? ifd.width ?? 0, h = ifd.t257?.[0] ?? ifd.height ?? 0;
    if (w * h > area) { area = w * h; best = ifd; }
  }
  UTIF.decodeImage(buf, best, ifds);
  const rgba = UTIF.toRGBA8(best) as Uint8Array;
  const img = new ImageData(new Uint8ClampedArray(rgba), best.width, best.height);
  return createImageBitmap(img);
}

export async function decodeFile(file: File, orientationHint?: number): Promise<Decoded> {
  const kind = await sniff(file);
  const notes: string[] = [];
  let image: ImageBitmap | null = null;
  const tryNative = async () => {
    try { return await bitmapOf(file); } catch { return null; }
  };
  switch (kind) {
    case 'heic': {
      image = await tryNative();
      if (!image) {
        notes.push('HEIC decoded in-browser with libheif');
        const heic2any = (await import('heic2any')).default;
        const out = await heic2any({ blob: file, toType: 'image/png' });
        image = await bitmapOf(Array.isArray(out) ? out[0] : out);
      }
      break;
    }
    case 'tiff': {
      image = await tryNative();
      if (!image) {
        try { image = await decodeTiff(file); notes.push('TIFF decoded in-browser'); }
        catch {
          const jpg = await rawPreview(file);
          image = await rotateBitmap(await createImageBitmap(jpg), orientationHint ?? 1);
          notes.push('Used the embedded preview of this TIFF-based file');
        }
      }
      break;
    }
    case 'raw': {
      const jpg = await rawPreview(file);
      image = await rotateBitmap(await createImageBitmap(jpg), orientationHint ?? 1);
      notes.push('RAW: developed from the camera’s embedded full-size JPEG');
      break;
    }
    case 'svg':
      image = await viaImageElement(file);
      notes.push('Vector image rasterised');
      break;
    default:
      image = (await tryNative()) ?? (await viaImageElement(file).catch(() => null));
  }
  if (!image) throw new Error(`This browser could not decode “${file.name}”.`);
  const hasAlpha = kind === 'png' || kind === 'webp' || kind === 'gif' || kind === 'svg' || kind === 'avif';
  return { image, width: image.width, height: image.height, kind, notes, hasAlpha };
}

/**
 * Normalise to the working resolution: long edge ≤ maxEdge and ≤ maxPixels,
 * transparent areas flattened onto white paper.
 */
export async function toWorking(d: Decoded, maxEdge: number, maxPixels = 40e6): Promise<{ full: ImageBitmap; w: number; h: number }> {
  let s = Math.min(1, maxEdge / Math.max(d.width, d.height));
  s = Math.min(s, Math.sqrt(maxPixels / (d.width * d.height)));
  const w = Math.max(1, Math.round(d.width * s)), h = Math.max(1, Math.round(d.height * s));
  if (s === 1 && !d.hasAlpha) return { full: d.image, w, h };
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(d.image, 0, 0, w, h);
  d.image.close();
  return { full: c.transferToImageBitmap(), w, h };
}

/** A small sRGB copy for analysis and the ML models. */
export function downscale(src: ImageBitmap, maxEdge: number): OffscreenCanvas {
  const s = Math.min(1, maxEdge / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
  // Halve repeatedly for a good-quality reduction.
  let cur: CanvasImageSource = src, cw = src.width, ch = src.height;
  while (cw / 2 > w * 1.2) {
    const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
    const t = new OffscreenCanvas(nw, nh), tg = t.getContext('2d')!;
    tg.imageSmoothingQuality = 'high';
    tg.drawImage(cur, 0, 0, nw, nh);
    cur = t; cw = nw; ch = nh;
  }
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, w, h);
  return c;
}

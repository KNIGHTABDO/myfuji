import { fmtShutter, type ExifInfo } from './exif';
import { SIM_BY_ID } from './film/sims';
import type { DevelopParams } from './film/types';

export type FrameId = 'none' | 'border' | 'caption' | 'film35' | 'instant' | 'instant-square';
export type SizeId = 'full' | '4k' | '2k' | '1080';

export interface ExportOptions {
  frame: FrameId;
  dateStamp: boolean;
  format: 'jpeg' | 'png' | 'webp';
  quality: number;
  size: SizeId;
}

export const FRAMES: Array<{ id: FrameId; name: string; hint: string }> = [
  { id: 'none', name: 'Full bleed', hint: 'Just the photograph' },
  { id: 'border', name: 'Gallery border', hint: 'Soft white mat' },
  { id: 'caption', name: 'Shot-on caption', hint: 'White border with film & EXIF line' },
  { id: 'film35', name: '35mm strip', hint: 'Sprockets and edge print' },
  { id: 'instant', name: 'Instant', hint: 'Instant-film card, smart-cropped' },
  { id: 'instant-square', name: 'Instant square', hint: 'Square instant card' },
];

/** Aspect ratio (w/h) of the image area a frame needs, or null to keep the crop. */
export function frameAspect(frame: FrameId, landscape: boolean): number | null {
  if (frame === 'instant') return landscape ? 99 / 62 : 46 / 62;
  if (frame === 'instant-square') return 1;
  return null;
}

export function outputSize(cropW: number, cropH: number, size: SizeId): [number, number] {
  const long = Math.max(cropW, cropH);
  const target = size === 'full' ? long : size === '4k' ? 3840 : size === '2k' ? 2048 : 1080;
  const s = Math.min(1, target / long);
  return [Math.max(1, Math.round(cropW * s)), Math.max(1, Math.round(cropH * s))];
}

export function captionLine(p: DevelopParams, e: ExifInfo): string {
  const parts: string[] = [];
  const cam = [e.make && !e.model?.startsWith(e.make) ? e.make : '', e.model].filter(Boolean).join(' ');
  if (cam) parts.push(cam);
  const exp = [e.focal ? `${Math.round(e.focal)}mm` : '', e.fNumber ? `f/${+e.fNumber.toFixed(1)}` : '', fmtShutter(e.exposureTime) ?? '', e.iso ? `ISO ${e.iso}` : ''].filter(Boolean).join('  ');
  if (exp) parts.push(exp);
  return parts.join('   ·   ');
}

// ---------------- 7-segment date stamp ----------------
const SEG: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', "'": '', ' ': '' };
function drawSeg(g: CanvasRenderingContext2D, ch: string, x: number, y: number, s: number) {
  if (ch === "'") { g.fillRect(x + s * 0.1, y, s * 0.12, s * 0.35); return s * 0.4; }
  if (ch === ' ') return s * 0.45;
  const w = s * 0.55, h = s, t = s * 0.11;
  const segs: Record<string, [number, number, number, number]> = {
    a: [x + t, y, w - 2 * t, t], b: [x + w - t, y + t, t, h / 2 - 1.5 * t], c: [x + w - t, y + h / 2 + 0.5 * t, t, h / 2 - 1.5 * t],
    d: [x + t, y + h - t, w - 2 * t, t], e: [x, y + h / 2 + 0.5 * t, t, h / 2 - 1.5 * t], f: [x, y + t, t, h / 2 - 1.5 * t], g: [x + t, y + h / 2 - t / 2, w - 2 * t, t],
  };
  for (const k of SEG[ch] ?? '') { const [a, b, c, d] = segs[k]; g.save(); g.transform(1, 0, -0.12, 1, 0, 0); g.fillRect(a + (b - y) * 0.12, b, c, d); g.restore(); }
  return w + s * 0.18;
}
export function drawDateStamp(g: CanvasRenderingContext2D, date: Date, x: number, y: number, size: number) {
  const yy = String(date.getFullYear()).slice(2), mm = String(date.getMonth() + 1).padStart(2, ' '), dd = String(date.getDate()).padStart(2, ' ');
  const text = `'${yy} ${mm} ${dd}`;
  let width = 0;
  const probe = document.createElement('canvas').getContext('2d')!;
  for (const ch of text) width += drawSeg(probe, ch, 0, 0, size);
  g.save();
  g.globalCompositeOperation = 'screen';
  g.shadowColor = 'rgba(255,120,30,0.9)';
  g.shadowBlur = size * 0.5;
  g.fillStyle = 'rgba(255,150,50,0.92)';
  let cx = x - width;
  for (const ch of text) cx += drawSeg(g, ch, cx, y - size, size);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,215,150,0.55)';
  cx = x - width;
  for (const ch of text) cx += drawSeg(g, ch, cx, y - size, size);
  g.restore();
}

/** Put the developed pixels into their print: borders, strip, instant card, stamp. */
export function composePrint(pixels: ImageData, p: DevelopParams, e: ExifInfo, opts: ExportOptions, frameNo = 1): HTMLCanvasElement {
  const iw = pixels.width, ih = pixels.height, long = Math.max(iw, ih);
  const img = document.createElement('canvas');
  img.width = iw; img.height = ih;
  const ig = img.getContext('2d')!;
  ig.putImageData(pixels, 0, 0);
  if (opts.dateStamp) drawDateStamp(ig, e.taken ?? new Date(), iw - long * 0.04, ih - long * 0.04, long * 0.028);

  const sim = SIM_BY_ID[p.sim];
  const out = document.createElement('canvas');
  const g = out.getContext('2d')!;
  const font = (px: number, fam = '"JetBrains Mono", monospace', weight = 500) => `${weight} ${Math.round(px)}px ${fam}`;
  switch (opts.frame) {
    case 'none':
      return img;
    case 'border': {
      const b = Math.round(long * 0.045);
      out.width = iw + 2 * b; out.height = ih + 2 * b;
      g.fillStyle = '#f7f4ee'; g.fillRect(0, 0, out.width, out.height);
      g.drawImage(img, b, b);
      return out;
    }
    case 'caption': {
      const b = Math.round(long * 0.04), bottom = Math.round(long * 0.1);
      out.width = iw + 2 * b; out.height = ih + b + bottom;
      g.fillStyle = '#fbfaf7'; g.fillRect(0, 0, out.width, out.height);
      g.drawImage(img, b, b);
      g.fillStyle = '#1c1a17';
      g.font = font(long * 0.022, '"Space Grotesk", sans-serif', 600);
      g.textBaseline = 'middle';
      const cy = b + ih + bottom / 2;
      g.fillText(sim.dial, b, cy - long * 0.012);
      g.fillStyle = '#7b746a';
      g.font = font(long * 0.013);
      g.fillText(captionLine(p, e) || 'developed with myfuji', b, cy + long * 0.016);
      g.textAlign = 'right';
      g.fillStyle = '#d9493f';
      g.beginPath(); g.arc(out.width - b - long * 0.008, cy - long * 0.012, long * 0.006, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1c1a17';
      g.font = font(long * 0.016, '"Space Grotesk", sans-serif', 700);
      g.fillText('myfuji', out.width - b - long * 0.022, cy - long * 0.012);
      return out;
    }
    case 'film35': {
      const edge = Math.round(Math.min(iw, ih) * 0.14), side = Math.round(long * 0.02);
      out.width = iw + 2 * side; out.height = ih + 2 * edge;
      g.fillStyle = '#0d0b09'; g.fillRect(0, 0, out.width, out.height);
      // film base tint
      g.fillStyle = 'rgba(80,45,20,0.25)'; g.fillRect(0, 0, out.width, out.height);
      g.drawImage(img, side, edge);
      const hole = edge * 0.34, pitch = hole * 1.9;
      g.fillStyle = '#f2ece2';
      for (let x = pitch * 0.4; x < out.width; x += pitch)
        for (const y of [edge * 0.3, out.height - edge * 0.3 - hole * 0.7]) { g.beginPath(); g.roundRect(x, y, hole * 0.72, hole * 0.7, hole * 0.12); g.fill(); }
      g.fillStyle = '#f0a33a';
      g.font = font(edge * 0.16, '"JetBrains Mono", monospace', 700);
      g.textBaseline = 'middle';
      const ty = edge * 0.78;
      g.fillText(`MYFUJI 400  ${sim.dial}`, side + edge * 0.2, ty);
      g.textAlign = 'right';
      g.fillText(`${frameNo}  ▶ ${frameNo}A`, out.width - side - edge * 0.2, ty);
      g.textAlign = 'left';
      g.fillText(`◀ ${frameNo + 1}   ${captionLine(p, e).toUpperCase()}`, side + edge * 0.2, out.height - edge * 0.78);
      return out;
    }
    case 'instant':
    case 'instant-square': {
      const sideB = Math.round(iw * 0.065), top = sideB, bottom = Math.round(ih * (opts.frame === 'instant-square' ? 0.24 : 0.26));
      out.width = iw + 2 * sideB; out.height = ih + top + bottom;
      g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, out.width, out.height);
      // slight paper gradient
      const gr = g.createLinearGradient(0, 0, 0, out.height);
      gr.addColorStop(0, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(210,200,185,0.25)');
      g.fillStyle = gr; g.fillRect(0, 0, out.width, out.height);
      g.drawImage(img, sideB, top);
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = Math.max(1, long * 0.001);
      g.strokeRect(sideB, top, iw, ih);
      g.fillStyle = '#3a3530';
      g.font = `${Math.round(bottom * 0.28)}px Caveat, cursive`;
      g.textBaseline = 'middle';
      const d = e.taken ?? new Date();
      g.fillText(`${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · ${sim.name.toLowerCase()}`, sideB * 1.1, top + ih + bottom * 0.52);
      return out;
    }
  }
}

export async function canvasToBlob(c: HTMLCanvasElement, opts: ExportOptions): Promise<Blob> {
  const type = opts.format === 'png' ? 'image/png' : opts.format === 'webp' ? 'image/webp' : 'image/jpeg';
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, opts.quality));
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function exportName(original: string, p: DevelopParams, opts: ExportOptions) {
  const base = original.replace(/\.[^.]+$/, '');
  return `${base}_${p.sim}.${opts.format === 'jpeg' ? 'jpg' : opts.format}`;
}

// ---------------- minimal store-only ZIP ----------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (d: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export async function zip(files: Array<{ name: string; blob: Blob }>): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [], central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), name = new Uint8Array(enc.encode(f.name)), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    const ce = new Uint8Array(46 + name.length); ce.set(new Uint8Array(c.buffer)); ce.set(name, 46);
    central.push(ce);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

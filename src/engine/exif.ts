export interface ExifInfo {
  make?: string;
  model?: string;
  lens?: string;
  focal?: number;
  focal35?: number;
  fNumber?: number;
  exposureTime?: number;
  iso?: number;
  bias?: number;
  flash?: boolean;
  /** Local wall-clock time the photo was taken, as written by the camera. */
  taken?: Date;
  /** Minutes east of UTC, when the file says so. */
  offsetMin?: number;
  /** UTC instant when it can be established (offset tag or GPS time). */
  utc?: Date;
  lat?: number;
  lon?: number;
  orientation?: number;
  software?: string;
  /** EXIF UserComment (e.g. "Screenshot" on phone screenshots). */
  userComment?: string;
  /** The file is a PNG container. */
  png?: boolean;
  /** Pixel size read from the file header (falls back to EXIF image size). */
  width?: number;
  height?: number;
}

export const EXIF_OPTIONS = {
  tiff: true, exif: true, gps: true, ifd1: false, xmp: false, icc: false, iptc: false,
  reviveValues: true, translateValues: false, mergeOutput: true, userComment: true,
};

/** Pixel size from the first bytes of a PNG (IHDR) or JPEG (SOF marker). */
export function imageHeaderSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (b[p + 5] << 8) | b[p + 6], w: (b[p + 7] << 8) | b[p + 8] };
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    p += 2 + ((b[p + 2] << 8) | b[p + 3]);
  }
  return null;
}

const decodeComment = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v.replace(/\0/g, '').trim() || undefined;
  if (v && typeof (v as ArrayLike<number>).length === 'number') {
    // EXIF UserComment: 8-byte character-code prefix, then the text.
    const bytes = Uint8Array.from(v as ArrayLike<number>).subarray(8);
    return new TextDecoder().decode(bytes).replace(/\0/g, '').trim() || undefined;
  }
  return undefined;
};

const parseOffset = (s?: string) => {
  const m = s && /^([+-])(\d{2}):?(\d{2})$/.exec(s.trim());
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : undefined;
};

/** Maps the raw exifr output (and header size) onto ExifInfo. */
export function exifFromRaw(t: any, head: { png?: boolean; size?: { w: number; h: number } | null } = {}): ExifInfo {
  if (!t) t = {};
  const info: ExifInfo = {
    make: t.Make?.trim?.(), model: t.Model?.trim?.(), lens: (t.LensModel || t.LensMake)?.trim?.(),
    focal: t.FocalLength, focal35: t.FocalLengthIn35mmFormat, fNumber: t.FNumber, exposureTime: t.ExposureTime,
    iso: t.ISO ?? t.ISOSpeedRatings ?? t.PhotographicSensitivity, bias: t.ExposureCompensation ?? t.ExposureBiasValue,
    flash: typeof t.Flash === 'number' ? (t.Flash & 1) === 1 : undefined,
    orientation: t.Orientation, software: typeof t.Software === 'string' ? t.Software.trim() : undefined,
    userComment: decodeComment(t.UserComment ?? t.userComment),
    png: head.png || undefined,
    width: head.size?.w ?? t.ExifImageWidth ?? t.ImageWidth,
    height: head.size?.h ?? t.ExifImageHeight ?? t.ImageHeight,
    lat: typeof t.latitude === 'number' ? t.latitude : undefined,
    lon: typeof t.longitude === 'number' ? t.longitude : undefined,
  };
  if (Array.isArray(info.iso)) info.iso = (info.iso as unknown as number[])[0];
  const dt: Date | undefined = t.DateTimeOriginal instanceof Date ? t.DateTimeOriginal : t.CreateDate instanceof Date ? t.CreateDate : undefined;
  if (dt && !isNaN(dt.getTime())) {
    // exifr interprets the naive camera clock in the browser's zone; keep the wall-clock fields.
    info.taken = dt;
    info.offsetMin = parseOffset(t.OffsetTimeOriginal || t.OffsetTime);
    if (info.offsetMin !== undefined) {
      const wall = Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds());
      info.utc = new Date(wall - info.offsetMin * 60000);
    }
  }
  if (!info.utc && t.GPSDateStamp && Array.isArray(t.GPSTimeStamp)) {
    const [y, mo, d] = String(t.GPSDateStamp).split(':').map(Number);
    const [hh, mm, ss] = t.GPSTimeStamp as number[];
    const u = Date.UTC(y, mo - 1, d, hh, mm, Math.floor(ss));
    if (!isNaN(u)) info.utc = new Date(u);
  }
  return info;
}

export async function readExif(file: File): Promise<ExifInfo> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const size = imageHeaderSize(head);
  const png = head[0] === 0x89 && head[1] === 0x50;
  try {
    const exifr = (await import('exifr')).default;
    const t: any = await exifr.parse(file, EXIF_OPTIONS);
    return exifFromRaw(t, { png, size });
  } catch {
    return exifFromRaw(null, { png, size });
  }
}

/** Solar elevation in degrees (NOAA simplified algorithm). */
export function sunElevation(utc: Date, lat: number, lon: number): number {
  const rad = Math.PI / 180;
  const jd = utc.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lon) * rad;
  const ha = lst - ra;
  const el = Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha));
  return el / rad;
}

export interface TimeOfDay {
  phase: 'night' | 'blue-hour' | 'golden-hour' | 'day' | 'unknown';
  source: 'sun' | 'clock' | 'none';
  sunElevation?: number;
  hour?: number;
}

export function timeOfDay(e: ExifInfo): TimeOfDay {
  let utc = e.utc;
  if (!utc && e.taken && e.lon !== undefined) {
    // No zone info: approximate the zone from longitude.
    const d = e.taken, off = Math.round(e.lon / 15) * 60;
    utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) - off * 60000);
  }
  if (utc && e.lat !== undefined && e.lon !== undefined) {
    const el = sunElevation(utc, e.lat, e.lon);
    const phase = el < -6 ? 'night' : el < 0 ? 'blue-hour' : el < 10 ? 'golden-hour' : 'day';
    return { phase, source: 'sun', sunElevation: el, hour: e.taken?.getHours() };
  }
  if (e.taken) {
    const h = e.taken.getHours() + e.taken.getMinutes() / 60;
    const phase = h < 5 || h >= 21.5 ? 'night' : h < 6.5 || (h >= 19.5 && h < 21.5) ? 'blue-hour' : h < 8 || h >= 17.5 ? 'golden-hour' : 'day';
    return { phase, source: 'clock', hour: h };
  }
  return { phase: 'unknown', source: 'none' };
}

export const fmtShutter = (t?: number) => (!t ? undefined : t >= 1 ? `${+t.toFixed(1)}s` : `1/${Math.round(1 / t)}`);

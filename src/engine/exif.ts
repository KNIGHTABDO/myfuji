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
  width?: number;
  height?: number;
}

const parseOffset = (s?: string) => {
  const m = s && /^([+-])(\d{2}):?(\d{2})$/.exec(s.trim());
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : undefined;
};

export async function readExif(file: File): Promise<ExifInfo> {
  try {
    const exifr = (await import('exifr')).default;
    const t: any = await exifr.parse(file, {
      tiff: true, exif: true, gps: true, ifd1: false, xmp: false, icc: false, iptc: false,
      reviveValues: true, translateValues: false, mergeOutput: true,
    });
    if (!t) return {};
    const info: ExifInfo = {
      make: t.Make?.trim(), model: t.Model?.trim(), lens: (t.LensModel || t.LensMake)?.trim?.(),
      focal: t.FocalLength, focal35: t.FocalLengthIn35mmFormat, fNumber: t.FNumber, exposureTime: t.ExposureTime,
      iso: t.ISO ?? t.ISOSpeedRatings ?? t.PhotographicSensitivity, bias: t.ExposureCompensation ?? t.ExposureBiasValue,
      flash: typeof t.Flash === 'number' ? (t.Flash & 1) === 1 : undefined,
      orientation: t.Orientation, software: t.Software,
      width: t.ExifImageWidth, height: t.ExifImageHeight,
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
  } catch {
    return {};
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

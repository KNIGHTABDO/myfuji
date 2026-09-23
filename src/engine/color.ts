// Colour maths shared by analysis, LUT building and UI.
// All "lin" values are linear-light sRGB/Rec.709 primaries, D65 white.

export type RGB = [number, number, number];

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const srgbToLin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const linToSrgb = (v: number) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;

/** 256-entry decode table for 8-bit sRGB. */
export const SRGB8_TO_LIN = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbToLin(i / 255);
  return t;
})();

export const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---- OKLab (Björn Ottosson) ----
export function linToOklab(r: number, g: number, b: number): RGB {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function oklabToLin(L: number, a: number, b: number): RGB {
  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l * l * l, m3 = m * m * m, s3 = s * s * s;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

/** Hue in degrees [0,360) of an OKLab a/b pair. */
export const okHue = (a: number, b: number) => {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
};

// ---- chromaticity / colour temperature ----
export function linToXYZ(r: number, g: number, b: number): RGB {
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
}
/** McCamy's approximation of correlated colour temperature from an RGB illuminant estimate. */
export function cctFromLin(r: number, g: number, b: number): number {
  const [X, Y, Z] = linToXYZ(r, g, b);
  const s = X + Y + Z || 1;
  const x = X / s, y = Y / s;
  const n = (x - 0.332) / (0.1858 - y);
  const cct = 449 * n * n * n + 3525 * n * n + 6823.3 * n + 5520.33;
  return clamp(cct, 1600, 16000);
}
/** Signed green/magenta tint of an illuminant: >0 is greener than the Planckian locus. */
export function tintFromLin(r: number, g: number, b: number): number {
  // Planckian locus approximated by the red/blue axis; residual green is the tint.
  const expectedG = Math.sqrt(Math.max(r, 1e-6) * Math.max(b, 1e-6));
  return Math.log2(Math.max(g, 1e-6) / expectedG);
}

/** Approximate linear RGB of a black-body/daylight illuminant at a temperature (normalised to G=1). */
export function illuminantRGB(kelvin: number): RGB {
  // Tanner Helland fit, then linearised.
  const t = kelvin / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const R = srgbToLin(clamp(r / 255)), G = srgbToLin(clamp(g / 255)), B = srgbToLin(clamp(Math.max(b, 1) / 255));
  return [R / G, 1, B / G];
}

export const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('');

/** Fritsch–Carlson monotone cubic interpolation through sorted control points. */
export function monotoneCurve(pts: Array<[number, number]>): (x: number) => number {
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** Float32 → IEEE half bits, for RGBA16F textures. */
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >> 16) & 0x8000;
  let e = ((x >> 23) & 0xff) - 127 + 15;
  const m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  // round to nearest
  let half = sign | (e << 10) | (m >> 13);
  if (m & 0x1000) half++;
  return half;
}

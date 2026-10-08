// Region maps for region-aware grading. Computed once per photo and uploaded as a second
// RGBA16F texture (uRegions) sampled with linear filtering; the maps are returned on the
// analysis grid (w×h).
//
// Method. Everything except the final lift runs on a coarse analysis grid (long edge ≤ 256
// cells, each cell the block average of an s×s block of the work image), using box filters
// only, so the cost is O(cells):
//   · colour: OKLab L/C/h per cell (fast cube root), hue bands for sky, foliage and ground
//   · texture: local σ of OKLab L over a 3×3 cell window (leaves high, sky/walls low)
//   · sky: colour-compatible, bright vs. the image, smooth, and connected to the top
//     (column-wise cumulative evidence), plus bright low-chroma gaps in the canopy
//   · foliage: hue 90–160°, chroma-gated (lower threshold when dark), texture-weighted
//   · ground: lower frame, neutral/beige/grey, not foliage
//   · sun: local log-luma contrast against a large-scale mean, gated by absolute brightness
//   · sky and foliage are refined with a luma-guided filter on the grid; all four maps are
//     then bilinearly lifted to the full analysis grid
//   · person mask (block-averaged) suppresses sky / foliage / ground
import type { WorkImage } from './aux';

export interface RegionMaps {
  w: number;
  h: number;
  /** open sky / bright see-through gaps in canopy (0..1) */
  sky: Float32Array;
  /** vegetation: leaves, grass, plants (0..1) */
  foliage: Float32Array;
  /** ground plane: roads, paths, sand, soil, floors (0..1) */
  ground: Float32Array;
  /** directly sunlit / key-lit amount relative to the local surroundings (0 = shade, 1 = full sun) */
  sun: Float32Array;
}

// ---------------------------------------------------------------- helpers

const ss = (a: number, b: number, x: number): number => {
  const t = (x - a) / (b - a);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** Cube root: float bit-hack seed + two Newton steps (|err| < 1e-6 on [0,1]). */
function cbrtFast(x: number): number {
  if (x <= 0) return 0;
  f32[0] = x;
  u32[0] = (u32[0] / 3 + 709921696) >>> 0;
  let y = f32[0];
  y -= (y * y * y - x) / (3 * y * y);
  y -= (y * y * y - x) / (3 * y * y);
  return y;
}

/** atan2 in degrees, [0, 360). Minimax-style polynomial, error ~1e-4°. */
function hueDeg(y: number, x: number): number {
  const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
  const mx = ax > ay ? ax : ay, mn = ax > ay ? ay : ax;
  let a = 0;
  if (mx > 0) {
    const t = mn / mx, t2 = t * t;
    a = t * (1 + t2 * (-0.327622764 + t2 * (0.15931422 + t2 * -0.0464964749)));
    if (ay > ax) a = 1.5707963267948966 - a;
  }
  if (x < 0) a = Math.PI - a;
  if (y < 0) a = -a;
  const d = a * 57.29577951308232;
  return d < 0 ? d + 360 : d;
}

// Reusable scratch buffers, keyed by role. Results are always fresh arrays.
const pool = new Map<string, Float32Array>();
function scratch(key: string, n: number): Float32Array {
  const a = pool.get(key);
  if (a && a.length === n) return a;
  const b = new Float32Array(n);
  pool.set(key, b);
  return b;
}

/** 2-D box mean with clamped edges. tmp must hold w*h values; dst must not alias src. */
function boxMean(src: Float32Array, dst: Float32Array, tmp: Float32Array, w: number, h: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  const pad = scratch('bm.pad', w + 2 * r + 2);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let i = 0; i < r; i++) pad[i] = src[row];
    for (let x = 0; x < w; x++) pad[r + x] = src[row + x];
    for (let i = 0; i <= r; i++) pad[r + w + i] = src[row + w - 1];
    let acc = 0;
    for (let i = 0; i <= 2 * r; i++) acc += pad[i];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      acc += pad[x + 2 * r + 1] - pad[x];
    }
  }
  const col = scratch('bm.col', w);
  col.fill(0);
  for (let i = -r; i <= r; i++) {
    const row = (i < 0 ? 0 : i >= h ? h - 1 : i) * w;
    for (let x = 0; x < w; x++) col[x] += tmp[row + x];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) dst[row + x] = col[x] * inv;
    const add = (y + r + 1 < h ? y + r + 1 : h - 1) * w;
    const sub = (y - r > 0 ? y - r : 0) * w;
    for (let x = 0; x < w; x++) col[x] += tmp[add + x] - tmp[sub + x];
  }
}

/**
 * Self-guided-style He et al. guided filter with a shared guide I (mean mI, variance vI
 * precomputed at radius r). Writes the refined map into out.
 */
function guidedRefine(
  p: Float32Array, I: Float32Array, mI: Float32Array, vI: Float32Array,
  out: Float32Array, w: number, h: number, r: number, eps: number,
): void {
  const n = w * h;
  const tmp = scratch('g.tmp', n);
  const ip = scratch('g.ip', n), mp = scratch('g.mp', n), mip = scratch('g.mip', n);
  const a = scratch('g.a', n), b = scratch('g.b', n), ma = scratch('g.ma', n), mb = scratch('g.mb', n);
  for (let i = 0; i < n; i++) ip[i] = I[i] * p[i];
  boxMean(p, mp, tmp, w, h, r);
  boxMean(ip, mip, tmp, w, h, r);
  for (let i = 0; i < n; i++) {
    const cov = mip[i] - mI[i] * mp[i];
    const ai = cov / (vI[i] + eps);
    a[i] = ai;
    b[i] = mp[i] - ai * mI[i];
  }
  boxMean(a, ma, tmp, w, h, r);
  boxMean(b, mb, tmp, w, h, r);
  for (let i = 0; i < n; i++) {
    const v = ma[i] * I[i] + mb[i];
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
}

/**
 * Block-average the work image onto the gw×gh analysis grid: each cell is the mean of an s×s
 * block of work pixels (clamped at the right and bottom edges). Linear RGB, luma and the
 * person mask are averaged in one pass.
 */
function downsample(
  img: WorkImage, person: Float32Array | null, s: number, gw: number, gh: number,
  R: Float32Array, G: Float32Array, B: Float32Array, Yd: Float32Array, pm: Float32Array,
): void {
  const W = img.w, H = img.h, lin = img.lin, Y = img.Y;
  for (let gy = 0; gy < gh; gy++) {
    const y0 = gy * s, y1 = Math.min(H, y0 + s);
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * s, x1 = Math.min(W, x0 + s);
      let r = 0, g = 0, b = 0, yy = 0, m = 0;
      for (let y = y0; y < y1; y++) {
        for (let p = y * W + x0, e = y * W + x1; p < e; p++) {
          const q = p * 3;
          r += lin[q]; g += lin[q + 1]; b += lin[q + 2]; yy += Y[p];
          m += person ? person[p] : 0;
        }
      }
      const k = 1 / ((y1 - y0) * (x1 - x0)), o = gy * gw + gx;
      R[o] = r * k; G[o] = g * k; B[o] = b * k; Yd[o] = yy * k; pm[o] = m * k;
    }
  }
}

/**
 * Bilinear lift of four (gw×gh) maps onto the (W×H) grid, sampling pixel centres. One pass
 * shares the index and weight tables between the maps.
 */
function lift4(
  s0: Float32Array, s1: Float32Array, s2: Float32Array, s3: Float32Array,
  gw: number, gh: number, W: number, H: number,
): [Float32Array, Float32Array, Float32Array, Float32Array] {
  const o0 = new Float32Array(W * H), o1 = new Float32Array(W * H);
  const o2 = new Float32Array(W * H), o3 = new Float32Array(W * H);
  const xi0 = new Int32Array(W), xi1 = new Int32Array(W), xf = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let u = ((x + 0.5) * gw) / W - 0.5;
    u = u < 0 ? 0 : u > gw - 1 ? gw - 1 : u;
    const i0 = Math.floor(u);
    xi0[x] = i0;
    xi1[x] = i0 < gw - 1 ? i0 + 1 : i0;
    xf[x] = u - i0;
  }
  const r0 = new Float32Array(gw), r1 = new Float32Array(gw);
  const r2 = new Float32Array(gw), r3 = new Float32Array(gw);
  for (let y = 0; y < H; y++) {
    let v = ((y + 0.5) * gh) / H - 0.5;
    v = v < 0 ? 0 : v > gh - 1 ? gh - 1 : v;
    const j0 = Math.floor(v), j1 = j0 < gh - 1 ? j0 + 1 : j0, fy = v - j0, gy = 1 - fy;
    const a = j0 * gw, b = j1 * gw;
    for (let i = 0; i < gw; i++) {
      r0[i] = gy * s0[a + i] + fy * s0[b + i];
      r1[i] = gy * s1[a + i] + fy * s1[b + i];
      r2[i] = gy * s2[a + i] + fy * s2[b + i];
      r3[i] = gy * s3[a + i] + fy * s3[b + i];
    }
    const o = y * W;
    for (let x = 0; x < W; x++) {
      const f = xf[x], g = 1 - f, p = xi0[x], q = xi1[x];
      o0[o + x] = g * r0[p] + f * r0[q];
      o1[o + x] = g * r1[p] + f * r1[q];
      o2[o + x] = g * r2[p] + f * r2[q];
      o3[o + x] = g * r3[p] + f * r3[q];
    }
  }
  return [o0, o1, o2, o3];
}

// ---------------------------------------------------------------- tuning

const GRID = 256;           // analysis grid: long edge ≤ GRID cells (each cell = s×s work pixels)
const GUIDE_R = 1;          // guided-filter / texture window, grid cells (3×3)
const GUIDE_EPS = 0.002;    // guide variance regulariser (OKLab L units²)
const PALE_SKY_W = 0.85;    // pale low-chroma sky of any hue (dusk, haze); grey backdrops (C < 0.006) excluded

/** Stats of an array: percentile by a 64-bin histogram over [0,1]. */
function percentile(a: Float32Array, q: number): number {
  const bins = new Uint32Array(64);
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    const k = v <= 0 ? 0 : v >= 1 ? 63 : (v * 64) | 0;
    bins[k]++;
  }
  const target = q * a.length;
  let acc = 0;
  for (let k = 0; k < 64; k++) {
    acc += bins[k];
    if (acc >= target) return (k + 1) / 64;
  }
  return 1;
}

// ---------------------------------------------------------------- main

/** Compute the four region maps for an analysis image. Inputs: the analysis image and the person mask (same grid, may be null). */
export function computeRegions(img: WorkImage, person: Float32Array | null): RegionMaps {
  const W = img.w, H = img.h;
  const s = Math.max(1, Math.ceil(Math.max(W, H) / GRID));
  const gw = Math.max(1, Math.ceil(W / s)), gh = Math.max(1, Math.ceil(H / s)), n = gw * gh;

  // 1. grid cells: block-averaged linear RGB, luma and person mask
  const R = scratch('R', n), Gc = scratch('G', n), Bc = scratch('B', n), Yh = scratch('Y', n), pm = scratch('pm', n);
  downsample(img, person, s, gw, gh, R, Gc, Bc, Yh, pm);

  // 2. per-cell colour: OKLab lightness L, chroma C, hue h (deg), log2 luma
  const Lk = scratch('Lk', n), Cc = scratch('Cc', n), Hd = scratch('Hd', n), lY = scratch('lY', n);
  for (let i = 0; i < n; i++) {
    const r = R[i], g = Gc[i], b = Bc[i];
    const l = cbrtFast(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = cbrtFast(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const sc = cbrtFast(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * sc;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * sc;
    Lk[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * sc;
    Cc[i] = Math.sqrt(A * A + B * B);
    Hd[i] = hueDeg(B, A);
    lY[i] = Math.log2(Math.max(Yh[i], 1e-5));
  }

  // 3. texture + guide statistics (radius GUIDE_R): mean, variance of L
  const tmp = scratch('tmp', n);
  const mG = scratch('mG', n), vG = scratch('vG', n), sq = scratch('sq', n);
  for (let i = 0; i < n; i++) sq[i] = Lk[i] * Lk[i];
  boxMean(Lk, mG, tmp, gw, gh, GUIDE_R);
  boxMean(sq, vG, tmp, gw, gh, GUIDE_R);
  const sd = scratch('sd', n);
  for (let i = 0; i < n; i++) {
    const v = vG[i] - mG[i] * mG[i];
    vG[i] = v > 0 ? v : 0;
    sd[i] = Math.sqrt(vG[i]);
  }

  // person mask, dilated by one cell so hair and clothing edges are excluded too
  const pmD = scratch('pmD', n);
  boxMean(pm, pmD, tmp, gw, gh, 1);
  // image-relative brightness reference
  const bLo = percentile(Lk, 0.4), bHi = percentile(Lk, 0.75);

  // 4. sky
  const sky = scratch('sky', n), cU = scratch('cU', n), colU = scratch('colU', n);
  const acc = scratch('acc', gw);
  acc.fill(0);
  for (let y = 0; y < gh; y++) {
    const row = y * gw;
    for (let x = 0; x < gw; x++) {
      const i = row + x;
      const H_ = Hd[i], C = Cc[i];
      const blue = ss(195, 215, H_) * (1 - ss(285, 305, H_)) * ss(0.014, 0.04, C); // shaded skin has a faint cool cast; sky is chromatic
      let h2 = H_ - 300; if (h2 < 0) h2 += 360;
      const warm = ss(8, 22, h2) * (1 - ss(110, 130, h2)) * ss(0.03, 0.07, C);
      const pale = PALE_SKY_W * ss(0.008, 0.016, C) * (1 - ss(0.025, 0.05, C));
      const colour = Math.max(blue, warm, pale);
      const cand = colour * ss(bLo, bHi, Lk[i]) * ss(0.45, 0.7, Lk[i]) * (1 - ss(0.03, 0.07, sd[i]));
      cU[i] = cand;
      acc[x] += cand;
      colU[i] = acc[x] / (y + 1); // mean of sky evidence in the column from the top down to here
    }
  }
  const topU = scratch('topU', n);
  boxMean(colU, topU, tmp, gw, gh, Math.max(2, Math.round(gw / 24)));
  for (let y = 0; y < gh; y++) {
    const yn = (y + 0.5) / gh;
    const pTop = 1 - ss(0.55, 0.95, yn);
    const row = y * gw;
    for (let x = 0; x < gw; x++) {
      const i = row + x;
      const C = Cc[i], Lv = Lk[i];
      const open = ss(0.2, 0.6, topU[i]) * pTop * cU[i];
      // bright, colourless gaps in the canopy, high in frame
      const cool = 1 - ss(0.012, 0.02, C); // canopy gaps are colourless; cool-cast skin, ivory, sand and haze are not
      const gap = ss(0.03, 0.1, Lv - mG[i]) * ss(0.6, 0.8, Lv) * (1 - ss(0.03, 0.07, C)) * (1 - ss(0.55, 0.85, yn)) * cool;
      sky[i] = (open > gap ? open : gap) * (1 - pmD[i]);
    }
  }

  // 5. foliage: green hue, chroma (relaxed in shade), texture-weighted
  const fol = scratch('fol', n);
  for (let i = 0; i < n; i++) {
    const H_ = Hd[i], C = Cc[i];
    const hueF = ss(84, 100, H_) * (1 - ss(150, 166, H_));
    const thr = 0.012 + 0.02 * ss(0.3, 0.6, Lk[i]);
    const chF = ss(thr, thr + 0.02, C);
    const texF = 0.1 + 0.9 * ss(0.01, 0.04, sd[i]);
    fol[i] = hueF * chF * texF * (1 - pmD[i]);
  }

  // 6. ground: lower frame, neutral / beige / warm-grey, not foliage
  const gnd = scratch('gnd', n);
  for (let y = 0; y < gh; y++) {
    const yn = (y + 0.5) / gh;
    const posG = ss(0.42, 0.8, yn);
    const row = y * gw;
    for (let x = 0; x < gw; x++) {
      const i = row + x;
      const H_ = Hd[i], C = Cc[i];
      // beige / sand / pavement hues (sea and cool greys excluded); chroma gate below ≈0.035
      const band = ss(20, 40, H_) * (1 - ss(95, 110, H_));
      // neutral grey / pavement (tight gate), or warm beige (sand, gravel) that fades out before saturated brick (C ≳ 0.06)
      const col = Math.max((1 - ss(0.015, 0.035, C)) * (1 - ss(0.012, 0.025, C)), band * (1 - ss(0.03, 0.06, C)));
      const lw = 0.2 + 0.8 * ss(0.3, 0.6, Lk[i]); // dark brick, jackets and skin are rarely ground
      const texG = ss(0.006, 0.016, sd[i]); // smooth surfaces (sky glow, skin, walls, posters) are not ground
      gnd[i] = posG * col * lw * texG * (1 - fol[i]) * (1 - pmD[i]);
    }
  }

  // 7. sun: local log-luma contrast against a large-scale mean, gated by absolute brightness
  const lSmall = scratch('lSmall', n), lLarge = scratch('lLarge', n);
  boxMean(lY, lSmall, tmp, gw, gh, GUIDE_R);
  boxMean(lY, lLarge, tmp, gw, gh, Math.max(3, Math.round(Math.max(gw, gh) * 0.06)));
  const sun = scratch('sun', n);
  for (let i = 0; i < n; i++) {
    const rel = ss(-0.8, 0.8, lSmall[i] - lLarge[i]);
    sun[i] = rel * (0.4 + 0.6 * ss(0.35, 0.6, mG[i]));
  }

  // 8. refine sky and foliage with a luma-guided filter on the grid (guide = OKLab L);
  // ground and sun are soft by construction
  const outS = scratch('outS', n), outF = scratch('outF', n);
  guidedRefine(sky, Lk, mG, vG, outS, gw, gh, GUIDE_R, GUIDE_EPS);
  guidedRefine(fol, Lk, mG, vG, outF, gw, gh, GUIDE_R, GUIDE_EPS);

  // 9. lift all four maps to the full analysis grid in one pass
  const [skyF, folF, gndF, sunF] = lift4(outS, outF, gnd, sun, gw, gh, W, H);
  return { w: W, h: H, sky: skyF, foliage: folF, ground: gndF, sun: sunF };
}

// The mosquito: whole-pose ink drawings in the hand-drawn-canvas-animation
// manner. Every body key is a complete drawing with the same semantic stroke
// ids, so assisted inbetweens can be made between compatible keys. Wings are
// separate replacement drawings exposed on ones; the body is exposed on twos.
// Side view, facing right (+x); origin at the middle of the thorax; y down.

type P = [number, number];
type LegSet = Record<'f' | 'm' | 'h', P[]>;

export type BodyKeyId = 'fly' | 'hover' | 'reach' | 'perch' | 'sip' | 'crouch';

interface BodyKey {
  pitch: number; // radians, + = nose down
  headDip: number; // extra head rotation
  curl: number; // abdomen curl, + = tip up
  swell: number; // abdomen fullness (sipping!)
  near: LegSet;
  far: LegSet;
}

const pressure: Array<[number, number]> = [[0, 0.15], [0.14, 0.85], [0.45, 1], [0.8, 0.65], [1, 0.08]];
const legPressure: Array<[number, number]> = [[0, 0.9], [0.35, 0.75], [0.7, 0.45], [1, 0.12]];

const shift = (s: LegSet, dx: number, dy: number, spread = 0): LegSet => ({
  f: s.f.map(([x, y], i) => [x + dx + spread * i, y + dy] as P),
  m: s.m.map(([x, y], i) => [x + dx - spread * 0.3 * i, y + dy] as P),
  h: s.h.map(([x, y], i) => [x + dx - spread * i, y + dy] as P),
});

const FLY: LegSet = {
  f: [[8, 7], [22, 20], [27, 38], [25, 50], [21, 59]],
  m: [[3, 8], [5, 24], [-3, 41], [-11, 51], [-18, 57]],
  h: [[-3, 7], [-18, 19], [-36, 31], [-52, 36], [-67, 36]],
};
const HOVER: LegSet = {
  f: [[8, 7], [21, 22], [23, 40], [19, 51], [14, 58]],
  m: [[3, 8], [3, 25], [-6, 41], [-15, 50], [-23, 54]],
  h: [[-3, 7], [-19, 16], [-38, 25], [-55, 27], [-70, 24]],
};
const REACH: LegSet = {
  f: [[8, 7], [24, 16], [33, 32], [38, 40], [43, 44]],
  m: [[3, 8], [7, 22], [5, 36], [2, 41], [-1, 44]],
  h: [[-3, 7], [-16, 18], [-29, 30], [-37, 39], [-44, 44]],
};
const PERCH: LegSet = {
  f: [[8, 7], [26, 8], [36, 27], [41, 39], [47, 44]],
  m: [[3, 8], [-1, 18], [-9, 33], [-12, 40], [-15, 44]],
  h: [[-3, 7], [-24, 14], [-50, 16], [-76, 9], [-88, -7]],
};
const SIP: LegSet = {
  f: [[8, 7], [24, 14], [34, 30], [41, 39], [47, 44]],
  m: [[3, 8], [-2, 20], [-9, 34], [-12, 40], [-15, 44]],
  h: [[-3, 7], [-22, 12], [-47, 12], [-72, 3], [-82, -15]],
};
const CROUCH: LegSet = {
  f: [[8, 7], [22, 19], [34, 32], [41, 40], [47, 44]],
  m: [[3, 8], [-4, 22], [-11, 36], [-13, 41], [-15, 44]],
  h: [[-3, 7], [-22, 16], [-46, 18], [-68, 12], [-80, 2]],
};

export const BODY_KEYS: Record<BodyKeyId, BodyKey> = {
  fly: { pitch: -0.08, headDip: 0, curl: 0.04, swell: 1, near: FLY, far: shift(FLY, 5, -3, 1.5) },
  hover: { pitch: -0.14, headDip: 0.04, curl: 0.08, swell: 1, near: HOVER, far: shift(HOVER, 5, -3, 1.5) },
  reach: { pitch: -0.02, headDip: 0.06, curl: -0.02, swell: 1, near: REACH, far: shift(REACH, 6, -3, 1) },
  perch: { pitch: 0.06, headDip: 0.1, curl: 0.12, swell: 1, near: PERCH, far: shift(PERCH, 7, -3, 1) },
  sip: { pitch: 0.26, headDip: 0.22, curl: 0.2, swell: 1.22, near: SIP, far: shift(SIP, 7, -3, 1) },
  crouch: { pitch: -0.05, headDip: 0.02, curl: 0.05, swell: 1, near: CROUCH, far: shift(CROUCH, 7, -3, 1) },
};

const rot = ([x, y]: P, a: number, [cx, cy]: P = [0, 0]): P => {
  const c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
};
const circle = (cx: number, cy: number, r: number, n = 9, squash = 1): P[] =>
  Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * squash] as P; });

export interface BodyGeometry { cel: RawCel; fills: { thorax: P[]; head: P[]; eye: P[]; abdomen: P[]; bands: P[][] } }

/** Build the complete body drawing for a key. Legs are authored per key; contours follow pitch and curl. */
export function bodyRaw(k: BodyKey): BodyGeometry {
  const body = (p: P) => rot(p, k.pitch);
  const neck: P = [15, -3];
  const headT = (p: P) => body(rot(p, k.headDip, neck));
  const strokes: RawStroke[] = [];
  const add = (id: string, points: P[], width = 1.6, opacity = 1, extra: Partial<RawStroke> = {}) =>
    strokes.push({ id, points: points.map((q) => [+q[0].toFixed(2), +q[1].toFixed(2)] as P), width, opacity, pressure, ...extra });

  // Far legs first (behind the body), then the abdomen, thorax, head, near legs.
  for (const id of ['f', 'm', 'h'] as const) {
    const pts = k.far[id].map((q, i) => (i === 0 ? body(q) : q));
    add(`leg/far/${id}`, pts, 1.1, 0.42, { pressure: legPressure, corner: 1.2 });
  }
  // Abdomen: slender, tapering, curling about its root.
  const root: P = [-9, 0];
  const curlPt = (p: P, u: number) => body(rot(p, -k.curl * u * 1.4, root));
  const sw = k.swell;
  const topRaw: P[] = [[-9, -6], [-24, -6.5 * sw], [-40, -6 * sw], [-56, -3.5 * sw], [-70, 0.5]];
  const botRaw: P[] = [[-7, 6], [-22, 8 * sw], [-39, 9 * sw], [-55, 7.5 * sw], [-70, 3.5]];
  const top = topRaw.map((p, i) => curlPt(p, i / 4));
  const bot = botRaw.map((p, i) => curlPt(p, i / 4));
  add('abdomen/top', top, 1.5);
  add('abdomen/bottom', bot, 1.4, 0.9);
  const bands: P[][] = [];
  for (let i = 1; i <= 5; i++) {
    const u = i / 6;
    const lerpP = (arr: P[]) => { const f = u * (arr.length - 1), j = Math.min(arr.length - 2, Math.floor(f)), t = f - j; return [arr[j][0] + (arr[j + 1][0] - arr[j][0]) * t, arr[j][1] + (arr[j + 1][1] - arr[j][1]) * t] as P; };
    const a = lerpP(top), b = lerpP(bot);
    const mid: P = [(a[0] + b[0]) / 2 + 1.5, (a[1] + b[1]) / 2];
    add(`abdomen/band/${i}`, [a, mid, b], 0.9, 0.7, { pressure: [[0, 0.4], [0.5, 1], [1, 0.3]] });
    bands.push([a, mid, b]);
  }
  add('abdomen/tip', [top[4], body(rot([-74, 2], -k.curl * 1.4, root)), bot[4]], 1.1, 0.9, { corner: 1 });
  // Thorax: the hunched back that makes a mosquito read as a mosquito.
  const thorax = ([[16, -3], [12, -12], [2, -16.5], [-8, -12.5], [-12, -4], [-8, 6], [4, 9], [14, 5]] as P[]).map((p) => body(p));
  add('thorax', thorax, 1.8, 1, { close: true });
  add('thorax/lyre', ([[10, -11], [1, -13.5], [-7, -10]] as P[]).map((p) => body(p)), 0.8, 0.55);
  add('haltere', ([[-7, -9], [-12, -13], [-13.5, -14]] as P[]).map((p) => body(p)), 0.9, 0.7);
  // Head, eye, antennae, palps and the proboscis.
  const head = circle(22, -5, 7.2, 9, 0.92).map(headT);
  add('head', head, 1.6, 1, { close: true });
  const eye = circle(22.8, -6, 5, 8, 1).map(headT);
  add('eye', eye, 1, 0.9, { close: true });
  add('antenna/near', ([[25, -11], [31, -18], [38, -24], [45, -28]] as P[]).map(headT), 0.9, 0.9);
  add('antenna/far', ([[24, -12], [28, -20], [33, -27], [37, -33]] as P[]).map(headT), 0.8, 0.55);
  add('palp', ([[28, -2], [33, 0], [38, 1.5]] as P[]).map(headT), 0.9, 0.8);
  add('proboscis', ([[28.5, -3], [40, 0], [52, 3.8], [63, 8.5]] as P[]).map(headT), 1.25, 1, { pressure: [[0, 1], [0.6, 0.8], [1, 0.25]] });
  for (const id of ['f', 'm', 'h'] as const) {
    const pts = k.near[id].map((q, i) => (i === 0 ? body(q) : q));
    add(`leg/near/${id}`, pts, 1.35, 0.95, { pressure: legPressure, corner: 1.2 });
    // Tiny tarsal claw on the foot.
    const e = pts[4], d = pts[3];
    const dx = e[0] - d[0], dy = e[1] - d[1], l = Math.hypot(dx, dy) || 1;
    add(`leg/near/${id}/claw`, [e, [e[0] + (dx / l) * 3 - (dy / l) * 2, e[1] + (dy / l) * 3 + (dx / l) * 2]], 0.8, 0.8);
  }
  return { cel: { strokes }, fills: { thorax, head, eye, abdomen: [...top, ...bot.slice().reverse()], bands } };
}

// ---------------- wings ----------------
export type WingId = 'up' | 'upMid' | 'down' | 'downMid' | 'fold';
const WING_ANGLE: Record<WingId, number> = { up: Math.PI + 1.05, upMid: Math.PI + 0.42, downMid: Math.PI - 0.05, down: Math.PI - 0.62, fold: Math.PI + 0.1 };

export function wingShape(angle: number, len = 60, width = 8.5, base: P = [1, -13]): P[] {
  const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
  const at = (u: number, w: number): P => [base[0] + dx * len * u + nx * w, base[1] + dy * len * u + ny * w];
  return [at(0, 0), at(0.15, width * 0.55), at(0.45, width), at(0.8, width * 0.85), at(1, width * 0.2), at(0.98, -width * 0.3), at(0.7, -width * 0.55), at(0.35, -width * 0.45), at(0.1, -width * 0.2)];
}

export function wingRaw(id: WingId, pitch: number): { cel: RawCel; near: P[]; far: P[] } {
  const a = WING_ANGLE[id];
  const base = rot([1, -13], pitch);
  const near = wingShape(a + pitch, id === 'fold' ? 62 : 58, id === 'fold' ? 7 : 8.5, base);
  const far = wingShape(a + pitch + (id === 'fold' ? -0.08 : 0.2), id === 'fold' ? 60 : 55, 7.5, [base[0] + 3, base[1] - 1]);
  const strokes: RawStroke[] = [
    { id: 'wing/far', points: far, width: 0.9, opacity: 0.45, close: true, pressure },
    { id: 'wing/near', points: near, width: 1.2, opacity: 0.9, close: true, pressure },
  ];
  // Veins: the long radial veins that give the wing its drawing.
  const dx = Math.cos(a + pitch), dy = Math.sin(a + pitch), nx = -dy, ny = dx, L = id === 'fold' ? 62 : 58;
  for (let v = 0; v < 3; v++) {
    const off = (v - 1) * 2.8;
    strokes.push({ id: `wing/vein/${v}`, points: [[base[0] + dx * 6 + nx * off * 0.3, base[1] + dy * 6 + ny * off * 0.3], [base[0] + dx * L * 0.5 + nx * off, base[1] + dy * L * 0.5 + ny * off], [base[0] + dx * L * 0.9 + nx * off * 0.8, base[1] + dy * L * 0.9 + ny * off * 0.8]], width: 0.55, opacity: 0.5, pressure: [[0, 0.8], [1, 0.2]] });
  }
  // A designed smear: faint arcs where the wing has just been, on the fast frames.
  if (id === 'upMid' || id === 'downMid') {
    const from = id === 'upMid' ? WING_ANGLE.down : WING_ANGLE.up, to = a;
    for (let r = 0; r < 3; r++) {
      const R = L * (0.62 + r * 0.16);
      const pts: P[] = Array.from({ length: 6 }, (_, i) => { const t = from + (to - from) * (i / 5) + pitch; return [base[0] + Math.cos(t) * R, base[1] + Math.sin(t) * R]; });
      strokes.push({ id: `wing/arc/${r}`, points: pts, width: 0.7, opacity: 0.22 + r * 0.05, pressure: [[0, 0.1], [0.5, 1], [1, 0.3]] });
    }
  }
  return { cel: { strokes }, near, far };
}

export const WING_CYCLE: WingId[] = ['up', 'upMid', 'downMid', 'down', 'downMid', 'upMid'];

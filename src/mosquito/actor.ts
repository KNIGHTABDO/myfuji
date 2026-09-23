import { BODY_KEYS, bodyRaw, wingRaw, type BodyKeyId, type WingId } from './cels';

type P = [number, number];

interface Built { cel: CompiledCel; fills: ReturnType<typeof bodyRaw>['fills']; pitch: number }
const bodyCache = new Map<string, Built>();
const wingCache = new Map<string, { near: CompiledCel; far: CompiledCel; nearPts: P[]; farPts: P[] }>();

const lerpPts = (a: P[], b: P[], t: number): P[] => a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);

/** Only a finite set of drawings exists: keys plus inbetweens at thirds. */
export const quantize = (u: number) => (u <= 0.001 ? 0 : u >= 0.999 ? 1 : u < 0.5 ? 0.34 : 0.67);

export function bodyDrawing(from: BodyKeyId, to: BodyKeyId, u: number): Built {
  const q = from === to ? 0 : quantize(u);
  const key = `${from}>${to}@${q}`;
  let b = bodyCache.get(key);
  if (b) return b;
  const A = bodyRaw(BODY_KEYS[from]), B = bodyRaw(BODY_KEYS[to]);
  const pitch = BODY_KEYS[from].pitch + (BODY_KEYS[to].pitch - BODY_KEYS[from].pitch) * q;
  if (q === 0) b = { cel: compileCel(A.cel, { id: 'mosquito/' + from }), fills: A.fills, pitch };
  else if (q === 1) b = { cel: compileCel(B.cel, { id: 'mosquito/' + to }), fills: B.fills, pitch };
  else {
    const raw = inbetweenCel(A.cel, B.cel, q);
    const f = A.fills, g = B.fills;
    b = {
      cel: compileCel(raw, { id: `mosquito/${key}` }),
      fills: { thorax: lerpPts(f.thorax, g.thorax, q), head: lerpPts(f.head, g.head, q), eye: lerpPts(f.eye, g.eye, q), abdomen: lerpPts(f.abdomen, g.abdomen, q), bands: f.bands.map((band, i) => lerpPts(band, g.bands[i], q)) },
      pitch,
    };
  }
  bodyCache.set(key, b);
  return b;
}

function wingDrawing(id: WingId, pitch: number) {
  const pk = Math.round(pitch * 20) / 20;
  const key = `${id}@${pk}`;
  let w = wingCache.get(key);
  if (!w) {
    const r = wingRaw(id, pk);
    w = {
      far: compileCel({ strokes: r.cel.strokes.filter((s) => s.id === 'wing/far') }, { id: 'wing-far/' + key }),
      near: compileCel({ strokes: r.cel.strokes.filter((s) => s.id !== 'wing/far') }, { id: 'wing-near/' + key }),
      nearPts: r.near, farPts: r.far,
    };
    wingCache.set(key, w);
  }
  return w;
}

const fillPoly = (c: CanvasRenderingContext2D, pts: P[], color: string, alpha: number) => {
  c.save();
  c.globalAlpha *= alpha;
  c.fillStyle = color;
  c.fill(polyPath(smoothPts(pts, true, 1.5, Math.PI), true));
  c.restore();
};

const mix = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
};

export interface MosquitoPose {
  x: number;
  y: number;
  scale: number;
  facing: 1 | -1;
  tilt: number;
  from: BodyKeyId;
  to: BodyKeyId;
  u: number;
  wing: WingId;
  /** 0..1 how much ink it has drunk: the abdomen fills with colour. */
  sip: number;
  ink: string;
  bloodInk: string;
  alpha?: number;
}

export function drawMosquito(c: CanvasRenderingContext2D, p: MosquitoPose) {
  const body = bodyDrawing(p.from, p.to, p.u);
  const wings = wingDrawing(p.wing, body.pitch);
  c.save();
  c.translate(p.x, p.y);
  c.rotate(p.tilt);
  c.scale(p.scale * p.facing, p.scale);
  c.globalAlpha *= p.alpha ?? 1;
  // far wing behind everything
  fillPoly(c, wings.farPts, '#9fb4cc', 0.16);
  drawCel(c, wings.far, { material: 'ink', color: p.ink });
  // body washes
  fillPoly(c, body.fills.abdomen, mix('#8c7a66', p.bloodInk, Math.min(1, p.sip)), 0.42 + 0.35 * p.sip);
  fillPoly(c, body.fills.thorax, '#6f5d4c', 0.5);
  fillPoly(c, body.fills.head, '#6f5d4c', 0.45);
  fillPoly(c, body.fills.eye, '#241b2c', 0.9);
  // pale Aedes bands between the segment lines
  c.save();
  c.globalAlpha *= 0.55;
  c.strokeStyle = '#fbf3e4';
  c.lineWidth = 1.6;
  c.lineCap = 'round';
  for (const band of body.fills.bands) {
    c.beginPath();
    c.moveTo(band[0][0] - 2.2, band[0][1] + 1.2);
    c.quadraticCurveTo(band[1][0] - 2.2, band[1][1], band[2][0] - 2.2, band[2][1] - 1.2);
    c.stroke();
  }
  c.restore();
  drawCel(c, body.cel, { material: 'ink', color: p.ink });
  // eye glint
  const e = body.fills.eye;
  c.save();
  c.fillStyle = '#fff8ea';
  c.globalAlpha *= 0.9;
  c.beginPath();
  c.arc(e[1][0] - 1.2, e[1][1] + 1.6, 1.1, 0, Math.PI * 2);
  c.fill();
  c.restore();
  // near wing over the body
  fillPoly(c, wings.nearPts, '#c4d5e8', 0.26);
  drawCel(c, wings.near, { material: 'ink', color: p.ink });
  c.restore();
}

/** A soft ground shadow that shrinks as the mosquito climbs. */
export function drawShadow(c: CanvasRenderingContext2D, x: number, groundY: number, altitude: number, scale: number, ink: string) {
  const k = Math.max(0, 1 - altitude / (140 * scale));
  if (k <= 0) return;
  c.save();
  c.globalAlpha *= 0.13 * k;
  c.fillStyle = ink;
  c.beginPath();
  c.ellipse(x - 6 * scale, groundY + 2, 42 * scale * (0.6 + 0.4 * k), 4.5 * scale * (0.6 + 0.4 * k), 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

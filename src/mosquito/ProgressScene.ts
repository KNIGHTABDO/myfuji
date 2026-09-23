// The developing card: an ink line is drawn across paper as the photo is
// processed, and a mosquito flies ahead of it. At each stage it lands on the
// station, drinks a little ink and takes off again. Root motion is evaluated
// every frame; body drawings are exposed on twos and wings on ones.
import { drawMosquito, drawShadow } from './actor';
import type { BodyKeyId, WingId } from './cels';
import { WING_CYCLE } from './cels';
import { Buzz } from './buzz';

type P = [number, number];

export interface Station { id: string; label: string; at: number }

type Mode = 'fly' | 'land' | 'sip' | 'takeoff' | 'exit' | 'gone';

const INK = '#1e1630';
const RED = '#b3262e';
const PAPER = '#f3e6cf';

export class ProgressScene {
  private c: CanvasRenderingContext2D;
  private raf = 0;
  private t0 = performance.now();
  private last = performance.now();
  private w = 0;
  private h = 0;
  private dpr = 1;
  private target = 0;
  private shown = 0;
  private visited = new Set<number>();
  private stationDone: number[] = [];
  private mode: Mode = 'fly';
  private modeT = 0;
  private landing = -1;
  private pos: P = [0, 0];
  private hoverFrom: P = [0, 0];
  private detail = '';
  private stageLabel = '';
  private title = '';
  private subtitle = '';
  private sip = 0;
  private done: (() => void) | null = null;
  private path: P[] = [];
  private lens: number[] = [];
  private paperCanvas: HTMLCanvasElement | null = null;
  private resizeObs: ResizeObserver;
  private buzz: Buzz | null;

  constructor(private canvas: HTMLCanvasElement, private stations: Station[], sound: boolean) {
    this.c = canvas.getContext('2d')!;
    this.buzz = sound ? new Buzz() : null;
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(canvas);
    this.layout();
    this.pos = this.pointAt(0);
    this.pos = [this.pos[0] - 40, this.pos[1] - 80];
    this.hoverFrom = this.pos;
    this.raf = requestAnimationFrame(this.frame);
    if (import.meta.env.DEV) (window as unknown as { __scene: ProgressScene }).__scene = this;
  }

  setTitle(title: string, subtitle = '') { this.title = title; this.subtitle = subtitle; }

  update(stage: string, value: number, detail?: string) {
    this.target = Math.max(this.target, Math.min(1, value));
    const s = this.stations.find((x) => x.id === stage);
    if (s) this.stageLabel = s.label;
    if (detail !== undefined) this.detail = detail;
  }

  /** Resolves once the mosquito has visited the last station and flown away. */
  finish(): Promise<void> {
    this.target = 1;
    return new Promise((r) => { this.done = r; });
  }

  /** Start a new photo on the same card. */
  reset() {
    this.target = 0; this.shown = 0; this.visited.clear(); this.stationDone = [];
    this.sip = 0; this.mode = 'fly'; this.modeT = 0; this.detail = ''; this.done = null;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.buzz?.stop();
  }

  private layout() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(280, r.width);
    this.h = Math.max(200, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    // The line wanders like a hand-drawn rule; seeded, so it never boils.
    const x0 = this.w * 0.08, x1 = this.w * 0.92, y = this.h * 0.64;
    const pts: P[] = [];
    for (let i = 0; i <= 8; i++) pts.push([x0 + ((x1 - x0) * i) / 8, y + noise1(i * 0.9, 41) * this.h * 0.035]);
    this.path = spline(pts, 3) as P[];
    this.lens = [0];
    for (let i = 1; i < this.path.length; i++) this.lens.push(this.lens[i - 1] + Math.hypot(this.path[i][0] - this.path[i - 1][0], this.path[i][1] - this.path[i - 1][1]));
    this.paperCanvas = null;
  }

  private pointAt(u: number): P {
    const L = this.lens[this.lens.length - 1] * Math.max(0, Math.min(1, u));
    let i = 1;
    while (i < this.lens.length - 1 && this.lens[i] < L) i++;
    const a = this.path[i - 1], b = this.path[i], t = (L - this.lens[i - 1]) / (this.lens[i] - this.lens[i - 1] || 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  private paper() {
    if (this.paperCanvas) return this.paperCanvas;
    const pc = document.createElement('canvas');
    pc.width = this.canvas.width; pc.height = this.canvas.height;
    const g = pc.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    g.fillStyle = PAPER;
    g.fillRect(0, 0, this.w, this.h);
    // fibres and tooth, fixed to the sheet
    for (let i = 0; i < 900; i++) {
      const x = hash(i, 3) * this.w, y = hash(i, 4) * this.h, l = 2 + hash(i, 5) * 9, a = hash(i, 6) * Math.PI;
      g.strokeStyle = hash(i, 7) > 0.5 ? 'rgba(120,90,50,0.07)' : 'rgba(255,255,255,0.25)';
      g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    const grd = g.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.2, this.w / 2, this.h / 2, this.w * 0.75);
    grd.addColorStop(0, 'rgba(255,248,230,0)');
    grd.addColorStop(1, 'rgba(120,85,40,0.16)');
    g.fillStyle = grd;
    g.fillRect(0, 0, this.w, this.h);
    // faint pencil guide under the ink line
    g.strokeStyle = 'rgba(60,70,120,0.25)';
    g.lineWidth = 0.7;
    g.setLineDash([2, 5]);
    g.beginPath();
    this.path.forEach((p, i) => (i ? g.lineTo(p[0], p[1] + 1.5) : g.moveTo(p[0], p[1] + 1.5)));
    g.stroke();
    this.paperCanvas = pc;
    return pc;
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    // rAF timestamps can precede performance.now() taken in the constructor.
    if (now < this.t0) this.t0 = now;
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = Math.max(this.last, now);
    const t = (now - this.t0) / 1000;
    try {
      this.step(dt, t);
      this.draw(t);
    } catch (e) {
      console.error('[mosquito]', e);
    }
  };

  private nextStation(): number {
    for (let i = 0; i < this.stations.length; i++) if (!this.visited.has(i)) return i;
    return -1;
  }

  private step(dt: number, t: number) {
    this.modeT += dt;
    const next = this.nextStation();
    const stopAt = next >= 0 ? this.stations[next].at : 1;
    if (this.mode === 'fly') {
      // Chase the real progress, but never overtake an unvisited station.
      const goal = Math.min(this.target, stopAt);
      const speed = Math.max(0.28, (goal - this.shown) * 3);
      this.shown = Math.min(goal, this.shown + speed * dt);
      if (next >= 0 && this.shown >= stopAt - 1e-4 && this.target >= stopAt) {
        const last = next === this.stations.length - 1;
        const hurry = this.target - stopAt > 0.2 && !last;
        if (hurry) { this.visited.add(next); this.stationDone[next] = t; this.sip = Math.min(1, this.sip + 0.06); }
        else { this.mode = 'land'; this.modeT = 0; this.landing = next; this.hoverFrom = this.pos; }
      }
    } else if (this.mode === 'land' && this.modeT > 0.26) { this.mode = 'sip'; this.modeT = 0; }
    else if (this.mode === 'sip') {
      this.sip = Math.min(1, this.sip + dt * 0.35);
      if (this.modeT > 0.42) { this.visited.add(this.landing); this.stationDone[this.landing] = t; this.mode = 'takeoff'; this.modeT = 0; }
    } else if (this.mode === 'takeoff' && this.modeT > 0.22) {
      this.mode = this.nextStation() < 0 ? 'exit' : 'fly';
      this.modeT = 0;
      this.hoverFrom = this.pos;
    } else if (this.mode === 'exit' && this.modeT > 1.0) {
      this.mode = 'gone';
      this.buzz?.stop();
      const d = this.done; this.done = null; d?.();
    }

    const sc = this.scale();
    const tip = this.pointAt(this.shown);
    const hover: P = [tip[0] + 18 * sc + drift(t, 3, { amp: 6 * sc, freq: 0.9 }), tip[1] - 46 * sc + Math.sin(t * 5.2) * 4 * sc + drift(t, 8, { amp: 5 * sc, freq: 0.7 })];
    const land = this.landing >= 0 ? this.pointAt(this.stations[this.landing].at) : tip;
    const stand: P = [land[0] - 4 * sc, land[1] - 44 * sc * 0.98];
    const ease = (x: number) => easeIO(Math.max(0, Math.min(1, x)));
    if (this.mode === 'fly') this.pos = [this.pos[0] + (hover[0] - this.pos[0]) * Math.min(1, dt * 7), this.pos[1] + (hover[1] - this.pos[1]) * Math.min(1, dt * 7)];
    else if (this.mode === 'land') { const u = ease(this.modeT / 0.26); this.pos = [this.hoverFrom[0] + (stand[0] - this.hoverFrom[0]) * u, this.hoverFrom[1] + (stand[1] - this.hoverFrom[1]) * u]; }
    else if (this.mode === 'sip') this.pos = [stand[0], stand[1] + Math.sin(Math.min(1, this.modeT / 0.42) * Math.PI) * 3 * sc];
    else if (this.mode === 'takeoff') { const u = ease(this.modeT / 0.22); this.pos = [stand[0] + 10 * sc * u, stand[1] + (u < 0.3 ? 4 * sc * u / 0.3 : 4 * sc - 60 * sc * (u - 0.3))]; }
    else if (this.mode === 'exit') { const u = this.modeT; this.pos = [this.hoverFrom[0] + u * u * this.w * 0.5 + u * 60, this.hoverFrom[1] - u * 90 * sc - u * u * this.h * 0.8]; }
    this.buzz?.set(this.mode === 'fly' || this.mode === 'exit' || this.mode === 'takeoff' ? 1 : this.mode === 'land' ? 0.5 : 0, this.pos[0] / this.w);
  }

  private scale() { return Math.max(0.7, Math.min(1.35, this.w / 620)); }

  private pose(t: number): { from: BodyKeyId; to: BodyKeyId; u: number; wing: WingId } {
    // Body on twos: the pose phase is sampled at 12 drawings per second.
    const q = (x: number, dur: number) => Math.floor((Math.min(dur, x) / dur) * 6 + 1e-6) / 6;
    const wingOnOnes = WING_CYCLE[Math.floor(t * 24) % WING_CYCLE.length];
    switch (this.mode) {
      case 'land': return { from: 'fly', to: 'reach', u: q(this.modeT, 0.26), wing: this.modeT > 0.2 ? 'upMid' : wingOnOnes };
      case 'sip': {
        const u = this.modeT < 0.1 ? q(this.modeT, 0.1) : 1;
        return this.modeT < 0.1 ? { from: 'reach', to: 'perch', u, wing: 'fold' } : { from: 'perch', to: 'sip', u: q(this.modeT - 0.1, 0.12), wing: 'fold' };
      }
      case 'takeoff': return { from: 'crouch', to: 'fly', u: q(this.modeT, 0.22), wing: this.modeT < 0.05 ? 'fold' : wingOnOnes };
      default: {
        // Alternate two held flight drawings for life, each held for a beat.
        const k = Math.floor(t * 2.5) % 2 === 0 ? 'fly' : 'hover';
        return { from: k, to: k, u: 0, wing: wingOnOnes };
      }
    }
  }

  private draw(t: number) {
    const c = this.c, sc = this.scale();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.drawImage(this.paper(), 0, 0, this.w, this.h);
    // Title, hand-lettered.
    c.fillStyle = INK;
    c.font = `600 ${Math.round(26 * sc)}px Caveat, "Segoe Script", cursive`;
    c.textBaseline = 'alphabetic';
    c.fillText(this.title, this.w * 0.08, this.h * 0.2);
    c.globalAlpha = 0.6;
    c.font = `${Math.round(17 * sc)}px Caveat, cursive`;
    c.fillText(this.subtitle, this.w * 0.08, this.h * 0.2 + 22 * sc);
    c.globalAlpha = 1;
    // The ink line, drawn on as progress advances.
    const L = this.path;
    brush(c, L, { w: 3.2 * sc, color: INK, p: this.shown, seed: 11, amp: 0.8, smooth: false });
    // Stations.
    this.stations.forEach((s, i) => {
      const [x, y] = this.pointAt(s.at);
      const doneAt = this.stationDone[i];
      const r = 7 * sc;
      c.save();
      c.strokeStyle = INK; c.lineWidth = 1.4; c.globalAlpha = 0.85;
      const ring: P[] = Array.from({ length: 12 }, (_, k) => { const a = (k / 12) * Math.PI * 2; return [x + Math.cos(a) * r, y + Math.sin(a) * r] as P; });
      wob(c, ring, 0.8, 100 + i, true);
      if (doneAt !== undefined) {
        const k = Math.min(1, (t - doneAt) / 0.25);
        c.fillStyle = i === this.stations.length - 1 ? RED : INK;
        c.globalAlpha = 0.9 * k;
        c.beginPath(); c.arc(x, y, r * 0.62 * k, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = doneAt !== undefined ? 0.95 : 0.5;
      c.fillStyle = INK;
      c.font = `${Math.round(15 * sc)}px Caveat, cursive`;
      c.textAlign = 'center';
      const words = s.label.split(' ');
      const half = Math.ceil(words.length / 2);
      c.fillText(words.slice(0, half).join(' '), x, y + 26 * sc);
      c.fillText(words.slice(half).join(' '), x, y + 42 * sc);
      c.restore();
    });
    // Live detail of what the lab is doing right now.
    c.fillStyle = INK;
    c.globalAlpha = 0.72;
    c.textAlign = 'left';
    c.font = `${Math.round(18 * sc)}px Caveat, cursive`;
    const status = this.mode === 'gone' ? 'ready!' : `${this.stageLabel}${this.detail ? ' · ' + this.detail : ''}`;
    c.fillText(status, this.w * 0.08, this.h * 0.9);
    c.textAlign = 'right';
    c.fillText(`${Math.round(this.shown * 100)}%`, this.w * 0.92, this.h * 0.9);
    c.globalAlpha = 1;
    c.textAlign = 'left';
    if (this.mode === 'gone') return;
    const pose = this.pose(t);
    const ground = this.pointAt(Math.min(1, this.shown + 0.01))[1];
    drawShadow(c, this.pos[0], ground, Math.max(0, ground - (this.pos[1] + 44 * sc)), sc, INK);
    const tilt = this.mode === 'fly' ? -0.05 + drift(t, 12, { amp: 0.06, freq: 0.8 }) : this.mode === 'exit' ? -0.35 : 0;
    drawMosquito(c, { x: this.pos[0], y: this.pos[1], scale: sc * 0.98, facing: 1, tilt, ...pose, sip: this.sip, ink: INK, bloodInk: RED });
  }
}

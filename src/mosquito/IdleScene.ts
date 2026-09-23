// The home-screen mosquito: it loiters over the page, lands on the drop zone,
// grooms for a while and takes off again. It keeps its distance from the cursor.
import { drawMosquito, drawShadow } from './actor';
import { WING_CYCLE, type BodyKeyId, type WingId } from './cels';

type P = [number, number];
type Mode = 'fly' | 'land' | 'perch' | 'takeoff';

export class IdleScene {
  private c: CanvasRenderingContext2D;
  private raf = 0;
  private t0 = performance.now();
  private last = performance.now();
  private w = 0;
  private h = 0;
  private dpr = 1;
  private pos: P = [-80, 120];
  private vel: P = [0, 0];
  private mode: Mode = 'fly';
  private modeT = 0;
  private flyFor = 5;
  private from: P = [0, 0];
  private perch: P = [0, 0];
  private cursor: P = [-9999, -9999];
  private facing: 1 | -1 = 1;
  private ro: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, private perchTarget: () => DOMRect | null, private ink = '#efe6d4') {
    this.c = canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(canvas);
    this.layout();
    window.addEventListener('pointermove', this.onMove);
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('pointermove', this.onMove);
  }

  private onMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.cursor = [e.clientX - r.left, e.clientY - r.top];
  };

  private layout() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
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

  private perchPoint(): P | null {
    const r = this.perchTarget();
    const me = this.canvas.getBoundingClientRect();
    if (!r) return null;
    return [r.left - me.left + r.width * 0.78, r.top - me.top];
  }

  private step(dt: number, t: number) {
    this.modeT += dt;
    const sc = this.scale();
    const [cx, cy] = this.cursor;
    const near = Math.hypot(cx - this.pos[0], cy - this.pos[1]) < 110 * sc;
    if (this.mode === 'fly') {
      // A lazy figure-of-eight around the upper part of the page, with drift.
      const ax = this.w * (0.5 + 0.34 * Math.sin(t * 0.37)) + drift(t, 5, { amp: 40, freq: 0.5 });
      const ay = this.h * (0.3 + 0.12 * Math.sin(t * 0.74)) + drift(t, 9, { amp: 30, freq: 0.6 });
      let gx = ax, gy = ay;
      if (near) { gx = this.pos[0] + (this.pos[0] - cx) * 2; gy = this.pos[1] + (this.pos[1] - cy) * 2; }
      this.vel[0] += ((gx - this.pos[0]) * 2.2 - this.vel[0] * 1.6) * dt;
      this.vel[1] += ((gy - this.pos[1]) * 2.2 - this.vel[1] * 1.6) * dt;
      this.pos = [this.pos[0] + this.vel[0] * dt, this.pos[1] + this.vel[1] * dt + Math.sin(t * 6) * 0.4];
      if (Math.abs(this.vel[0]) > 12) this.facing = this.vel[0] > 0 ? 1 : -1;
      const pp = this.perchPoint();
      if (this.modeT > this.flyFor && pp && !near) { this.mode = 'land'; this.modeT = 0; this.from = this.pos; this.perch = [pp[0], pp[1] - 44 * sc]; this.facing = this.perch[0] > this.pos[0] ? 1 : -1; }
    } else if (this.mode === 'land') {
      const u = easeIO(Math.min(1, this.modeT / 0.9));
      const lift = Math.sin(u * Math.PI) * 30;
      this.pos = [this.from[0] + (this.perch[0] - this.from[0]) * u, this.from[1] + (this.perch[1] - this.from[1]) * u - lift];
      if (this.modeT >= 0.9) { this.mode = 'perch'; this.modeT = 0; }
    } else if (this.mode === 'perch') {
      const pp = this.perchPoint();
      if (pp) this.perch = [pp[0], pp[1] - 44 * sc];
      this.pos = this.perch;
      if (this.modeT > 4.5 || near) { this.mode = 'takeoff'; this.modeT = 0; this.from = this.pos; }
    } else if (this.mode === 'takeoff') {
      const u = Math.min(1, this.modeT / 0.3);
      this.pos = [this.from[0] + 12 * u * this.facing, this.from[1] - 50 * u * u];
      if (u >= 1) { this.mode = 'fly'; this.modeT = 0; this.vel = [80 * this.facing, -60]; this.flyFor = 5 + (hash(Math.floor(t), 2) * 5); }
    }
  }

  private scale() { return Math.max(0.6, Math.min(1.1, this.w / 1100)); }

  private pose(t: number): { from: BodyKeyId; to: BodyKeyId; u: number; wing: WingId } {
    const wing = WING_CYCLE[Math.floor(t * 24) % WING_CYCLE.length];
    const q = (x: number, d: number) => Math.floor((Math.min(d, x) / d) * 6 + 1e-6) / 6;
    if (this.mode === 'land') return this.modeT < 0.6 ? { from: 'fly', to: 'fly', u: 0, wing } : { from: 'fly', to: 'reach', u: q(this.modeT - 0.6, 0.3), wing };
    if (this.mode === 'perch') {
      if (this.modeT < 0.15) return { from: 'reach', to: 'perch', u: q(this.modeT, 0.15), wing: 'fold' };
      // Holds, with an occasional dip of the head: whole drawings, held.
      const beat = Math.floor((this.modeT - 0.15) * 1.2) % 4;
      return beat === 2 ? { from: 'sip', to: 'sip', u: 0, wing: 'fold' } : { from: 'perch', to: 'perch', u: 0, wing: 'fold' };
    }
    if (this.mode === 'takeoff') return { from: 'crouch', to: 'fly', u: q(this.modeT, 0.3), wing: this.modeT < 0.06 ? 'fold' : wing };
    const k = Math.floor(t * 2.5) % 2 === 0 ? 'fly' : 'hover';
    return { from: k, to: k, u: 0, wing };
  }

  private draw(t: number) {
    const c = this.c, sc = this.scale();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    const pp = this.perchPoint();
    if (pp && (this.mode === 'perch' || this.mode === 'land')) drawShadow(c, this.pos[0], pp[1], Math.max(0, pp[1] - (this.pos[1] + 44 * sc)), sc, '#000');
    const tilt = this.mode === 'fly' ? Math.max(-0.35, Math.min(0.35, this.vel[1] * 0.002)) * this.facing : 0;
    drawMosquito(c, { x: this.pos[0], y: this.pos[1], scale: sc, facing: this.facing, tilt, ...this.pose(t), sip: 0.15, ink: this.ink, bloodInk: '#d9493f' });
  }
}

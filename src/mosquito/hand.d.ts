// Globals provided by the vendored hand-drawn-canvas-animation engine
// (public/hand/core.js, studio.js, cels.js, materials.js), loaded as classic scripts.
type Pt = [number, number];
interface RawStroke { id: string; points: Pt[]; width?: number; opacity?: number; pressure?: Array<[number, number]>; close?: boolean; corner?: number; color?: string }
interface RawCel { strokes: RawStroke[] }
interface CompiledCel { id: string; strokes: Array<RawStroke & { samples: unknown[] }> }

declare function compileCel(cel: RawCel, opts?: { id?: string }): CompiledCel;
declare function inbetweenCel(a: RawCel, b: RawCel, t: number): RawCel;
declare function drawCel(c: CanvasRenderingContext2D, cel: CompiledCel, opts?: { material?: 'pencil' | 'ink'; color?: string; opacity?: number }): void;
declare function exposureSheet(entries: Array<{ id: string; frames: number }>, drawings: Record<string, CompiledCel>, fps?: number): {
  frames: number; duration: number; at(seconds: number): { id: string; drawing: CompiledCel };
};
declare function smoothPts(pts: Pt[], close?: boolean, step?: number, corner?: number): Pt[];
declare function noise1(x: number, seed?: number): number;
declare function hash(k: number, seed?: number): number;
declare function drift(t: number, seed?: number, o?: { amp?: number; freq?: number }): number;
declare function pigmentWash(c: CanvasRenderingContext2D, path: Path2D, box: [number, number, number, number], o?: { color?: string; seed?: number; opacity?: number; granulation?: number; edge?: number; blend?: GlobalCompositeOperation }): void;
declare function formHatch(c: CanvasRenderingContext2D, path: Path2D, box: [number, number, number, number], o?: Record<string, unknown>): void;
declare function polyPath(pts: Pt[], close?: boolean): Path2D;
declare function wob(c: CanvasRenderingContext2D, pts: Pt[], amp: number, seed: number, close?: boolean, o?: Record<string, unknown>): void;
declare function brush(c: CanvasRenderingContext2D, pts: Pt[], o?: { w?: number; color?: string; p?: number; seed?: number; amp?: number; taper?: number; close?: boolean; smooth?: boolean; al?: number }): void;
declare function spline(pts: Pt[], step?: number, close?: boolean): Pt[];
declare const easeIO: (t: number) => number;
declare const easeOut: (t: number) => number;
declare const easeInOutSine: (t: number) => number;

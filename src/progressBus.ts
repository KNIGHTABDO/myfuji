import type { ProgressScene } from './mosquito/ProgressScene';

let scene: ProgressScene | null = null;
let title: [string, string] = ['', ''];
let last: [string, number, string | undefined] | null = null;
let waiting: Array<() => void> = [];

/** Routes pipeline progress to the mosquito card, whether or not it is mounted yet. */
export const progress = {
  attach(s: ProgressScene) {
    scene = s;
    s.setTitle(...title);
    if (last) s.update(...last);
    const w = waiting; waiting = [];
    w.forEach((f) => f());
  },
  detach(s: ProgressScene) { if (scene === s) scene = null; },
  begin(t: string, sub: string) {
    title = [t, sub]; last = null;
    scene?.reset();
    scene?.setTitle(t, sub);
  },
  update(stage: string, v: number, d?: string) {
    last = [stage, v, d];
    scene?.update(stage, v, d);
  },
  async finish(): Promise<void> {
    if (!scene) await new Promise<void>((r) => { waiting.push(r); setTimeout(r, 400); });
    if (!scene) return;
    await scene.finish();
  },
};

import { buildLut, lutKey, type LutParams } from './film/lut';

export interface LutPair { main: Uint16Array; skin: Uint16Array; size: number }

/** Builds LUTs off the main thread; the newest request always wins. */
class LutClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, (v: LutPair) => void>();
  private cache = new Map<string, LutPair>();

  private get w() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./lut.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<LutPair & { id: number }>) => {
        const r = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        r?.({ main: e.data.main, skin: e.data.skin, size: e.data.size });
      };
    }
    return this.worker;
  }

  async get(p: LutParams, size = 48): Promise<LutPair | null> {
    const key = lutKey(p, false, size);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const id = ++this.seq;
    const res = await new Promise<LutPair>((resolve) => {
      this.pending.set(id, resolve);
      try { this.w.postMessage({ id, p, size }); }
      catch { resolve({ main: buildLut(p, size, false), skin: buildLut(p, size, true), size }); }
    });
    this.cache.set(key, res);
    if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
    // A newer request superseded this one: its result is cached but not applied.
    return id === this.seq ? res : null;
  }

  /** Synchronous small LUTs for thumbnails. */
  small(p: LutParams, size = 25): LutPair {
    const key = lutKey(p, false, size);
    let hit = this.cache.get(key);
    if (!hit) { hit = { main: buildLut(p, size, false), skin: buildLut(p, size, true), size }; this.cache.set(key, hit); }
    return hit;
  }
}

export const luts = new LutClient();

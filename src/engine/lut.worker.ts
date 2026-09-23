import { buildLut, type LutParams } from './film/lut';

self.onmessage = (e: MessageEvent<{ id: number; p: LutParams; size: number }>) => {
  const { id, p, size } = e.data;
  const main = buildLut(p, size, false);
  const skin = buildLut(p, size, true);
  (self as unknown as Worker).postMessage({ id, main, skin, size }, [main.buffer, skin.buffer]);
};

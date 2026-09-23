import { useEffect, useRef } from 'react';
import { darkroom } from '../darkroom';

/** Live RGB histogram of what the viewer is showing. */
export function Histogram() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let t = 0;
    const probe = document.createElement('canvas');
    probe.width = 160; probe.height = 110;
    const pg = probe.getContext('2d', { willReadFrequently: true })!;
    const draw = () => {
      const src = darkroom.renderer?.canvas as HTMLCanvasElement | undefined;
      const c = ref.current;
      if (!src || !c || !src.width) return;
      pg.drawImage(src, 0, 0, probe.width, probe.height);
      const d = pg.getImageData(0, 0, probe.width, probe.height).data;
      const N = 64, h = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) h[k][(d[i + k] * N) >> 8]++;
      const dpr = window.devicePixelRatio || 1;
      c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      let max = 0;
      for (const a of h) for (let i = 1; i < N - 1; i++) max = Math.max(max, a[i]);
      g.globalCompositeOperation = 'screen';
      const cols = ['rgba(255,70,60,.75)', 'rgba(80,220,110,.7)', 'rgba(80,130,255,.8)'];
      h.forEach((a, k) => {
        g.fillStyle = cols[k];
        g.beginPath();
        g.moveTo(0, c.height);
        for (let i = 0; i < N; i++) g.lineTo((i / (N - 1)) * c.width, c.height - Math.min(1, a[i] / (max || 1)) * c.height * 0.92);
        g.lineTo(c.width, c.height);
        g.fill();
      });
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(255,255,255,.08)';
      for (const x of [0.25, 0.5, 0.75]) g.fillRect(x * c.width, 0, 1, c.height);
    };
    darkroom.onRendered = () => { clearTimeout(t); t = window.setTimeout(draw, 120); };
    draw();
    return () => { darkroom.onRendered = null; clearTimeout(t); };
  }, []);
  return <canvas ref={ref} className="hist" />;
}

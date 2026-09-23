import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { exportActive } from '../actions';
import { darkroom } from '../darkroom';
import { cropRect, resolveDR } from '../engine/develop';
import { SIM_BY_ID } from '../engine/film/sims';
import { activePhoto, getState, setState, useStore } from '../state';

export function Viewer() {
  const photo = useStore(activePhoto);
  const split = useStore((s) => s.split);
  const showOriginal = useStore((s) => s.showOriginal);
  const zoom = useStore((s) => s.zoom);
  const pan = useStore((s) => s.pan);
  const busy = useStore((s) => s.busy);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvas.current) return;
    try { darkroom.attach(canvas.current); }
    catch (e) { setError((e as Error).message); }
    return () => darkroom.detach();
  }, []);

  const crop = photo ? cropRect(photo.params.crop, photo.params.cropCenter, photo.w, photo.h) : [0, 0, 1, 1];
  const aspect = photo ? ((crop[2] - crop[0]) * photo.w) / ((crop[3] - crop[1]) * photo.h) : 1.5;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 40;
      const cw = Math.min(w, h * aspect);
      setSize([Math.max(10, Math.floor(cw)), Math.max(10, Math.floor(cw / aspect))]);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  useEffect(() => { if (photo) void darkroom.sync(photo); }, [photo, size]);
  useEffect(() => { darkroom.requestRender(); }, [split, showOriginal, zoom, pan]);

  // Wheel zoom around the pointer; drag to pan.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = getState();
      const r = c.getBoundingClientRect();
      const mx = (e.clientX - r.left) / r.width, my = (e.clientY - r.top) / r.height;
      const z = Math.min(16, Math.max(1, s.zoom * Math.exp(-e.deltaY * 0.0015)));
      const fx = s.pan[0] + (mx - 0.5) / s.zoom, fy = s.pan[1] + (my - 0.5) / s.zoom;
      const clampP = (v: number) => Math.min(1 - 0.5 / z, Math.max(0.5 / z, v));
      setState({ zoom: z, pan: z === 1 ? [0.5, 0.5] : [clampP(fx - (mx - 0.5) / z), clampP(fy - (my - 0.5) / z)] });
    };
    let drag: { x: number; y: number; pan: [number, number] } | null = null;
    const down = (e: PointerEvent) => { if (getState().zoom <= 1) return; drag = { x: e.clientX, y: e.clientY, pan: getState().pan }; c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing'; };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const s = getState(), r = c.getBoundingClientRect();
      const clampP = (v: number) => Math.min(1 - 0.5 / s.zoom, Math.max(0.5 / s.zoom, v));
      setState({ pan: [clampP(drag.pan[0] - (e.clientX - drag.x) / r.width / s.zoom), clampP(drag.pan[1] - (e.clientY - drag.y) / r.height / s.zoom)] });
    };
    const up = () => { drag = null; c.style.cursor = ''; };
    const dbl = (e: MouseEvent) => {
      const s = getState(), p = activePhoto(s);
      if (!p) return;
      if (s.zoom > 1.01) { setState({ zoom: 1, pan: [0.5, 0.5] }); return; }
      const r = c.getBoundingClientRect();
      const cr = cropRect(p.params.crop, p.params.cropCenter, p.w, p.h);
      const oneToOne = ((cr[2] - cr[0]) * p.w) / (r.width * (window.devicePixelRatio || 1));
      setState({ zoom: Math.max(2, oneToOne), pan: [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] });
    };
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('dblclick', dbl);
    return () => {
      c.removeEventListener('wheel', wheel);
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('dblclick', dbl);
    };
  }, []);

  const startSplitDrag = (e: React.PointerEvent) => {
    const c = canvas.current!;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = c.getBoundingClientRect();
      setState({ split: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) });
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const sim = photo ? SIM_BY_ID[photo.params.sim] : null;
  const isAuto = photo ? JSON.stringify(photo.params) === JSON.stringify(photo.auto) : false;
  const dr = photo ? resolveDR(photo.params, photo.stats) : 100;
  const left = canvas.current ? canvas.current.offsetLeft : 0;

  return (
    <div className="viewer" ref={box}>
      {photo && (
        <div className="chips">
          <span className="chip accent">◉ {sim!.dial}</span>
          <span className="chip">{isAuto ? 'LAB AUTO' : 'CUSTOM'}</span>
          <span className="chip">DR{dr}{photo.params.dr === 'auto' ? ' A' : ''}</span>
          {photo.vision.faces.length > 0 && <span className="chip">☺ {photo.vision.faces.length}</span>}
          {zoom > 1.01 && <span className="chip">{zoom.toFixed(1)}×</span>}
          {showOriginal && <span className="chip red">ORIGINAL</span>}
        </div>
      )}
      {error && <div className="card" style={{ maxWidth: 420 }}><b>Can’t start the darkroom</b><p style={{ color: 'var(--text-2)' }}>{error} Try a recent Chrome, Edge, Firefox or Safari.</p></div>}
      <div style={{ position: 'relative', width: size[0], height: size[1] }}>
        <canvas ref={canvas} className="photo" style={{ width: size[0], height: size[1], cursor: zoom > 1 ? 'grab' : 'zoom-in' }} />
        {split !== null && (
          <>
            <div className="split-handle" style={{ left: split * size[0] }} onPointerDown={startSplitDrag}>
              <div className="knob">⇆</div>
            </div>
            <span className="split-tag" style={{ left: 8 }}>ORIGINAL</span>
            <span className="split-tag" style={{ right: 8 }}>{sim?.dial}</span>
          </>
        )}
      </div>
      <div className="tools" data-left={left}>
        <button className={zoom === 1 ? 'on' : ''} onClick={() => setState({ zoom: 1, pan: [0.5, 0.5] })}>FIT</button>
        <button className={split !== null ? 'on' : ''} onClick={() => setState({ split: split === null ? 0.5 : null })}>BEFORE|AFTER</button>
        <button
          onPointerDown={() => setState({ showOriginal: true })}
          onPointerUp={() => setState({ showOriginal: false })}
          onPointerLeave={() => setState({ showOriginal: false })}
          title="Hold to see the original (or hold B)"
        >HOLD ORIG.</button>
        <button onClick={() => void exportActive()} title="Export (E)">EXPORT ↓</button>
      </div>
      {busy && <div className="busy chip accent">{busy}</div>}
    </div>
  );
}

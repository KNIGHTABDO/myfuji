import { useRef } from 'react';
import { resetAuto } from '../../actions';
import { resolveDR } from '../../engine/develop';
import type { DevelopParams, DrMode, Strength, WbMode } from '../../engine/film/types';
import { activePhoto, setState, updateParams, useStore } from '../../state';

const fmt = (v: number, step = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + (step < 1 ? Math.abs(v).toFixed(step === 0.5 ? 1 : 2).replace(/\.0$/, '') : Math.abs(v));
const cycle = <T,>(arr: readonly T[], v: T, d: number) => arr[(arr.indexOf(v) + d + arr.length) % arr.length];

interface TileProps { label: string; value: string; changed?: boolean; onStep: (d: 1 | -1) => void }
function Tile({ label, value, changed, onStep }: TileProps) {
  return (
    <div className={`qtile ${changed ? 'changed' : ''}`}>
      <span className="q-l">{label}</span>
      <span className="q-v">{value}</span>
      <div className="q-s"><button onClick={() => onStep(-1)} aria-label={`${label} down`}>−</button><button onClick={() => onStep(1)} aria-label={`${label} up`}>+</button></div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, fmtV, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmtV?: (v: number) => string; hint?: string }) {
  return (
    <div className="slider">
      <label>{label}</label>
      <output>{fmtV ? fmtV(value) : value}</output>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} aria-label={label} />
      {hint && <small>{hint}</small>}
    </div>
  );
}

function WbPad({ r, b, onChange }: { r: number; b: number; onChange: (r: number, b: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 18 - 9), y = Math.round(9 - ((e.clientY - rect.top) / rect.height) * 18);
    onChange(Math.max(-9, Math.min(9, x)), Math.max(-9, Math.min(9, y)));
  };
  return (
    <div ref={ref} className="wbpad" onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); set(e); }} onPointerMove={(e) => e.buttons && set(e)} onDoubleClick={() => onChange(0, 0)} title="White balance shift · double-click to centre">
      <span className="ax" style={{ right: 6, top: '50%' }}>R</span>
      <span className="ax" style={{ left: 6, top: '50%' }}>C</span>
      <span className="ax" style={{ left: '52%', top: 4 }}>B</span>
      <span className="ax" style={{ left: '52%', bottom: 4 }}>Y</span>
      <div className="dot" style={{ left: `${((r + 9) / 18) * 100}%`, top: `${((9 - b) / 18) * 100}%` }} />
    </div>
  );
}

const WB: WbMode[] = ['auto', 'auto-white', 'auto-ambience', 'as-shot', 'shade', 'incandescent', 'fluorescent', 'kelvin'];
const WB_NAME: Record<WbMode, string> = { auto: 'AUTO', 'auto-white': 'AUTO W', 'auto-ambience': 'AUTO AMB', 'as-shot': 'AS SHOT', shade: 'SHADE', incandescent: 'TUNGSTEN', fluorescent: 'FLUOR', kelvin: 'KELVIN' };
const GRAIN: Array<[Strength, 'small' | 'large']> = [['off', 'small'], ['weak', 'small'], ['weak', 'large'], ['strong', 'small'], ['strong', 'large']];
const STR: Strength[] = ['off', 'weak', 'strong'];
const DR: DrMode[] = ['auto', 100, 200, 400];

export function TunePanel() {
  const p = useStore(activePhoto);
  if (!p) return null;
  const v = p.params, a = p.auto;
  const set = (patch: Partial<DevelopParams>) => updateParams(patch);
  const mono = v.sim === 'acros' || v.sim === 'mono' || v.sim === 'sepia';
  const step = (key: 'highlight' | 'shadow' | 'color' | 'sharpness' | 'clarity', d: number, lo: number, hi: number, s = 1) => set({ [key]: Math.max(lo, Math.min(hi, +(v[key] + d * s).toFixed(2))) });
  const gi = GRAIN.findIndex(([g, sz]) => g === v.grain && (g === 'off' || sz === v.grainSize));
  return (
    <>
      <div className="section">
        <h3><span className="label">Q menu</span><button className="btn ghost small" onClick={resetAuto}>↺ Lab auto</button></h3>
        <div className="qgrid">
          <Tile label="Exposure" value={`${fmt(Math.round(v.exposure * 3) / 3, 0.33)} EV`} changed={v.exposure !== a.exposure} onStep={(d) => set({ exposure: Math.max(-3, Math.min(3, +(v.exposure + d / 3).toFixed(3))) })} />
          <Tile label="Dynamic range" value={v.dr === 'auto' ? `AUTO ${resolveDR(v, p.stats)}` : `DR${v.dr}`} changed={v.dr !== a.dr} onStep={(d) => set({ dr: cycle(DR, v.dr, d) })} />
          <Tile label="White balance" value={WB_NAME[v.wbMode]} changed={v.wbMode !== a.wbMode} onStep={(d) => set({ wbMode: cycle(WB, v.wbMode, d) })} />
          <Tile label="Highlight" value={fmt(v.highlight, 0.5)} changed={v.highlight !== a.highlight} onStep={(d) => step('highlight', d, -2, 4, 0.5)} />
          <Tile label="Shadow" value={fmt(v.shadow, 0.5)} changed={v.shadow !== a.shadow} onStep={(d) => step('shadow', d, -2, 4, 0.5)} />
          <Tile label="Color" value={mono ? 'B&W' : fmt(v.color)} changed={v.color !== a.color} onStep={(d) => step('color', d, -4, 4)} />
          <Tile label="Grain effect" value={v.grain === 'off' ? 'OFF' : `${v.grain.toUpperCase()} ${v.grainSize === 'small' ? 'S' : 'L'}`} changed={v.grain !== a.grain || v.grainSize !== a.grainSize} onStep={(d) => { const [g, sz] = GRAIN[(Math.max(0, gi) + d + GRAIN.length) % GRAIN.length]; set({ grain: g, grainSize: sz }); }} />
          <Tile label="Color chrome" value={v.cce.toUpperCase()} changed={v.cce !== a.cce} onStep={(d) => set({ cce: cycle(STR, v.cce, d) })} />
          <Tile label="CC FX blue" value={v.cceBlue.toUpperCase()} changed={v.cceBlue !== a.cceBlue} onStep={(d) => set({ cceBlue: cycle(STR, v.cceBlue, d) })} />
          <Tile label="Sharpness" value={fmt(v.sharpness)} changed={v.sharpness !== a.sharpness} onStep={(d) => step('sharpness', d, -4, 4)} />
          <Tile label="Clarity" value={fmt(v.clarity)} changed={v.clarity !== a.clarity} onStep={(d) => step('clarity', d, -5, 5)} />
          {mono
            ? <Tile label="Filter" value={{ std: 'STD', ye: 'YE', r: 'R', g: 'G' }[v.monoFilter]} changed={v.monoFilter !== a.monoFilter} onStep={(d) => set({ monoFilter: cycle(['std', 'ye', 'r', 'g'] as const, v.monoFilter, d) })} />
            : <Tile label="Film strength" value={`${Math.round(v.intensity * 100)}%`} changed={v.intensity !== 1} onStep={(d) => set({ intensity: Math.max(0, Math.min(1, +(v.intensity + d * 0.1).toFixed(2))) })} />}
        </div>
      </div>

      {v.wbMode === 'kelvin' && (
        <div className="section">
          <Slider label="Colour temperature" value={v.wbKelvin} min={2500} max={10000} step={100} onChange={(k) => set({ wbKelvin: k })} fmtV={(k) => `${k} K`} hint="Lower is cooler, as on the camera." />
        </div>
      )}

      <div className="section">
        <h3><span className="label">WB shift</span><span className="label">R {fmt(v.wbShiftR)} · B {fmt(v.wbShiftB)}</span></h3>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <WbPad r={v.wbShiftR} b={v.wbShiftB} onChange={(r, b) => set({ wbShiftR: r, wbShiftB: b })} />
          <p style={{ color: 'var(--text-3)', fontSize: 12, flex: 1, minWidth: 120, margin: 0 }}>Drag toward R to warm and toward B to cool, like the camera’s shift grid. Many film recipes live here: <span className="mono">R+2 B−4</span> is a warm negative.</p>
        </div>
      </div>

      {mono && (
        <div className="section">
          <h3><span className="label">Monochromatic colour</span></h3>
          <Slider label="Warm ↔ cool" value={v.monoWC} min={-9} max={9} step={1} onChange={(x) => set({ monoWC: x })} fmtV={(x) => fmt(x)} />
          <Slider label="Magenta ↔ green" value={v.monoMG} min={-9} max={9} step={1} onChange={(x) => set({ monoMG: x })} fmtV={(x) => fmt(x)} />
        </div>
      )}

      <div className="section">
        <h3><span className="label">Lab extras</span></h3>
        <Slider label="Smart light" value={v.smartLight} min={0} max={1} step={0.05} onChange={(x) => set({ smartLight: x })} fmtV={(x) => `${Math.round(x * 100)}%`} hint="Adaptive local tone mapping. Holds skies and opens shadows." />
        <Slider label="Subject lift" value={v.subjectLift} min={0} max={1} step={0.05} onChange={(x) => set({ subjectLift: x })} fmtV={(x) => `${Math.round(x * 100)}%`} hint={p.scene.subjectDeficit > 0.2 ? `Faces sit ${p.scene.subjectDeficit.toFixed(1)} EV under. This brings them up without touching the sky.` : 'Brightens faces and people found by the models.'} />
        {!mono && <Slider label="Film strength" value={v.intensity} min={0} max={1} step={0.05} onChange={(x) => set({ intensity: x })} fmtV={(x) => `${Math.round(x * 100)}%`} />}
        <Slider label="Halation" value={v.halation} min={0} max={1} step={0.05} onChange={(x) => set({ halation: x })} fmtV={(x) => `${Math.round(x * 100)}%`} hint="Red glow around highlights, as on film without an anti-halation layer." />
        <Slider label="Vignette" value={v.vignette} min={0} max={1} step={0.05} onChange={(x) => set({ vignette: x })} fmtV={(x) => `${Math.round(x * 100)}%`} />
        <Slider label="Fade" value={v.fade} min={0} max={1} step={0.05} onChange={(x) => set({ fade: x })} fmtV={(x) => `${Math.round(x * 100)}%`} hint="Lifted blacks and softer colour, like an old print." />
        <Slider label="Light leak" value={v.lightLeak} min={0} max={1} step={0.05} onChange={(x) => set({ lightLeak: x })} fmtV={(x) => `${Math.round(x * 100)}%`} />
        {v.lightLeak > 0 && <button className="btn small" onClick={() => set({ leakSeed: (v.leakSeed * 7 + 13) % 997 })}>↻ New leak</button>}
        <div className={`toggle ${v.skinProtect ? 'on' : ''}`} onClick={() => set({ skinProtect: !v.skinProtect })} role="switch" aria-checked={v.skinProtect}>
          <span>Skin-tone protection {p.vision.faces.length ? `(${p.vision.faces.length} face${p.vision.faces.length > 1 ? 's' : ''})` : ''}</span><i />
        </div>
      </div>
      <button className="btn ghost small" onClick={() => setState({ tab: 'film' })}>← Film simulations & recipes</button>
    </>
  );
}

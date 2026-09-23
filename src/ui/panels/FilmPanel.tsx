import { useEffect, useRef } from 'react';
import { applyCustom, applyPick, applyRecipe, clearCustom, saveCustom } from '../../actions';
import { RECIPES } from '../../engine/film/recipes';
import { SIM_BY_ID, SIMS } from '../../engine/film/sims';
import type { SimId } from '../../engine/film/types';
import { activePhoto, updateParams, useStore } from '../../state';
import { renderSimThumb } from '../../thumbs';

const ABBR: Record<SimId, string> = {
  provia: 'STD', velvia: 'V', astia: 'S', 'classic-chrome': 'CC', 'reala-ace': 'RA', 'pro-neg-hi': 'NH', 'pro-neg-std': 'NS',
  'classic-neg': 'NC', 'nostalgic-neg': 'NN', eterna: 'E', 'eterna-bb': 'EB', acros: 'A', mono: 'M', sepia: 'SEP',
};

function Dial({ value, onChange }: { value: SimId; onChange: (s: SimId) => void }) {
  const idx = SIMS.findIndex((s) => s.id === value);
  const step = 360 / SIMS.length;
  const R = 112;
  return (
    <svg width="280" height="200" viewBox="-140 -140 280 200" role="listbox" aria-label="Film simulation dial">
      <defs>
        <radialGradient id="dialG" cx="40%" cy="30%" r="80%"><stop offset="0" stopColor="#4a4540" /><stop offset=".6" stopColor="#2a2622" /><stop offset="1" stopColor="#1a1714" /></radialGradient>
      </defs>
      <circle r="134" fill="#141210" stroke="#2f2b26" />
      <g style={{ transform: `rotate(${-idx * step}deg)`, transition: 'transform .45s cubic-bezier(.3,1.3,.5,1)' }}>
        <circle r="128" fill="url(#dialG)" stroke="#57504a" strokeWidth="1" />
        {Array.from({ length: 96 }, (_, i) => {
          const a = (i / 96) * Math.PI * 2;
          return <line key={i} x1={Math.cos(a) * 124} y1={Math.sin(a) * 124} x2={Math.cos(a) * 128} y2={Math.sin(a) * 128} stroke="#6d665c" strokeWidth="1.2" />;
        })}
        {SIMS.map((s, i) => {
          const a = ((i * step - 90) * Math.PI) / 180;
          const on = s.id === value;
          return (
            <g key={s.id} transform={`translate(${Math.cos(a) * R * 0.82} ${Math.sin(a) * R * 0.82}) rotate(${i * step})`} style={{ cursor: 'pointer' }} onClick={() => onChange(s.id)} role="option" aria-selected={on}>
              <rect x="-18" y="-11" width="36" height="22" fill="transparent" />
              <text textAnchor="middle" dominantBaseline="middle" fontFamily="JetBrains Mono, monospace" fontWeight="700" fontSize={on ? 13 : 11} fill={on ? '#f0a33a' : s.family === 'mono' ? '#cfc8bd' : '#efe6d4'}>{ABBR[s.id]}</text>
            </g>
          );
        })}
        <circle r="46" fill="#1c1916" stroke="#3d3832" />
        <circle r="30" fill="#24201c" stroke="#3d3832" />
      </g>
      <path d="M0 -139 L-7 -152 L7 -152 Z" fill="#d9493f" transform="translate(0 16)" />
      <text y="4" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="9" letterSpacing="2" fill="#7c7466">FILM SIM</text>
    </svg>
  );
}

function ContactSheet() {
  const p = useStore(activePhoto);
  const refs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const key = p ? `${p.id}|${JSON.stringify({ ...p.params, sim: 0, grain: 0, crop: 0, cropCenter: 0 })}` : '';
  useEffect(() => {
    if (!p) return;
    let cancelled = false, i = 0;
    const next = () => {
      if (cancelled || i >= SIMS.length) return;
      const s = SIMS[i++];
      const c = refs.current[s.id];
      if (c) { try { renderSimThumb(p, p.params, s.id, c); } catch (e) { console.warn(e); } }
      setTimeout(next, 0);
    };
    const t = setTimeout(next, 180);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!p) return null;
  return (
    <div className="sim-grid">
      {SIMS.map((s) => (
        <button key={s.id} className={`sim-tile ${p.params.sim === s.id ? 'on' : ''}`} onClick={() => updateParams({ sim: s.id })} title={s.blurb}>
          <canvas ref={(el) => { refs.current[s.id] = el; }} width={240} height={180} />
          <span>{s.dial}</span>
        </button>
      ))}
    </div>
  );
}

export function FilmPanel() {
  const p = useStore(activePhoto);
  const customs = useStore((s) => s.customs);
  if (!p) return null;
  const [top, ...alts] = p.rec.picks;
  const sim = SIM_BY_ID[p.params.sim];
  const topSim = SIM_BY_ID[top.sim];
  return (
    <>
      <div className="section pick">
        <h3><span className="label">The lab’s pick</span><span className="label">from {SIMS.length} films</span></h3>
        <div className="card pick-main">
          <div className="rank">№1 FOR THIS PHOTO</div>
          <h4>{topSim.name}</h4>
          <div style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{topSim.blurb}</div>
          {top.reasons.length > 0 && <ul>{top.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          <button className="btn primary small" onClick={() => applyPick(top.sim)}>{p.params.sim === top.sim ? 'Re-tune to this photo' : 'Use it'}</button>
        </div>
        <div className="alts">
          {alts.slice(0, 4).map((a, i) => (
            <button key={a.sim} className="alt" onClick={() => applyPick(a.sim)} title={a.reasons.join(' · ')}>
              <small>№{i + 2}</small>
              <b>{SIM_BY_ID[a.sim].name}</b>
              <small>{a.reasons[0] ?? SIM_BY_ID[a.sim].character.join(', ')}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <h3><span className="label">Simulation dial</span><span className="label">[ ] to turn</span></h3>
        <div className="dial-wrap"><Dial value={p.params.sim} onChange={(s) => updateParams({ sim: s })} /></div>
        <div className="dial-readout"><b>{sim.name}</b><span>{sim.blurb}</span></div>
      </div>

      <div className="section">
        <h3><span className="label">Contact sheet</span><span className="label">your settings × every film</span></h3>
        <ContactSheet />
      </div>

      <div className="section">
        <h3><span className="label">Recipes</span><span className="label">tuned to this frame</span></h3>
        <div className="recipes">
          {RECIPES.map((r) => (
            <button key={r.id} className={`recipe ${p.rec.recipe?.id === r.id ? 'suggested' : ''}`} onClick={() => applyRecipe(r)}>
              <b>{r.name}</b>
              <small>{r.mood}</small>
              <span className="tag">{p.rec.recipe?.id === r.id ? '★ SUGGESTED' : SIM_BY_ID[r.params.sim!].dial}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <h3><span className="label">Custom settings · C1–C7</span><span className="label">click to load · ⇧click to save</span></h3>
        <div className="customs">
          {customs.map((c, i) => (
            <button
              key={i}
              className={`cslot ${c ? 'full' : ''}`}
              title={c ? `${c.name} (shift-click to overwrite, right-click to clear)` : 'Empty: click to save the current settings'}
              onClick={(e) => (c && !e.shiftKey ? applyCustom(i) : saveCustom(i))}
              onContextMenu={(e) => { e.preventDefault(); if (c) clearCustom(i); }}
            >C{i + 1}</button>
          ))}
        </div>
      </div>
    </>
  );
}

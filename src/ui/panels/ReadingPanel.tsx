import { fmtShutter } from '../../engine/exif';
import { resolveDR } from '../../engine/develop';
import { activePhoto, useStore } from '../../state';
import { Histogram } from '../Histogram';

const SUBJECT: Record<string, string> = {
  portrait: 'Portrait', group: 'Group', people: 'People', street: 'Street', landscape: 'Landscape', architecture: 'Architecture', food: 'Food',
  animal: 'Animal', nature: 'Nature', 'night-city': 'City night', interior: 'Interior', vehicle: 'Vehicle', beach: 'Seaside', snow: 'Snow', 'still-life': 'Still life', general: 'Everyday',
};
const LIGHT: Record<string, string> = {
  'golden-hour': 'Golden hour', 'blue-hour': 'Blue hour', night: 'Night', tungsten: 'Tungsten', fluorescent: 'Fluorescent / mixed', overcast: 'Overcast',
  'harsh-sun': 'Hard sun', daylight: 'Daylight', backlit: 'Backlit', 'low-key': 'Low key', 'high-key': 'High key', neon: 'Neon',
};

export function ReadingPanel() {
  const p = useStore(activePhoto);
  if (!p) return null;
  const { stats: st, scene: sc, exif: e, vision: v } = p;
  const cctPos = Math.min(1, Math.max(0, (st.cct - 2000) / 9000));
  const camera = [e.make && !e.model?.startsWith(e.make) ? e.make : '', e.model].filter(Boolean).join(' ');
  const time = sc.time;
  const timeLabel = time.source === 'sun' ? `sun ${time.sunElevation!.toFixed(0)}°` : time.source === 'clock' ? `${String(Math.floor(time.hour!)).padStart(2, '0')}:${String(Math.round((time.hour! % 1) * 60)).padStart(2, '0')} clock` : 'inferred';
  return (
    <>
      <div className="section">
        <h3><span className="label">The lab’s reading</span><span className="label">{p.kind.toUpperCase()} · {p.origW}×{p.origH}</span></h3>
        <p className="story">{sc.story}</p>
        <div className="scene-chips">
          <span className="chip accent">{SUBJECT[sc.subject]}</span>
          <span className="chip accent">{LIGHT[sc.lighting]}</span>
          <span className="chip">{time.inferred.replace('-', ' ')} · {timeLabel}</span>
          {!v.available && <span className="chip red">pixel analysis only</span>}
        </div>
        <ul className="facts">{sc.facts.map((f) => <li key={f}>{f}</li>)}</ul>
      </div>

      <div className="section">
        <h3><span className="label">Palette</span><span className="label">colourfulness {Math.round(st.colorfulness)}</span></h3>
        <div className="palette">
          {st.palette.map((s) => (
            <div className="swatch" key={s.hex + s.share} title={`${s.hex} · ${Math.round(s.share * 100)}%`}>
              <i style={{ background: s.hex }} />
              <span>{s.name}<br />{Math.round(s.share * 100)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <h3><span className="label">Histogram · developed</span></h3>
        <Histogram />
      </div>

      <div className="section">
        <h3><span className="label">Light</span><span className="label">{Math.round(st.cct / 50) * 50} K</span></h3>
        <div className="meter"><div className="mark" style={{ left: `calc(${cctPos * 100}% - 1.5px)` }} /></div>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}><span className="label">2000K candle</span><span className="label">daylight</span><span className="label">11000K shade</span></div>
        <dl className="kv" style={{ marginTop: 14 }}>
          <dt>Scene range</dt><dd>{st.drStops.toFixed(1)} stops → DR{resolveDR(p.params, st)}</dd>
          <dt>Key (mid-grey)</dt><dd>{(st.key * 100).toFixed(1)}%</dd>
          <dt>Contrast</dt><dd>{st.contrast.toFixed(2)} σ</dd>
          <dt>Clipped</dt><dd>{(st.clipHigh * 100).toFixed(1)}% hi · {(st.clipLow * 100).toFixed(1)}% lo</dd>
          <dt>Tint</dt><dd>{st.tint > 0.03 ? 'green' : st.tint < -0.03 ? 'magenta' : 'neutral'} ({st.tint.toFixed(2)})</dd>
          <dt>Sky</dt><dd>{st.sky.kind === 'none' ? '—' : `${st.sky.kind} · ${Math.round(st.sky.fraction * 100)}%`}</dd>
          <dt>Noise</dt><dd>{st.noise.toFixed(1)} {st.noise > 3.2 ? '· high' : ''}</dd>
          {sc.faceLum !== null && <><dt>Faces</dt><dd>{(sc.faceLum * 100).toFixed(0)}% lum · lift {sc.subjectDeficit.toFixed(1)} EV</dd></>}
        </dl>
      </div>

      {v.available && (
        <div className="section">
          <h3><span className="label">What the models saw</span></h3>
          <div className="bars">
            {v.labels.slice(0, 5).map((l) => (
              <div className="bar" key={l.name}>
                <div className="name"><span>{l.name.split(',')[0]}</span><b>{Math.round(l.score * 100)}%</b></div>
                <div className="track"><i style={{ width: `${Math.min(100, l.score * 100)}%` }} /></div>
              </div>
            ))}
          </div>
          {v.objects.length > 0 && <p style={{ color: 'var(--text-2)', fontSize: 12.5 }}>Objects: {[...new Set(v.objects.map((o) => o.name))].join(', ')}</p>}
        </div>
      )}

      <div className="section">
        <h3><span className="label">Negative sleeve · EXIF</span></h3>
        <div className="card">
          <dl className="kv">
            <dt>File</dt><dd title={p.name}>{p.name}</dd>
            <dt>Camera</dt><dd>{camera || '—'}</dd>
            <dt>Lens</dt><dd>{e.lens || '—'}</dd>
            <dt>Exposure</dt><dd>{[e.focal ? `${Math.round(e.focal)}mm` : '', e.fNumber ? `f/${e.fNumber}` : '', fmtShutter(e.exposureTime), e.iso ? `ISO ${e.iso}` : ''].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Taken</dt><dd>{e.taken ? e.taken.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd>
            <dt>Where</dt><dd>{e.lat !== undefined ? `${e.lat.toFixed(2)}, ${e.lon!.toFixed(2)}` : '—'}</dd>
            <dt>Worked at</dt><dd>{p.w}×{p.h}</dd>
          </dl>
          {p.notes.map((n) => <p key={n} className="label" style={{ marginTop: 10, lineHeight: 1.5 }}>{n}</p>)}
        </div>
      </div>
    </>
  );
}

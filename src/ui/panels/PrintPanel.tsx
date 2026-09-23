import { exportActive, exportRoll } from '../../actions';
import { cropRect } from '../../engine/develop';
import { FRAMES, frameAspect, outputSize, type FrameId, type SizeId } from '../../engine/export';
import type { CropId } from '../../engine/film/types';
import { activePhoto, setState, updateParams, useStore } from '../../state';

const CROPS: Array<[CropId, string]> = [['original', 'Original'], ['3:2', '3:2'], ['4:3', '4:3'], ['4:5', '4:5'], ['1:1', '1:1'], ['16:9', '16:9'], ['65:24', 'XPan 65:24']];
const SIZES: Array<[SizeId, string]> = [['full', 'Full'], ['4k', '4K'], ['2k', '2K'], ['1080', '1080']];

function Mini({ id }: { id: FrameId }) {
  const ph = (w: number, h: number) => <div className="ph" style={{ width: w, height: h }} />;
  switch (id) {
    case 'none': return ph(52, 36);
    case 'border': return <div style={{ background: '#f7f4ee', padding: 4 }}>{ph(44, 30)}</div>;
    case 'caption': return <div style={{ background: '#fbfaf7', padding: '4px 4px 10px' }}>{ph(44, 28)}</div>;
    case 'film35': return <div style={{ background: '#111', padding: '7px 2px', backgroundImage: 'radial-gradient(circle,#ddd 1.2px,transparent 1.4px)', backgroundSize: '6px 6px', backgroundRepeat: 'repeat-x', backgroundPosition: '0 1px' }}>{ph(48, 30)}</div>;
    case 'instant': return <div style={{ background: '#f4f1ea', padding: '3px 3px 12px' }}>{ph(28, 36)}</div>;
    case 'instant-square': return <div style={{ background: '#f4f1ea', padding: '3px 3px 10px' }}>{ph(32, 32)}</div>;
  }
}

export function PrintPanel() {
  const p = useStore(activePhoto);
  const o = useStore((s) => s.exportOpts);
  const count = useStore((s) => s.photos.length);
  const busy = useStore((s) => s.busy);
  if (!p) return null;
  const setO = (patch: Partial<typeof o>) => setState((s) => ({ exportOpts: { ...s.exportOpts, ...patch } }));
  const fa = frameAspect(o.frame, p.w >= p.h);
  const cr = cropRect(p.params.crop, p.params.cropCenter, p.w, p.h, fa ?? undefined);
  const [ow, oh] = outputSize((cr[2] - cr[0]) * p.w, (cr[3] - cr[1]) * p.h, o.size);
  const canShare = typeof navigator.canShare === 'function';
  return (
    <>
      <div className="section">
        <h3><span className="label">Crop</span><span className="label">{p.vision.faces.length ? 'centred on faces' : 'centred on subject'}</span></h3>
        <div className="seg">
          {CROPS.map(([id, name]) => <button key={id} className={p.params.crop === id ? 'on' : ''} onClick={() => updateParams({ crop: id })}>{name}</button>)}
        </div>
        {fa && <p className="label" style={{ marginTop: 8 }}>This frame style sets its own crop.</p>}
      </div>

      <div className="section">
        <h3><span className="label">Print style</span></h3>
        <div className="frames">
          {FRAMES.map((f) => (
            <button key={f.id} className={`frame-opt ${o.frame === f.id ? 'on' : ''}`} onClick={() => setO({ frame: f.id })} title={f.hint}>
              <div className="mini"><Mini id={f.id} /></div>
              <b>{f.name}</b>
            </button>
          ))}
        </div>
        <div className={`toggle ${o.dateStamp ? 'on' : ''}`} onClick={() => setO({ dateStamp: !o.dateStamp })} role="switch" aria-checked={o.dateStamp} style={{ marginTop: 10 }}>
          <span>’98 date stamp <span className="label">({p.exif.taken ? 'from EXIF' : 'today'})</span></span><i />
        </div>
      </div>

      <div className="section">
        <h3><span className="label">File</span><span className="label">{ow}×{oh}px</span></h3>
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="seg">{SIZES.map(([id, n]) => <button key={id} className={o.size === id ? 'on' : ''} onClick={() => setO({ size: id })}>{n}</button>)}</div>
          <div className="seg">{(['jpeg', 'png', 'webp'] as const).map((f) => <button key={f} className={o.format === f ? 'on' : ''} onClick={() => setO({ format: f })}>{f.toUpperCase()}</button>)}</div>
        </div>
        {o.format !== 'png' && (
          <div className="slider">
            <label>Quality</label><output>{Math.round(o.quality * 100)}</output>
            <input type="range" min={0.6} max={1} step={0.01} value={o.quality} onChange={(e) => setO({ quality: +e.target.value })} />
          </div>
        )}
        <div className="export-cta">
          <button className="btn red" onClick={() => void exportActive()} disabled={!!busy}>Export this print</button>
          {canShare && <button className="btn" onClick={() => void exportActive(true)} disabled={!!busy}>Share…</button>}
          {count > 1 && <button className="btn" onClick={() => void exportRoll()} disabled={!!busy}>Export the whole roll ({count}) as .zip</button>}
        </div>
        <p className="label" style={{ marginTop: 12, lineHeight: 1.6 }}>Developed on your GPU at full resolution. Nothing leaves your device.</p>
      </div>
    </>
  );
}

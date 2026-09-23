import { useEffect, useRef, useState } from 'react';
import { enqueue, exportActive, stepPhoto, stepSim } from '../actions';
import { getState, setState, useStore } from '../state';
import { Darkroom } from './Darkroom';
import { DevelopOverlay } from './DevelopOverlay';
import { Header } from './Header';
import { Home } from './Home';

export function App() {
  const hasPhotos = useStore((s) => s.photos.length > 0);
  const developing = useStore((s) => s.developing);
  const toasts = useStore((s) => s.toasts);
  const help = useStore((s) => s.help);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const openPicker = () => input.current?.click();

  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth++; setDragging(true); };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault(); depth = 0; setDragging(false);
      enqueue(Array.from(e.dataTransfer!.files));
    };
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) enqueue(files);
    };
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const s = getState();
      if (e.key === '?') setState({ help: !s.help });
      else if (e.key === 'Escape') setState({ help: false });
      else if (e.key === 'o' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openPicker(); }
      if (!s.activeId) return;
      if (e.key === 'ArrowRight') stepPhoto(1);
      else if (e.key === 'ArrowLeft') stepPhoto(-1);
      else if (e.key === ']') stepSim(1);
      else if (e.key === '[') stepSim(-1);
      else if (e.key === 'b' || e.key === 'B') { if (!e.repeat) setState({ showOriginal: true }); }
      else if (e.key === 'c' || e.key === 'C') setState({ split: s.split === null ? 0.5 : null });
      else if (e.key === '0') setState({ zoom: 1, pan: [0.5, 0.5] });
      else if (e.key === 'e' || e.key === 'E') void exportActive();
      else if (['1', '2', '3', '4'].includes(e.key)) setState({ tab: (['reading', 'film', 'tune', 'print'] as const)[+e.key - 1] });
    };
    const keyUp = (e: KeyboardEvent) => { if (e.key === 'b' || e.key === 'B') setState({ showOriginal: false }); };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', keyUp);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', keyUp);
    };
  }, []);

  return (
    <div className="app">
      <Header onOpen={openPicker} />
      <main style={{ minHeight: 0 }}>{hasPhotos ? <Darkroom onOpen={openPicker} /> : <Home onOpen={openPicker} />}</main>
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif,.tif,.tiff,.dng,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2,.pef,.srw"
        multiple
        hidden
        onChange={(e) => { enqueue(Array.from(e.target.files ?? [])); e.target.value = ''; }}
      />
      {developing && <DevelopOverlay />}
      {dragging && <div className="drop-hint">Drop to develop</div>}
      {help && <HelpSheet />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone === 'err' ? 'err' : ''}`}>{t.text}</div>)}
      </div>
    </div>
  );
}

function HelpSheet() {
  const rows: Array<[string, string]> = [
    ['⌘/Ctrl O', 'Load photos (or drop / paste them anywhere)'],
    ['← →', 'Previous / next frame on the roll'],
    ['[ ]', 'Previous / next film simulation'],
    ['hold B', 'See the original'],
    ['C', 'Before / after split'],
    ['0', 'Fit to screen · scroll to zoom · drag to pan'],
    ['1 – 4', 'Reading · Film · Tune · Print'],
    ['E', 'Export the print'],
  ];
  return (
    <div className="overlay" onClick={() => setState({ help: false })}>
      <div className="help" onClick={(e) => e.stopPropagation()}>
        <h2>Darkroom shortcuts</h2>
        <table><tbody>{rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
        <p className="label" style={{ marginTop: 16, lineHeight: 1.6 }}>Everything runs on your device. Photos are never uploaded.</p>
      </div>
    </div>
  );
}

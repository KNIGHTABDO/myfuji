import { removePhoto } from '../actions';
import { setState, useStore, type Tab } from '../state';
import { FilmPanel } from './panels/FilmPanel';
import { PrintPanel } from './panels/PrintPanel';
import { ReadingPanel } from './panels/ReadingPanel';
import { TunePanel } from './panels/TunePanel';
import { Viewer } from './Viewer';

const TABS: Array<[Tab, string]> = [['reading', 'Reading'], ['film', 'Film'], ['tune', 'Tune'], ['print', 'Print']];

export function Darkroom({ onOpen }: { onOpen: () => void }) {
  const tab = useStore((s) => s.tab);
  return (
    <div className="darkroom">
      <div className="stage"><Viewer /></div>
      <aside className="side">
        <nav className="tabs" role="tablist">
          {TABS.map(([id, name], i) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setState({ tab: id })} title={`${name} (${i + 1})`}>{name}</button>
          ))}
        </nav>
        <div className="panel">
          {tab === 'reading' && <ReadingPanel />}
          {tab === 'film' && <FilmPanel />}
          {tab === 'tune' && <TunePanel />}
          {tab === 'print' && <PrintPanel />}
        </div>
      </aside>
      <RollStrip onOpen={onOpen} />
    </div>
  );
}

function RollStrip({ onOpen }: { onOpen: () => void }) {
  const photos = useStore((s) => s.photos);
  const active = useStore((s) => s.activeId);
  return (
    <div className="roll">
      <span className="count">ROLL · {String(photos.length).padStart(2, '0')}/36</span>
      {photos.map((p, i) => (
        <div key={p.id} className={`frame ${p.id === active ? 'on' : ''}`} onClick={() => setState({ activeId: p.id, zoom: 1, pan: [0.5, 0.5] })} title={p.name}>
          <img src={p.thumb} alt={p.name} draggable={false} />
          <span className="no">{i + 1}A ▸ {p.params.sim.toUpperCase()}</span>
          <button className="x" title="Remove from roll" onClick={(e) => { e.stopPropagation(); removePhoto(p.id); }}>×</button>
        </div>
      ))}
      <button className="add" onClick={onOpen}>+ ADD</button>
    </div>
  );
}

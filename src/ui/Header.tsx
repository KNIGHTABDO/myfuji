import { setState, useStore } from '../state';

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="27" fill="#1c1a17" stroke="#3d3832" strokeWidth="2" />
      <circle cx="32" cy="32" r="19" fill="none" stroke="#efe6d4" strokeWidth="2.5" />
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        return <line key={i} x1={32 + Math.cos(a) * 22} y1={32 + Math.sin(a) * 22} x2={32 + Math.cos(a) * 25.5} y2={32 + Math.sin(a) * 25.5} stroke="#6b645a" strokeWidth="1.4" />;
      })}
      <circle cx="32" cy="32" r="11" fill="#0d1117" stroke="#efe6d4" strokeWidth="1.5" />
      <circle cx="35.5" cy="28.5" r="3" fill="#9fb7d0" opacity=".7" />
      <circle cx="51" cy="13" r="4" fill="#d9493f" />
    </svg>
  );
}

export function Header({ onOpen }: { onOpen: () => void }) {
  const sound = useStore((s) => s.sound);
  const count = useStore((s) => s.photos.length);
  return (
    <header className="header">
      <div className="brand">
        <Logo />
        <span>myfuji<span className="dot">.</span></span>
        <small>a film darkroom in your browser</small>
      </div>
      <div className="spacer" />
      {count > 0 && <span className="label hide-sm" style={{ marginRight: 4 }}>{count} frame{count > 1 ? 's' : ''} on the roll</span>}
      <button className={`icon-btn ${sound ? 'on' : ''}`} title={sound ? 'Sound on (mosquito buzz & shutter)' : 'Sound off'} onClick={() => setState({ sound: !sound })} aria-pressed={sound}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 10v4h4l5 4V6L8 10H4z" />
          {sound ? <><path d="M16 9c1.2 1.6 1.2 4.4 0 6" /><path d="M19 6.5c2.4 3 2.4 8 0 11" /></> : <path d="M17 9l5 6M22 9l-5 6" />}
        </svg>
      </button>
      <button className="icon-btn" title="Shortcuts (?)" onClick={() => setState({ help: true })}>?</button>
      <button className="btn primary" onClick={onOpen}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        <span>Load <span className="hide-sm">photos</span></span>
      </button>
    </header>
  );
}

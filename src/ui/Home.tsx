import { useEffect, useRef, useState } from 'react';
import { IdleScene } from '../mosquito/IdleScene';

const POINTS: Array<[string, string]> = [
  ['Reads the photo', 'Faces, objects, sky, light, colour temperature and time of day, all found on your device.'],
  ['Picks the film', 'Scores all 14 Fuji-style simulations against what it saw, then explains its choice.'],
  ['Tunes like a camera', 'Grain, colour chrome, DR, highlight and shadow tone, white-balance shift. The whole Q menu.'],
  ['Prints it', 'Full resolution, with 35mm strips, instant frames, EXIF captions or a ’98 date stamp.'],
];

export function Home({ onOpen }: { onOpen: () => void }) {
  const layer = useRef<HTMLCanvasElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!layer.current) return;
    const scene = new IdleScene(layer.current, () => zone.current?.getBoundingClientRect() ?? null);
    return () => scene.dispose();
  }, []);
  return (
    <div className="home">
      <canvas ref={layer} className="idle-layer" aria-hidden />
      <div className="home-inner">
        <section>
          <span className="label">film simulation lab · no sign-up · runs offline</span>
          <h1>Every photo has<br />a <em>film</em> it was<br />meant for.</h1>
          <p className="lead">
            Drop in any image: a phone snap at noon, a neon street at 2 am, a RAW from your camera. myfuji studies it the way a lab tech would, then develops it with the film that suits it.
          </p>
          <button className="btn red" onClick={onOpen} style={{ padding: '12px 20px', fontSize: 15 }}>Develop a photo</button>
          <ul className="points">
            {POINTS.map(([b, t], i) => (
              <li key={b}><span className="n">0{i + 1}</span><span><b>{b}</b>{t}</span></li>
            ))}
          </ul>
        </section>
        <div
          ref={zone}
          className={`dropzone ${over ? 'over' : ''}`}
          role="button"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
          onDragEnter={() => setOver(true)}
          onDragLeave={() => setOver(false)}
          onDrop={() => setOver(false)}
        >
          <div className="knurl top" />
          <div style={{ width: '100%' }}>
            <div className="lens"><span>XF 23 · 1:2</span></div>
            <div className="cta">Drop photos here</div>
            <div className="sub">or click, or paste. Several at once makes a roll.</div>
            <div className="formats">JPEG · PNG · HEIC · WEBP · AVIF · TIFF · RAW*</div>
          </div>
          <div className="knurl bottom" />
        </div>
      </div>
    </div>
  );
}

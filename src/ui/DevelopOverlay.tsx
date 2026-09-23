import { useEffect, useRef } from 'react';
import { STAGES } from '../engine/pipeline';
import { ProgressScene } from '../mosquito/ProgressScene';
import { progress } from '../progressBus';
import { getState } from '../state';

export function DevelopOverlay() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const scene = new ProgressScene(ref.current, STAGES, getState().sound);
    progress.attach(scene);
    return () => { progress.detach(scene); scene.dispose(); };
  }, []);
  return (
    <div className="overlay" role="dialog" aria-label="Developing photo">
      <div className="develop-card">
        <canvas ref={ref} />
        <div className="tape" />
      </div>
    </div>
  );
}

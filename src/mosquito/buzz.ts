// A tiny synthesised mosquito whine: two detuned saws through a band-pass,
// with a slow wobble. Only used when the user switches sound on.
export class Buzz {
  private ac: AudioContext | null = null;
  private gain: GainNode | null = null;
  private pan: StereoPannerNode | null = null;
  private oscs: OscillatorNode[] = [];

  private ensure() {
    if (this.ac) return;
    const ac = new AudioContext();
    const gain = ac.createGain();
    gain.gain.value = 0;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.4;
    const pan = ac.createStereoPanner();
    const lfo = ac.createOscillator(), lfoGain = ac.createGain();
    lfo.frequency.value = 5.3; lfoGain.gain.value = 18;
    lfo.connect(lfoGain);
    for (const f of [470, 476, 941]) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      lfoGain.connect(o.frequency);
      const g = ac.createGain();
      g.gain.value = f > 900 ? 0.25 : 0.5;
      o.connect(g).connect(bp);
      o.start();
      this.oscs.push(o);
    }
    lfo.start();
    this.oscs.push(lfo);
    bp.connect(gain).connect(pan).connect(ac.destination);
    Object.assign(this, { ac, gain, pan });
  }

  set(level: number, x: number) {
    if (level > 0) this.ensure();
    if (!this.ac || !this.gain || !this.pan) return;
    const t = this.ac.currentTime;
    this.gain.gain.setTargetAtTime(level * 0.035, t, 0.06);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, x * 2 - 1)) * 0.7, t, 0.1);
  }

  stop() {
    this.oscs.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } });
    this.ac?.close();
    this.ac = null;
  }
}

/** A short shutter "clack" for exports. */
export function shutterSound() {
  const ac = new AudioContext();
  const len = Math.floor(ac.sampleRate * 0.09);
  const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  let s = 1;
  for (let i = 0; i < len; i++) {
    s = (s * 16807) % 2147483647;
    const n = (s / 2147483647) * 2 - 1;
    const env = i < len * 0.08 ? 1 : i < len * 0.5 ? 0.25 : Math.max(0, 1 - (i - len * 0.5) / (len * 0.5)) * 0.8;
    d[i] = n * env * (i > len * 0.55 && i < len * 0.62 ? 2.2 : 1);
  }
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  f.type = 'highpass'; f.frequency.value = 1200; g.gain.value = 0.35;
  src.buffer = buf;
  src.connect(f).connect(g).connect(ac.destination);
  src.start();
  src.onended = () => ac.close();
}

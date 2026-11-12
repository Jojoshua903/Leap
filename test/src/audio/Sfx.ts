import { Mixer } from './Mixer';

/**
 * Game and UI sound effects, all synthesised. Everything routes through the shared Mixer,
 * so volume sliders, mute and ducking apply. Calls before audio is unlocked are ignored.
 */
export class Sfx {
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private gutterGain: GainNode | null = null;
  private loops: AudioBufferSourceNode[] = [];

  constructor() { Mixer.whenReady(() => this.buildLoops()); }

  private buildLoops(): void {
    const ctx = Mixer.ctx, out = Mixer.sfxBus;
    if (!ctx || !out) return;
    // continuous roll: looping noise through a low-pass whose cutoff follows ball speed
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.Q.value = 4;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    this.loop(this.rollFilter);
    this.rollFilter.connect(this.rollGain).connect(out);

    // gutter rumble: lower and boomier
    const gf = ctx.createBiquadFilter();
    gf.type = 'lowpass'; gf.frequency.value = 160; gf.Q.value = 6;
    this.gutterGain = ctx.createGain();
    this.gutterGain.gain.value = 0;
    this.loop(gf);
    gf.connect(this.gutterGain).connect(out);
  }

  private loop(into: AudioNode): void {
    const ctx = Mixer.ctx, noise = Mixer.noise;
    if (!ctx || !noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise; src.loop = true;
    src.connect(into); src.start();
    this.loops.push(src);
  }

  /** Kept for older call sites: unlocking now lives in the Mixer. */
  resume(): void { Mixer.unlock(); }

  /** Rolling sound; speed in m/s, 0 = silent. */
  setRoll(speed: number): void {
    if (!Mixer.ctx || !this.rollGain || !this.rollFilter) return;
    const t = Mixer.now;
    this.rollGain.gain.setTargetAtTime(speed > 0.15 ? Math.min(0.32, 0.05 + speed * 0.025) : 0, t, 0.06);
    this.rollFilter.frequency.setTargetAtTime(160 + speed * 70, t, 0.08);
  }

  setGutter(on: boolean, speed = 0): void {
    if (!Mixer.ctx || !this.gutterGain) return;
    this.gutterGain.gain.setTargetAtTime(on ? Math.min(0.5, 0.15 + speed * 0.04) : 0, Mixer.now, 0.05);
  }

  /** Silence the continuous loops (pause, leaving a match). */
  stopLoops(): void { this.setRoll(0); this.setGutter(false); }

  private burst(freq: number, q: number, gain: number, dur: number, when = 0, rate = 1): void {
    const ctx = Mixer.ctx, noise = Mixer.noise, out = Mixer.sfxBus;
    if (!ctx || !noise || !out) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noise; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number): void {
    const ctx = Mixer.ctx, out = Mixer.sfxBus;
    if (!ctx || !out) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /* ---------- bowling ---------- */

  /** Ball meets pins: low thud plus a layered wooden clatter. intensity 0..1, `big` for the 100-pin wall. */
  crash(intensity: number, big = false): void {
    const k = Math.max(0.15, Math.min(1, intensity));
    this.tone(90, 0.25, 'sine', 0.6 * k, 0, 45);
    const n = (big ? 12 : 4) + Math.round(k * (big ? 14 : 6));
    for (let i = 0; i < n; i++) {
      this.burst(900 + Math.random() * 2600, 3 + Math.random() * 5, (big ? 0.22 : 0.35) * k, 0.12 + Math.random() * 0.25,
        Math.random() * (big ? 0.6 : 0.18) * k, 0.8 + Math.random() * 0.6);
    }
  }

  /** Small pin-on-pin knock. */
  knock(intensity: number): void {
    this.burst(1400 + Math.random() * 1800, 6, 0.18 * Math.min(1, intensity), 0.09, 0, 1.2);
  }

  thud(): void { this.tone(70, 0.35, 'sine', 0.5, 0, 40); this.burst(300, 1, 0.2, 0.2); }
  release(): void { this.burst(500, 1.5, 0.15, 0.12); }

  private arpeggio(notes: number[], step: number, type: OscillatorType, gain: number): void {
    notes.forEach((n, i) => this.tone(n, 0.22, type, gain, i * step));
  }
  strike(): void { this.arpeggio([523, 659, 784, 1047, 1319, 1568], 0.07, 'square', 0.07); }
  spare(): void { this.arpeggio([523, 659, 784, 1047], 0.09, 'triangle', 0.12); }
  gutterSad(): void { this.tone(330, 0.5, 'triangle', 0.1, 0, 196); }
  bonus(): void { this.arpeggio([784, 988, 1175, 1568, 1976], 0.06, 'triangle', 0.1); }

  /* ---------- UI ---------- */

  click(): void { this.tone(1200, 0.05, 'triangle', 0.12); }
  tick(): void { this.tone(1320, 0.03, 'sine', 0.06); }
  select(): void { [784, 1047, 1319].forEach((f, i) => this.tone(f, 0.1, 'triangle', 0.08, i * 0.06)); }
  back(): void { [660, 440].forEach((f, i) => this.tone(f, 0.08, 'triangle', 0.07, i * 0.06)); }
  error(): void { this.tone(220, 0.18, 'square', 0.05, 0, 180); }
  toggle(on: boolean): void { this.tone(on ? 880 : 660, 0.06, 'triangle', 0.08, 0, on ? 1100 : 520); }
  pop(): void { this.tone(500, 0.08, 'sine', 0.12, 0, 900); }
  levelUp(): void { this.arpeggio([523, 659, 784, 659, 784, 1047], 0.08, 'triangle', 0.1); }
  achievement(): void { this.arpeggio([988, 1319, 1568], 0.1, 'sine', 0.12); this.tone(1976, 0.5, 'sine', 0.05, 0.3); }
}

export const sfx = new Sfx();

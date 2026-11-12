import { Mixer, setAmbience } from './Mixer';

/**
 * Synthesised crowd: a cheer (swelling filtered noise with whistles and claps) and a disappointed "aww"
 * (a falling formant). Both duck the music for their length.
 */
class CrowdImpl {
  private noiseVoice(t: number, dur: number, freqFrom: number, freqTo: number, q: number, peak: number, attack: number): void {
    const ctx = Mixer.ctx, buf = Mixer.noise, out = Mixer.sfxBus;
    if (!ctx || !buf || !out) return;
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(freqFrom, t); f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random()); s.stop(t + dur + 0.1);
  }

  private whistle(t: number): void {
    const ctx = Mixer.ctx, out = Mixer.sfxBus;
    if (!ctx || !out) return;
    const o = ctx.createOscillator(); o.type = 'sine';
    const f0 = 1800 + Math.random() * 900;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + 0.18);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.1, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.5);
  }

  private clap(t: number): void { this.noiseVoice(t, 0.06, 1500, 1400, 1.2, 0.08, 0.003); }

  /** intensity 0..1: a spare is ~0.5, a strike 1. */
  cheer(intensity = 1): void {
    const ctx = Mixer.ctx;
    if (!ctx) return;
    const k = Math.max(0.3, Math.min(1, intensity));
    const t = ctx.currentTime, dur = 1.6 + 1.2 * k;
    Mixer.duck(dur);
    this.noiseVoice(t, dur, 700, 1000, 0.8, 0.22 * k, 0.25);
    this.noiseVoice(t + 0.05, dur * 0.9, 1800, 2400, 1.5, 0.1 * k, 0.3);
    const claps = Math.round(10 + 20 * k);
    for (let i = 0; i < claps; i++) this.clap(t + 0.2 + Math.random() * (dur - 0.6));
    for (let i = 0; i < Math.round(1 + 3 * k); i++) this.whistle(t + 0.2 + Math.random() * 0.9);
  }

  aww(): void {
    const ctx = Mixer.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, dur = 1.4;
    Mixer.duck(dur);
    // Two formants sliding down give the "aww" vowel.
    this.noiseVoice(t, dur, 800, 420, 6, 0.16, 0.15);
    this.noiseVoice(t, dur, 1250, 800, 7, 0.08, 0.15);
    this.noiseVoice(t, dur, 300, 220, 3, 0.1, 0.2);
  }

  /** Short rising "ooh" (net cords, near misses). */
  ooh(): void {
    const ctx = Mixer.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseVoice(t, 0.8, 380, 620, 6, 0.1, 0.12);
    this.noiseVoice(t, 0.8, 700, 1000, 7, 0.05, 0.12);
  }

  private murmur: AudioBufferSourceNode | null = null;

  /**
   * Rally ambience: a steady crowd murmur on the ambience bus that swells with the rally.
   * level 0 = quiet hall, 1 = the whole crowd holding its breath.
   */
  setRally(level: number): void {
    const ctx = Mixer.ctx, buf = Mixer.noise, bus = Mixer.ambienceBus;
    if (!ctx || !buf || !bus) return;
    if (!this.murmur) {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = 0.6;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.value = 0.22;
      s.connect(f).connect(g).connect(bus); s.start();
      this.murmur = s;
    }
    setAmbience(0.15 + 0.85 * Math.max(0, Math.min(1, level)));
  }

  /** Silence the murmur (leaving a match). */
  stopRally(): void { setAmbience(0, 0.3); }
}

export const Crowd = new CrowdImpl();

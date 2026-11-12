import { Mixer } from './Mixer';

/**
 * Procedural background music. Each track is a small generator (chords, bass line, melody, drums)
 * scheduled ahead of time on the audio clock. Tracks change with a 1 s crossfade.
 *
 * Kinds: menu, match, results. Each sport gets its own flavour of each kind (tempo, key, scale,
 * instruments and groove), so bowling sounds like a lounge and table tennis bounces.
 */
export type MusicKind = 'menu' | 'match' | 'results';

interface Flavour {
  bpm: number;
  root: number;                // MIDI note of the key centre
  scale: number[];             // semitone offsets
  prog: number[];              // chord roots as scale degrees, one per bar
  lead: OscillatorType;
  bass: OscillatorType;
  swing: number;               // 0 = straight 16ths, 0.33 = triplet swing
  drums: 'none' | 'soft' | 'groove' | 'hiphop' | 'bounce' | 'taiko';
  pad: boolean;
  density: number;             // 0..1 melody notes per step
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MIXO = [0, 2, 4, 5, 7, 9, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PENTA = [0, 2, 4, 7, 9, 12, 14];

const SPORT_FLAVOUR: Record<string, Partial<Flavour>> = {
  default:     { bpm: 108, root: 60, scale: MAJOR, prog: [0, 4, 5, 3], lead: 'triangle', bass: 'sine', swing: 0.12, drums: 'soft', pad: true, density: 0.45 },
  bowling:     { bpm: 100, root: 58, scale: MIXO, prog: [0, 3, 0, 4], lead: 'square', bass: 'triangle', swing: 0.3, drums: 'groove', pad: false, density: 0.5 },
  swordplay:   { bpm: 122, root: 57, scale: MINOR, prog: [0, 5, 6, 4], lead: 'sawtooth', bass: 'square', swing: 0, drums: 'taiko', pad: true, density: 0.4 },
  airsports:   { bpm: 118, root: 62, scale: PENTA, prog: [0, 3, 4, 0], lead: 'sine', bass: 'sine', swing: 0, drums: 'soft', pad: true, density: 0.35 },
  basketball:  { bpm: 90, root: 55, scale: DORIAN, prog: [0, 3, 0, 4], lead: 'square', bass: 'sawtooth', swing: 0.2, drums: 'hiphop', pad: false, density: 0.4 },
  tabletennis: { bpm: 132, root: 64, scale: MAJOR, prog: [0, 5, 3, 4], lead: 'triangle', bass: 'triangle', swing: 0, drums: 'bounce', pad: false, density: 0.55 },
  frisbee:     { bpm: 112, root: 60, scale: PENTA, prog: [0, 4, 3, 4], lead: 'triangle', bass: 'sine', swing: 0.25, drums: 'soft', pad: true, density: 0.5 }
};

function flavourFor(kind: MusicKind, sport?: string): Flavour {
  const base = SPORT_FLAVOUR.default as Flavour;
  const sp = sport ? SPORT_FLAVOUR[sport] ?? {} : {};
  const f: Flavour = { ...base, ...sp };
  if (kind === 'menu') {
    // The main menu (no sport) is the island theme; a sport's menu is a calmer cut of its match track.
    if (sport) return { ...f, bpm: Math.round(f.bpm * 0.9), drums: f.drums === 'none' ? 'none' : 'soft', density: f.density * 0.7, pad: true };
    return f;
  }
  if (kind === 'results') return { ...f, bpm: Math.round(f.bpm * 0.85), prog: [0, 3, 4, 0], drums: 'soft', pad: true, density: 0.3 };
  return { ...f, density: Math.min(0.75, f.density + 0.1) };
}

/** Tiny deterministic PRNG so a track's melody is the same every time it plays. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class Track {
  out: GainNode;
  private nextTime = 0;
  private step = 0;
  private melody: Array<number | null> = [];   // 64 steps (4 bars of 16ths), scale-degree offsets or rest
  private timer: number | null = null;
  private stopped = false;

  constructor(private ctx: AudioContext, dest: AudioNode, private f: Flavour, seed: number) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    const r = rng(seed);
    let deg = 2;
    for (let i = 0; i < 64; i++) {
      const strong = i % 4 === 0;
      if (r() < (strong ? f.density + 0.25 : f.density * 0.6)) {
        deg = Math.max(-2, Math.min(9, deg + Math.round((r() - 0.5) * 4)));
        this.melody.push(deg);
      } else this.melody.push(null);
    }
  }

  start(at: number): void {
    this.nextTime = at;
    const tick = () => {
      if (this.stopped) return;
      const now = this.ctx.currentTime;
      if (this.nextTime < now - 0.2) this.nextTime = now + 0.05; // tab was in the background; skip ahead
      while (this.nextTime < now + 0.15) { this.schedule(this.step, this.nextTime); this.advance(); }
    };
    tick();
    this.timer = window.setInterval(tick, 25);
  }

  stop(at: number): void {
    window.setTimeout(() => {
      this.stopped = true;
      if (this.timer !== null) clearInterval(this.timer);
      this.out.disconnect();
    }, Math.max(0, (at - this.ctx.currentTime) * 1000) + 100);
  }

  private advance(): void {
    const sixteenth = 60 / this.f.bpm / 4;
    // Swing lengthens even 16ths and shortens odd ones.
    const sw = this.step % 2 === 0 ? 1 + this.f.swing : 1 - this.f.swing;
    this.nextTime += sixteenth * sw;
    this.step += 1;
  }

  private note(deg: number, octave: number): number {
    const sc = this.f.scale, n = sc.length;
    const o = Math.floor(deg / n), i = ((deg % n) + n) % n;
    return this.f.root + 12 * (octave + o) + sc[i];
  }

  private schedule(step: number, t: number): void {
    const f = this.f;
    const bar = Math.floor(step / 16) % f.prog.length;
    const inBar = step % 16;
    const chord = f.prog[bar];
    const beat = 60 / f.bpm;
    const phrase = Math.floor(step / 64);

    // pad: chord on each bar
    if (f.pad && inBar === 0) for (const d of [0, 2, 4]) this.padNote(mtof(this.note(chord + d, -1)), t, beat * 4);
    // bass: root on 1, fifth on the "and" of 2, with a pickup
    if (inBar === 0 || inBar === 10) this.bassNote(mtof(this.note(chord + (inBar === 10 ? 4 : 0), -2)), t, beat * 0.9);
    if (inBar === 14 && phrase % 2 === 1) this.bassNote(mtof(this.note(chord + 2, -2)), t, beat * 0.4);
    // melody, varied every other phrase by moving it up a third
    const m = this.melody[step % 64];
    if (m !== null) {
      const deg = m + (phrase % 2 === 1 && bar >= 2 ? 2 : 0);
      this.leadNote(mtof(this.note(deg, 0)), t, beat * 0.45);
    }
    this.drums(inBar, t);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, peak: number, attack: number, cutoff?: number, detune = 0): void {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const g = this.ctx.createGain();
    this.env(g, t, peak, attack, dur);
    if (cutoff) {
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
      o.connect(lp).connect(g);
    } else o.connect(g);
    g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private leadNote(freq: number, t: number, dur: number): void {
    const peak = this.f.lead === 'square' || this.f.lead === 'sawtooth' ? 0.045 : 0.09;
    this.osc(this.f.lead, freq, t, dur, peak, 0.01, this.f.lead === 'sine' ? undefined : 2600);
  }
  private bassNote(freq: number, t: number, dur: number): void {
    this.osc(this.f.bass, freq, t, dur, this.f.bass === 'sine' ? 0.22 : 0.12, 0.01, 600);
  }
  private padNote(freq: number, t: number, dur: number): void {
    this.osc('sawtooth', freq, t, dur, 0.018, 0.4, 900, -7);
    this.osc('sawtooth', freq, t, dur, 0.018, 0.4, 900, 7);
  }

  private kick(t: number, peak = 0.5): void {
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = this.ctx.createGain(); this.env(g, t, peak, 0.002, 0.22);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.3);
  }
  private noiseHit(t: number, type: BiquadFilterType, freq: number, peak: number, dur: number): void {
    const buf = Mixer.noise;
    if (!buf) return;
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    const fl = this.ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = freq;
    const g = this.ctx.createGain(); this.env(g, t, peak, 0.002, dur);
    s.connect(fl).connect(g).connect(this.out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  private drums(i: number, t: number): void {
    switch (this.f.drums) {
      case 'none': return;
      case 'soft':
        if (i === 0 || i === 8) this.kick(t, 0.25);
        if (i % 4 === 2) this.noiseHit(t, 'highpass', 7000, 0.03, 0.04);
        return;
      case 'groove':
        if (i === 0 || i === 7 || i === 10) this.kick(t, 0.4);
        if (i === 4 || i === 12) this.noiseHit(t, 'bandpass', 1800, 0.18, 0.12);
        if (i % 2 === 0) this.noiseHit(t, 'highpass', 8000, i % 4 === 2 ? 0.05 : 0.025, 0.04);
        return;
      case 'hiphop':
        if (i === 0 || i === 3 || i === 10) this.kick(t, 0.5);
        if (i === 4 || i === 12) this.noiseHit(t, 'bandpass', 1500, 0.22, 0.16);
        if (i % 2 === 0) this.noiseHit(t, 'highpass', 9000, 0.03, 0.03);
        return;
      case 'bounce':
        if (i % 4 === 0) this.kick(t, 0.4);
        if (i === 4 || i === 12) this.noiseHit(t, 'bandpass', 2200, 0.14, 0.08);
        this.noiseHit(t, 'highpass', 9000, i % 2 ? 0.015 : 0.03, 0.025);
        return;
      case 'taiko':
        if (i === 0 || i === 6 || i === 8) this.kick(t, 0.55);
        if (i === 12 || i === 14) { this.kick(t, 0.35); this.noiseHit(t, 'lowpass', 400, 0.12, 0.2); }
        if (i % 4 === 2) this.noiseHit(t, 'highpass', 6000, 0.03, 0.05);
        return;
    }
  }
}

const FADE = 1.0;

class MusicImpl {
  private current: Track | null = null;
  private currentKey = '';
  private wanted: { kind: MusicKind; sport?: string } | null = null;

  /** Switch to a track. Same track again = no change. Before audio unlocks, remembers the request. */
  play(kind: MusicKind, sport?: string): void {
    this.wanted = { kind, sport };
    const ctx = Mixer.ctx, bus = Mixer.musicBus;
    if (!ctx || !bus) { Mixer.whenReady(() => { if (this.wanted) this.play(this.wanted.kind, this.wanted.sport); }); return; }
    const key = `${kind}:${sport ?? ''}`;
    if (key === this.currentKey && this.current) return;
    const now = ctx.currentTime;
    if (this.current) {
      const old = this.current;
      old.out.gain.cancelScheduledValues(now);
      old.out.gain.setValueAtTime(old.out.gain.value, now);
      old.out.gain.linearRampToValueAtTime(0, now + FADE);
      old.stop(now + FADE);
    }
    const tr = new Track(ctx, bus, flavourFor(kind, sport), hash(key));
    tr.out.gain.setValueAtTime(0, now);
    tr.out.gain.linearRampToValueAtTime(1, now + FADE);
    tr.start(now + 0.05);
    this.current = tr;
    this.currentKey = key;
  }

  stop(): void {
    this.wanted = null;
    const ctx = Mixer.ctx;
    if (!ctx || !this.current) return;
    const now = ctx.currentTime;
    this.current.out.gain.setValueAtTime(this.current.out.gain.value, now);
    this.current.out.gain.linearRampToValueAtTime(0, now + FADE);
    this.current.stop(now + FADE);
    this.current = null;
    this.currentKey = '';
  }
}

export const Music = new MusicImpl();

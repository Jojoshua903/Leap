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

    // disc whoosh: band-passed noise whose pitch follows the disc speed
    this.whooshFilter = ctx.createBiquadFilter();
    this.whooshFilter.type = 'bandpass'; this.whooshFilter.Q.value = 2.2; this.whooshFilter.frequency.value = 600;
    this.whooshGain = ctx.createGain();
    this.whooshGain.gain.value = 0;
    this.loop(this.whooshFilter);
    this.whooshFilter.connect(this.whooshGain).connect(out);

    // wind ambience: low, slowly breathing noise
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass'; wf.frequency.value = 420; wf.Q.value = 0.7;
    this.windFilter = wf;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loop(wf);
    wf.connect(this.windGain).connect(out);
  }

  private whooshGain: GainNode | null = null;
  private whooshFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

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
  stopLoops(): void { this.setRoll(0); this.setGutter(false); this.setWhoosh(0); this.setWind(0); }

  /** Disc flying past: speed in m/s (0 = silent), `near` 0..1 how close it is to the camera. */
  setWhoosh(speed: number, near = 1): void {
    if (!Mixer.ctx || !this.whooshGain || !this.whooshFilter) return;
    const t = Mixer.now;
    this.whooshGain.gain.setTargetAtTime(speed > 1 ? Math.min(0.16, 0.012 + speed * 0.005) * near : 0, t, 0.05);
    this.whooshFilter.frequency.setTargetAtTime(280 + speed * 55, t, 0.06);
  }

  /** Wind bed, 0..1 (strength of the wind). */
  setWind(level: number): void {
    if (!Mixer.ctx || !this.windGain || !this.windFilter) return;
    const t = Mixer.now;
    this.windGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.22, t, 0.6);
    this.windFilter.frequency.setTargetAtTime(260 + level * 520, t, 0.8);
  }

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

  /* ---------- table tennis ---------- */

  /**
   * Paddle "tock": a short pitched knock plus a click of rubber. Harder = higher and brighter;
   * off the sweet spot (edge 0..1) = duller, lower and woodier.
   */
  paddleHit(power: number, edge = 0): void {
    const k = Math.max(0.1, Math.min(1.1, power)), dull = Math.max(0, Math.min(1, edge));
    const f = (720 + 520 * k) * (1 - 0.35 * dull);
    this.tone(f, 0.05 + 0.02 * dull, 'triangle', 0.14 + 0.12 * k);
    this.tone(f * 1.52, 0.025, 'sine', 0.05 * (1 - dull));
    this.burst(2600 + 2400 * k * (1 - dull), 2.5, 0.18 * (0.5 + k), 0.03);
    if (dull > 0.5) this.burst(420, 2, 0.12, 0.08);
  }

  /** Ball on the table: a light hollow tick. */
  tableTick(speed: number): void {
    const k = Math.max(0.15, Math.min(1, speed / 12));
    this.tone(1900 + 600 * k, 0.025, 'sine', 0.1 * k + 0.03);
    this.burst(4200, 4, 0.12 * k + 0.03, 0.02);
  }

  /** Ball clipping the tape: a muffled tick. */
  netCord(): void { this.tone(520, 0.06, 'triangle', 0.1); this.burst(900, 1.5, 0.08, 0.06); }
  /** Into the net mesh. */
  netThud(): void { this.burst(300, 0.8, 0.12, 0.12); }
  /** Bouncing on the floor. */
  floorTick(): void { this.tone(900, 0.03, 'sine', 0.05); }
  /** Swing and miss. */
  whoosh(): void { this.burst(700, 0.7, 0.12, 0.18, 0, 0.6); }
  /** Smash: the tock plus a crack. */
  smash(): void { this.paddleHit(1.1, 0); this.burst(1800, 1.2, 0.3, 0.09); this.tone(160, 0.12, 'sine', 0.25, 0, 70); }
  /** Point jingle: rising for a point won by the near player (or any point in 2-player), falling for a point lost to the AI. */
  ttPoint(good: boolean): void { this.arpeggio(good ? [659, 784, 988] : [523, 440, 392], 0.07, 'triangle', 0.1); }
  /** Game won jingle. */
  ttGame(): void { this.arpeggio([523, 659, 784, 1047, 784, 1047, 1319], 0.08, 'square', 0.07); }
  /** Return Challenge target hit. */
  target(): void { this.arpeggio([1319, 1568, 2093], 0.04, 'sine', 0.1); }
  /** Lost a life. */
  lifeLost(): void { this.tone(392, 0.25, 'triangle', 0.12, 0, 262); }

  /* ---------- basketball ---------- */

  /** Ball on the floor: a rubbery thump, higher and louder the harder it lands. */
  bounce(speed: number): void {
    const k = Math.max(0.1, Math.min(1, speed / 8));
    this.tone(95 + 70 * k, 0.12 + 0.05 * k, 'sine', 0.18 + 0.32 * k, 0, 60 + 30 * k);
    this.burst(420 + 500 * k, 1.4, 0.08 + 0.12 * k, 0.05);
  }

  /** Clean make: a soft filtered-noise "swish" through the net. */
  swish(): void {
    this.burst(3200, 0.8, 0.22, 0.3, 0, 1.25);
    this.burst(6500, 1.6, 0.1, 0.22, 0.03, 1.4);
  }

  /** Ball on the rim: inharmonic metal partials (like a struck ring), brighter for harder hits. */
  rimClank(speed: number): void {
    const k = Math.max(0.15, Math.min(1, speed / 9));
    const f = 480 + 160 * k;
    for (const [m, g, d] of [[1, 0.12, 0.35], [2.76, 0.07, 0.25], [5.4, 0.045, 0.16], [8.93, 0.03, 0.1]] as const) {
      this.tone(f * m, d * (0.6 + 0.4 * k), 'sine', g * k + 0.01);
    }
    this.burst(2400, 2, 0.12 * k, 0.04);
  }

  /** Off the glass: a hollow thud. */
  boardThud(speed: number): void {
    const k = Math.max(0.15, Math.min(1, speed / 9));
    this.tone(150, 0.14, 'triangle', 0.18 * k + 0.04, 0, 95);
    this.burst(750, 1.1, 0.2 * k, 0.09);
  }

  /** Sneaker squeak on a hard cut. */
  squeak(): void {
    const f = 1700 + Math.random() * 700;
    this.tone(f, 0.08, 'square', 0.025, 0, f * 1.3);
    this.tone(f * 1.01, 0.07, 'sine', 0.03, 0.01, f * 1.25);
  }

  /** The end-of-clock buzzer. */
  buzzer(): void {
    this.tone(196, 0.9, 'sawtooth', 0.09);
    this.tone(199, 0.9, 'square', 0.05);
    this.tone(392, 0.9, 'square', 0.025);
  }

  /** A made basket jingle (money balls and 2-pointers get the bigger one). */
  bbMake(big: boolean): void { this.arpeggio(big ? [659, 784, 988, 1319] : [659, 880], 0.06, 'triangle', 0.09); }

  /** Countdown beep (3-2-1) and the go beep. */
  beep(go = false): void { this.tone(go ? 1175 : 784, go ? 0.25 : 0.12, 'square', 0.06); }

  /* ---------- frisbee ---------- */

  /** The disc leaves the hand: a short rising "thwip". */
  thwip(power = 1): void {
    const k = Math.max(0.3, Math.min(1, power));
    this.burst(1800, 2.5, 0.12 * k, 0.09, 0, 1.6);
    this.tone(500, 0.08, 'triangle', 0.05 * k, 0, 1300);
  }

  /** A catch: a soft plastic thump. */
  catchThump(): void { this.tone(210, 0.1, 'triangle', 0.22, 0, 120); this.burst(900, 1.3, 0.14, 0.06); }

  /** Disc on the ground: a dull tap (grass) or a scrape (sand). */
  discLand(speed: number, sand = false): void {
    const k = Math.max(0.1, Math.min(1, speed / 15));
    if (sand) this.burst(2200, 0.7, 0.12 * k + 0.03, 0.25, 0, 0.7);
    else { this.tone(160, 0.07, 'sine', 0.12 * k + 0.03, 0, 90); this.burst(1200, 1, 0.06 * k, 0.12); }
  }

  /** Into a tree: a wooden knock and a leafy rustle. */
  treeHit(): void { this.tone(260, 0.08, 'square', 0.05, 0, 140); this.burst(3500, 0.6, 0.14, 0.35, 0.02, 0.8); }

  /** Water: a splash (a wide noise burst with a falling filter, then drips). */
  splash(): void {
    this.burst(900, 0.5, 0.3, 0.45, 0, 0.7);
    this.burst(2600, 1.2, 0.12, 0.3, 0.05, 1);
    for (let i = 0; i < 4; i++) this.tone(900 + Math.random() * 900, 0.06, 'sine', 0.03, 0.18 + i * 0.09, 1600 + Math.random() * 600);
  }

  /** The disc hits the chains: metallic noise bursts, many for a big hit. */
  chains(intensity = 1): void {
    const k = Math.max(0.2, Math.min(1, intensity));
    const n = 5 + Math.round(9 * k);
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 0.45 * k;
      this.burst(3200 + Math.random() * 4500, 8 + Math.random() * 10, 0.1 * k + 0.02, 0.08 + Math.random() * 0.18, w, 1.4);
      if (i % 3 === 0) this.tone(1900 + Math.random() * 2200, 0.15, 'sine', 0.025 * k, w);
    }
  }

  /** A cute bark: two formants over a short pitched buzz. */
  bark(): void {
    const f = 430 + Math.random() * 120;
    this.tone(f, 0.11, 'sawtooth', 0.05, 0, f * 0.7);
    this.burst(f * 2.4, 6, 0.16, 0.1, 0, 1.1);
    this.burst(f * 5.2, 9, 0.07, 0.08, 0.005, 1.2);
  }

  /** Panting: a few soft breathy bursts. */
  pant(): void { for (let i = 0; i < 3; i++) this.burst(1700, 1.2, 0.05, 0.08, i * 0.16, 0.9); }

  /* ---------- swordplay ---------- */

  /** Blade through the air: a band-passed noise sweep, higher and louder for a faster slash. */
  bladeWhoosh(speed: number): void {
    const k = Math.max(0.2, Math.min(1, speed / 12));
    this.burst(500 + 900 * k, 1.1, 0.07 + 0.12 * k, 0.12 + 0.08 * k, 0, 0.7 + 0.5 * k);
    this.burst(1600 + 1400 * k, 2, 0.04 * k, 0.1, 0.03, 1.2);
  }

  /** Wooden "tok": a foam/wood blade landing on a body or a dummy. */
  tok(power: number): void {
    const k = Math.max(0.2, Math.min(1, power));
    this.tone(320 + 160 * k, 0.07, 'triangle', 0.16 + 0.12 * k, 0, 220);
    this.tone(880 + 300 * k, 0.03, 'square', 0.03);
    this.burst(1500, 3, 0.12 * k + 0.04, 0.05);
  }

  /** Blade on blade (a block or parry): inharmonic partials like a struck bar; a parry rings longer. */
  clang(power: number, parry = false): void {
    const k = Math.max(0.25, Math.min(1, power));
    const f = 620 + 180 * k, ring = parry ? 1.8 : 1;
    for (const [m, g, d] of [[1, 0.1, 0.3], [2.32, 0.06, 0.22], [4.25, 0.04, 0.16], [6.63, 0.025, 0.1]] as const) {
      this.tone(f * m, d * ring, 'sine', g * k + 0.01);
    }
    this.burst(3800, 2.5, 0.16 * k, 0.04);
    if (parry) this.arpeggio([1319, 1760], 0.05, 'triangle', 0.05);
  }

  /** A clean slice through a target: a swish and a pop. `perfect` adds a sparkle. */
  swishPop(perfect = false): void {
    this.burst(2800, 1, 0.16, 0.12, 0, 1.3);
    this.tone(420, 0.09, 'sine', 0.16, 0.03, 900);
    if (perfect) this.arpeggio([1568, 2093, 2637], 0.04, 'sine', 0.07);
  }

  /** A cartoon bomb: a soft "poof" with a low boom (no explosion debris). */
  bombPoof(): void { this.tone(110, 0.35, 'sine', 0.35, 0, 45); this.burst(600, 0.6, 0.3, 0.35, 0, 0.6); }

  /** Something blunt bonks you (a rock, a foam arrow). */
  bonk(): void { this.tone(260, 0.12, 'triangle', 0.2, 0, 120); this.burst(700, 1.5, 0.1, 0.06); }

  /** Heart pickup. */
  heart(): void { this.arpeggio([784, 988, 1319, 1568], 0.05, 'sine', 0.09); }

  /** Boss roar, made friendly: a growly slide through a formant. */
  roar(): void {
    this.tone(150, 0.7, 'sawtooth', 0.07, 0, 90);
    this.burst(520, 3, 0.2, 0.7, 0, 0.5);
    this.burst(1100, 4, 0.08, 0.5, 0.05, 0.6);
  }

  /** A gong-like hit for "K.O." and round starts. */
  gong(): void {
    for (const [m, g, d] of [[1, 0.14, 1.6], [1.48, 0.07, 1.2], [2.09, 0.05, 0.9], [2.76, 0.03, 0.7]] as const) this.tone(130 * m, d, 'sine', g);
    this.burst(400, 0.8, 0.12, 0.4);
  }

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

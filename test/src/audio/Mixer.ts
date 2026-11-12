/**
 * Shared Web Audio graph: one AudioContext, three volume buses (plus ambience) and music ducking.
 *
 *   music ─► duck ─┐
 *   sfx  ──────────┼─► master ─► destination
 *   ui   ──────────┘
 *   ambience ─► sfx   (crowd murmur, rally bed: its own level so it can swell without touching effects)
 *
 * The context is created on the first user input (browsers block audio before that).
 * Until then every getter returns null and sound calls quietly do nothing.
 */
export const DUCK_DB = -8;
const dbToGain = (db: number) => Math.pow(10, db / 20);

export interface MixLevels { master: number; music: number; sfx: number; muted: boolean }

class MixerImpl {
  ctx: AudioContext | null = null;
  masterBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  sfxBus: GainNode | null = null;
  ambienceBus: GainNode | null = null;
  private duckNode: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private levels: MixLevels = { master: 0.8, music: 0.6, sfx: 0.9, muted: false };
  private duckCount = 0;
  private readyFns: Array<() => void> = [];

  /** Call from a user gesture. Safe to call many times. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.masterBus = ctx.createGain();
      this.masterBus.connect(ctx.destination);
      this.duckNode = ctx.createGain();
      this.duckNode.connect(this.masterBus);
      this.musicBus = ctx.createGain();
      this.musicBus.connect(this.duckNode);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.masterBus);
      this.ambienceBus = ctx.createGain();
      this.ambienceBus.gain.value = 0;
      this.ambienceBus.connect(this.sfxBus);
      this.applyLevels(0);
      const fns = this.readyFns; this.readyFns = [];
      for (const f of fns) f();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean { return !!this.ctx; }
  /** Run once audio is unlocked (immediately if it already is). */
  whenReady(fn: () => void): void { if (this.ctx) fn(); else this.readyFns.push(fn); }

  get now(): number { return this.ctx?.currentTime ?? 0; }

  /** 2 s of white noise shared by every noise-based sound. */
  get noise(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noiseBuf) {
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  setLevels(l: Partial<MixLevels>): void {
    this.levels = { ...this.levels, ...l };
    this.applyLevels(0.05);
  }
  getLevels(): MixLevels { return { ...this.levels }; }

  toggleMute(): boolean { this.setLevels({ muted: !this.levels.muted }); return this.levels.muted; }

  private applyLevels(tc: number): void {
    if (!this.ctx || !this.masterBus || !this.musicBus || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const set = (g: GainNode, v: number) => { if (tc <= 0) g.gain.value = v; else g.gain.setTargetAtTime(v, t, tc); };
    // Squared so the sliders feel even (perceived loudness is roughly logarithmic).
    set(this.masterBus, this.levels.muted ? 0 : this.levels.master * this.levels.master);
    set(this.musicBus, this.levels.music * this.levels.music);
    set(this.sfxBus, this.levels.sfx * this.levels.sfx);
  }

  /**
   * Lower the music by 8 dB while something important plays (crowd cheers, results jingle).
   * Calls nest: the music comes back when every duck() has been released.
   * Returns the release function; it also auto-releases after `seconds` if given.
   */
  duck(seconds?: number): () => void {
    this.duckCount += 1;
    this.applyDuck();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.duckCount = Math.max(0, this.duckCount - 1);
      this.applyDuck();
    };
    if (seconds !== undefined) setTimeout(release, seconds * 1000);
    return release;
  }

  private applyDuck(): void {
    if (!this.ctx || !this.duckNode) return;
    this.duckNode.gain.setTargetAtTime(this.duckCount > 0 ? dbToGain(DUCK_DB) : 1, this.ctx.currentTime, 0.12);
  }
}

export const Mixer = new MixerImpl();

/**
 * Ambience level 0..1 (e.g. the crowd getting louder during a long rally), smoothed over `tc` seconds.
 * It sits under the effects bus, so the Effects slider and mute still apply.
 */
export function setAmbience(level: number, tc = 0.4): void {
  const ctx = Mixer.ctx, g = Mixer.ambienceBus;
  if (!ctx || !g) return;
  g.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), ctx.currentTime, tc);
}

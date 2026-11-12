/**
 * Graphics quality levels and an automatic governor that steps quality down when the frame rate
 * stays under target, so the 100-pin wall keeps running at 60 FPS on slower machines.
 */
export type QualityLevel = 'low' | 'med' | 'high';
export const QUALITY_LEVELS: QualityLevel[] = ['low', 'med', 'high'];

export interface QualityProfile {
  pixelRatio: number;    // cap on devicePixelRatio
  shadows: boolean;
  shadowMap: number;
  pinDetail: 'full' | 'simple';
  pinOutlines: boolean;
  neighbourLanes: boolean;
  antialias: boolean;
}

export const QUALITY: Record<QualityLevel, QualityProfile> = {
  low:  { pixelRatio: 1,    shadows: false, shadowMap: 512,  pinDetail: 'simple', pinOutlines: false, neighbourLanes: false, antialias: false },
  med:  { pixelRatio: 1.5,  shadows: true,  shadowMap: 1024, pinDetail: 'simple', pinOutlines: true,  neighbourLanes: true,  antialias: true },
  high: { pixelRatio: 2,    shadows: true,  shadowMap: 2048, pinDetail: 'full',   pinOutlines: true,  neighbourLanes: true,  antialias: true }
};

export const lowerOf = (q: QualityLevel): QualityLevel => (q === 'high' ? 'med' : 'low');

/**
 * Feed it real frame times. When the smoothed FPS stays below `target` for `window` seconds it calls
 * onLower once and waits `cooldown` seconds before judging again. Pauses (long frames) are ignored.
 */
export class QualityGovernor {
  enabled = true;
  private fps = 60;
  private lowT = 0;
  private cooldownT = 3;   // give scenes a moment to warm up
  constructor(
    private readonly onLower: () => boolean,
    private readonly target = 55,
    private readonly window = 2.5,
    private readonly cooldown = 6
  ) {}

  /** Average FPS, for the on-screen counter. */
  get current(): number { return this.fps; }

  sample(dt: number): void {
    if (dt <= 0 || dt > 0.25) return;                 // tab switch or breakpoint: don't count it
    this.fps += (1 / dt - this.fps) * 0.05;
    if (!this.enabled) return;
    if (this.cooldownT > 0) { this.cooldownT -= dt; return; }
    if (this.fps < this.target) this.lowT += dt; else this.lowT = Math.max(0, this.lowT - dt * 2);
    if (this.lowT >= this.window) {
      this.lowT = 0;
      this.cooldownT = this.cooldown;
      this.onLower();
    }
  }

  reset(): void { this.lowT = 0; this.cooldownT = 3; this.fps = 60; }
}

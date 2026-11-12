import type { InputBackend } from '../input/InputBackend';
import type { MouseBackend } from '../input/MouseBackend';
import type { SwingDetector } from '../input/SwingDetector';
import type { HoopShot } from '../types';
import { BB_TUNING } from './bbTuning';
import { gradeTiming, inputFromFlick, inputFromMeter, type ShotGrade, type ShotInput } from './ShotSolver';

export interface ReleaseInfo {
  input: ShotInput;
  grade: ShotGrade;
  mouse: boolean;
  /** Motion: flick peak (rad/s). Mouse: meter value 0..1. */
  power: number;
  /** Aim at the release, degrees (+ = right of the hoop). */
  aimDeg: number;
  /** Mouse: where the sweet spot was. */
  sweet: number;
  /** ms, performance.now() of the release. */
  t: number;
}

export interface ShotHooks {
  /** Trigger / mouse button down: crouch, show the arc. */
  set(): void;
  /** Let go without shooting. */
  unset(): void;
  /** Motion only: the lift started (start the jump). `null` = the lift fizzled. */
  lift(atMs: number | null): void;
  release(r: ReleaseInfo): void;
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/**
 * Turns one player's controller into shots.
 *  - Phone / Joy-Con: hold the trigger to set, lift (the jump starts), flick up: the flick peak is the release.
 *    Timing = release − (lift start + jump apex). No smoothing; the detector reports 1 sample after the peak.
 *  - Mouse: aim with the pointer, hold the left button to fill a power meter that bounces between empty and
 *    full; a sweet spot drifts while you charge. Let go = release (the scene jumps and releases at the apex).
 *    The aim sways a little and the meter never stops, so it is not trivially perfect.
 * `ready` gates everything: no shots while the ball isn't in the shooter's hands.
 */
export class ShotControl {
  ready = false;
  /** Distance to the hoop of the coming shot (for the ideal flick speed). */
  dist = 6.75;
  private setActive = false;
  private liftT = -1;
  private mouseDown = false;
  private meterT = 0;
  private sweetPhase = 0;
  private t = 0;
  private attached = false;

  constructor(
    private readonly swing: SwingDetector,
    private readonly backend: () => InputBackend | null,
    private readonly hooks: ShotHooks
  ) {}

  get isMouse(): boolean { return this.backend()?.kind === 'mouse'; }
  get isSet(): boolean { return this.setActive; }
  get lifting(): boolean { return this.liftT >= 0; }

  /** The power meter for the HUD (mouse only). */
  get meter(): { active: boolean; value: number; sweet: number; width: number } {
    return { active: this.mouseDown && this.setActive, value: this.meterValue(), sweet: this.sweet(), width: BB_TUNING.sweetWidth };
  }

  /** Live aim for the arrow, degrees (+ = right). */
  get aimDeg(): number {
    if (this.isMouse) {
      const p = (this.backend() as MouseBackend | null)?.pointer;
      const x = p ? (p.x / Math.max(1, innerWidth) - 0.5) * 2 : 0;
      return clamp(x * 14, -20, 20) + Math.sin(this.t * 1.7) * BB_TUNING.aimSwayDeg;
    }
    return -this.swing.face.yaw;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const sw = this.swing;
    sw.mode = 'hoops';
    sw.cancel();
    sw.enabled = true;
    sw.onHoopSet = held => {
      if (this.isMouse) return;
      if (held && this.ready) { this.setActive = true; this.liftT = -1; this.hooks.set(); }
      else if (!held && this.setActive) { this.setActive = false; this.liftT = -1; this.hooks.unset(); }
    };
    sw.onHoopLift = t => {
      if (this.isMouse || !this.setActive) return;
      this.liftT = t ?? -1;
      this.hooks.lift(t);
    };
    sw.onHoopShot = s => this.onFlick(s);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    const sw = this.swing;
    sw.onHoopSet = null; sw.onHoopLift = null; sw.onHoopShot = null;
    sw.enabled = false;
    sw.mode = 'throw';
    this.setActive = false; this.liftT = -1; this.mouseDown = false;
  }

  /** Drop a set shot (e.g. the ball was stolen, the clock ran out). */
  cancel(): void {
    if (this.setActive) this.hooks.unset();
    this.setActive = false; this.liftT = -1; this.mouseDown = false;
    this.swing.cancel();
  }

  private onFlick(s: HoopShot): void {
    if (this.isMouse || !this.setActive || !this.ready) return;
    this.setActive = false;
    const lift = this.liftT >= 0 ? this.liftT : s.liftT;
    this.liftT = -1;
    const timing = s.t - lift - BB_TUNING.jumpApexMs;
    const input = inputFromFlick(s.peakRate, s.yawDeg, timing, this.dist);
    this.hooks.release({ input, grade: gradeTiming(timing), mouse: false, power: s.peakRate, aimDeg: -s.yawDeg, sweet: 0, t: s.t });
  }

  private meterValue(): number {
    const k = (this.meterT / BB_TUNING.meterPeriod) % 2;
    return k <= 1 ? k : 2 - k;
  }

  private sweet(): number { return clamp(0.72 + BB_TUNING.sweetDrift * Math.sin(this.sweetPhase), 0.3, 0.95); }

  /** Call every frame (real time). Drives the mouse meter. */
  tick(dt: number): void {
    this.t += dt;
    if (!this.attached || !this.isMouse) return;
    const p = (this.backend() as MouseBackend | null)?.pointer;
    const down = !!p?.left;
    if (down && !this.mouseDown && this.ready) {
      this.mouseDown = true; this.setActive = true; this.meterT = 0;
      this.sweetPhase = this.t * 2.1;
      this.hooks.set();
    } else if (!down && this.mouseDown) {
      this.mouseDown = false;
      if (this.setActive && this.ready) {
        this.setActive = false;
        const value = this.meterValue(), sweet = this.sweet(), aim = this.aimDeg;
        const input = inputFromMeter(value - sweet, aim);
        this.hooks.release({ input, grade: Math.abs(value - sweet) <= BB_TUNING.sweetWidth / 2 ? 'perfect' : Math.abs(value - sweet) < BB_TUNING.sweetWidth * 1.5 ? 'good' : value < sweet ? 'early' : 'late', mouse: true, power: value, aimDeg: aim, sweet, t: performance.now() });
      } else if (this.setActive) { this.setActive = false; this.hooks.unset(); }
    }
    if (this.mouseDown) { this.meterT += dt; this.sweetPhase += dt * 1.6; }
  }
}

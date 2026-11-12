import type { InputSample, Quat } from '../types';
import { TUNING } from '../tuning';
import { qConj, qMul, qToEuler, vLen } from '../math/Filter';
import type { Rng } from '../tabletennis/BallPhysics';
import { FB_TUNING, type DiscType } from './frisbeeTuning';

/**
 * Throw mapping, pure logic. Controllers give orientation and rates but no position, so a throw is read
 * from the flick itself:
 *   hold the trigger = grip · a fast wrist flick = the throw, released on the first sample after its peak
 *   (no smoothing: one sample of delay at most).
 *
 *   speed  ← peak angular speed (+ a little linear accel), soft curve onto 8–32 m/s, times the disc's armFactor
 *   dir    ← controller yaw at the release, relative to the calibrated forward (release early = it goes left)
 *   loft   ← controller pitch at the release (−5…25°)
 *   bank   ← controller roll at the release (hyzer / flat / anhyzer, ±35°)
 *   spin   ← wrist roll rate at the release plus the flick itself (10–60 rad/s; low spin wobbles)
 *   style  ← the sweep direction: a right-hander's backhand sweeps right (negative yaw rate), mirrored for
 *            left-handers; a mostly forward (pitch) flick counts as a backhand
 *   quality← smoothness (jerk); a dirty release adds wobble and a small angle error
 *
 * The mouse uses a slingshot (mapSling): drag back from the disc and let go; bank and nose angle come from
 * two sliders (A/D, W/S or the wheel).
 */
export interface FlickRaw {
  /** ms of the peak sample: the release. */
  t: number;
  peakRate: number;
  peakAccel: number;
  /** Signed sums of the yaw and pitch rates during the flick (which way it swept). */
  yawSum: number;
  pitchSum: number;
  /** Wrist roll rate at the peak (rad/s). */
  rollRate: number;
  /** Controller attitude at the release, degrees relative to calibration (+yaw = left, +pitch = up, +roll = left side down). */
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  jerk: number;
  durationMs: number;
}

export interface ThrowParams {
  speed: number;
  yawDeg: number;
  loftDeg: number;
  noseDeg: number;
  bankDeg: number;
  spin: number;
  wobble: number;
  /** 0..1 */
  quality: number;
  forehand: boolean;
  /** Where it came from, for the overlay. */
  source: 'motion' | 'mouse';
  peakRate: number;
}

const G = 9.81;
const RAD = 180 / Math.PI;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Watches InputSamples and reports one FlickRaw per flick while the trigger is held. */
export class FlickTracker {
  /** Called on grip (trigger down) and when the grip is let go without a throw. */
  onGrip: ((held: boolean) => void) | null = null;
  sensitivity = 1;
  private prevTrigger = false;
  private gripping = false;
  private armed = false;
  private tracking = false;
  private peak = 0;
  private peakT = 0;
  private startT = 0;
  private peakAccel = 0;
  private yawSum = 0;
  private pitchSum = 0;
  private jerk = 0;
  private prevA = G;
  private atPeak = { yaw: 0, pitch: 0, roll: 0, rollRate: 0 };

  get isGripping(): boolean { return this.gripping; }

  private get sens(): number { return clamp(this.sensitivity, 0.5, 1.5); }

  cancel(): void { this.gripping = false; this.armed = false; this.tracking = false; this.prevTrigger = false; }

  /** Feed one sample; `forward` is the calibrated forward orientation. Returns a flick at its release. */
  feed(s: InputSample, forward: Quat, enabled = true): FlickRaw | null {
    const trigger = s.buttons.trigger && enabled;
    if (trigger && !this.prevTrigger) { this.gripping = true; this.armed = true; this.tracking = false; this.onGrip?.(true); }
    if (!trigger && this.prevTrigger && this.gripping) {
      this.gripping = false;
      if (this.armed) this.onGrip?.(false);
      this.armed = false; this.tracking = false;
    }
    this.prevTrigger = trigger;
    if (!this.gripping || !this.armed) return null;

    const yawRate = s.gyro[1], pitchRate = s.gyro[0] * TUNING.swingSign, rollRate = -s.gyro[2];
    const rate = Math.hypot(yawRate, pitchRate);
    const T = FB_TUNING, start = T.flickRate * 0.5 / this.sens;
    const aMag = vLen(s.accel);
    if (!this.tracking) {
      if (rate < start) { this.prevA = aMag; return null; }
      this.tracking = true;
      this.startT = s.t; this.peak = 0; this.peakAccel = 0; this.yawSum = 0; this.pitchSum = 0; this.jerk = 0;
    }
    this.yawSum += yawRate; this.pitchSum += pitchRate;
    this.jerk += Math.abs(aMag - this.prevA);
    this.prevA = aMag;
    this.peakAccel = Math.max(this.peakAccel, aMag - G);
    if (rate > this.peak) {
      this.peak = rate; this.peakT = s.t;
      const rel = qToEuler(qMul(qConj(forward), s.orientation));
      this.atPeak = { yaw: rel.yaw * RAD, pitch: rel.pitch * RAD * TUNING.swingSign, roll: rel.roll * RAD, rollRate };
      return null;
    }
    if (rate < this.peak * 0.9) {
      if (this.peak * this.sens >= T.flickRate) {
        this.armed = false; this.tracking = false;
        return {
          t: this.peakT, peakRate: this.peak * this.sens, peakAccel: this.peakAccel, yawSum: this.yawSum, pitchSum: this.pitchSum,
          rollRate: this.atPeak.rollRate, yawDeg: this.atPeak.yaw, pitchDeg: this.atPeak.pitch, rollDeg: this.atPeak.roll,
          jerk: this.jerk, durationMs: s.t - this.startT
        };
      }
      // a wiggle that never became a flick
      if (rate < start) this.tracking = false;
    }
    return null;
  }
}

export interface MapOptions { handed: 'right' | 'left'; disc: DiscType; rng?: Rng }

/** Spin direction: + = counter-clockwise seen from above (a right-hand forehand, a left-hand backhand). */
export const spinSign = (forehand: boolean, handed: 'right' | 'left'): number => (forehand ? 1 : -1) * (handed === 'left' ? -1 : 1);

export function speedFrom(power: number, disc: DiscType): number {
  const T = FB_TUNING;
  const k = clamp((power - T.flickRate) / Math.max(0.1, T.rateForMax - T.flickRate), 0, 1);
  return Math.min(disc.maxSpeed, (T.speedMin + (T.speedMax - T.speedMin) * Math.pow(k, T.speedCurve)) * disc.armFactor);
}

export function mapFlick(f: FlickRaw, o: MapOptions): ThrowParams {
  const T = FB_TUNING;
  const speed = speedFrom(f.peakRate + T.accelWeight * Math.max(0, f.peakAccel), o.disc);
  const left = o.handed === 'left';
  const sweptYaw = Math.abs(f.yawSum) >= Math.abs(f.pitchSum) * 0.5;
  const forehand = sweptYaw && (left ? f.yawSum < 0 : f.yawSum > 0);
  const quality = clamp(1 - (f.jerk - T.jerkOk) / T.jerkRange, 0, 1);
  const g = (): number => (o.rng ? o.rng.gauss() : 0);
  const bad = 1 - quality;
  const spinMag = clamp(T.spinBase + Math.abs(f.rollRate) * T.spinRollGain + f.peakRate * T.spinFlickGain * 0.5, T.spinMin, T.spinMax);
  const spin = spinMag * spinSign(forehand, o.handed);
  const lowSpin = clamp((25 - spinMag) / 15, 0, 1);
  return {
    speed,
    yawDeg: clamp(-f.yawDeg * T.yawGain + bad * T.errDeg * g(), -T.maxDirDeg, T.maxDirDeg),
    loftDeg: clamp(f.pitchDeg * T.pitchGain + T.loftOffset + bad * T.errDeg * 0.5 * g(), -5, 25),
    noseDeg: T.noseClean + bad * 3 * g(),
    bankDeg: clamp(-f.rollDeg * T.rollGain + bad * T.errDeg * 0.6 * g(), -T.maxBankDeg, T.maxBankDeg),
    spin,
    wobble: clamp(bad * 0.9 + lowSpin * 0.5, 0, 1),
    quality,
    forehand,
    source: 'motion',
    peakRate: f.peakRate
  };
}

export interface SlingInput {
  /** Drag from the press point to the release point, screen px (+x right, +y down: pulling back = down). */
  dx: number;
  dy: number;
  bankDeg: number;
  /** The nose slider: launch angle (−5…25°). */
  noseDeg: number;
}

/** Drag length (0..1 of full power) of a slingshot pull; dragging up (forward) doesn't count. */
export const slingPower = (s: SlingInput): number => clamp(Math.max(0, s.dy) > 0 ? Math.hypot(s.dx, s.dy) / FB_TUNING.slingPx : 0, 0, 1);

/** Mouse slingshot: the throw goes opposite the pull. Capped below the motion maximum, with a little error. */
export function mapSling(s: SlingInput, o: MapOptions): ThrowParams | null {
  const T = FB_TUNING;
  const p = slingPower(s);
  if (p < 0.08) return null;
  const g = (): number => (o.rng ? o.rng.gauss() : 0);
  const k = clamp(p * (1 + T.slingPowerErr * g()), 0, 1);
  const raw = (T.speedMin + (T.speedMax - T.speedMin) * Math.pow(k, T.speedCurve)) * o.disc.armFactor;
  const speed = Math.min(raw, o.disc.maxSpeed * T.slingCap);
  const dir = Math.atan2(-s.dx, Math.max(1, s.dy)) * RAD;
  return {
    speed,
    yawDeg: clamp(dir + T.slingDirErr * g(), -T.maxDirDeg, T.maxDirDeg),
    loftDeg: clamp(s.noseDeg, -5, 25),
    noseDeg: T.noseClean,
    bankDeg: clamp(s.bankDeg, -T.maxBankDeg, T.maxBankDeg),
    spin: T.slingSpin * spinSign(false, o.handed),
    wobble: 0.1,
    quality: 0.85,
    forehand: false,
    source: 'mouse',
    peakRate: 0
  };
}

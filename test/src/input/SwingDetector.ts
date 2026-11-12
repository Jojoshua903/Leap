import type { Calibration, InputSample, Throw } from '../types';
import { TUNING } from '../tuning';
import { qConj, qMul, qToEuler, vLen } from '../math/Filter';

export type SwingPhase = 'idle' | 'aiming' | 'backswing' | 'forward';
const G = 9.81;
const RAD = 180 / Math.PI;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/**
 * Turns InputSamples into one Throw per swing.
 *
 *  idle ──trigger down──▶ aiming ──pitch rate < -backswingRate──▶ backswing
 *    ▲                      │                                        │
 *    │                      └── pitch rate > 1.5·forwardRate (flick) ┐   │ pitch rate > forwardRate
 *    │                                                               ▼   ▼
 *    └──────────── trigger up: throw (weak if no real forward swing) ◀── forward
 *
 * During the forward phase we track the peak pitch rate, peak linear accel and a jerk metric.
 * At release we read the yaw change since the swing started (direction) and the wrist roll rate (spin).
 */
export class SwingDetector {
  phase: SwingPhase = 'idle';
  aimX = 0;
  /** Controller pitch relative to the calibrated forward pose (rad), used to animate the arm. */
  pitchRad = 0;
  lastThrow: Throw | null = null;
  onThrow: ((t: Throw) => void) | null = null;
  onPhase: ((p: SwingPhase) => void) | null = null;
  /** Player preferences: sensitivity > 1 makes a softer swing count as a full one; invertHook flips spin. */
  prefs = { sensitivity: 1, invertHook: false };
  /** While false, samples still update aim/pitch but never start a swing. */
  enabled = false;

  private calib: Calibration = { gyroBias: [0, 0, 0], forward: [0, 0, 0, 1] };
  private prevTrigger = false;
  private yawAtSwing = 0;
  private peakRate = 0;
  private peakAccel = 0;
  private peakT = 0;
  private jerk = 0;
  private prevAccelMag = G;
  private rollHistory: number[] = [];

  setCalibration(c: Calibration): void { this.calib = c; }

  private get sens(): number { return Math.max(0.5, Math.min(1.5, this.prefs.sensitivity)); }

  private setPhase(p: SwingPhase): void { if (p !== this.phase) { this.phase = p; this.onPhase?.(p); } }

  feed(s: InputSample): void {
    const pitchRate = s.gyro[0] * TUNING.swingSign;
    const rollRate = -s.gyro[2];                         // rotation about the forward (-z) axis
    const rel = qToEuler(qMul(qConj(this.calib.forward), s.orientation));
    const yaw = rel.yaw * RAD;                           // + = turned left
    this.pitchRad = rel.pitch * TUNING.swingSign;
    const trigger = s.buttons.trigger && this.enabled;

    this.rollHistory.push(rollRate);
    if (this.rollHistory.length > 4) this.rollHistory.shift();

    // Aim follows yaw until the backswing starts (yaw right = aim right).
    if (this.phase === 'idle' || this.phase === 'aiming') this.aimX = clamp(-yaw / TUNING.aimYawRangeDeg, -1, 1);

    if (trigger && !this.prevTrigger && this.phase === 'idle') this.startAiming(yaw);

    if (this.phase === 'aiming') {
      if (pitchRate < -TUNING.backswingRate / this.sens) { this.yawAtSwing = yaw; this.setPhase('backswing'); }
      else if (pitchRate > TUNING.forwardRate * 1.5 / this.sens) { this.yawAtSwing = yaw; this.setPhase('forward'); }
    } else if (this.phase === 'backswing' && pitchRate > TUNING.forwardRate / this.sens) {
      this.setPhase('forward');
    }

    if (this.phase === 'forward') this.trackForward(s, pitchRate);

    if (!trigger && this.prevTrigger && this.phase !== 'idle') this.release(s, yaw);
    this.prevTrigger = trigger;
  }

  private startAiming(yaw: number): void {
    this.peakRate = 0; this.peakAccel = 0; this.jerk = 0; this.peakT = 0;
    this.yawAtSwing = yaw;
    this.setPhase('aiming');
  }

  private trackForward(s: InputSample, pitchRate: number): void {
    const aMag = vLen(s.accel);
    this.jerk += Math.abs(aMag - this.prevAccelMag);   // sum of accel-magnitude changes: smooth swings stay low
    this.prevAccelMag = aMag;
    if (pitchRate > this.peakRate) { this.peakRate = pitchRate; this.peakT = s.t; }
    this.peakAccel = Math.max(this.peakAccel, aMag - G);
  }

  private release(s: InputSample, yaw: number): void {
    const late = this.peakT > 0 && s.t - this.peakT > TUNING.releaseGraceMs * 3;
    const swung = this.phase === 'forward' && this.peakRate >= TUNING.weakRate / this.sens && !late;
    const t = swung ? this.realThrow(yaw) : this.weakThrow();
    this.lastThrow = t;
    this.setPhase('idle');
    this.onThrow?.(t);
  }

  private realThrow(yaw: number): Throw {
    // power: peak rotation rate plus a little linear accel, normalised between weakRate and rateForMaxSpeed
    const power = (this.peakRate + TUNING.accelWeight * Math.max(0, this.peakAccel)) * this.sens;
    const k = clamp((power - TUNING.weakRate) / (TUNING.rateForMaxSpeed - TUNING.weakRate), 0, 1);
    const speed = TUNING.speedMin + (TUNING.speedMax - TUNING.speedMin) * Math.pow(k, TUNING.speedCurve);

    // direction: yaw change during the swing (+yaw = left, so negate for "+ = right")
    let angle = -(yaw - this.yawAtSwing) * TUNING.yawToAngle;
    if (this.jerk > TUNING.jerkThreshold) {
      const extra = Math.min(1, (this.jerk - TUNING.jerkThreshold) / TUNING.jerkThreshold);
      angle += (Math.random() * 2 - 1) * TUNING.jerkNoiseDeg * extra;
    }
    angle = clamp(angle, -TUNING.maxAngleDeg, TUNING.maxAngleDeg);

    // spin: average wrist roll over the last few samples (one sample is too noisy)
    const roll = this.rollHistory.reduce((a, b) => a + b, 0) / Math.max(1, this.rollHistory.length);
    const spin = clamp(roll / TUNING.rollRateForMaxSpin, -1, 1) * TUNING.maxSpin * (this.prefs.invertHook ? -1 : 1);

    return { speed, angleDeg: angle, spin, aimX: this.aimX, weak: false, jerk: this.jerk, peakRate: this.peakRate, peakAccel: this.peakAccel };
  }

  private weakThrow(): Throw {
    return {
      speed: TUNING.weakSpeed, angleDeg: (Math.random() * 2 - 1) * 2, spin: 0, aimX: this.aimX,
      weak: true, jerk: this.jerk, peakRate: this.peakRate, peakAccel: this.peakAccel
    };
  }

  cancel(): void { this.setPhase('idle'); this.prevTrigger = false; }
}

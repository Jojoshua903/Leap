import type { Calibration, HoopGesture, HoopShot, InputSample, PaddleSwing, Throw, Vec3 } from '../types';
import { TUNING } from '../tuning';
import { TT_TUNING } from '../tabletennis/ttTuning';
import { BB_TUNING } from '../basketball/bbTuning';
import { FlickTracker, type FlickRaw } from '../frisbee/ThrowMapper';
import { qConj, qMul, qToEuler, vLen } from '../math/Filter';

export type SwingPhase = 'idle' | 'aiming' | 'backswing' | 'forward';
export type SwingMode = 'throw' | 'paddle' | 'hoops' | 'disc' | 'blade';
const G = 9.81;
const RAD = 180 / Math.PI;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/**
 * Turns InputSamples into one Throw per swing (mode 'throw', bowling) or one PaddleSwing per swing
 * (mode 'paddle', table tennis).
 *
 * Throw mode:
 *  idle ──trigger down──▶ aiming ──pitch rate < -backswingRate──▶ backswing
 *    ▲                      │                                        │
 *    │                      └── pitch rate > 1.5·forwardRate (flick) ┐   │ pitch rate > forwardRate
 *    │                                                               ▼   ▼
 *    └──────────── trigger up: throw (weak if no real forward swing) ◀── forward
 *
 * During the forward phase we track the peak pitch rate, peak linear accel and a jerk metric.
 * At release we read the yaw change since the swing started (direction) and the wrist roll rate (spin).
 *
 * Paddle mode: no trigger needed. A swing starts when the angular speed in the swing plane passes
 * TT_TUNING.swingRate and is emitted on the first sample after the peak (≤ 1 sample of delay, no
 * smoothing). Its timestamp is the peak sample, so the game judges timing on the real peak.
 * The trigger's rising edge is the serve toss.
 *
 * Hoops mode (basketball): holding the trigger "sets" the shot. Lifting the controller (pitch rate above
 * BB_TUNING.liftRate) starts the jump; the flick that follows (above flickRate) is the shot, emitted on
 * the first sample after its peak with the peak's timestamp as the release. Without the trigger, quick
 * motions are gestures: an up-flick (block), a sideways swipe (steal), a forward push (pass).
 */
export class SwingDetector {
  phase: SwingPhase = 'idle';
  mode: SwingMode = 'throw';
  aimX = 0;
  /** Controller pitch relative to the calibrated forward pose (rad), used to animate the arm. */
  pitchRad = 0;
  lastThrow: Throw | null = null;
  lastPaddle: PaddleSwing | null = null;
  onThrow: ((t: Throw) => void) | null = null;
  onPhase: ((p: SwingPhase) => void) | null = null;
  onPaddleSwing: ((s: PaddleSwing) => void) | null = null;
  onToss: (() => void) | null = null;
  /** Hoops: the shot was set (trigger down) or let go without shooting. */
  onHoopSet: ((held: boolean) => void) | null = null;
  /** Hoops: the lift (jump) started at this ms, or null when a lift fizzled out without a flick. */
  onHoopLift: ((t: number | null) => void) | null = null;
  onHoopShot: ((s: HoopShot) => void) | null = null;
  onHoopGesture: ((g: HoopGesture) => void) | null = null;
  lastHoop: HoopShot | null = null;
  /** Disc (frisbee): grip held / let go without a throw, and the flick at its release. Map it with ThrowMapper.mapFlick. */
  onDiscGrip: ((held: boolean) => void) | null = null;
  onDiscFlick: ((f: FlickRaw) => void) | null = null;
  lastFlick: FlickRaw | null = null;
  /** Blade (swordplay): every sample with the calibrated forward pose, straight through. */
  onBladeSample: ((s: InputSample, forward: Calibration['forward']) => void) | null = null;
  private readonly disc = new FlickTracker();
  /** Latest movement stick (x right, y forward) and A button, for modes that move a player. */
  stick: [number, number] = [0, 0];
  buttonA = false;
  /** Live paddle face angles relative to calibration (degrees), paddle mode. */
  readonly face = { yaw: 0, pitch: 0, roll: 0 };
  /** Live angular speed in the swing plane (rad/s), for the paddle animation. */
  rate = 0;
  /** Player preferences: sensitivity > 1 makes a softer swing count as a full one; invertHook flips spin. */
  prefs: { sensitivity: number; invertHook: boolean; handed?: 'right' | 'left' } = { sensitivity: 1, invertHook: false };
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

  // paddle swing state
  private pSwing = false;
  private pStartT = 0;
  private pPeak = 0;
  private pPeakT = 0;
  private pSumYaw = 0;
  private pSumPitch = 0;
  private pAtPeak = { yaw: 0, pitch: 0, roll: 0 };

  // hoops state
  private hSet = false;
  private hLift = false;
  private hFlick = false;
  private hLiftT = 0;
  private hPeak = 0;
  private hPeakT = 0;
  private hYaw = 0;
  private lpAccel: Vec3 | null = null;
  private gestureUntil = 0;

  setCalibration(c: Calibration): void { this.calib = c; }
  get calibration(): Calibration { return this.calib; }

  private get sens(): number { return Math.max(0.5, Math.min(1.5, this.prefs.sensitivity)); }

  private setPhase(p: SwingPhase): void { if (p !== this.phase) { this.phase = p; this.onPhase?.(p); } }

  feed(s: InputSample): void {
    const pitchRate = s.gyro[0] * TUNING.swingSign;
    const rollRate = -s.gyro[2];                         // rotation about the forward (-z) axis
    const rel = qToEuler(qMul(qConj(this.calib.forward), s.orientation));
    const yaw = rel.yaw * RAD;                           // + = turned left
    this.pitchRad = rel.pitch * TUNING.swingSign;
    const trigger = s.buttons.trigger && this.enabled;
    this.stick = s.stick ?? [0, 0];
    this.buttonA = s.buttons.a;

    if (this.mode === 'paddle') {
      this.feedPaddle(s, pitchRate, rollRate, rel);
      if (trigger && !this.prevTrigger) this.onToss?.();
      this.prevTrigger = trigger;
      return;
    }
    if (this.mode === 'hoops') {
      this.feedHoops(s, pitchRate, rel, trigger);
      this.prevTrigger = trigger;
      return;
    }
    if (this.mode === 'blade') {
      // swordplay: raw passthrough; BladeTracker + SlashDetector do the work (no extra delay here)
      this.rate = Math.hypot(s.gyro[0], s.gyro[1], s.gyro[2]);
      this.onBladeSample?.(s, this.calib.forward);
      this.prevTrigger = trigger;
      return;
    }
    if (this.mode === 'disc') {
      // live attitude for the aim preview; the flick itself is read by the FlickTracker (no smoothing)
      this.face.yaw = rel.yaw * RAD;
      this.face.pitch = rel.pitch * RAD * TUNING.swingSign;
      this.face.roll = rel.roll * RAD;
      this.rate = Math.hypot(s.gyro[1], pitchRate);
      this.disc.sensitivity = this.sens;
      this.disc.onGrip = this.onDiscGrip;
      const f = this.disc.feed(s, this.calib.forward, this.enabled);
      if (f) { this.lastFlick = f; this.onDiscFlick?.(f); }
      this.prevTrigger = trigger;
      return;
    }

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

  /* ---------------- paddle mode ---------------- */

  private feedPaddle(s: InputSample, pitchRate: number, rollRate: number, rel: { yaw: number; pitch: number; roll: number }): void {
    const T = TT_TUNING;
    const yawRate = s.gyro[1];
    this.face.yaw = rel.yaw * RAD;
    this.face.pitch = rel.pitch * RAD * TUNING.swingSign;
    this.face.roll = rel.roll * RAD;
    this.aimX = clamp(-this.face.yaw / T.faceYawRangeDeg, -1, 1);
    const rate = Math.hypot(pitchRate, yawRate);
    this.rate = rate;
    const start = T.swingRate / this.sens;

    if (!this.pSwing) {
      if (!this.enabled || rate < start) return;
      this.pSwing = true;
      this.pStartT = s.t;
      this.pPeak = 0; this.pSumYaw = 0; this.pSumPitch = 0;
    }
    this.pSumYaw += yawRate;
    this.pSumPitch += pitchRate;
    if (rate > this.pPeak) {
      this.pPeak = rate;
      this.pPeakT = s.t;
      this.pAtPeak = { yaw: this.face.yaw, pitch: this.face.pitch, roll: rollRate };
      return;
    }
    // first sample after the peak, or the swing died out, or it went on too long
    if (rate < this.pPeak * 0.9 || rate < start * 0.6 || s.t - this.pStartT > 600) this.emitPaddle();
  }

  private emitPaddle(): void {
    const T = TT_TUNING;
    this.pSwing = false;
    const start = T.swingRate / this.sens;
    const power = clamp((this.pPeak * this.sens - start) / Math.max(0.1, T.rateForFullPower - start), 0, 1.15);
    const total = Math.abs(this.pSumYaw) + Math.abs(this.pSumPitch) || 1;
    const left = this.prefs.handed === 'left';
    const sw: PaddleSwing = {
      t: this.pPeakT,
      power,
      direction: clamp(-this.pAtPeak.yaw / T.faceYawRangeDeg, -1.2, 1.2),
      loft: clamp(this.pAtPeak.pitch / T.facePitchRangeDeg, 0, 1),
      brush: clamp(this.pSumPitch / total / T.brushForFullSpin, -1, 1),
      roll: clamp(this.pAtPeak.roll / T.rollForFullSide, -1, 1) * (this.prefs.invertHook ? -1 : 1),
      // a right-hander's forehand sweeps right → left, which is a positive yaw rate
      forehand: left ? this.pSumYaw < 0 : this.pSumYaw >= 0,
      peakRate: this.pPeak
    };
    this.lastPaddle = sw;
    this.onPaddleSwing?.(sw);
  }

  /* ---------------- hoops mode ---------------- */

  private feedHoops(s: InputSample, pitchRate: number, rel: { yaw: number; pitch: number; roll: number }, trigger: boolean): void {
    const T = BB_TUNING, sens = this.sens;
    const yawRate = s.gyro[1];
    this.face.yaw = rel.yaw * RAD;
    this.face.pitch = rel.pitch * RAD * TUNING.swingSign;
    this.face.roll = rel.roll * RAD;
    this.aimX = clamp(-this.face.yaw / 30, -1, 1);
    this.rate = Math.abs(pitchRate);
    // slow average of the accelerometer; what sticks out above it is a push
    const lp = (this.lpAccel ??= [s.accel[0], s.accel[1], s.accel[2]]);
    for (let i = 0; i < 3; i++) lp[i] += (s.accel[i] - lp[i]) * 0.08;
    const hpZ = s.accel[2] - lp[2];

    if (trigger && !this.prevTrigger) {
      this.hSet = true; this.hLift = false; this.hFlick = false; this.hPeak = 0;
      this.onHoopSet?.(true);
    }
    if (!trigger && this.prevTrigger && this.hSet) { this.hSet = false; this.onHoopSet?.(false); }

    if (this.hSet) {
      if (!this.hLift) {
        if (pitchRate > T.liftRate / sens) {
          this.hLift = true; this.hLiftT = s.t;
          this.hPeak = pitchRate; this.hPeakT = s.t; this.hYaw = this.face.yaw;
          this.onHoopLift?.(s.t);
        }
        return;
      }
      if (pitchRate > this.hPeak) {
        this.hPeak = pitchRate; this.hPeakT = s.t; this.hYaw = this.face.yaw;
        if (pitchRate > T.flickRate / sens) this.hFlick = true;
        return;
      }
      // first sample after the peak of a real flick: that peak was the release
      if (this.hFlick && pitchRate < this.hPeak * 0.9) {
        this.hSet = false;
        const shot: HoopShot = { t: this.hPeakT, liftT: this.hLiftT, peakRate: this.hPeak * sens, yawDeg: this.hYaw };
        this.lastHoop = shot;
        this.onHoopShot?.(shot);
        return;
      }
      // lifted but never flicked: the jump is over, back to the set
      if (!this.hFlick && s.t - this.hLiftT > 900) { this.hLift = false; this.hPeak = 0; this.onHoopLift?.(null); }
      return;
    }

    if (!this.enabled || s.t < this.gestureUntil) return;
    let g: HoopGesture | null = null;
    if (pitchRate > T.blockRate / sens) g = { kind: 'flickUp', t: s.t, dir: 0, yawDeg: this.face.yaw };
    else if (Math.abs(yawRate) > T.swipeRate / sens && Math.abs(yawRate) > Math.abs(pitchRate) * 1.3) g = { kind: 'swipe', t: s.t, dir: Math.sign(yawRate), yawDeg: this.face.yaw };
    else if (-hpZ > T.pushAccel / sens && Math.hypot(s.gyro[0], s.gyro[1], s.gyro[2]) < 4) g = { kind: 'push', t: s.t, dir: 0, yawDeg: this.face.yaw };
    if (g) { this.gestureUntil = s.t + 380; this.onHoopGesture?.(g); }
  }

  /* ---------------- throw mode ---------------- */

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

  cancel(): void { this.setPhase('idle'); this.prevTrigger = false; this.pSwing = false; this.hSet = false; this.hLift = false; this.hFlick = false; this.disc.cancel(); }
}

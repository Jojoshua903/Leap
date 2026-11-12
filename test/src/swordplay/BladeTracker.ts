import type { InputSample, Quat } from '../types';
import { qConj, qMul, qRotate } from '../math/Filter';
import { SW_TUNING } from './swordTuning';
import { add, clamp, cross, len, norm, scale, sub, v3, type V3 } from './swMath';

/** One blade sample for the SlashDetector, in the P frame (x right, y up, z forward). */
export interface BladeSample {
  /** ms */
  t: number;
  tip: V3;
  /** Unit vector hilt → tip. */
  dir: V3;
  /** Angular speed of the controller, rad/s. */
  gyro: number;
  /** Linear acceleration along forward, gravity removed (m/s²). 0 for the mouse. */
  accelFwd: number;
  /** Wrist roll rate about the controller's long axis (rad/s, + = counter-clockwise seen from behind). */
  roll: number;
}

const G = 9.81;

/**
 * The blade pose from a controller that has orientation but no position.
 *
 * The hilt sits at a fixed anchor in front of the sword shoulder; the blade points along the controller
 * (its "pointing" axis, −z in the device frame) relative to the calibrated forward. Swinging the wrist or arm
 * tilts the blade, so the tip moves on a sphere of radius `bladeLen` around the anchor.
 *
 * Drift: gravity keeps pitch and roll honest, yaw is not. While the controller is held still the yaw slowly
 * eases back to straight ahead (`recenterRate`), and `recenter()` (B / R key / phone double tap) snaps it.
 *
 * No smoothing anywhere: each sample sets the pose directly. At most one frame of prediction is added along
 * the gyro rate so the blade feels attached to the hand.
 *
 * Mouse: `updateMouse` moves the tip across a plane in front of the hilt toward the cursor, with a speed limit.
 */
export class BladeTracker {
  handed: 'right' | 'left' = 'right';
  /** Live pose (P frame). */
  anchor: V3 = v3();
  dir: V3 = v3(0, 0.6, 0.8);
  tip: V3 = v3();
  vel: V3 = v3();
  speed = 0;
  gyro = 0;
  roll = 0;
  accelFwd = 0;
  t = 0;
  /** Forward lunge of the hilt (m), the mouse thrust. */
  lunge = 0;
  /** Yaw correction (rad) applied about world up. */
  private yawOffset = 0;
  private wantRecenter = false;
  private stillSince = -1;
  private prevTip: V3 | null = null;
  private prevT = 0;
  private mouseTip: V3 | null = null;
  private thrustT = -1;

  constructor(handed: 'right' | 'left' = 'right') { this.handed = handed; this.placeAnchor(); }

  private placeAnchor(): void {
    const T = SW_TUNING, s = this.handed === 'left' ? -1 : 1;
    this.anchor = v3(T.anchorX * s, T.anchorY, T.anchorZ + this.lunge);
  }

  /** Snap the yaw so the blade points straight ahead on the next sample. */
  recenter(): void { this.wantRecenter = true; if (this.mouseTip) this.mouseTip = null; }

  /** Current blade yaw (degrees, + = right) and pitch (degrees, + = up), for the overlay. */
  get yawDeg(): number { return Math.atan2(this.dir.x, this.dir.z) * 180 / Math.PI; }
  get pitchDeg(): number { return Math.asin(clamp(this.dir.y, -1, 1)) * 180 / Math.PI; }

  /**
   * One controller sample. `forward` is the calibrated forward orientation.
   * LATENCY: called straight from the backend's sample callback (no buffering); the pose is ready for the
   * next physics step / frame.
   */
  feed(s: InputSample, forward: Quat): BladeSample {
    const T = SW_TUNING;
    this.placeAnchor();
    const rel = qMul(qConj(forward), s.orientation);
    let off: Quat = [0, Math.sin(this.yawOffset / 2), 0, Math.cos(this.yawOffset / 2)];
    let r = qMul(off, rel);
    // pointing direction in the calibrated world frame (x right, y up, z toward the player)
    let d = qRotate(r, [0, 0, -1]);
    const yaw = Math.atan2(d[0], -d[2]);
    const gyroMag = Math.hypot(s.gyro[0], s.gyro[1], s.gyro[2]);
    if (this.wantRecenter) {
      this.wantRecenter = false;
      this.yawOffset += yaw;
    } else if (T.recenterRate > 0 && Math.abs(d[1]) < 0.85) {
      // slow auto re-centering while held still
      if (gyroMag < T.stillRate) {
        if (this.stillSince < 0) this.stillSince = s.t;
        if (s.t - this.stillSince > T.stillMs) {
          const dt = Math.min(0.05, Math.max(0, (s.t - this.prevT) / 1000));
          const step = T.recenterRate * Math.PI / 180 * dt;
          this.yawOffset += clamp(yaw, -step, step);
        }
      } else this.stillSince = -1;
    }
    off = [0, Math.sin(this.yawOffset / 2), 0, Math.cos(this.yawOffset / 2)];
    r = qMul(off, rel);
    d = qRotate(r, [0, 0, -1]);
    // LATENCY: one short extrapolation along the angular velocity (≤ 1 frame). Raise predictMs only if the
    // blade lags; it overshoots on sudden stops.
    const k = clamp(T.predictMs, 0, 16.7) / 1000;
    if (k > 0) {
      const wWorld = qRotate(s.orientation, s.gyro);
      const w = qRotate(qMul(off, qConj(forward)), wWorld);
      const dv = { x: d[0], y: d[1], z: d[2] };
      const dp = add(dv, scale(cross({ x: w[0], y: w[1], z: w[2] }, dv), k));
      d = [dp.x, dp.y, dp.z];
    }
    // world (z toward the player) → P frame (z forward)
    this.dir = norm(v3(d[0], d[1], -d[2]));
    this.gyro = gyroMag;
    this.roll = -s.gyro[2];
    // forward linear acceleration, gravity removed, in the re-centered frame
    const aw = qRotate(s.orientation, s.accel);
    const lin = qRotate(qMul(off, qConj(forward)), [aw[0], aw[1] - G, aw[2]]);
    this.accelFwd = -lin[2];
    return this.finish(s.t);
  }

  /**
   * Mouse fallback. `nx`, `ny` = cursor position −1..1 (y up), `dt` in seconds. The tip follows the cursor on
   * a plane in front of the hilt with a speed limit, so the mouse can't out-slash a real swing.
   */
  updateMouse(nx: number, ny: number, tMs: number, dt: number): BladeSample {
    const T = SW_TUNING;
    // the thrust lunge: out fast, back slower
    if (this.thrustT >= 0) {
      this.thrustT += dt;
      const out = 0.08, back = 0.22;
      this.lunge = this.thrustT < out ? 0.35 * (this.thrustT / out) : 0.35 * Math.max(0, 1 - (this.thrustT - out) / back);
      if (this.thrustT > out + back) { this.thrustT = -1; this.lunge = 0; }
    }
    this.placeAnchor();
    const a = this.anchor;
    const target = v3(clamp(nx, -1, 1) * T.mouseSpanX / 2, T.anchorY + 0.15 + clamp(ny, -1, 1) * T.mouseSpanY / 2, a.z + T.mousePlaneZ);
    const want = add(a, scale(norm(sub(target, a)), T.bladeLen));
    if (!this.mouseTip) this.mouseTip = want;
    const step = sub(want, this.mouseTip), d = len(step), max = T.mouseMaxSpeed * dt;
    this.mouseTip = d > max ? add(this.mouseTip, scale(step, max / d)) : want;
    this.dir = norm(sub(this.mouseTip, a));
    const prev = this.dir;
    this.gyro = this.prevTip ? len(sub(add(a, scale(prev, T.bladeLen)), this.prevTip)) / Math.max(1e-3, dt) / T.bladeLen : 0;
    this.roll = 0;
    this.accelFwd = 0;
    return this.finish(tMs);
  }

  /** Mouse click: a quick forward lunge of the hilt (the SlashDetector sees a thrust). */
  mouseThrust(): void { if (this.thrustT < 0) this.thrustT = 0; }

  private finish(tMs: number): BladeSample {
    this.tip = add(this.anchor, scale(this.dir, SW_TUNING.bladeLen));
    const dt = (tMs - this.prevT) / 1000;
    if (this.prevTip && dt > 0.001 && dt < 0.1) {
      this.vel = scale(sub(this.tip, this.prevTip), 1 / dt);
      this.speed = len(this.vel);
    } else { this.vel = v3(); this.speed = 0; }
    this.prevTip = { ...this.tip };
    this.prevT = tMs;
    this.t = tMs;
    return { t: tMs, tip: { ...this.tip }, dir: { ...this.dir }, gyro: this.gyro, accelFwd: this.accelFwd, roll: this.roll };
  }

  /** Forget motion history (after a pause or a teleport). */
  reset(): void { this.prevTip = null; this.vel = v3(); this.speed = 0; this.stillSince = -1; }
}

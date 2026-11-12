import type { Quat, Vec3 } from '../types';

/* ---------- small quaternion / vector helpers on tuples ---------- */
export const qIdentity = (): Quat => [0, 0, 0, 1];

export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}
export const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
export function qNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
/** Rotate vector v by quaternion q. */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  const p = qMul(qMul(q, [v[0], v[1], v[2], 0]), qConj(q));
  return [p[0], p[1], p[2]];
}
export function qFromEuler(yaw: number, pitch: number, roll: number): Quat {
  // order: yaw about Y, then pitch about X, then roll about Z
  const qy: Quat = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const qx: Quat = [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)];
  const qz: Quat = [0, 0, Math.sin(roll / 2), Math.cos(roll / 2)];
  return qMul(qMul(qy, qx), qz);
}
/** Yaw / pitch / roll (radians) of q, matching qFromEuler's YXZ order. */
export function qToEuler(q: Quat): { yaw: number; pitch: number; roll: number } {
  const [x, y, z, w] = q;
  const sinP = 2 * (w * x - y * z);
  const pitch = Math.abs(sinP) >= 1 ? Math.sign(sinP) * Math.PI / 2 : Math.asin(sinP);
  const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
  const roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z));
  return { yaw, pitch, roll };
}
export const vLen = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const G = 9.81;

/**
 * Complementary filter (Mahony-style, proportional only).
 *
 * 1. Integrate the gyro: q ← q ⊗ exp(½·ω·dt). Accurate short-term but drifts.
 * 2. Gravity check: rotate world-up into the device frame and compare it with the measured
 *    accel direction. Their cross product is the tilt error axis.
 * 3. Feed that error back into ω with gain Kp = filterGain / dt, which equals blending
 *    `filterGain` of the accel tilt into the estimate every sample (0.02 at 120 Hz ≈ 0.4 s
 *    time constant). Gravity can't correct yaw, which is why calibration stores "forward".
 * 4. The correction is skipped while |accel| is far from 1 g (mid-swing), so the swing itself
 *    doesn't bend the estimate.
 */
export class ComplementaryFilter {
  q: Quat = qIdentity();
  constructor(public gain: number) {}

  reset(q: Quat = qIdentity()): void { this.q = q; }

  update(gyro: Vec3, accel: Vec3, dt: number): Quat {
    if (dt <= 0 || dt > 0.25) return this.q;
    let w: Vec3 = [gyro[0], gyro[1], gyro[2]];
    const aLen = vLen(accel);
    if (aLen > 0.7 * G && aLen < 1.3 * G) {
      const a: Vec3 = [accel[0] / aLen, accel[1] / aLen, accel[2] / aLen];
      const upInDevice = qRotate(qConj(this.q), [0, 1, 0]);
      const e = cross(a, upInDevice);
      const kp = this.gain / dt;
      w = [w[0] + kp * e[0], w[1] + kp * e[1], w[2] + kp * e[2]];
    }
    const half = 0.5 * dt;
    const dq: Quat = [w[0] * half, w[1] * half, w[2] * half, 1];
    this.q = qNormalize(qMul(this.q, dq));
    return this.q;
  }
}

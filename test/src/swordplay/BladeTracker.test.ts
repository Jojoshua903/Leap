import { describe, expect, it } from 'vitest';
import { qFromEuler } from '../math/Filter';
import type { InputSample, Quat } from '../types';
import { BladeTracker } from './BladeTracker';
import { SW_TUNING } from './swordTuning';
import { len, sub } from './swMath';

const D2R = Math.PI / 180;
const FWD: Quat = [0, 0, 0, 1];
const sample = (t: number, yaw: number, pitch: number, gyro: [number, number, number] = [0, 0, 0]): InputSample => ({
  t, accel: [0, 9.81, 0], gyro, orientation: qFromEuler(yaw * D2R, pitch * D2R, 0), buttons: { trigger: false, a: false, b: false }
});

describe('BladeTracker', () => {
  it('points forward at the calibrated pose, with the tip one blade length from the hilt', () => {
    const b = new BladeTracker('right');
    b.feed(sample(0, 0, 0), FWD);
    expect(b.dir.z).toBeCloseTo(1);
    expect(len(sub(b.tip, b.anchor))).toBeCloseTo(SW_TUNING.bladeLen);
    expect(b.anchor.x).toBeGreaterThan(0);
    expect(new BladeTracker('left').anchor.x).toBeLessThan(0);
  });

  it('turning left points the blade left, tilting up points it up', () => {
    const b = new BladeTracker();
    b.feed(sample(0, 30, 0), FWD);
    expect(b.yawDeg).toBeCloseTo(-30, 0);
    b.feed(sample(10, 0, 40), FWD);
    expect(b.pitchDeg).toBeCloseTo(40, 0);
  });

  it('recenter snaps the yaw back to straight ahead', () => {
    const b = new BladeTracker();
    b.feed(sample(0, 25, 0, [0, 1, 0]), FWD);
    b.recenter();
    b.feed(sample(10, 25, 0, [0, 1, 0]), FWD);
    expect(Math.abs(b.yawDeg)).toBeLessThan(1.5);
  });

  it('eases the yaw back while held still', () => {
    const b = new BladeTracker();
    let t = 0;
    for (; t < 3000; t += 8) b.feed(sample(t, 20, 0), FWD);
    expect(Math.abs(b.yawDeg)).toBeLessThan(20 - SW_TUNING.recenterRate * 2);
  });

  it('predicts a little along the gyro rate (no more than a frame)', () => {
    const a = new BladeTracker(), still = { ...SW_TUNING };
    a.feed(sample(0, 0, 0, [0, 0, 0]), FWD);
    const noPred = a.dir.x;
    const b = new BladeTracker();
    // turning right fast (negative yaw rate about +y)
    b.feed(sample(0, 0, 0, [0, -10, 0]), FWD);
    expect(b.dir.x).toBeGreaterThan(noPred);
    expect(Math.atan2(b.dir.x, b.dir.z)).toBeLessThan(10 * 0.0167 + 1e-6);
    expect(still.predictMs).toBeLessThanOrEqual(16.7);
  });

  it('mouse: the tip follows the cursor with a speed limit', () => {
    const b = new BladeTracker();
    b.updateMouse(-1, 0, 0, 1 / 120);
    const p0 = { ...b.tip };
    b.updateMouse(1, 0, 8.33, 1 / 120);
    // (a hair more than the chord step: the tip is put back on the blade sphere)
    expect(len(sub(b.tip, p0))).toBeLessThanOrEqual(SW_TUNING.mouseMaxSpeed / 120 * 1.02);
    for (let i = 0; i < 120; i++) b.updateMouse(1, 0, 8.33 * (i + 2), 1 / 120);
    expect(b.tip.x).toBeGreaterThan(0.3);
    expect(len(sub(b.tip, b.anchor))).toBeCloseTo(SW_TUNING.bladeLen);
  });
});

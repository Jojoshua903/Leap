import { describe, expect, it } from 'vitest';
import type { InputSample, Quat } from '../types';
import { qFromEuler } from '../math/Filter';
import { Rng } from '../tabletennis/BallPhysics';
import { DISC_TYPES, FB_TUNING } from './frisbeeTuning';
import { FlickTracker, mapFlick, mapSling, spinSign, type FlickRaw } from './ThrowMapper';

const D2R = Math.PI / 180;
const FWD: Quat = [0, 0, 0, 1];

interface Pose { yaw: number; pitch: number; roll: number }

/**
 * A synthetic flick at 120 Hz: trigger down, a bell-shaped burst of yaw rate (the sweep) peaking at `peak`,
 * with a little wrist roll, ending in the attitude `atRelease` (degrees).
 */
function flick(o: { peak: number; yawSign: number; atRelease?: Partial<Pose>; roll?: number; jerky?: boolean; pitch?: boolean }): InputSample[] {
  const out: InputSample[] = [];
  const rel = { yaw: 0, pitch: 0, roll: 0, ...o.atRelease };
  let t = 1000;
  const push = (gyro: [number, number, number], trigger: boolean, accelMag = 9.81, pose: Pose = rel) => {
    out.push({
      t, accel: [0, accelMag, 0], gyro,
      orientation: qFromEuler(pose.yaw * D2R, pose.pitch * D2R, pose.roll * D2R),
      buttons: { trigger, a: false, b: false }
    });
    t += 1000 / 120;
  };
  for (let i = 0; i < 6; i++) push([0, 0, 0], true);                 // grip, holding still
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const k = Math.sin((i / N) * Math.PI);                            // 0 → 1 → 0
    const r = o.peak * k;
    const a = 9.81 + (o.jerky ? (i % 2 ? 30 : -20) : 6 * k);
    push(o.pitch ? [r, 0, -(o.roll ?? 0) * k] : [0, r * o.yawSign, -(o.roll ?? 0) * k], true, a);
  }
  for (let i = 0; i < 4; i++) push([0, 0, 0], true);
  push([0, 0, 0], false);
  return out;
}

function run(samples: InputSample[]): FlickRaw | null {
  const tr = new FlickTracker();
  let got: FlickRaw | null = null;
  for (const s of samples) { const f = tr.feed(s, FWD); if (f && !got) got = f; }
  return got;
}

describe('ThrowMapper', () => {
  it('a strong right-hand backhand flick (sweeping right) maps into the expected ranges', () => {
    const f = run(flick({ peak: 18, yawSign: -1, roll: 8 }));
    expect(f).not.toBeNull();
    const p = mapFlick(f!, { handed: 'right', disc: DISC_TYPES.driver });
    expect(p.forehand).toBe(false);
    expect(p.spin).toBeLessThan(0);                                    // clockwise from above
    expect(p.speed).toBeGreaterThan(18);
    expect(p.speed).toBeLessThanOrEqual(32);
    expect(Math.abs(p.spin)).toBeGreaterThanOrEqual(10);
    expect(Math.abs(p.spin)).toBeLessThanOrEqual(60);
    expect(Math.abs(p.yawDeg)).toBeLessThan(1);
    expect(p.quality).toBeGreaterThan(0.8);
  });

  it('a soft flick is slow, a wiggle is no throw', () => {
    const soft = run(flick({ peak: 7.5, yawSign: -1 }));
    expect(soft).not.toBeNull();
    expect(mapFlick(soft!, { handed: 'right', disc: DISC_TYPES.dog }).speed).toBeLessThan(10);
    expect(run(flick({ peak: 4, yawSign: -1 }))).toBeNull();
  });

  it('release attitude sets direction, loft and bank', () => {
    const f = run(flick({ peak: 15, yawSign: -1, atRelease: { yaw: 10, pitch: 10, roll: -20 } }))!;
    const p = mapFlick(f, { handed: 'right', disc: DISC_TYPES.mid });
    expect(p.yawDeg).toBeCloseTo(-10 * FB_TUNING.yawGain, 0);          // turned left at the release → goes left
    expect(p.loftDeg).toBeCloseTo(10 * FB_TUNING.pitchGain + FB_TUNING.loftOffset, 0);
    expect(p.bankDeg).toBeCloseTo(20 * FB_TUNING.rollGain, 0);        // right side down = anhyzer for a backhand
    // all within the documented limits
    expect(p.loftDeg).toBeGreaterThanOrEqual(-5); expect(p.loftDeg).toBeLessThanOrEqual(25);
    expect(Math.abs(p.bankDeg)).toBeLessThanOrEqual(35);
  });

  it('a right-hand forehand sweeps the other way and spins counter-clockwise', () => {
    const f = run(flick({ peak: 15, yawSign: 1 }))!;
    const p = mapFlick(f, { handed: 'right', disc: DISC_TYPES.dog });
    expect(p.forehand).toBe(true);
    expect(p.spin).toBeGreaterThan(0);
  });

  it('is mirrored for left-handers', () => {
    // the same motion mirrored: a left-hand backhand sweeps left
    const f = run(flick({ peak: 15, yawSign: 1 }))!;
    const p = mapFlick(f, { handed: 'left', disc: DISC_TYPES.dog });
    expect(p.forehand).toBe(false);
    expect(p.spin).toBeGreaterThan(0);
    expect(spinSign(false, 'left')).toBe(-spinSign(false, 'right'));
    expect(spinSign(true, 'left')).toBe(-spinSign(true, 'right'));
  });

  it('a jerky flick has lower quality and more wobble', () => {
    const clean = mapFlick(run(flick({ peak: 15, yawSign: -1 }))!, { handed: 'right', disc: DISC_TYPES.dog });
    const jerky = mapFlick(run(flick({ peak: 15, yawSign: -1, jerky: true }))!, { handed: 'right', disc: DISC_TYPES.dog });
    expect(jerky.quality).toBeLessThan(clean.quality);
    expect(jerky.wobble).toBeGreaterThan(clean.wobble);
  });

  it('a forward (pitch) flick counts as a backhand', () => {
    const f = run(flick({ peak: 15, yawSign: 1, pitch: true }))!;
    expect(mapFlick(f, { handed: 'right', disc: DISC_TYPES.dog }).forehand).toBe(false);
  });

  it('letting go of the trigger without a flick is no throw', () => {
    const tr = new FlickTracker();
    const grips: boolean[] = [];
    tr.onGrip = h => grips.push(h);
    const s = flick({ peak: 2, yawSign: -1 });
    for (const x of s) expect(tr.feed(x, FWD)).toBeNull();
    expect(grips).toEqual([true, false]);
  });

  it('mouse slingshot: direction opposite the pull, capped speed, no throw for a tiny pull', () => {
    const rng = new Rng(1);
    const straight = mapSling({ dx: 0, dy: 300, bankDeg: 0, noseDeg: 8 }, { handed: 'right', disc: DISC_TYPES.driver });
    expect(straight!.speed).toBeLessThanOrEqual(DISC_TYPES.driver.maxSpeed * FB_TUNING.slingCap + 1e-9);
    expect(straight!.yawDeg).toBeCloseTo(0, 5);
    const right = mapSling({ dx: -120, dy: 200, bankDeg: 10, noseDeg: 8 }, { handed: 'right', disc: DISC_TYPES.dog, rng });
    expect(right!.yawDeg).toBeGreaterThan(10);                        // pulled left → flies right
    expect(right!.bankDeg).toBeCloseTo(10, 5);
    expect(mapSling({ dx: 0, dy: 5, bankDeg: 0, noseDeg: 8 }, { handed: 'right', disc: DISC_TYPES.dog })).toBeNull();
    expect(mapSling({ dx: 0, dy: -200, bankDeg: 0, noseDeg: 8 }, { handed: 'right', disc: DISC_TYPES.dog })).toBeNull();
  });
});

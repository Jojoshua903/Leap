import { describe, expect, it } from 'vitest';
import { closestSegSeg, segmentDistance, sweepCapsule, type Shape } from './HitTest';
import { SW_TUNING } from './swordTuning';
import { v3 } from './swMath';

const R = SW_TUNING.bladeRadius;
/** A blade standing upright at x (hilt y 0.8, tip y 1.7), at depth z. */
const blade = (x: number, z = 0.6) => ({ a: v3(x, 0.8, z), b: v3(x, 1.7, z) });

describe('HitTest', () => {
  it('a slash through the centre hits, with the point on the near side and the normal facing the blade', () => {
    const s: Shape = { kind: 'sphere', c: v3(0, 1.2, 0.6), r: 0.1 };
    const h = sweepCapsule(blade(-0.5), blade(0.5), R, s)!;
    expect(h).not.toBeNull();
    expect(h.point.x).toBeCloseTo(-0.1, 2);
    expect(h.point.y).toBeCloseTo(1.2, 2);
    expect(h.normal.x).toBeCloseTo(-1, 2);
    expect(h.dir.x).toBeCloseTo(1, 3);
    expect(h.t).toBeGreaterThan(0.35);
    expect(h.t).toBeLessThan(0.5);
    expect(h.along).toBeCloseTo((1.2 - 0.8) / 0.9, 1);
  });

  it('no tunnelling at the fastest blade speed (and far beyond it)', () => {
    // 30 m/s at 120 Hz = 0.25 m per step; try a whole 2 m jump past a 2 cm target
    const tiny: Shape = { kind: 'sphere', c: v3(0, 1.2, 0.6), r: 0.02 };
    expect(sweepCapsule(blade(-0.125), blade(0.125), R, tiny)).not.toBeNull();
    expect(sweepCapsule(blade(-1), blade(1), R, tiny)).not.toBeNull();
    const thinBox: Shape = { kind: 'box', c: v3(0, 1.2, 0.6), half: v3(0.01, 0.3, 0.3) };
    expect(sweepCapsule(blade(-1), blade(1), R, thinBox)).not.toBeNull();
    const pole: Shape = { kind: 'capsule', a: v3(0, 0.5, 0.6), b: v3(0, 2, 0.6), r: 0.015 };
    expect(sweepCapsule(blade(-1, 0.6), blade(1, 0.6), R, pole)).not.toBeNull();
  });

  it('a miss by a margin does not hit', () => {
    const s: Shape = { kind: 'sphere', c: v3(0, 1.2, 0.6 + 0.1 + R + 0.05), r: 0.1 };
    expect(sweepCapsule(blade(-0.5), blade(0.5), R, s)).toBeNull();
    // above the tip
    const high: Shape = { kind: 'sphere', c: v3(0, 1.7 + 0.1 + R + 0.05, 0.6), r: 0.1 };
    expect(sweepCapsule(blade(-0.5), blade(0.5), R, high)).toBeNull();
    const box: Shape = { kind: 'box', c: v3(0, 1.2, 1.2), half: v3(0.1, 0.1, 0.1) };
    expect(sweepCapsule(blade(-0.5), blade(0.5), R, box)).toBeNull();
  });

  it('boxes (also turned) and capsules hit at the right place', () => {
    const box: Shape = { kind: 'box', c: v3(0, 1.2, 0.6), half: v3(0.15, 0.1, 0.1), yaw: Math.PI / 2 };
    // turned 90°: the 0.15 half-width now lies along z, so the x face is at 0.1
    const h = sweepCapsule(blade(-0.6), blade(0.6), R, box)!;
    expect(h.point.x).toBeCloseTo(-0.1, 2);
    const cap: Shape = { kind: 'capsule', a: v3(0, 1.0, 0.6), b: v3(0, 1.0, 0.9), r: 0.08 };
    const hc = sweepCapsule(blade(-0.6), blade(0.6), R, cap)!;
    expect(hc.point.x).toBeCloseTo(-0.08, 2);
    expect(hc.normal.x).toBeLessThan(-0.9);
  });

  it('segment helpers', () => {
    const r = closestSegSeg(v3(-1, 0, 0), v3(1, 0, 0), v3(0, -1, 1), v3(0, 1, 1));
    expect(r.c1.x).toBeCloseTo(0);
    expect(r.c2.z).toBeCloseTo(1);
    expect(segmentDistance(v3(0, 0, 0), v3(0, 0, 0), { kind: 'box', c: v3(0, 0, 0), half: v3(1, 1, 1) }).d).toBeLessThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { Rng } from '../tabletennis/BallPhysics';
import {
  applyError, arcFor, gradeTiming, HOOP_CENTER, inputFromFlick, inputFromMeter, isMake, predictOutcome, solveIdealShot,
  type ShotInput, type V3
} from './ShotSolver';
import { BB_TUNING, COURT, isOutsideArc, type ShotAssist } from './bbTuning';

const RELEASE_H = 2.3;
const at = (x: number, z: number): V3 => ({ x, y: RELEASE_H, z });
const NONE: ShotInput = { powerErr: 0, dirErrDeg: 0, timingMs: 0 };

/** The five contest spots, just behind the 3-point line. */
const SPOTS: V3[] = [
  at(-6.85, 0.6), at(-5.0, 5.0), at(0, 7.0), at(5.0, 5.0), at(6.85, 0.6)
];

describe('solveIdealShot', () => {
  it('passes through the hoop centre from five named spots (free throw, wing, top, corner, block)', () => {
    const spots = [at(0, COURT.freeThrowZ + 0.38), at(-4, 3), at(0, 6.9), at(6.85, 0.5), at(1.6, 1.2)];
    for (const s of spots) {
      const ideal = solveIdealShot(s);
      const o = predictOutcome(s, ideal.vel);
      expect(o.outcome, JSON.stringify(s)).toBe('swish');
      expect(o.rimDist).toBeLessThan(0.03);
    }
  });

  it('ideal shots go in from ≥ 99 % of 500 random spots on the court', () => {
    const r = new Rng(42);
    let made = 0;
    for (let i = 0; i < 500; i++) {
      const d = 1.5 + r.next() * 7, a = (r.next() - 0.5) * Math.PI * 0.9;
      const s = at(Math.sin(a) * d, Math.max(0.3, Math.cos(a) * d));
      if (isMake(predictOutcome(s, solveIdealShot(s).vel).outcome)) made++;
    }
    expect(made / 500).toBeGreaterThanOrEqual(0.99);
  });

  it('uses a 48–58° arc from mid and long range, steeper under the basket', () => {
    for (const s of SPOTS) {
      const arc = arcFor(s);
      expect(arc).toBeGreaterThanOrEqual(48);
      expect(arc).toBeLessThanOrEqual(58);
    }
    expect(arcFor(at(0, 1))).toBeGreaterThan(58);
  });

  it('stays under the speed cap', () => {
    const far = solveIdealShot(at(0, 12));
    expect(far.speed).toBeLessThanOrEqual(BB_TUNING.maxLaunchSpeed + 1e-9);
  });

  it('the contest spots are outside the arc', () => {
    for (const s of SPOTS) expect(isOutsideArc(s.x, s.z)).toBe(true);
    expect(isOutsideArc(0, 4)).toBe(false);
  });
});

describe('player error', () => {
  it('perfect input is a swish (any assist level)', () => {
    for (const s of SPOTS) for (const a of [0, 1, 2, 3] as ShotAssist[]) {
      const shot = applyError(solveIdealShot(s), NONE, a);
      expect(predictOutcome(s, shot.vel).outcome).toBe('swish');
    }
  });

  it('a 5 % power error from 3-point range usually misses (assist off)', () => {
    let misses = 0;
    for (const s of SPOTS) {
      const shot = applyError(solveIdealShot(s), { powerErr: 0.05, dirErrDeg: 0, timingMs: 0 }, 0);
      if (!isMake(predictOutcome(s, shot.vel).outcome)) misses++;
    }
    // a long ball from straight on can still drop in off the glass, so "usually" = most of the five
    expect(misses).toBeGreaterThanOrEqual(3);
  });

  it('more assist = more makes over 1000 seeded shots', () => {
    const rate = (assist: ShotAssist): number => {
      const r = new Rng(7);
      let made = 0;
      for (let i = 0; i < 1000; i++) {
        const s = SPOTS[i % 5];
        const input: ShotInput = { powerErr: r.gauss() * 0.05, dirErrDeg: r.gauss() * 5, timingMs: r.gauss() * 90 };
        if (isMake(predictOutcome(s, applyError(solveIdealShot(s), input, assist).vel).outcome)) made++;
      }
      return made / 1000;
    };
    const rates = ([0, 1, 2, 3] as ShotAssist[]).map(rate);
    for (let i = 1; i < 4; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
    expect(rates[0]).toBeLessThan(0.5);
  });

  it('is deterministic for a seed (including defender noise)', () => {
    const run = () => {
      const r = new Rng(99);
      return SPOTS.map(s => applyError(solveIdealShot(s), { powerErr: 0.01, dirErrDeg: 1, timingMs: 30 }, 2, 0.04, r).vel);
    };
    expect(run()).toEqual(run());
  });

  it('grades the release against the jump apex', () => {
    expect(gradeTiming(0)).toBe('perfect');
    expect(gradeTiming(-80)).toBe('good');
    expect(gradeTiming(-200)).toBe('early');
    expect(gradeTiming(200)).toBe('late');
  });

  it('maps a flick and a mouse meter to errors with dead bands', () => {
    const near = inputFromFlick(9.25, 0, 0, 4.5);
    expect(Math.abs(near.powerErr)).toBeLessThan(0.01);
    expect(inputFromFlick(20, 0, 0, 4.5).powerErr).toBeGreaterThan(0.05);
    expect(inputFromFlick(9.25, -20, 0, 4.5).dirErrDeg).toBeGreaterThan(3);
    expect(inputFromMeter(0.02, 0).powerErr).toBe(0);
    expect(inputFromMeter(-0.3, 0).powerErr).toBeLessThan(-0.05);
  });

  it('adds backspin, most for a clean release', () => {
    const s = SPOTS[2];
    const clean = applyError(solveIdealShot(s), NONE, 0);
    const sloppy = applyError(solveIdealShot(s), { powerErr: 0.06, dirErrDeg: 5, timingMs: 200 }, 0);
    const mag = (v: V3) => Math.hypot(v.x, v.y, v.z);
    expect(mag(clean.spin)).toBeGreaterThan(mag(sloppy.spin));
    // shooting toward −z: backspin is about +x (the top of the ball spins back toward the shooter)
    expect(clean.spin.x).toBeGreaterThan(0);
  });

  it('predictOutcome uses the same hoop as the game', () => {
    expect(HOOP_CENTER.y).toBeCloseTo(3.05);
  });
});

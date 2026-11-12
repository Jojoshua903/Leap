import { describe, expect, it } from 'vitest';
import { Rng } from '../tabletennis/BallPhysics';
import { DISC_TYPES } from './frisbeeTuning';
import { Disc, FLAT_GROUND, STEP, Wind, flatDist, simulateFlight, type Ground, type Launch } from './DiscPhysics';

const START = { x: 0, y: 1.2, z: 0 };
/** A flat right-hand backhand (clockwise spin). */
const flat = (o: Partial<Launch> = {}): Launch => ({ pos: START, speed: 20, yawDeg: 0, loftDeg: 6, noseDeg: 2, bankDeg: 0, spin: -40, wobble: 0, ...o });

describe('DiscPhysics', () => {
  it('a flat 20 m/s throw with 40 rad/s spin flies a plausible, stable distance', () => {
    const r = simulateFlight(flat());
    expect(r.outcome).toBe('rest');
    const d = flatDist(r.final, START);
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(90);
    expect(r.maxHeight).toBeLessThan(15);
    // mostly straight: it ends within a third of its length from the line
    expect(Math.abs(r.final.x)).toBeLessThan(d / 3);
    expect(r.final.z).toBeLessThan(-20);
  });

  it('more spin = more stable (less banking over the same flight)', () => {
    const bankChange = (spin: number): number => {
      const d = new Disc(DISC_TYPES.dog, 3);
      d.launch(flat({ spin }));
      let maxTilt = 0;
      while (d.flying && d.t < 8) { d.step(STEP, Wind.calm(), FLAT_GROUND); maxTilt = Math.max(maxTilt, d.tilt); }
      return maxTilt;
    };
    expect(bankChange(-55)).toBeLessThan(bankChange(-15));
  });

  it('hyzer curves left and anhyzer curves right for a right-hand backhand', () => {
    const hyzer = simulateFlight(flat({ bankDeg: -22 }));
    const anhyzer = simulateFlight(flat({ bankDeg: 22 }));
    expect(hyzer.final.x).toBeLessThan(-2);
    expect(anhyzer.final.x).toBeGreaterThan(2);
  });

  it('a tailwind carries it further, a headwind cuts it short', () => {
    const still = flatDist(simulateFlight(flat()).final, START);
    const tail = flatDist(simulateFlight(flat(), DISC_TYPES.dog, { wind: Wind.from(0, 5, 0, 1) }).final, START);
    const head = flatDist(simulateFlight(flat(), DISC_TYPES.dog, { wind: Wind.from(180, 5, 0, 1) }).final, START);
    expect(tail).toBeGreaterThan(still);
    expect(head).toBeLessThan(still);
  });

  it('is deterministic for the same seed (gusts and wobble included)', () => {
    const run = () => simulateFlight(flat({ wobble: 0.8 }), DISC_TYPES.driver, { wind: Wind.from(60, 4, 0.5, 42), seed: 9 });
    const a = run(), b = run();
    expect(a.final).toEqual(b.final);
    expect(a.path.length).toBe(b.path.length);
  });

  it('water stops the disc', () => {
    const lake: Ground = { height: () => 0, surface: (_x, z) => (z < -15 ? 'water' : 'grass'), obstacles: [] };
    const r = simulateFlight(flat(), DISC_TYPES.dog, { ground: lake });
    expect(r.outcome).toBe('water');
  });

  it('a tree deflects the disc and drops it', () => {
    const woods: Ground = { height: () => 0, surface: () => 'grass', obstacles: [{ x: 0, z: -12, r: 0.6, y0: 0, y1: 8, kind: 'trunk' }] };
    const r = simulateFlight(flat({ loftDeg: 2 }), DISC_TYPES.dog, { ground: woods });
    expect(r.hitObstacle).toBe(true);
    expect(r.final.z).toBeGreaterThan(-14);
  });

  it('never produces NaN over 10,000 random throws', () => {
    const rng = new Rng(2024);
    const types = Object.values(DISC_TYPES);
    let bad = 0;
    for (let i = 0; i < 10000; i++) {
      const l: Launch = {
        pos: { x: 0, y: 0.3 + rng.next() * 2, z: 0 },
        speed: rng.next() * 40, yawDeg: rng.signed() * 90, loftDeg: rng.signed() * 45, noseDeg: rng.signed() * 30,
        bankDeg: rng.signed() * 90, spin: rng.signed() * 70, wobble: rng.next()
      };
      const r = simulateFlight(l, types[i % types.length], { wind: Wind.from(rng.next() * 360, rng.next() * 10, rng.next(), i), maxT: 5, sampleEvery: 1 });
      const f = r.final;
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.z)) bad++;
    }
    expect(bad).toBe(0);
  }, 120_000);
});

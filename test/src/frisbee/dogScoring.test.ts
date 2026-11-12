import { describe, expect, it } from 'vitest';
import { DOG_SCORING, DOG_ZONES, DogRound, maxRound, scoreThrow, streakMult, zoneAt } from './dogScoring';

const caught = (distance: number, o: { midAir?: boolean; leap?: boolean; z?: number } = {}) =>
  ({ caught: true, distance, midAir: !!o.midAir, leap: !!o.leap, zone: o.z !== undefined ? zoneAt(0, o.z) : null });

describe('dogScoring', () => {
  it('a plain catch is base + 1 per metre', () => {
    expect(scoreThrow(caught(18.7), 0).points).toBe(DOG_SCORING.base + 18);
  });

  it('mid-air and leap bonuses add up', () => {
    expect(scoreThrow(caught(10, { midAir: true }), 0).points).toBe(10 + 10 + 20);
    expect(scoreThrow(caught(10, { midAir: true, leap: true }), 0).points).toBe(10 + 10 + 20 + 30);
  });

  it('zones multiply ×1.5 / ×2 / ×3 and only count inside the ring', () => {
    expect(zoneAt(0, -20)?.mult).toBe(1.5);
    expect(zoneAt(1, -35)?.mult).toBe(2);
    expect(zoneAt(0, -50)?.mult).toBe(3);
    expect(zoneAt(0, -27)).toBeNull();
    expect(zoneAt(10, -20)).toBeNull();
    expect(scoreThrow(caught(20, { z: -20 }), 0).points).toBe(Math.round(30 * 1.5));
    expect(scoreThrow(caught(20, { z: -35 }), 0).points).toBe(60);
  });

  it('streak adds ×0.25 per catch in a row, up to ×2, and a miss resets it', () => {
    expect(streakMult(0)).toBe(1);
    expect(streakMult(2)).toBe(1.5);
    expect(streakMult(4)).toBe(2);
    expect(streakMult(9)).toBe(2);
    const r = new DogRound();
    for (let i = 0; i < 3; i++) r.record(caught(10));
    expect(r.streak).toBe(3);
    expect(r.throws[2].score.points).toBe(Math.round(20 * 1.5));
    r.record({ caught: false, distance: 30, midAir: false, leap: false, zone: null });
    expect(r.streak).toBe(0);
    expect(r.throws[3].score.points).toBe(0);
    expect(r.record(caught(10)).score.points).toBe(20);
    expect(r.bestStreak).toBe(3);
  });

  it('caps a throw and a perfect round is about 1000', () => {
    const big = scoreThrow(caught(50, { midAir: true, leap: true, z: -50 }), 4);
    expect(big.points).toBe(DOG_SCORING.throwCap);
    expect(big.capped).toBe(true);
    expect(maxRound()).toBe(DOG_SCORING.throws * DOG_SCORING.throwCap);
    expect(maxRound()).toBeGreaterThanOrEqual(900);
    expect(maxRound()).toBeLessThanOrEqual(1100);
  });

  it('a round is 10 throws and counts catches, mid-air catches and the longest throw', () => {
    const r = new DogRound();
    for (let i = 0; i < 10; i++) r.record(caught(5 + i, { midAir: i % 2 === 0 }));
    expect(r.done).toBe(true);
    expect(r.catches).toBe(10);
    expect(r.midAirCatches).toBe(5);
    expect(r.longest).toBe(14);
  });

  it('practice keeps no score and never ends', () => {
    const r = new DogRound(true);
    for (let i = 0; i < 25; i++) r.record(caught(20, { z: -20 }));
    expect(r.score).toBe(0);
    expect(r.done).toBe(false);
  });

  it('the zones sit along the field at 20, 35 and 50 m', () => {
    expect(DOG_ZONES.map(z => -z.z)).toEqual([20, 35, 50]);
  });
});

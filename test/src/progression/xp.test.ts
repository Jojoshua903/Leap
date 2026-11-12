import { describe, expect, it } from 'vitest';
import { levelFromXp, matchXp, totalXpForLevel, xpForLevel } from './xp';

describe('xp', () => {
  it('1 per 10 pins, +20 strike, +10 spare, +50 win', () => {
    expect(matchXp({ pins: 0, strikes: 0, spares: 0, won: false })).toBe(0);
    expect(matchXp({ pins: 99, strikes: 0, spares: 0, won: false })).toBe(9);
    expect(matchXp({ pins: 150, strikes: 3, spares: 2, won: true })).toBe(15 + 60 + 20 + 50);
  });

  it('xpForLevel(n) = round(100 * n^1.4)', () => {
    expect(xpForLevel(1)).toBe(100);
    expect(xpForLevel(2)).toBe(264);
    expect(xpForLevel(5)).toBe(Math.round(100 * Math.pow(5, 1.4)));
  });

  it('levels from total xp', () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(99).level).toBe(1);
    expect(levelFromXp(100).level).toBe(2);
    expect(levelFromXp(100 + 264).level).toBe(3);
    const l = levelFromXp(150);
    expect(l.into).toBe(50);
    expect(l.need).toBe(264);
  });

  it('totalXpForLevel matches levelFromXp', () => {
    for (const n of [2, 5, 10, 20]) {
      expect(levelFromXp(totalXpForLevel(n)).level).toBe(n);
      expect(levelFromXp(totalXpForLevel(n) - 1).level).toBe(n - 1);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { DECOY_PENALTY, DODGE_BONUS, SliceScore, basePoints, judge, tierFor } from './sliceScoring';
import { SW_TUNING } from './swordTuning';

const good = (s: SliceScore, golden = false) => s.slice({ want: 'right', angle: 0, dir: 'right', straight: 1, speed: 14, golden });

describe('Speed Slice scoring', () => {
  it('base points: 100 + straightness (up to 100) + speed (up to 50)', () => {
    expect(basePoints(1, 14)).toBe(250);
    expect(basePoints(0, 0)).toBe(100);
    expect(basePoints(0.5, 9)).toBe(100 + 50 + 25);
  });

  it('direction match within the tolerance, PERFECT when exact and straight', () => {
    expect(judge(10, 'right', 0.95)).toMatchObject({ dirOk: true, perfect: true });
    expect(judge(SW_TUNING.perfectDeg + 2, 'right', 0.95)).toMatchObject({ dirOk: true, perfect: false });
    expect(judge(5, 'right', 0.8)).toMatchObject({ dirOk: true, perfect: false });
    expect(judge(SW_TUNING.dirTolerance + 5, 'right', 1).dirOk).toBe(false);
    // wraps around: −170° is "left"
    expect(judge(-170, 'left', 1).dirOk).toBe(true);
    expect(judge(135, 'upLeft', 1).dirOk).toBe(true);
  });

  it('combo goes ×1 → ×5, one step per 5 good slices', () => {
    const s = new SliceScore();
    const mults: number[] = [];
    for (let i = 0; i < 26; i++) mults.push(good(s).mult);
    expect(mults.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(mults[5]).toBe(2);
    expect(mults[20]).toBe(5);
    expect(mults[25]).toBe(5);
    expect(s.maxMult).toBe(5);
    expect(s.score).toBe(250 * (5 * 1 + 5 * 2 + 5 * 3 + 5 * 4 + 6 * 5));
  });

  it('a wrong direction gives half the base and breaks the combo', () => {
    const s = new SliceScore();
    for (let i = 0; i < 6; i++) good(s);
    expect(s.mult).toBe(2);
    const r = s.slice({ want: 'right', angle: 90, dir: 'up', straight: 1, speed: 14, golden: false });
    expect(r).toMatchObject({ dirOk: false, points: 125 });
    expect(s.streak).toBe(0);
    expect(s.mult).toBe(1);
    expect(s.wrong).toBe(1);
  });

  it('golden doubles, decoys cost and dodges pay, misses break the combo', () => {
    const s = new SliceScore();
    expect(good(s, true).points).toBe(500);
    for (let i = 0; i < 4; i++) good(s);
    expect(s.decoy(false)).toBe(DODGE_BONUS);
    expect(s.streak).toBe(5);
    const before = s.score;
    s.decoy(true);
    expect(s.score).toBe(before - DECOY_PENALTY);
    expect(s.streak).toBe(0);
    good(s); s.miss();
    expect(s.streak).toBe(0);
    expect(s.accuracy).toBeCloseTo(6 / 7);
    // the score never goes below zero
    const z = new SliceScore();
    z.decoy(true);
    expect(z.score).toBe(0);
  });

  it('perfect runs and per-direction counts', () => {
    const s = new SliceScore();
    for (let i = 0; i < 10; i++) good(s);
    expect(s.bestPerfectRun).toBe(10);
    s.slice({ want: 'right', angle: 0, dir: 'right', straight: 0.5, speed: 10, golden: false });
    expect(s.perfectRun).toBe(0);
    expect(s.byDir.right).toBe(11);
  });

  it('tiers need both the score and the accuracy', () => {
    expect(tierFor(45000, 0.95)).toBe('platinum');
    expect(tierFor(45000, 0.8)).toBe('gold');
    expect(tierFor(26000, 0.5)).toBe('bronze');
    expect(tierFor(13000, 0.65)).toBe('silver');
    expect(tierFor(100, 1)).toBe('bronze');
  });
});

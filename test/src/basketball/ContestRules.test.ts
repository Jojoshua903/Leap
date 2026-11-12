import { describe, expect, it } from 'vitest';
import { BALLS_PER_RACK, ContestRound, RACK_SPOTS, TOP_RACK, ballValue, maxScore, tiedForFirst } from './ContestRules';
import { isOutsideArc } from './bbTuning';

/** Shoot every ball, deciding each with `made(rackIndex, ball)`. */
function play(r: ContestRound, made: (rack: number, ball: number) => boolean): void {
  let guard = 0;
  while (!r.allTaken && guard++ < 100) {
    const s = r.take(30);
    if (!s) { r.nextRack(); continue; }
    r.resolve(s, made(s.rack, s.ball));
  }
}

describe('3-Point Contest scoring', () => {
  it('a perfect round is 30 points: four 1-pointers and a money ball per rack', () => {
    const r = new ContestRound({ moneyRack: null });
    play(r, () => true);
    expect(r.score).toBe(30);
    expect(r.max).toBe(30);
    expect(r.attempts).toBe(25);
    expect(r.perfectRacks).toBe(5);
    expect(r.moneyMade).toBe(5);
    expect(r.bestStreak).toBe(25);
    expect(r.finished).toBe(true);
  });

  it('only the 5th ball of a rack is a money ball (worth 2)', () => {
    for (let b = 0; b < BALLS_PER_RACK; b++) expect(ballValue(1, b, null)).toBe(b === 4 ? 2 : 1);
  });

  it('the money rack makes all five balls of that rack worth 2 (max 34)', () => {
    expect(maxScore(3)).toBe(34);
    for (let b = 0; b < BALLS_PER_RACK; b++) expect(ballValue(3, b, 3)).toBe(2);
    const r = new ContestRound({ moneyRack: 3 });
    play(r, rack => rack === 3);
    expect(r.score).toBe(10);
  });

  it('money balls only: 10 points, and Money Maker needs all five 5th balls', () => {
    const r = new ContestRound({ moneyRack: null });
    play(r, (_, b) => b === 4);
    expect(r.score).toBe(10);
    expect(r.moneyMade).toBe(5);
    expect(r.perfectRacks).toBe(0);
  });

  it('streaks reset on a miss', () => {
    const r = new ContestRound({ moneyRack: null });
    play(r, (rack, b) => !(rack === 2 && b === 2));
    expect(r.score).toBe(29);
    expect(r.bestStreak).toBe(12);
    expect(r.perfectRacks).toBe(4);
  });

  it('nothing more after the last rack, and nothing scored twice', () => {
    const r = new ContestRound({ moneyRack: null });
    play(r, () => true);
    expect(r.take(1)).toBeNull();
    expect(r.resolve(r.shots[0], true)).toBe(0);
    expect(r.score).toBe(30);
  });

  it('practice never ends and keeps no score', () => {
    const r = new ContestRound({ moneyRack: null, practice: true });
    for (let i = 0; i < 60; i++) {
      const s = r.take(Infinity) ?? (r.nextRack(), r.take(Infinity));
      expect(s).not.toBeNull();
      r.resolve(s!, true);
    }
    expect(r.allTaken).toBe(false);
    expect(r.score).toBe(0);
    expect(r.makes).toBe(60);
  });

  it('sudden death is one rack from the top, money ball last', () => {
    const r = new ContestRound({ moneyRack: null, racks: [TOP_RACK] });
    play(r, () => true);
    expect(r.score).toBe(6);
    expect(r.attempts).toBe(5);
  });

  it('finds ties for first place', () => {
    expect(tiedForFirst([20, 18, 20])).toEqual([0, 2]);
    expect(tiedForFirst([12])).toEqual([0]);
    expect(tiedForFirst([9, 15, 3])).toEqual([1]);
  });

  it('every rack spot is behind the 3-point line', () => {
    for (const s of RACK_SPOTS) expect(isOutsideArc(s.x, s.z), s.id).toBe(true);
  });
});

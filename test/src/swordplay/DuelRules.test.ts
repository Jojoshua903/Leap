import { describe, expect, it } from 'vitest';
import {
  DUEL, arrivalOf, bestGuard, covers, damageFor, matchWinner, newFighter, resolve, roundWinner, setGuard, tickFighter, tryDodge, type Attack
} from './DuelRules';

const slash = (dx: number, dy: number, power = 0.5, straight = 0.5): Attack => ({ kind: 'slash', dx, dy, power, straight });
const thrust = (power = 0.5): Attack => ({ kind: 'thrust', dx: 0, dy: 0, power, straight: 1 });

describe('Duel rules', () => {
  it('maps attack directions to the side they arrive from', () => {
    // a slash to the attacker's right comes in from the defender's right
    const r = arrivalOf(slash(1, 0));
    expect(r.x).toBe(1);
    expect(r.y).toBeCloseTo(0);
    // a downward slash comes from above
    expect(covers('high', slash(0, -1))).toBe(true);
    expect(covers('low', slash(0, 1))).toBe(true);
    expect(covers('right', slash(1, 0))).toBe(true);
    expect(covers('left', slash(-1, 0))).toBe(true);
    expect(covers('left', slash(1, 0))).toBe(false);
    // a diagonal (down-right) is covered by high and by right
    const d = slash(Math.SQRT1_2, -Math.SQRT1_2);
    expect(covers('high', d) && covers('right', d)).toBe(true);
    expect(covers('low', d) || covers('left', d)).toBe(false);
    expect(covers('mid', thrust())).toBe(true);
    expect(covers('high', thrust())).toBe(false);
    expect(bestGuard(slash(0, -1))).toBe('high');
    expect(bestGuard(thrust())).toBe('mid');
  });

  it('damage is 10–25 by power and straightness', () => {
    expect(damageFor(0, 0)).toBe(10);
    expect(damageFor(1, 1)).toBe(25);
    expect(damageFor(0.5, 0.5)).toBeGreaterThan(10);
    expect(damageFor(2, 2)).toBe(25);
  });

  it('an unguarded hit hurts and gives 0.4 s of invulnerability', () => {
    const a = newFighter(), b = newFighter();
    const r = resolve(a, b, slash(1, 0, 1, 1), 5);
    expect(r).toMatchObject({ outcome: 'hit', damage: 25 });
    expect(b.hp).toBe(75);
    expect(resolve(a, b, slash(1, 0), 5.1).outcome).toBe('invuln');
    tickFighter(b, DUEL.invulnTime + 0.01);
    expect(resolve(a, b, slash(1, 0), 5.5).outcome).toBe('hit');
  });

  it('a block fills the attacker stagger meter; enough blocks stagger them', () => {
    const a = newFighter(), b = newFighter();
    setGuard(b, 'right', 0);
    let r = resolve(a, b, slash(1, 0, 1), 2);
    expect(r.outcome).toBe('block');
    expect(a.meter).toBeCloseTo(DUEL.blockStagger + DUEL.blockStaggerPower);
    r = resolve(a, b, slash(1, 0, 1), 2.1);
    r = resolve(a, b, slash(1, 0, 1), 2.2);
    expect(r).toMatchObject({ outcome: 'block', attackerStaggered: true });
    expect(a.staggered).toBeCloseTo(DUEL.staggerTime);
    expect(b.hp).toBe(DUEL.hp);
  });

  it('a guard put up within 150 ms of the hit is a parry: attacker staggered and open for a free hit', () => {
    const a = newFighter(), b = newFighter();
    setGuard(b, 'high', 3.0);
    const r = resolve(a, b, slash(0, -1), 3.1);
    expect(r).toMatchObject({ outcome: 'parry', attackerStaggered: true });
    expect(b.parries).toBe(1);
    // a staggered attacker's own attack fizzles
    expect(resolve(a, b, slash(0, -1), 3.2).outcome).toBe('stagger');
    // and b's counter lands even though a "guards"
    setGuard(a, 'right', 3.2);
    expect(a.guard).toBeNull();
    expect(resolve(b, a, slash(1, 0), 3.3).outcome).toBe('hit');
    // a guard that went up 200 ms early is only a block
    const c = newFighter(), d = newFighter();
    setGuard(d, 'high', 0);
    expect(resolve(c, d, slash(0, -1), 0.2).outcome).toBe('block');
  });

  it('a thrust is blocked by a fresh mid guard but breaks any guard held over 1.5 s', () => {
    const a = newFighter(), b = newFighter();
    setGuard(b, 'mid', 0);
    expect(resolve(a, b, thrust(), 1).outcome).toBe('block');
    const r = resolve(a, b, thrust(), 1.6);
    expect(r).toMatchObject({ outcome: 'guardBreak', defenderStaggered: true });
    expect(b.hp).toBeLessThan(DUEL.hp);
    const c = newFighter(), d = newFighter();
    setGuard(d, 'high', 0);
    expect(resolve(c, d, thrust(), 0.5).outcome).toBe('hit');
    expect(resolve(c, newFighter(), thrust(), 2).outcome).toBe('hit');
  });

  it('a dodge avoids everything for a moment and then needs a cooldown', () => {
    const a = newFighter(), b = newFighter();
    expect(tryDodge(b)).toBe(true);
    expect(resolve(a, b, slash(1, 0), 0).outcome).toBe('dodge');
    expect(tryDodge(b)).toBe(false);
    tickFighter(b, DUEL.dodgeTime + 0.01);
    expect(resolve(a, b, slash(1, 0), 1).outcome).toBe('hit');
    tickFighter(b, DUEL.dodgeCooldown);
    expect(tryDodge(b)).toBe(true);
  });

  it('rounds end at 0 HP or at the bell (higher HP wins), best of 3', () => {
    const a = newFighter(), b = newFighter();
    expect(roundWinner(a, b, 10)).toBeNull();
    b.hp = 0;
    expect(roundWinner(a, b, 10)).toBe(0);
    b.hp = 40; a.hp = 30;
    expect(roundWinner(a, b, DUEL.roundTime)).toBe(1);
    a.hp = 40;
    expect(roundWinner(a, b, DUEL.roundTime)).toBe(-1);
    a.hits = 3;
    expect(roundWinner(a, b, DUEL.roundTime)).toBe(0);
    expect(matchWinner([1, 1])).toBeNull();
    expect(matchWinner([2, 1])).toBe(0);
    expect(matchWinner([0, 2])).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { PickupScore } from './PickupRules';
import { COURT } from './bbTuning';

const INSIDE: [number, number] = [0, 3];
const OUTSIDE: [number, number] = [0, COURT.threeRadius + 0.5];
const CORNER: [number, number] = [COURT.cornerX + 0.2, 0.4];

describe('Pickup rules', () => {
  it('1 point inside the arc, 2 outside (corners included)', () => {
    expect(PickupScore.value(...INSIDE)).toBe(1);
    expect(PickupScore.value(...OUTSIDE)).toBe(2);
    expect(PickupScore.value(...CORNER)).toBe(2);
    expect(PickupScore.value(COURT.cornerX - 0.3, 0.4)).toBe(1);
  });

  it('make-it-take-it: the scoring team keeps the ball', () => {
    const s = new PickupScore(11, 0);
    const r = s.basket(0, ...INSIDE);
    expect(r).toMatchObject({ counted: true, points: 1, nextOffense: 0, winner: null });
    expect(s.offense).toBe(0);
    expect(s.points).toEqual([1, 0]);
  });

  it('after a change of possession the ball must be cleared before a basket counts', () => {
    const s = new PickupScore(11, 0);
    s.changePossession(1);
    expect(s.cleared).toBe(false);
    const r = s.basket(1, ...INSIDE);
    expect(r.counted).toBe(false);
    expect(s.points).toEqual([0, 0]);
    expect(r.nextOffense).toBe(0);           // no basket: the other team checks it
    s.changePossession(1);
    s.carry(...INSIDE);
    expect(s.cleared).toBe(false);
    s.carry(...OUTSIDE);
    expect(s.cleared).toBe(true);
    expect(s.basket(1, ...INSIDE).counted).toBe(true);
  });

  it('a check at the top clears the ball', () => {
    const s = new PickupScore(11, 0);
    s.changePossession(1);
    s.check();
    expect(s.basket(1, ...OUTSIDE)).toMatchObject({ counted: true, points: 2 });
  });

  it('first to 11 wins, win by 1 (11–10 is enough)', () => {
    const s = new PickupScore(11, 0);
    for (let i = 0; i < 10; i++) { s.changePossession(1); s.check(); s.basket(1, ...INSIDE); }
    s.changePossession(0); s.check();
    for (let i = 0; i < 10; i++) expect(s.basket(0, ...INSIDE).winner).toBeNull();
    const last = s.basket(0, ...INSIDE);
    expect(last.winner).toBe(0);
    expect(s.points).toEqual([11, 10]);
    expect(s.basket(1, ...INSIDE).counted).toBe(false);   // game over
  });

  it('a 2 from 10 goes past the target and still wins; 21 works too', () => {
    const s = new PickupScore(11, 0);
    for (let i = 0; i < 5; i++) s.basket(0, ...OUTSIDE);
    expect(s.points[0]).toBe(10);
    expect(s.basket(0, ...OUTSIDE)).toMatchObject({ winner: 0 });
    expect(s.points[0]).toBe(12);
    const t = new PickupScore(21, 1);
    for (let i = 0; i < 10; i++) t.basket(1, ...OUTSIDE);
    expect(t.winner).toBeNull();
    expect(t.basket(1, ...INSIDE).winner).toBe(1);
  });
});

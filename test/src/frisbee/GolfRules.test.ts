import { describe, expect, it } from 'vitest';
import { GOLF_RULES, GolfRound, inBounds, puttSpeed, recommendDisc, scoreName } from './GolfRules';
import { COURSES, coursePar, holeLength } from './courses';

const TEE = { x: 0, y: 0, z: 0 };
const BASKET = { x: 0, y: 0, z: -50 };
const at = (z: number, x = 0) => ({ kind: 'rest' as const, at: { x, y: 0, z } });

describe('GolfRules', () => {
  it('names scores (ace beats everything)', () => {
    expect(scoreName(1, 3)).toBe('ace');
    expect(scoreName(2, 4)).toBe('eagle');
    expect(scoreName(2, 3)).toBe('birdie');
    expect(scoreName(3, 3)).toBe('par');
    expect(scoreName(4, 3)).toBe('bogey');
    expect(scoreName(5, 3)).toBe('double');
    expect(scoreName(8, 3)).toBe('triple');
  });

  it('counts strokes from the lie and holes out', () => {
    const r = new GolfRound([3], 1);
    r.startHole(0, TEE, BASKET);
    r.record(0, at(-30));
    expect(r.state[0].lie.z).toBe(-30);
    expect(r.state[0].onTee).toBe(false);
    r.record(0, at(-46));
    expect(r.isPutt(0)).toBe(true);
    const res = r.record(0, { kind: 'in' });
    expect(res).toMatchObject({ strokes: 3, holed: true, putt: true });
    expect(r.cards[0][0]).toBe(3);
    expect(r.done).toBe(true);
  });

  it('OB costs a penalty stroke and the re-throw is from the last lie', () => {
    const r = new GolfRound([3], 1);
    r.startHole(0, TEE, BASKET);
    r.record(0, at(-25));
    const res = r.record(0, { kind: 'ob' });
    expect(res.penalty).toBe(true);
    expect(res.strokes).toBe(2 + GOLF_RULES.obPenalty);
    expect(r.state[0].lie.z).toBe(-25);
    // OB off the tee: still on the tee
    const r2 = new GolfRound([3], 1);
    r2.startHole(0, TEE, BASKET);
    r2.record(0, { kind: 'ob' });
    expect(r2.state[0].onTee).toBe(true);
    expect(r2.state[0].strokes).toBe(2);
  });

  it('putt mode starts inside 10 m', () => {
    const r = new GolfRound([3], 1);
    r.startHole(0, TEE, BASKET);
    r.record(0, at(-39.5));
    expect(r.isPutt(0)).toBe(false);
    r.record(0, at(-40.5));
    expect(r.isPutt(0)).toBe(true);
  });

  it('picks up at the stroke limit', () => {
    const r = new GolfRound([3], 1);
    r.startHole(0, TEE, BASKET);
    let res = r.record(0, { kind: 'ob' });
    for (let i = 0; i < 10 && !res.picked; i++) res = r.record(0, { kind: 'ob' });
    expect(res.picked).toBe(true);
    expect(r.cards[0][0]).toBe(GOLF_RULES.maxStrokes);
    expect(r.holeDone).toBe(true);
  });

  it('tees off in honours order, then farthest from the basket goes first', () => {
    const r = new GolfRound([3, 3], 3);
    r.startHole(0, TEE, BASKET);
    expect(r.next()).toBe(0);
    r.record(0, at(-40));
    expect(r.next()).toBe(1);
    r.record(1, at(-20));
    expect(r.next()).toBe(2);
    r.record(2, at(-35));
    // distances: p0 10 m, p1 30 m, p2 15 m
    expect(r.next()).toBe(1);
    r.record(1, at(-48));
    expect(r.next()).toBe(2);
    r.record(2, { kind: 'in' });          // p2: 2
    r.record(0, { kind: 'in' });          // p0: 2 (next would be p0 at 10 m)
    expect(r.next()).toBe(1);
    r.record(1, { kind: 'in' });          // p1: 3
    expect(r.holeDone).toBe(true);
    r.startHole(1, TEE, BASKET);
    // honours: p0 and p2 tied on 2 keep their order, then p1
    expect(r.teeOrder).toEqual([0, 2, 1]);
    expect(r.next()).toBe(0);
  });

  it('lowest total wins, ties share', () => {
    const r = new GolfRound([3], 2);
    r.startHole(0, TEE, BASKET);
    r.record(0, { kind: 'in' });
    r.record(1, at(-45)); r.record(1, { kind: 'in' });
    expect(r.winners()).toEqual([0]);
    expect(r.vsPar(0)).toBe(-2);
    expect(r.counts(0).ace).toBe(1);
    expect(r.counts(1).birdie).toBe(1);
    const t = new GolfRound([3], 2);
    t.startHole(0, TEE, BASKET);
    t.record(0, at(-45)); t.record(0, { kind: 'in' });
    t.record(1, at(-45)); t.record(1, { kind: 'in' });
    expect(t.winners()).toEqual([0, 1]);
  });

  it('tracks putts in a row', () => {
    const r = new GolfRound([3, 3, 3], 1);
    for (let h = 0; h < 3; h++) {
      r.startHole(h, TEE, BASKET);
      r.record(0, at(-45));
      r.record(0, { kind: 'in' });
    }
    expect(r.bestPuttStreak[0]).toBe(3);
  });

  it('helpers: putt speed, recommended disc, bounds', () => {
    expect(puttSpeed(8)).toBe(3);
    expect(puttSpeed(19)).toBe(12);
    expect(recommendDisc(80)).toBe('driver');
    expect(recommendDisc(35)).toBe('mid');
    expect(recommendDisc(8)).toBe('putter');
    expect(inBounds({ x0: -5, x1: 5, z0: -10, z1: 1 }, 0, -5)).toBe(true);
    expect(inBounds({ x0: -5, x1: 5, z0: -10, z1: 1 }, 6, -5)).toBe(false);
  });

  it('course data: 9 holes each, pars 3–4, sensible lengths, baskets in bounds', () => {
    for (const c of Object.values(COURSES)) {
      expect(c.holes.length).toBe(9);
      expect(coursePar(c)).toBeGreaterThanOrEqual(27);
      for (const h of c.holes) {
        expect([3, 4]).toContain(h.par);
        const L = holeLength(h);
        if (h.par === 3) { expect(L).toBeGreaterThanOrEqual(38); expect(L).toBeLessThanOrEqual(80); }
        else { expect(L).toBeGreaterThanOrEqual(80); expect(L).toBeLessThanOrEqual(125); }
        expect(inBounds(h.bounds, h.basket.x, h.basket.z)).toBe(true);
        expect(inBounds(h.bounds, 0, 0)).toBe(true);
      }
    }
    expect(coursePar(COURSES.meadow)).toBeLessThan(33);
  });
});

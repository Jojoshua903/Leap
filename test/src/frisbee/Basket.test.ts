import { describe, expect, it } from 'vitest';
import { Rng } from '../tabletennis/BallPhysics';
import { BASKET, basketCheck, bounceOff, restInTray } from './Basket';

const BASE = { x: 0, y: 0, z: -10 };
/** One physics step toward the pole at height y (enters the chain cylinder). */
const enter = (y: number) => ({ prev: { x: 0, y, z: -10 + 0.4 }, cur: { x: 0, y, z: -10 + 0.3 } });

describe('basket', () => {
  it('slow and low into the chains is in', () => {
    const { prev, cur } = enter(0.9);
    expect(basketCheck(prev, cur, 6, BASE, new Rng(1))).toBe('in');
    expect(basketCheck(prev, cur, BASKET.inSpeed, BASE, new Rng(2))).toBe('in');
  });

  it('fast and high mostly rattles out', () => {
    const { prev, cur } = enter(1.25);
    const r = new Rng(7);
    let rattles = 0;
    for (let i = 0; i < 200; i++) if (basketCheck(prev, cur, 20, BASE, r) === 'rattle') rattles++;
    expect(rattles).toBeGreaterThan(150);
  });

  it('a medium hit is a seeded mix of in and rattle-out', () => {
    const { prev, cur } = enter(1.0);
    const run = (seed: number) => { const r = new Rng(seed); return Array.from({ length: 100 }, () => basketCheck(prev, cur, 10, BASE, r)); };
    const a = run(3);
    expect(a.filter(x => x === 'in').length).toBeGreaterThan(40);
    expect(a.filter(x => x === 'rattle').length).toBeGreaterThan(10);
    expect(run(3)).toEqual(a);
  });

  it('band, tray rim and over the top', () => {
    expect(basketCheck(enter(1.34).prev, enter(1.34).cur, 6, BASE, new Rng(1))).toBe('band');
    expect(basketCheck(enter(0.5).prev, enter(0.5).cur, 6, BASE, new Rng(1))).toBe('cage');
    expect(basketCheck(enter(1.6).prev, enter(1.6).cur, 6, BASE, new Rng(1))).toBe('none');
  });

  it('a wide miss is nothing, and staying inside does not count twice', () => {
    expect(basketCheck({ x: 2, y: 1, z: -9 }, { x: 2, y: 1, z: -9.1 }, 6, BASE, new Rng(1))).toBe('none');
    expect(basketCheck({ x: 0, y: 1, z: -9.8 }, { x: 0, y: 1, z: -9.85 }, 6, BASE, new Rng(1))).toBe('none');
  });

  it('dropping into the tray from above is in', () => {
    expect(basketCheck({ x: 0, y: 1.0, z: -9.9 }, { x: 0, y: 0.62, z: -9.9 }, 3, BASE, new Rng(1))).toBe('in');
  });

  it('rest spot in the tray, and bounces slow the disc and send it back', () => {
    const p = restInTray(BASE, { x: 0, y: 1, z: -9 });
    expect(p.y).toBeCloseTo(BASKET.trayY + 0.03);
    expect(Math.hypot(p.x - BASE.x, p.z - BASE.z)).toBeLessThan(BASKET.trayR);
    const v = bounceOff({ x: 0, y: -1, z: -10 }, { x: 0, y: 1, z: -9.7 }, BASE, 'cage', new Rng(1));
    expect(v.z).toBeGreaterThan(0);
    expect(Math.hypot(v.x, v.z)).toBeLessThan(5);
  });
});

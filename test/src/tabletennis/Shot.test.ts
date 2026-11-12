import { describe, expect, it } from 'vitest';
import { BallPhysics, v3 } from './BallPhysics';
import { firstContact, intentFromSwing, paddleFor, planShot, spinVector } from './Shot';
import { TABLE } from './ttTuning';

describe('Shot planner', () => {
  it('lands a planned drive on target', () => {
    const from = v3(0.1, TABLE.height + 0.2, 1.6);
    const plan = planShot(from, { target: { x: 0.3, z: -0.9 }, apex: 0.3, top: 60, side: 0 }, 0);
    expect(plan.clears).toBe(true);
    expect(plan.landing).not.toBeNull();
    expect(Math.abs(plan.landing!.x - 0.3)).toBeLessThan(0.05);
    expect(Math.abs(plan.landing!.z + 0.9)).toBeLessThan(0.05);
  });

  it('works for the far side too, and with sidespin', () => {
    const from = v3(-0.2, TABLE.height + 0.25, -1.7);
    const plan = planShot(from, { target: { x: -0.4, z: 0.8 }, apex: 0.35, top: -40, side: 50 }, 1);
    expect(plan.clears).toBe(true);
    expect(Math.abs(plan.landing!.x + 0.4)).toBeLessThan(0.06);
  });

  it('topspin axis is up × direction', () => {
    const s = spinVector(0, -1, 100, 0);
    expect(s.x).toBe(-100);
    expect(Math.abs(s.z)).toBe(0);
  });

  it('paddleFor inverts the paddle collision', () => {
    const vIn = v3(0.3, -1.5, 7), wIn = v3(40, 0, 0);
    const vOut = v3(0.4, 2.0, -8), wOut = v3(-90, 10, 0);
    const p = paddleFor(vIn, wIn, vOut, wOut);
    const b = new BallPhysics();
    b.set(v3(0, 1, 1.6), vIn, wIn);
    b.hitWith(p.normal, p.vel, 0.86);
    expect(b.vel.x).toBeCloseTo(vOut.x, 1);
    expect(b.vel.y).toBeCloseTo(vOut.y, 1);
    expect(b.vel.z).toBeCloseTo(vOut.z, 1);
    expect(b.spin.x).toBeLessThan(-30);
  });

  it('a full-power, full-direction swing can go out; a middle swing lands in', () => {
    const contact = v3(0, TABLE.height + 0.15, 1.6);
    const mid = intentFromSwing({ power: 0.5, direction: 0, loft: 0.2, topspin: 0.3, sidespin: 0 }, contact, 0);
    const p = planShot(contact, mid.intent, 0);
    expect(p.clears).toBe(true);
    const wide = intentFromSwing({ power: 1.1, direction: 1.2, loft: 0, topspin: 0, sidespin: 0 }, contact, 0);
    expect(Math.abs(wide.intent.target.x)).toBeGreaterThan(TABLE.width / 2);
    const c = firstContact(contact, p.vel, p.spin);
    expect(c?.kind).toBe('table');
  });
});

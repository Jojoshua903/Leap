import { describe, expect, it } from 'vitest';
import { RC_RULES, ReturnScore, levelFor } from './ReturnRules';
import { BallMachine, MACHINE_STEPS, machineStep, targetsHit } from './BallMachine';
import { planShot } from './Shot';

describe('Return Challenge scoring', () => {
  it('10 per return, +5 spin, +25 per target', () => {
    const s = new ReturnScore();
    expect(s.addReturn({ spin: false, targets: 0 }).points).toBe(10);
    expect(s.addReturn({ spin: true, targets: 0 }).points).toBe(15);
    expect(s.addReturn({ spin: true, targets: 1 }).points).toBe(40);
    expect(s.score).toBe(65);
    expect(s.targets).toBe(1);
    expect(s.spinShots).toBe(2);
  });

  it('combo multiplier ×1 for returns 1–3, ×2 for 4–6 … capped at ×5, reset by a miss', () => {
    const s = new ReturnScore();
    const mults: number[] = [];
    for (let i = 0; i < 16; i++) mults.push(s.addReturn({ spin: false, targets: 0 }).multiplier);
    expect(mults).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5]);
    s.miss();
    expect(s.multiplier).toBe(1);
    expect(s.bestCombo).toBe(16);
  });

  it('3 lives, game over at 0', () => {
    const s = new ReturnScore();
    expect(s.lives).toBe(RC_RULES.lives);
    expect(s.miss()).toBe(false);
    expect(s.miss()).toBe(false);
    expect(s.miss()).toBe(true);
    expect(s.over).toBe(true);
    expect(s.miss()).toBe(true);
    expect(s.lives).toBe(0);
  });

  it('difficulty rises every 10 returns, in 5 steps', () => {
    expect([0, 9, 10, 19, 20, 30, 40, 99, 500].map(levelFor)).toEqual([1, 1, 2, 2, 3, 4, 5, 5, 5]);
    const s = new ReturnScore();
    const ups: number[] = [];
    for (let i = 1; i <= 45; i++) if (s.addReturn({ spin: false, targets: 0 }).levelUp) ups.push(i);
    expect(ups).toEqual([10, 20, 30, 40]);
  });
});

describe('Ball machine difficulty curve', () => {
  it('each step is faster (lower arc), spinnier, wider and quicker', () => {
    for (let i = 1; i < MACHINE_STEPS.length; i++) {
      const a = MACHINE_STEPS[i - 1], b = MACHINE_STEPS[i];
      expect(b.apex).toBeLessThan(a.apex);
      expect(b.topMax).toBeGreaterThanOrEqual(a.topMax);
      expect(b.spread).toBeGreaterThan(a.spread);
      expect(b.interval).toBeLessThan(a.interval);
      expect(b.targetRadius).toBeLessThanOrEqual(a.targetRadius);
    }
    expect(machineStep(0)).toBe(MACHINE_STEPS[0]);
    expect(machineStep(9)).toBe(MACHINE_STEPS[4]);
  });

  it('machine balls land on the player’s half', () => {
    const m = new BallMachine(3);
    for (const lvl of [1, 3, 5]) {
      for (let i = 0; i < 6; i++) {
        const b = m.next(lvl);
        const plan = planShot(b.from, b.intent, 1);
        expect(plan.clears, `level ${lvl}`).toBe(true);
      }
    }
  });

  it('targets sit on the machine’s half and don’t overlap', () => {
    const m = new BallMachine(8);
    const ts = m.targets(5);
    expect(ts).toHaveLength(3);
    for (const t of ts) expect(t.z).toBeLessThan(0);
    expect(targetsHit({ x: ts[0].x, z: ts[0].z }, ts)).toBe(1);
    expect(targetsHit({ x: 5, z: 5 }, ts)).toBe(0);
  });
});

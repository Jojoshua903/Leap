import { describe, expect, it } from 'vitest';
import { AI_LEVELS, AIPlayer, getLevel, simulateGame } from './AI';
import { Engine } from './Engine';
import { onHalf, planShot } from './Shot';
import type { Side } from './Rules';

/** Headless matches are slow-ish (full 240 Hz physics plus shot planning), so give them room. */
const LONG = 240_000;

function winRate(a: number, b: number, games: number, seed0: number): number {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    // alternate who serves first so neither side has the serve advantage
    if (simulateGame(a, b, seed0 + g, (g % 2) as Side).winner === 0) wins++;
  }
  return wins / games;
}

describe('AI', () => {
  it('has 5 levels that get strictly better', () => {
    expect(AI_LEVELS.map(l => l.id)).toEqual([0, 1, 2, 3, 4]);
    for (let i = 1; i < AI_LEVELS.length; i++) {
      expect(AI_LEVELS[i].reactionMs).toBeLessThan(AI_LEVELS[i - 1].reactionMs);
      expect(AI_LEVELS[i].timingErrMs).toBeLessThan(AI_LEVELS[i - 1].timingErrMs);
      expect(AI_LEVELS[i].aimErr).toBeLessThan(AI_LEVELS[i - 1].aimErr);
    }
    expect(getLevel(99).id).toBe(4);
  });

  it('is deterministic for a seed', () => {
    expect(simulateGame(2, 3, 1234)).toEqual(simulateGame(2, 3, 1234));
  }, LONG);

  it('Master picks targets that land on the other half', () => {
    const ai = new AIPlayer(1, getLevel(4), 9);
    let inside = 0;
    for (let i = 0; i < 40; i++) {
      const from = { x: 0.1, y: 0.95, z: -1.6 };
      const { intent } = ai.chooseShot(from);
      const plan = planShot(from, intent, 1);
      if (plan.clears && plan.landing && onHalf(plan.landing, 0)) inside++;
    }
    expect(inside).toBeGreaterThanOrEqual(37);
  });

  it('serves are legal and start a rally', () => {
    const e = new Engine(1, 1, 5);
    const ai = new AIPlayer(1, getLevel(4), 3);
    for (let i = 0; i < 240 * 4 && e.rallyLength === 0; i++) { ai.tick(e); e.step(); }
    expect(e.rallyLength).toBe(1);
    for (let i = 0; i < 240 && e.toPlay !== 0 && e.phase === 'live'; i++) e.step();
    expect(e.toPlay).toBe(0);              // bounced on both halves: the receiver must play it
  });

  it('Master beats Beginner in at least 95% of 200 games', () => {
    expect(winRate(4, 0, 200, 1000)).toBeGreaterThanOrEqual(0.95);
  }, LONG);

  it('same-level games are close to 50/50 (±15%)', () => {
    const r = winRate(2, 2, 120, 5000);
    expect(r).toBeGreaterThanOrEqual(0.35);
    expect(r).toBeLessThanOrEqual(0.65);
  }, LONG);
});

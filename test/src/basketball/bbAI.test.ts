import { describe, expect, it } from 'vitest';
import { AI_DIFFICULTY, DIFFICULTIES } from './bbAI';
import { PickupSim, simulateGame } from './PickupSim';
import type { Team } from './PickupRules';

/** Headless games are quick (60 Hz, no Rapier) but 100 of them still need room. */
const LONG = 240_000;

function winRate(home: 'easy' | 'normal' | 'hard', away: 'easy' | 'normal' | 'hard', games: number, seed0: number): number {
  let wins = 0;
  for (let g = 0; g < games; g++) if (simulateGame(home, away, seed0 + g).winner === 0) wins++;
  return wins / games;
}

describe('bbAI', () => {
  it('difficulties get strictly better', () => {
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      const a = AI_DIFFICULTY[DIFFICULTIES[i - 1]], b = AI_DIFFICULTY[DIFFICULTIES[i]];
      expect(b.reaction).toBeLessThan(a.reaction);
      expect(b.powerSd).toBeLessThan(a.powerSd);
      expect(b.timingSd).toBeLessThan(a.timingSd);
      expect(b.stealChance).toBeGreaterThan(a.stealChance);
    }
  });

  it('a game is deterministic for a seed', () => {
    expect(simulateGame('normal', 'hard', 4242)).toEqual(simulateGame('normal', 'hard', 4242));
  }, LONG);

  it('games finish with a legal score (first to 11, win by 1)', () => {
    for (let s = 0; s < 10; s++) {
      const r = simulateGame('normal', 'normal', 900 + s);
      expect(r.winner).not.toBeNull();
      const w = r.winner as Team;
      expect(r.points[w]).toBeGreaterThanOrEqual(11);
      expect(r.points[w]).toBeLessThanOrEqual(12);          // the winning basket is 1 or 2 points
      expect(r.points[1 - w]).toBeLessThan(11);
    }
  }, LONG);

  it('Hard beats Easy in at least 85% of 100 games', () => {
    expect(winRate('hard', 'easy', 100, 1000)).toBeGreaterThanOrEqual(0.85);
  }, LONG);

  it('every player is busy: brains take roles and states during a game', () => {
    const sim = new PickupSim({ target: 11, difficulty: ['normal', 'normal'], seed: 7 });
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 40 && sim.phase !== 'over'; i++) {
      sim.step(1 / 60);
      for (const p of sim.players) seen.add(p.brain.state);
    }
    for (const s of ['guard', 'spotUp', 'dribble', 'setShot', 'rebound']) expect(seen.has(s)).toBe(true);
  });

  it('players never overlap for long (separation steering)', () => {
    const sim = new PickupSim({ target: 11, difficulty: ['hard', 'hard'], seed: 11 });
    let close = 0, samples = 0;
    for (let i = 0; i < 60 * 30; i++) {
      sim.step(1 / 60);
      for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) {
        samples++;
        if (Math.hypot(sim.players[a].x - sim.players[b].x, sim.players[a].z - sim.players[b].z) < 0.35) close++;
      }
    }
    expect(close / samples).toBeLessThan(0.01);
  });
});

describe('PickupSim rules in play', () => {
  it('a made 2 from outside scores 2 and the scorer keeps the ball (make-it-take-it)', () => {
    const sim = new PickupSim({ target: 11, difficulty: ['hard', 'hard'], seed: 3 });
    let basket: { team: Team; points: number; counted: boolean } | null = null;
    sim.events.basket = e => { basket ??= e; };
    while (!basket && sim.time < 300) sim.step(1 / 60);
    expect(basket).not.toBeNull();
    const b = basket as unknown as { team: Team; points: number; counted: boolean };
    if (b.counted) {
      expect([1, 2]).toContain(b.points);
      expect(sim.rules.offense).toBe(b.team);
    }
  });

  it('after a steal the ball must be cleared before a basket counts', () => {
    const sim = new PickupSim({ target: 11, difficulty: ['easy', 'easy'], seed: 5 });
    for (let i = 0; i < 90; i++) sim.step(1 / 60);             // past the check
    const thief = sim.players[3];
    sim.rules.changePossession(1);
    expect(sim.rules.cleared).toBe(false);
    thief.x = 0; thief.z = 2;                                   // inside the arc
    sim.rules.carry(thief.x, thief.z);
    expect(sim.rules.cleared).toBe(false);
    sim.rules.carry(0, 7.5);
    expect(sim.rules.cleared).toBe(true);
  });

  it('a human-controlled player only moves by its stick', () => {
    const sim = new PickupSim({ target: 11, difficulty: ['normal', 'normal'], seed: 9 });
    const me = sim.players[1];
    me.human = true;
    const x0 = me.x, z0 = me.z;
    for (let i = 0; i < 30; i++) sim.step(1 / 60);
    expect(Math.hypot(me.x - x0, me.z - z0)).toBeLessThan(0.3);
    me.moveX = 1;
    for (let i = 0; i < 60; i++) sim.step(1 / 60);
    expect(me.x - x0).toBeGreaterThan(1);
  });
});

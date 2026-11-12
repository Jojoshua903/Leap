import { describe, expect, it } from 'vitest';
import { AI_LEVELS, DuelAI, simulateDuel } from './DuelAI';
import { newFighter } from './DuelRules';

describe('Duel AI', () => {
  it('levels get sharper from 1 to 5, and every level telegraphs (wind-up ≥ 0.4 s)', () => {
    for (let i = 1; i < AI_LEVELS.length; i++) {
      const a = AI_LEVELS[i - 1], b = AI_LEVELS[i];
      expect(b.reaction).toBeLessThan(a.reaction);
      expect(b.attackGap).toBeLessThan(a.attackGap);
      expect(b.guardAcc).toBeGreaterThan(a.guardAcc);
      expect(b.parry).toBeGreaterThanOrEqual(a.parry);
    }
    for (const l of AI_LEVELS) expect(l.windup).toBeGreaterThanOrEqual(0.4);
  });

  it('is deterministic for a seed', () => {
    const a = simulateDuel(3, 4, 17), b = simulateDuel(3, 4, 17);
    expect(a.winner).toBe(b.winner);
    expect(a.wins).toEqual(b.wins);
    expect(a.time).toBeCloseTo(b.time, 9);
    expect(a.log.map(r => r.outcome)).toEqual(b.log.map(r => r.outcome));
  });

  it('level 5 beats level 1 in at least 90 % of 200 duels, and nothing stalemates', () => {
    let wins5 = 0;
    for (let s = 0; s < 200; s++) {
      // alternate sides so starting position doesn't matter
      const flip = s % 2 === 1;
      const r = flip ? simulateDuel(1, 5, s) : simulateDuel(5, 1, s);
      expect(r.wins[0] === 2 || r.wins[1] === 2).toBe(true);
      if ((flip ? 1 : 0) === r.winner) wins5++;
    }
    expect(wins5 / 200).toBeGreaterThanOrEqual(0.9);
  });

  it('the order is roughly monotonic: higher levels win more often against level 3', () => {
    const rate = (lvl: number): number => {
      let w = 0;
      for (let s = 0; s < 40; s++) {
        const flip = s % 2 === 1;
        const r = flip ? simulateDuel(3, lvl, 1000 + s) : simulateDuel(lvl, 3, 1000 + s);
        if (r.winner === (flip ? 1 : 0)) w++;
      }
      return w / 40;
    };
    const rates = [1, 2, 3, 4, 5].map(rate);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThanOrEqual(rates[i - 1] - 0.1);
    expect(rates[4]).toBeGreaterThan(rates[0]);
  });

  it('always attacks with a wind-up the defender can see, and is beatable (it gets hit)', () => {
    const r = simulateDuel(5, 5, 3);
    expect(r.log.some(x => x.outcome === 'hit')).toBe(true);
    const ai = new DuelAI(5, 1), me = newFighter(), foe = newFighter();
    let t = 0, sawWindup = false;
    for (let i = 0; i < 600; i++) {
      t += 1 / 60;
      const o = ai.update(t, me, foe, null);
      if (o.attack) { expect(o.attack.land - o.attack.start).toBeGreaterThanOrEqual(0.4 - 1e-9); sawWindup = true; }
    }
    expect(sawWindup).toBe(true);
  });
});

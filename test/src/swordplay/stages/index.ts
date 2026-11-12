import { Rng } from '../../tabletennis/BallPhysics';
import { BRIDGE } from './bridge';
import { RUINS } from './ruins';
import { FOREST } from './forest';
import type { StageDef } from './types';

export * from './types';

/** The whole run in order: 5 stages and the boss. */
export const STAGES: readonly StageDef[] = [...BRIDGE, ...RUINS, ...FOREST];

/**
 * A seeded variant of the run: enemy spots shift a little sideways and waves with two or more enemies may
 * swap who comes first. The boss stage is never changed.
 */
export function seededStages(seed: number, base: readonly StageDef[] = STAGES): StageDef[] {
  const rng = new Rng(seed);
  return base.map(st => st.boss ? st : {
    ...st,
    waves: st.waves.map(w => {
      const enemies = w.enemies.map(e => ({ ...e, x: Math.round((e.x + rng.signed() * 0.25) * 100) / 100 }));
      if (enemies.length > 1 && rng.next() < 0.5) {
        const [a, b] = [enemies[0], enemies[1]];
        enemies[0] = { ...b, delay: a.delay }; enemies[1] = { ...a, delay: b.delay };
      }
      return { enemies };
    })
  });
}

import type { EnemyDef } from './types';

/** A puppet archer that stays back and shoots slow foam arrows. Slice an arrow out of the air or dodge it. */
export const ARCHER: EnemyDef = {
  id: 'archer', nameKey: 'sw.enemy.archer', hp: 2, score: 250, count: 1, armor: 'none',
  radius: 0.28, height: 1.5, stun: 1.0,
  script: rng => [
    { kind: 'idle', t: 1.2 + rng.next() * 0.6 },
    { kind: 'shoot', speed: 3.6 + rng.next() * 0.8, damage: 8 }
  ]
};

import type { EnemyDef } from './types';

/** A round puppet that lobs cartoon bombs. Slice a bomb and it flies back at the bomber. */
export const BOMBER: EnemyDef = {
  id: 'bomber', nameKey: 'sw.enemy.bomber', hp: 2, score: 300, count: 1, armor: 'none',
  radius: 0.34, height: 1.3, stun: 1.0,
  script: rng => [
    { kind: 'idle', t: 1.0 + rng.next() * 0.5 },
    { kind: 'bomb', flight: 1.5, damage: 10 }
  ]
};

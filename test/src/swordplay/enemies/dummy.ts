import type { EnemyDef } from './types';

/** A straw training dummy on a post: it just stands there. One clean slash. */
export const DUMMY: EnemyDef = {
  id: 'dummy', nameKey: 'sw.enemy.dummy', hp: 1, score: 100, count: 1, armor: 'none',
  radius: 0.28, height: 1.5, stun: 0,
  script: () => [{ kind: 'idle', t: 2 }]
};

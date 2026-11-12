import { pick, type EnemyDef } from './types';

/** Five felt bats that flap around and dive at you one by one. Any slash that touches one pops it. */
export const BAT_SWARM: EnemyDef = {
  id: 'batSwarm', nameKey: 'sw.enemy.batSwarm', hp: 1, score: 60, count: 5, armor: 'none',
  radius: 0.16, height: 0.3, stun: 0.6,
  script: rng => [
    { kind: 'idle', t: 0.9 + rng.next() * 0.8 },
    { kind: 'attack', dir: pick(rng, ['left', 'right', 'down', 'downLeft', 'downRight'] as const), windup: 0.6, damage: 6 }
  ]
};

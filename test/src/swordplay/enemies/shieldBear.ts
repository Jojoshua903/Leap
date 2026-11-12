import { pick, type EnemyDef } from './types';

/**
 * A big plush bear behind a round wooden shield. Slashes thud off the shield: a thrust knocks it aside,
 * then the bear is open to slashes for a few seconds. It swats down or shoves (a slow thrust).
 */
export const SHIELD_BEAR: EnemyDef = {
  id: 'shieldBear', nameKey: 'sw.enemy.shieldBear', hp: 2, score: 400, count: 1, armor: 'thrustFirst',
  radius: 0.45, height: 1.9, stun: 1.4,
  script: rng => [
    { kind: 'idle', t: 1.1 },
    { kind: 'attack', dir: pick(rng, ['down', 'downLeft', 'downRight', 'thrust'] as const), windup: 0.95, damage: 14 },
    { kind: 'idle', t: 0.8 }
  ]
};

import { pick, type EnemyDef } from './types';
import { DIRS } from '../swMath';

/**
 * A wooden puppet knight. It alternates: holds its shield on one side (slashes from that side bounce),
 * then swings at you. Hit it from the open side, or parry its swing for a free hit.
 */
export const PUPPET_KNIGHT: EnemyDef = {
  id: 'puppetKnight', nameKey: 'sw.enemy.puppetKnight', hp: 3, score: 300, count: 1, armor: 'shieldSide',
  radius: 0.3, height: 1.6, stun: 1.2,
  script: rng => [
    { kind: 'shield', zone: pick(rng, ['left', 'right', 'high'] as const), t: 1.6 },
    { kind: 'attack', dir: pick(rng, DIRS), windup: 0.85, damage: 10 },
    { kind: 'idle', t: 0.7 }
  ]
};

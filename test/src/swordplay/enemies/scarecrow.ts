import { pick, type EnemyDef, type EnemyMove } from './types';
import { DIRS } from '../swMath';

/**
 * The boss: The Great Scarecrow Knight, a tall straw knight with a broom-handle lance.
 * It only takes damage on its glowing weak points (slash them in the shown direction).
 *   Phase 1: slow swings, one weak point at a time.
 *   Phase 2: faster swings and lance thrusts, two weak points in a row.
 *   Phase 3: combos of three, short weak-point windows.
 * At 0 HP it wobbles: one big thrust within 4 s finishes it, otherwise it recovers a little (see BossBrain).
 */
export const SCARECROW: EnemyDef = {
  id: 'scarecrow', nameKey: 'sw.enemy.scarecrow', hp: 24, score: 3000, count: 1, armor: 'weakOnly',
  radius: 0.5, height: 2.8, stun: 1.6,
  script: (rng, phase) => {
    const swing = (windup: number, dmg: number): EnemyMove => ({ kind: 'attack', dir: pick(rng, DIRS), windup, damage: dmg });
    const weak = (t: number): EnemyMove => ({ kind: 'weak', dir: pick(rng, DIRS), t });
    if (phase <= 1) return [swing(1.0, 12), { kind: 'idle', t: 0.6 }, weak(2.2), { kind: 'idle', t: 0.6 }];
    if (phase === 2) return [
      swing(0.85, 14), { kind: 'attack', dir: 'thrust', windup: 1.0, damage: 16 }, weak(1.6), weak(1.6), { kind: 'idle', t: 0.5 }
    ];
    return [swing(0.7, 15), swing(0.6, 15), swing(0.6, 15), weak(1.2), weak(1.2), weak(1.2), { kind: 'idle', t: 0.4 }];
  }
};

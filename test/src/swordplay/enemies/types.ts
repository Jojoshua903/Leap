import type { Rng } from '../../tabletennis/BallPhysics';
import type { GuardZone } from '../SlashDetector';
import type { Dir8 } from '../swMath';

/**
 * Showdown enemies as data. A def says how tough an enemy is, what hurts it and what it does: `script`
 * returns one loop of moves (seeded), which the Showdown runs again and again. Attack directions are the
 * blade movement as the ENEMY sees it (DuelRules convention); the HUD shows the arrow mirrored for the
 * player.
 */
export type EnemyId = 'dummy' | 'puppetKnight' | 'shieldBear' | 'batSwarm' | 'archer' | 'bomber' | 'scarecrow';

export type EnemyMove =
  /** Stand there for t seconds (the enemy can be hit). */
  | { kind: 'idle'; t: number }
  /** A telegraphed attack: guard, dodge or parry it. */
  | { kind: 'attack'; dir: Dir8 | 'thrust'; windup: number; damage: number }
  /** Hold a shield on one side for t seconds: slashes coming from that side bounce off. */
  | { kind: 'shield'; zone: GuardZone; t: number }
  /** Shoot a slow foam arrow at the player: slice it or dodge. */
  | { kind: 'shoot'; speed: number; damage: number }
  /** Lob a cartoon bomb: slice it away (it flies back) or it poofs on you. */
  | { kind: 'bomb'; flight: number; damage: number }
  /** Boss: show a weak point that only a slash in `dir` (as the player sees it) can hit. */
  | { kind: 'weak'; dir: Dir8; t: number };

/** What hurts it: everything; only a thrust breaks its shield first; or only its weak points. */
export type Armor = 'none' | 'shieldSide' | 'thrustFirst' | 'weakOnly';

export interface EnemyDef {
  id: EnemyId;
  nameKey: string;
  hp: number;
  /** Points for beating one. */
  score: number;
  /** How many of them come at once (a swarm). */
  count: number;
  armor: Armor;
  /** Body size for hit tests (a capsule this tall with this radius) and how far in front it stands. */
  radius: number;
  height: number;
  /** Seconds a successful parry leaves it stunned (and open). */
  stun: number;
  /** One loop of moves. `phase` is the boss phase (1–3), 1 for everything else. */
  script(rng: Rng, phase: number): EnemyMove[];
}

export const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng.next() * list.length)];

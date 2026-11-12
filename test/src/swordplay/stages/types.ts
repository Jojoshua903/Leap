import type { EnemyId } from '../enemies/types';

/**
 * Showdown stages as data. The Buddy walks `walk` metres on along the path (from the last stop; the stops land
 * at 10, 24, 40, 54, 76 and 104 m, matching the bridge, ruins, forest and clearing in ArenaScenes), then the waves come one after
 * the other (each wave starts when the last one is beaten). Positions are in front of the player:
 * x = right, z = forward (metres).
 */
export type Area = 'bridge' | 'ruins' | 'forest';

export interface SpawnDef { id: EnemyId; x: number; z: number; delay?: number }
export interface WaveDef { enemies: SpawnDef[] }

export interface StageDef {
  id: string;
  nameKey: string;
  area: Area;
  walk: number;
  waves: WaveDef[];
  /** A heart pickup (+25 HP) appears after this wave (0-based), if set. */
  heartAfter?: number;
  /** Seconds for the full speed bonus (from the first wave to the last kill). */
  parTime: number;
  boss?: boolean;
}

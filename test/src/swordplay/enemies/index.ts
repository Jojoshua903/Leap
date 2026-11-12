import type { EnemyDef, EnemyId } from './types';
import { DUMMY } from './dummy';
import { PUPPET_KNIGHT } from './puppetKnight';
import { SHIELD_BEAR } from './shieldBear';
import { BAT_SWARM } from './batSwarm';
import { ARCHER } from './archer';
import { BOMBER } from './bomber';
import { SCARECROW } from './scarecrow';

export * from './types';

/** Every enemy by id. Add a new one here (and a model in enemyModels.ts). */
export const ENEMIES: Record<EnemyId, EnemyDef> = {
  dummy: DUMMY, puppetKnight: PUPPET_KNIGHT, shieldBear: SHIELD_BEAR, batSwarm: BAT_SWARM,
  archer: ARCHER, bomber: BOMBER, scarecrow: SCARECROW
};

import type { StageDef } from './types';

/** Stage 5 and the boss: the lantern forest, then the clearing of The Great Scarecrow Knight. */
export const FOREST: StageDef[] = [
  {
    id: 'forest1', nameKey: 'sw.stage.forest1', area: 'forest', walk: 22, parTime: 70, heartAfter: 2,
    waves: [
      { enemies: [{ id: 'batSwarm', x: 0, z: 1.4 }, { id: 'puppetKnight', x: 0.4, z: 1.8, delay: 3 }] },
      { enemies: [{ id: 'archer', x: -1.2, z: 6.5 }, { id: 'archer', x: 1.2, z: 6.5, delay: 1.2 }, { id: 'shieldBear', x: 0, z: 2.0, delay: 2 }] },
      { enemies: [{ id: 'bomber', x: 0, z: 6 }, { id: 'puppetKnight', x: -0.4, z: 1.7, delay: 1 }] }
    ]
  },
  {
    id: 'boss', nameKey: 'sw.stage.boss', area: 'forest', walk: 28, parTime: 120, boss: true,
    waves: [{ enemies: [{ id: 'scarecrow', x: 0, z: 2.4 }] }]
  }
];

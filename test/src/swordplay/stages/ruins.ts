import type { StageDef } from './types';

/** Stages 3–4: the old castle ruins. The shield bear (thrust first!) and the bomber. */
export const RUINS: StageDef[] = [
  {
    id: 'ruins1', nameKey: 'sw.stage.ruins1', area: 'ruins', walk: 16, parTime: 55,
    waves: [
      { enemies: [{ id: 'shieldBear', x: 0, z: 1.9 }] },
      { enemies: [{ id: 'bomber', x: 0, z: 6 }] },
      { enemies: [{ id: 'dummy', x: -0.7, z: 1.6 }, { id: 'shieldBear', x: 0.3, z: 2.0, delay: 0.5 }] }
    ]
  },
  {
    id: 'ruins2', nameKey: 'sw.stage.ruins2', area: 'ruins', walk: 14, parTime: 60, heartAfter: 1,
    waves: [
      { enemies: [{ id: 'puppetKnight', x: 0, z: 1.7 }, { id: 'bomber', x: -1.2, z: 6.5, delay: 1.5 }] },
      { enemies: [{ id: 'batSwarm', x: 0, z: 1.4 }, { id: 'archer', x: 1.3, z: 6.5, delay: 2 }] },
      { enemies: [{ id: 'shieldBear', x: 0, z: 1.9 }, { id: 'bomber', x: 1.2, z: 6.5, delay: 1 }] }
    ]
  }
];

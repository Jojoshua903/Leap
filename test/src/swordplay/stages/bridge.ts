import type { StageDef } from './types';

/** Stages 1–2: the rope bridge over the gorge. Warm-up dummies, the first knights, bats and an archer. */
export const BRIDGE: StageDef[] = [
  {
    id: 'bridge1', nameKey: 'sw.stage.bridge1', area: 'bridge', walk: 10, parTime: 35,
    waves: [
      { enemies: [{ id: 'dummy', x: 0, z: 1.5 }] },
      { enemies: [{ id: 'dummy', x: -0.6, z: 1.6 }, { id: 'dummy', x: 0.6, z: 1.6, delay: 0.4 }] },
      { enemies: [{ id: 'puppetKnight', x: 0, z: 1.7 }] }
    ]
  },
  {
    id: 'bridge2', nameKey: 'sw.stage.bridge2', area: 'bridge', walk: 14, parTime: 50, heartAfter: 0,
    waves: [
      { enemies: [{ id: 'batSwarm', x: 0, z: 1.4 }] },
      { enemies: [{ id: 'archer', x: 0, z: 6 }] },
      { enemies: [{ id: 'puppetKnight', x: -0.5, z: 1.7 }, { id: 'archer', x: 1.2, z: 6.5, delay: 1 }] }
    ]
  }
];

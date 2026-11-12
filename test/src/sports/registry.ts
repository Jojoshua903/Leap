import type { BackendKind } from '../types';
import type { ModeDef, ModeId, ModeOptionDef, SportDef, SportId, ScoringType } from './types';

/**
 * Data-driven list of every sport and mode. The main menu, mode setup, stats and saves all read this.
 * Adding a sport = one entry here + a scene file returned by `scene`.
 */
const ALL: BackendKind[] = ['mouse', 'phone', 'joycon'];

const bowlingOptions: ModeOptionDef[] = [
  { id: 'frames', labelKey: 'opt.frames', default: 10, choices: [{ value: 10, labelKey: 'opt.frames.10' }, { value: 5, labelKey: 'opt.frames.5' }] },
  { id: 'handicap', labelKey: 'opt.handicap', default: false, choices: [{ value: false, labelKey: 'opt.off' }, { value: true, labelKey: 'opt.on' }] }
];

const bowlingScene = (): Promise<import('./types').SceneFactory> => import('../game/BowlingScene').then(m => m.createBowlingScene);

function mode(sport: SportId, id: ModeId, o: {
  status?: 'playable' | 'comingSoon'; min?: number; max?: number; gyro?: boolean; scoring: ScoringType;
  scene?: ModeDef['scene']; options?: ModeOptionDef[]; controllers?: BackendKind[];
}): ModeDef {
  return {
    id, sport,
    nameKey: `mode.${sport}.${id}.name`,
    descKey: `mode.${sport}.${id}.desc`,
    rulesKey: `mode.${sport}.${id}.rules`,
    status: o.status ?? 'comingSoon',
    minPlayers: o.min ?? 1,
    maxPlayers: o.max ?? 4,
    controllers: o.controllers ?? ALL,
    needsGyro: o.gyro ?? true,
    scoring: o.scoring,
    scene: o.scene ?? null,
    options: o.options ?? []
  };
}

function sport(id: SportId, accent: string, modes: ModeDef[]): SportDef {
  return { id, nameKey: `sport.${id}.name`, descKey: `sport.${id}.desc`, icon: id, accent, modes };
}

export const SPORTS: SportDef[] = [
  sport('swordplay', '#ff7a59', [
    mode('swordplay', 'duel', { scoring: 'points', min: 1, max: 2 }),
    mode('swordplay', 'speedSlice', { scoring: 'points', min: 1, max: 2 }),
    mode('swordplay', 'showdown', { scoring: 'points', min: 1, max: 2 })
  ]),
  sport('airsports', '#ffb020', [
    mode('airsports', 'islandFlyover', { scoring: 'points', min: 1, max: 2 }),
    mode('airsports', 'dogfight', { scoring: 'points', min: 2, max: 2 }),
    mode('airsports', 'skydiving', { scoring: 'points', min: 1, max: 4 })
  ]),
  sport('bowling', '#ff5fa2', [
    mode('bowling', 'standard', { status: 'playable', scoring: 'tenpin', scene: bowlingScene, options: bowlingOptions }),
    mode('bowling', 'hundred', { status: 'playable', scoring: 'pinTotal', scene: bowlingScene, options: bowlingOptions })
  ]),
  sport('basketball', '#ff8a3c', [
    mode('basketball', 'threePoint', { scoring: 'points' }),
    mode('basketball', 'pickup', { scoring: 'points', min: 1, max: 2 })
  ]),
  sport('tabletennis', '#2f8fd8', [
    mode('tabletennis', 'matchPlay', { scoring: 'points', min: 1, max: 2 }),
    mode('tabletennis', 'returnChallenge', { scoring: 'points' })
  ]),
  sport('frisbee', '#3bb37a', [
    mode('frisbee', 'frisbeeDog', { scoring: 'points' }),
    mode('frisbee', 'frisbeeGolf', { scoring: 'points' })
  ])
];

export function getSport(id: SportId): SportDef {
  const s = SPORTS.find(x => x.id === id);
  if (!s) throw new Error(`Unknown sport ${id}`);
  return s;
}

export function getMode(sportId: SportId, modeId: ModeId): ModeDef {
  const m = getSport(sportId).modes.find(x => x.id === modeId);
  if (!m) throw new Error(`Unknown mode ${sportId}/${modeId}`);
  return m;
}

export const allModes = (): ModeDef[] => SPORTS.flatMap(s => s.modes);

/** Default option values for a mode. */
export function defaultOptions(m: ModeDef): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const o of m.options) out[o.id] = o.default;
  return out;
}

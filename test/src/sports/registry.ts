import type { BackendKind } from '../types';
import type { ModeDef, ModeId, ModeOptionDef, SceneFactory, SportDef, SportId, ScoringType } from './types';

/**
 * Data-driven list of every sport and mode. The main menu, mode setup, stats and saves all read this.
 * Adding a sport = one entry here + a scene file returned by `scene`.
 */
const ALL: BackendKind[] = ['mouse', 'phone', 'joycon'];

const bowlingOptions: ModeOptionDef[] = [
  { id: 'frames', labelKey: 'opt.frames', default: 10, choices: [{ value: 10, labelKey: 'opt.frames.10' }, { value: 5, labelKey: 'opt.frames.5' }] },
  { id: 'handicap', labelKey: 'opt.handicap', default: false, choices: [{ value: false, labelKey: 'opt.off' }, { value: true, labelKey: 'opt.on' }] }
];

const matchPlayOptions: ModeOptionDef[] = [
  { id: 'games', labelKey: 'opt.games', default: 3, choices: [{ value: 1, labelKey: 'opt.games.1' }, { value: 3, labelKey: 'opt.games.3' }, { value: 5, labelKey: 'opt.games.5' }] },
  {
    id: 'ai', labelKey: 'opt.ai', default: 1, players: [1, 1],
    choices: [0, 1, 2, 3, 4].map(n => ({ value: n, labelKey: `ai.level.${n}` }))
  }
];

const threePointOptions: ModeOptionDef[] = [
  { id: 'moneyRack', labelKey: 'opt.moneyRack', default: false, choices: [{ value: false, labelKey: 'opt.off' }, { value: true, labelKey: 'opt.on' }] }
];

const pickupOptions: ModeOptionDef[] = [
  { id: 'target', labelKey: 'opt.target', default: 11, choices: [{ value: 11, labelKey: 'opt.target.11' }, { value: 21, labelKey: 'opt.target.21' }] },
  {
    id: 'difficulty', labelKey: 'opt.difficulty', default: 'normal',
    choices: ['easy', 'normal', 'hard'].map(d => ({ value: d, labelKey: `opt.difficulty.${d}` }))
  }
];

const bowlingScene = (): Promise<SceneFactory> => import('../game/BowlingScene').then(m => m.createBowlingScene);
const matchPlayScene = (): Promise<SceneFactory> => import('../tabletennis/MatchPlay').then(m => m.createMatchPlay);
const returnScene = (): Promise<SceneFactory> => import('../tabletennis/ReturnChallenge').then(m => m.createReturnChallenge);
const threePointScene = (): Promise<SceneFactory> => import('../basketball/ThreePointContest').then(m => m.createThreePoint);
const pickupScene = (): Promise<SceneFactory> => import('../basketball/PickupGame').then(m => m.createPickup);
const frisbeeDogScene = (): Promise<SceneFactory> => import('../frisbee/FrisbeeDog').then(m => m.createFrisbeeDog);
const frisbeeGolfScene = (): Promise<SceneFactory> => import('../frisbee/FrisbeeGolf').then(m => m.createFrisbeeGolf);
const duelScene = (): Promise<SceneFactory> => import('../swordplay/Duel').then(m => m.createDuel);
const speedSliceScene = (): Promise<SceneFactory> => import('../swordplay/SpeedSlice').then(m => m.createSpeedSlice);
const showdownScene = (): Promise<SceneFactory> => import('../swordplay/Showdown').then(m => m.createShowdown);

function mode(sport: SportId, id: ModeId, o: {
  status?: 'playable' | 'comingSoon'; min?: number; max?: number; gyro?: boolean; scoring: ScoringType;
  scene?: ModeDef['scene']; options?: ModeOptionDef[]; controllers?: BackendKind[];
  practice?: boolean; split?: boolean; cosmetics?: string[];
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
    options: o.options ?? [],
    practice: o.practice ?? true,
    splitControllers: o.split ?? false,
    cosmetics: o.cosmetics ?? []
  };
}

function sport(id: SportId, accent: string, modes: ModeDef[]): SportDef {
  return { id, nameKey: `sport.${id}.name`, descKey: `sport.${id}.desc`, icon: id, accent, modes };
}

const BOWLING_COSMETICS = ['lane', 'ball', 'trail'];
const TT_COSMETICS = ['paddle', 'table', 'hall'];
const BB_COSMETICS = ['hoopball', 'jersey', 'net', 'court'];
const DOG_COSMETICS = ['dog', 'disc', 'discTrail'];
const GOLF_COSMETICS = ['course', 'disc', 'discTrail'];
const DUEL_COSMETICS = ['blade', 'bladeTrail', 'arena', 'outfit'];
const SWORD_COSMETICS = ['blade', 'bladeTrail', 'outfit'];

const duelOptions: ModeOptionDef[] = [
  { id: 'rounds', labelKey: 'opt.rounds', default: 3, choices: [{ value: 1, labelKey: 'opt.rounds.1' }, { value: 3, labelKey: 'opt.rounds.3' }] },
  { id: 'ai', labelKey: 'opt.ai', default: 2, players: [1, 1], choices: [1, 2, 3, 4, 5].map(n => ({ value: n, labelKey: `sw.ai.${n}` })) }
];

const golfOptions: ModeOptionDef[] = [
  { id: 'aids', labelKey: 'opt.aids', default: 'short', choices: ['off', 'short', 'full'].map(v => ({ value: v, labelKey: `fb.aids.${v}` })) }
];

export const SPORTS: SportDef[] = [
  sport('swordplay', '#ff7a59', [
    mode('swordplay', 'duel', {
      status: 'playable', scoring: 'points', min: 1, max: 2, scene: duelScene, options: duelOptions, practice: false, split: true, cosmetics: DUEL_COSMETICS
    }),
    mode('swordplay', 'speedSlice', { status: 'playable', scoring: 'points', min: 1, max: 4, scene: speedSliceScene, cosmetics: SWORD_COSMETICS }),
    mode('swordplay', 'showdown', { status: 'playable', scoring: 'points', min: 1, max: 1, scene: showdownScene, practice: false, cosmetics: SWORD_COSMETICS })
  ]),
  sport('airsports', '#ffb020', [
    mode('airsports', 'islandFlyover', { scoring: 'points', min: 1, max: 2 }),
    mode('airsports', 'dogfight', { scoring: 'points', min: 2, max: 2 }),
    mode('airsports', 'skydiving', { scoring: 'points', min: 1, max: 4 })
  ]),
  sport('bowling', '#ff5fa2', [
    mode('bowling', 'standard', { status: 'playable', scoring: 'tenpin', scene: bowlingScene, options: bowlingOptions, cosmetics: BOWLING_COSMETICS }),
    mode('bowling', 'hundred', { status: 'playable', scoring: 'pinTotal', scene: bowlingScene, options: bowlingOptions, cosmetics: BOWLING_COSMETICS })
  ]),
  sport('basketball', '#ff8a3c', [
    mode('basketball', 'threePoint', {
      status: 'playable', scoring: 'points', min: 1, max: 4, scene: threePointScene, options: threePointOptions, cosmetics: BB_COSMETICS
    }),
    mode('basketball', 'pickup', {
      status: 'playable', scoring: 'points', min: 1, max: 1, scene: pickupScene, options: pickupOptions, practice: false, cosmetics: BB_COSMETICS
    })
  ]),
  sport('tabletennis', '#2f8fd8', [
    mode('tabletennis', 'matchPlay', {
      status: 'playable', scoring: 'points', min: 1, max: 2, scene: matchPlayScene, options: matchPlayOptions,
      practice: false, split: true, cosmetics: TT_COSMETICS
    }),
    mode('tabletennis', 'returnChallenge', {
      status: 'playable', scoring: 'points', min: 1, max: 1, scene: returnScene, practice: false, cosmetics: TT_COSMETICS
    })
  ]),
  sport('frisbee', '#3bb37a', [
    mode('frisbee', 'frisbeeDog', { status: 'playable', scoring: 'points', min: 1, max: 4, scene: frisbeeDogScene, cosmetics: DOG_COSMETICS }),
    mode('frisbee', 'frisbeeGolf', { status: 'playable', scoring: 'points', min: 1, max: 4, scene: frisbeeGolfScene, options: golfOptions, cosmetics: GOLF_COSMETICS })
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

import { defaultBuddy, validateBuddy, FAV_COLORS } from '../buddy/BuddyConfig';
import {
  DEFAULT_LOADOUT, DEFAULT_SETTINGS, MAX_PROFILES, PROFILE_SETTING_KEYS, SCHEMA_VERSION,
  type ModeStats, type Profile, type SaveData, type SettingsData
} from './types';

/**
 * Save migrations. Each entry upgrades data from version N to N+1; `migrate` runs them in order,
 * then `sanitizeSave` makes sure every field is present and well-typed. Add a step here whenever
 * SCHEMA_VERSION goes up, and never edit an old step.
 */
type Raw = Record<string, unknown>;
const MIGRATIONS: Record<number, (d: Raw) => Raw> = {
  // v0: anything without a schemaVersion (early builds). Profiles may be missing buddies or stats.
  0: d => ({
    schemaVersion: 1,
    profiles: Array.isArray(d.profiles) ? d.profiles : [],
    activeProfileId: typeof d.activeProfileId === 'string' ? d.activeProfileId : null,
    settings: d.settings && typeof d.settings === 'object' ? d.settings : {}
  })
};

export class MigrationError extends Error {
  constructor(public key: 'error.import.version' | 'error.import.shape') { super(key); }
}

export function emptySave(): SaveData {
  return { schemaVersion: SCHEMA_VERSION, profiles: [], activeProfileId: null, settings: { ...DEFAULT_SETTINGS } };
}

export function migrate(raw: unknown): SaveData {
  if (raw === null || raw === undefined) return emptySave();
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new MigrationError('error.import.shape');
  let d = raw as Raw;
  let v = typeof d.schemaVersion === 'number' ? d.schemaVersion : 0;
  if (v > SCHEMA_VERSION) throw new MigrationError('error.import.version');
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new MigrationError('error.import.shape');
    d = step(d);
    v += 1;
  }
  return sanitizeSave(d);
}

/** Phase 1 stored only player names under `bb_players_v1`. Turn them into profiles. */
export function fromLegacyPlayers(raw: unknown): Profile[] {
  if (!raw || typeof raw !== 'object') return [];
  const names = (raw as { names?: unknown }).names;
  if (!Array.isArray(names)) return [];
  return names
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '' && !/^Player \d$/.test(n.trim()))
    .slice(0, MAX_PROFILES)
    .map((n, i) => newProfile(n, i));
}

let idCounter = 0;
export function newProfileId(): string {
  idCounter += 1;
  return `p_${Date.now().toString(36)}_${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newProfile(name: string, colorIndex = 0, buddy = defaultBuddy(name, colorIndex % FAV_COLORS.length)): Profile {
  return {
    id: newProfileId(), name: buddy.name, buddy, settings: {}, unlocked: [], achievements: {}, xp: 0, stats: {},
    loadout: { ...DEFAULT_LOADOUT }, createdAt: Date.now()
  };
}

/* ---------------- sanitising ---------------- */

const num = (v: unknown, d: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const str = (v: unknown, d: string, max = 64): string => (typeof v === 'string' ? v.slice(0, max) : d);

export function sanitizeSettings(raw: unknown, base: SettingsData = DEFAULT_SETTINGS): SettingsData {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Raw;
  return {
    backend: oneOf(s.backend, ['mouse', 'phone', 'joycon'] as const, base.backend),
    handed: oneOf(s.handed, ['right', 'left'] as const, base.handed),
    sensitivity: num(s.sensitivity, base.sensitivity, 0.5, 1.5),
    invertHook: bool(s.invertHook, base.invertHook),
    quality: oneOf(s.quality, ['low', 'med', 'high'] as const, base.quality),
    autoQuality: bool(s.autoQuality, base.autoQuality),
    showFps: bool(s.showFps, base.showFps),
    reducedMotion: bool(s.reducedMotion, base.reducedMotion),
    highContrast: bool(s.highContrast, base.highContrast),
    bigText: bool(s.bigText, base.bigText),
    colorblind: bool(s.colorblind, base.colorblind),
    gutterAssist: bool(s.gutterAssist, base.gutterAssist),
    shotAssist: ([0, 1, 2, 3] as const).find(v => v === s.shotAssist) ?? base.shotAssist,
    master: num(s.master, base.master, 0, 1),
    music: num(s.music, base.music, 0, 1),
    sfx: num(s.sfx, base.sfx, 0, 1),
    muted: bool(s.muted, base.muted),
    language: oneOf(s.language, ['en', 'nl'] as const, base.language),
    tutorialSeen: bool(s.tutorialSeen, base.tutorialSeen)
  };
}

function sanitizeStats(raw: unknown): Record<string, Record<string, ModeStats>> {
  const out: Record<string, Record<string, ModeStats>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [sport, modes] of Object.entries(raw as Raw)) {
    if (!modes || typeof modes !== 'object') continue;
    for (const [mode, ms] of Object.entries(modes as Raw)) {
      if (!ms || typeof ms !== 'object') continue;
      const m = ms as Raw;
      const extras: Record<string, number> = {};
      if (m.extras && typeof m.extras === 'object') {
        for (const [k, v] of Object.entries(m.extras as Raw)) if (typeof v === 'number' && Number.isFinite(v)) extras[k] = v;
      }
      (out[sport] ??= {})[mode] = {
        gamesPlayed: num(m.gamesPlayed, 0, 0), bestScore: num(m.bestScore, 0, 0), totalScore: num(m.totalScore, 0, 0), extras
      };
    }
  }
  return out;
}

/** Validate one profile. Returns null when it can't be repaired (no usable name/buddy). */
export function sanitizeProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Raw;
  const buddy = validateBuddy(p.buddy) ?? (typeof p.name === 'string' ? validateBuddy(defaultBuddy(p.name)) : null);
  if (!buddy) return null;
  const settings: Profile['settings'] = {};
  if (p.settings && typeof p.settings === 'object') {
    const full = sanitizeSettings(p.settings);
    for (const k of PROFILE_SETTING_KEYS) if (k in (p.settings as Raw)) (settings as Record<string, unknown>)[k] = full[k];
  }
  const ach: Record<string, number> = {};
  if (p.achievements && typeof p.achievements === 'object') {
    for (const [k, v] of Object.entries(p.achievements as Raw)) if (typeof v === 'number') ach[k] = v;
  }
  const lo = (p.loadout && typeof p.loadout === 'object' ? p.loadout : {}) as Raw;
  return {
    id: typeof p.id === 'string' && p.id ? p.id.slice(0, 40) : newProfileId(),
    name: buddy.name,
    buddy,
    settings,
    unlocked: Array.isArray(p.unlocked) ? [...new Set(p.unlocked.filter((x): x is string => typeof x === 'string'))] : [],
    achievements: ach,
    xp: Math.floor(num(p.xp, 0, 0)),
    stats: sanitizeStats(p.stats),
    loadout: {
      laneLook: str(lo.laneLook, 'classic'), ballSkin: str(lo.ballSkin, 'solid'), trail: str(lo.trail, 'classic'),
      paddle: str(lo.paddle, DEFAULT_LOADOUT.paddle), table: str(lo.table, DEFAULT_LOADOUT.table), hall: str(lo.hall, DEFAULT_LOADOUT.hall),
      hoopBall: str(lo.hoopBall, DEFAULT_LOADOUT.hoopBall), jersey: str(lo.jersey, DEFAULT_LOADOUT.jersey),
      net: str(lo.net, DEFAULT_LOADOUT.net), court: str(lo.court, DEFAULT_LOADOUT.court),
      dog: str(lo.dog, DEFAULT_LOADOUT.dog), disc: str(lo.disc, DEFAULT_LOADOUT.disc),
      discTrail: str(lo.discTrail, DEFAULT_LOADOUT.discTrail), fbCourse: str(lo.fbCourse, DEFAULT_LOADOUT.fbCourse),
      blade: str(lo.blade, DEFAULT_LOADOUT.blade), bladeTrail: str(lo.bladeTrail, DEFAULT_LOADOUT.bladeTrail),
      arena: str(lo.arena, DEFAULT_LOADOUT.arena), outfit: str(lo.outfit, DEFAULT_LOADOUT.outfit)
    },
    createdAt: num(p.createdAt, Date.now(), 0)
  };
}

export function sanitizeSave(raw: Raw): SaveData {
  const seen = new Set<string>();
  const profiles: Profile[] = [];
  for (const rp of Array.isArray(raw.profiles) ? raw.profiles : []) {
    const p = sanitizeProfile(rp);
    if (!p) continue;
    if (seen.has(p.id)) p.id = newProfileId();
    seen.add(p.id);
    profiles.push(p);
    if (profiles.length >= MAX_PROFILES) break;
  }
  const active = typeof raw.activeProfileId === 'string' && profiles.some(p => p.id === raw.activeProfileId) ? raw.activeProfileId : null;
  return { schemaVersion: SCHEMA_VERSION, profiles, activeProfileId: active, settings: sanitizeSettings(raw.settings) };
}

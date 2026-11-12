import type { BackendKind } from '../types';
import type { BuddyConfig } from '../buddy/BuddyConfig';
import type { Language } from '../i18n';
import type { QualityLevel } from '../core/Quality';

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'breezyIsle.save';
export const MAX_PROFILES = 4;

/** Stats for one sport + mode. `extras` holds sport-specific counters so new sports need no schema change. */
export interface ModeStats {
  gamesPlayed: number;
  bestScore: number;
  totalScore: number;
  extras: Record<string, number>;
}

/** Bowling extras keys (documented here so stats screens and achievements agree). */
export const BOWLING_EXTRAS = ['strikes', 'spares', 'gutters', 'bestStrikeStreak', 'pins', 'wins', 'score10Total'] as const;
/** Table tennis extras keys (Match Play and Return Challenge). */
export const TT_EXTRAS = ['wins', 'longestRally', 'aces', 'smashes', 'spinPoints', 'longRallies', 'gamesWon', 'pointsWon', 'returns', 'targets', 'bestCombo'] as const;
/** Basketball extras keys (3-Point Contest and Pickup). */
export const BB_EXTRAS = ['wins', 'makes', 'attempts', 'swishes', 'points', 'moneyMade', 'perfectRacks', 'bestStreak', 'steals', 'blocks', 'assists'] as const;

export interface SettingsData {
  // controller
  backend: BackendKind;
  handed: 'right' | 'left';
  sensitivity: number;     // 0.5 .. 1.5, scales the swing speed thresholds
  invertHook: boolean;
  // graphics
  quality: QualityLevel;
  autoQuality: boolean;
  showFps: boolean;
  reducedMotion: boolean;
  // accessibility
  highContrast: boolean;
  bigText: boolean;
  colorblind: boolean;
  gutterAssist: boolean;
  /** Basketball Shot Assist: 0 Off, 1 Low, 2 High, 3 Very High. */
  shotAssist: 0 | 1 | 2 | 3;
  // audio (0..1)
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  language: Language;
  tutorialSeen: boolean;
}

export const DEFAULT_SETTINGS: SettingsData = {
  backend: 'mouse', handed: 'right', sensitivity: 1, invertHook: false,
  quality: 'high', autoQuality: true, showFps: false, reducedMotion: false,
  highContrast: false, bigText: false, colorblind: false, gutterAssist: false, shotAssist: 2,
  master: 0.8, music: 0.6, sfx: 0.9, muted: false,
  language: 'en', tutorialSeen: false
};

/** Settings a profile may override; the rest are device-wide (audio, graphics, language). */
export const PROFILE_SETTING_KEYS = ['handed', 'sensitivity', 'invertHook', 'gutterAssist', 'shotAssist', 'highContrast', 'bigText', 'colorblind', 'reducedMotion'] as const;
export type ProfileSettingKey = typeof PROFILE_SETTING_KEYS[number];

export interface Profile {
  id: string;
  name: string;
  buddy: BuddyConfig;
  /** Only the keys the player changed while this profile was active. */
  settings: Partial<Pick<SettingsData, ProfileSettingKey>>;
  unlocked: string[];
  achievements: Record<string, number>;   // id -> unlocked at (ms)
  xp: number;
  /** stats[sport][mode] */
  stats: Record<string, Record<string, ModeStats>>;
  /** Last chosen cosmetics, so mode setup remembers them. */
  loadout: { laneLook: string; ballSkin: string; trail: string; paddle: string; table: string; hall: string; hoopBall: string; jersey: string; net: string; court: string; dog: string; disc: string; discTrail: string; fbCourse: string; blade: string; bladeTrail: string; arena: string; outfit: string };
  createdAt: number;
}

export interface SaveData {
  schemaVersion: number;
  profiles: Profile[];
  activeProfileId: string | null;
  settings: SettingsData;
}

/** Wrapper used for profile export files. */
export interface ProfileExport {
  kind: 'breezyIsle.profile';
  schemaVersion: number;
  profile: Profile;
}

/** Cosmetics a new profile starts with. Missing keys in older saves are filled from here (no schema bump needed). */
export const DEFAULT_LOADOUT: Profile['loadout'] = { laneLook: 'classic', ballSkin: 'solid', trail: 'classic', paddle: 'classic', table: 'blue', hall: 'island', hoopBall: 'classic', jersey: 'home', net: 'white', court: 'gym', dog: 'mutt', disc: 'classic', discTrail: 'classic', fbCourse: 'meadow', blade: 'wood', bladeTrail: 'classic', arena: 'courtyard', outfit: 'none' };

import type * as THREE from 'three';
import type { BackendKind } from '../types';
import type { BuddyConfig } from '../buddy/BuddyConfig';
import type { InputBackend } from '../input/InputBackend';
import type { SwingDetector } from '../input/SwingDetector';
import type { QualityLevel } from '../core/Quality';

export type SportId = 'swordplay' | 'airsports' | 'bowling' | 'basketball' | 'tabletennis' | 'frisbee';
export type ModeId =
  | 'duel' | 'speedSlice' | 'showdown'
  | 'islandFlyover' | 'dogfight' | 'skydiving'
  | 'standard' | 'hundred'
  | 'threePoint' | 'pickup'
  | 'matchPlay' | 'returnChallenge'
  | 'frisbeeDog' | 'frisbeeGolf';

export type ModeStatus = 'playable' | 'comingSoon';
export type ScoringType = 'tenpin' | 'pinTotal' | 'points' | 'time' | 'distance';
export type OptionValue = string | number | boolean;

export interface ModeOptionDef {
  id: string;
  labelKey: string;
  choices: Array<{ value: OptionValue; labelKey: string }>;
  default: OptionValue;
  /** Only show this option when the player count is in range (e.g. the AI level only for 1 player). */
  players?: [number, number];
}

export interface MatchPlayer {
  name: string;
  color: string;
  profileId: string | null;
  buddy: BuddyConfig;
  handicap: number;
}

/** Cosmetic picks for a match, keyed by unlock category (lane, ball, trail, paddle, table, hall). */
export type Cosmetics = Record<string, string>;

export interface MatchSetup {
  sport: SportId;
  mode: ModeId;
  players: MatchPlayer[];
  options: Record<string, OptionValue>;
  practice: boolean;
  laneLook: string;
  ballSkin: string;
  trail: string;
  /** Every cosmetic pick, including the bowling ones above. */
  cosmetics?: Cosmetics;
  /** Per-player controller for local multiplayer with split controllers (index = player). */
  controllers?: BackendKind[];
}

export interface PlayerResult {
  name: string;
  color: string;
  profileId: string | null;
  buddy: BuddyConfig;
  score: number;          // raw score
  total: number;          // score + handicap
  handicap: number;
  rolls: number[];
  /** Sport-specific counters, e.g. bowling: strikes, spares, gutters, bestStrikeStreak, hookStrikes, pins. */
  stats: Record<string, number>;
  /** Optional per-turn breakdown for the results screen (already translated), e.g. Frisbee Dog throws or a golf scorecard. */
  breakdown?: { head: string[]; rows: string[][] };
}

export interface MatchSummary {
  sport: SportId;
  mode: ModeId;
  practice: boolean;
  frames: number;
  players: PlayerResult[];
  /** Index into players of the winner (highest total), -1 for no winner (practice). */
  winner: number;
  /** history[f][p] = cumulative total of player p after frame f (handicap excluded). */
  history: number[][];
  /** Optional sub-mode, e.g. the Frisbee Golf course, for per-variant personal bests. */
  variant?: string;
}

/** The second local player's controller (split-controller modes). */
export interface SecondInput {
  backend: () => InputBackend | null;
  swing: SwingDetector;
}

/** F3 debug hooks a scene can use: a text block and a small drawing. */
export interface SceneDebug {
  readonly visible: boolean;
  text(s: string): void;
  viz(draw: ((ctx: CanvasRenderingContext2D, w: number, h: number) => void) | null): void;
}

/** Everything a sport scene gets from the host. */
export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  ui: HTMLElement;
  setup: MatchSetup;
  backend: () => InputBackend | null;
  swing: SwingDetector;
  /** Player 2's controller when the mode splits controllers and two people play; otherwise null. */
  second: SecondInput | null;
  quality: () => QualityLevel;
  reducedMotion: () => boolean;
  gutterAssist: () => boolean;
  /** Basketball Shot Assist, 0 Off … 3 Very High. */
  shotAssist: () => 0 | 1 | 2 | 3;
  handed: () => 'right' | 'left';
  debug: SceneDebug;
  /** Ask the host to show the first-throw tutorial (it knows whether it has been seen). */
  onFirstTurn: () => void;
  /** Called after each throw so the host can close the tutorial. */
  onThrown: () => void;
  onFinished: (summary: MatchSummary) => void;
}

/** A playable match. The host runs fixedStep at 120 Hz and frame once per rendered frame. */
export interface SportScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  /** Physics time scale (slow motion < 1). */
  readonly timeScale: number;
  start(): void;
  fixedStep(dt: number): void;
  frame(alpha: number, realDt: number): void;
  restart(): void;
  setPaused(paused: boolean): void;
  resize(w: number, h: number): void;
  /** Apply a graphics level (called at start and when the governor lowers quality). */
  setQuality(q: QualityLevel): void;
  /** Re-read settings that can change mid-match from the pause menu (gutter assist, reduced motion, language). */
  refreshSettings(): void;
  /** Optional: a live tuning slider changed in the F3 debug panel. */
  onTuning?(key: string): void;
  /** Optional: toggle the in-match scoreboard (Tab). */
  toggleScores?(): void;
  /** Optional: a key the scene wants (e.g. skipping a replay). Return true if used. */
  onKey?(e: KeyboardEvent): boolean;
  dispose(): void;
}

export type SceneFactory = (ctx: SceneContext) => Promise<SportScene>;

export interface ModeDef {
  id: ModeId;
  sport: SportId;
  nameKey: string;
  descKey: string;
  rulesKey: string;
  status: ModeStatus;
  minPlayers: number;
  maxPlayers: number;
  controllers: BackendKind[];
  needsGyro: boolean;
  scoring: ScoringType;
  /** Lazy so the registry stays light (and testable in Node). null = coming soon. */
  scene: (() => Promise<SceneFactory>) | null;
  options: ModeOptionDef[];
  /** Offer the practice toggle in mode setup. */
  practice: boolean;
  /** With 2+ players, each player picks their own controller. */
  splitControllers: boolean;
  /** Unlock categories shown as cosmetics in mode setup, in order. */
  cosmetics: string[];
}

export interface SportDef {
  id: SportId;
  nameKey: string;
  descKey: string;
  icon: SportId;
  accent: string;
  modes: ModeDef[];
}

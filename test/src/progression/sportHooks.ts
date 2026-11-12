import type { ModeStats } from '../save/types';
import type { MatchSummary, PlayerResult } from '../sports/types';

/**
 * Per-sport progression rules. Bowling uses the defaults in applyMatch / ResultsScreen / StatsScreen;
 * other sports register what differs: how XP is earned, when a score can be a personal best,
 * which extras are "best of" instead of summed, the results line and the stats-table columns.
 */
export interface StatColumn {
  labelKey: string;
  value(ms: ModeStats, mode: string): string | number;
}

export interface SportHooks {
  xp?(player: PlayerResult, summary: MatchSummary, index: number): number;
  /** Whether this match's score may set the personal best. */
  bestCounts?(summary: MatchSummary): boolean;
  /** Extras kept as a maximum (e.g. longest rally) instead of summed. */
  maxExtras?: readonly string[];
  /** Extras kept as a minimum over values > 0 (e.g. the fastest clear time); 0 means "none this match". */
  minExtras?: readonly string[];
  /** One line of stats under a player's name on the results screen. */
  resultLine?(player: PlayerResult, summary: MatchSummary, best: number | null): string;
  /** Columns of the stats table, after the mode name. */
  statColumns?: readonly StatColumn[];
  /** Lower scores win (golf strokes): results places and personal bests use the minimum. */
  lowerIsBetter?(summary: MatchSummary): boolean;
  /**
   * Keep this match's personal best in `extras[key]` instead of ModeStats.bestScore, e.g. one best per
   * golf course. The results screen reads the same key.
   */
  bestKey?(summary: MatchSummary): string | null;
}

const HOOKS = new Map<string, SportHooks>();

export function registerSportHooks(sport: string, hooks: SportHooks): void { HOOKS.set(sport, hooks); }
export const sportHooks = (sport: string): SportHooks => HOOKS.get(sport) ?? {};

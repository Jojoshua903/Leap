import type { MatchSummary, PlayerResult } from '../sports/types';
import type { Profile } from '../save/types';

/**
 * Achievement registry. Checks run once per player at the end of a match, after that match's
 * stats have been added to the profile. Sports register their own with `registerAchievement`.
 */
export interface AchievementContext {
  summary: MatchSummary;
  index: number;          // this player's index in summary.players
  player: PlayerResult;
  profile: Profile;       // stats already include this match
}

export interface AchievementDef {
  id: string;
  sport: string;
  nameKey: string;
  descKey: string;
  check(ctx: AchievementContext): boolean;
}

const DEFS: AchievementDef[] = [];

export function registerAchievement(def: AchievementDef): void {
  if (!DEFS.some(a => a.id === def.id)) DEFS.push(def);
}
export const allAchievements = (): readonly AchievementDef[] => DEFS;
export const achievementsFor = (sport: string): AchievementDef[] => DEFS.filter(a => a.sport === sport);
export const getAchievement = (id: string): AchievementDef | undefined => DEFS.find(a => a.id === id);

/** Sum of a bowling extra across every bowling mode. */
export function bowlingTotal(p: Profile, key: string): number {
  return Object.values(p.stats.bowling ?? {}).reduce((s, m) => s + (m.extras[key] ?? 0), 0);
}
export function bowlingGames(p: Profile): number {
  return Object.values(p.stats.bowling ?? {}).reduce((s, m) => s + m.gamesPlayed, 0);
}

/**
 * Comeback: won the match after trailing the leader by `margin` or more pins at some frame boundary.
 * Uses summary.history (cumulative totals per frame, handicap excluded).
 */
export function isComeback(summary: MatchSummary, index: number, margin = 30): boolean {
  if (summary.players.length < 2 || summary.winner !== index) return false;
  for (const row of summary.history) {
    const mine = row[index] ?? 0;
    const best = Math.max(...row.filter((_, i) => i !== index));
    if (best - mine >= margin) return true;
  }
  return false;
}

const bowl = (id: string, check: AchievementDef['check']) =>
  registerAchievement({ id, sport: 'bowling', nameKey: `ach.${id}.name`, descKey: `ach.${id}.desc`, check });

const isStandardFull = (s: MatchSummary) => s.mode === 'standard' && s.frames === 10;

bowl('first_strike', c => (c.player.stats.strikes ?? 0) >= 1);
bowl('turkey', c => (c.player.stats.bestStrikeStreak ?? 0) >= 3);
bowl('perfect_game', c => isStandardFull(c.summary) && c.player.score === 300);
bowl('comeback', c => isComeback(c.summary, c.index));
bowl('ten_spares', c => bowlingTotal(c.profile, 'spares') >= 10);
bowl('ten_games', c => bowlingGames(c.profile) >= 10);
bowl('score_200', c => c.summary.mode === 'standard' && c.player.score >= 200);
bowl('hook_master', c => (c.player.stats.hookStrikes ?? 0) >= 1);

/** Ids of achievements this player newly earned in this match. Does not modify the profile. */
export function evaluateAchievements(ctx: AchievementContext): string[] {
  if (ctx.summary.practice) return [];
  return achievementsFor(ctx.summary.sport)
    .filter(a => !(a.id in ctx.profile.achievements))
    .filter(a => { try { return a.check(ctx); } catch { return false; } })
    .map(a => a.id);
}

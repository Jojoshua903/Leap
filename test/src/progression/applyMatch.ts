import { bus } from '../core/events';
import type { SaveManager } from '../save/SaveManager';
import type { ModeStats, Profile } from '../save/types';
import type { MatchSummary } from '../sports/types';
import { evaluateAchievements } from './achievements';
import { grantUnlocks } from './unlocks';
import { levelFromXp, matchXp } from './xp';
import { sportHooks } from './sportHooks';

/** What one player got out of a match, for the results screen. */
export interface PlayerReport {
  index: number;
  profileId: string | null;
  xp: number;
  levelBefore: number;
  levelAfter: number;
  newBest: boolean;
  achievements: string[];
  unlocks: string[];
}

/** Extras that are "best of" rather than summed. */
const MAX_EXTRAS = new Set(['bestStrikeStreak']);

/**
 * Apply one match to one profile: stats, XP, achievements, then unlocks (which may depend on the first three).
 * Pure apart from mutating `profile`, so it is easy to test. Sports other than bowling plug in their
 * XP and best-score rules through sportHooks.
 */
export function applyMatchToProfile(profile: Profile, summary: MatchSummary, index: number, now = Date.now()): PlayerReport {
  const pr = summary.players[index];
  const hooks = sportHooks(summary.sport);
  const report: PlayerReport = {
    index, profileId: profile.id, xp: 0, levelBefore: levelFromXp(profile.xp).level, levelAfter: 0,
    newBest: false, achievements: [], unlocks: []
  };
  if (summary.practice) { report.levelAfter = report.levelBefore; return report; }

  const modes = (profile.stats[summary.sport] ??= {});
  const ms: ModeStats = (modes[summary.mode] ??= { gamesPlayed: 0, bestScore: 0, totalScore: 0, extras: {} });
  // A personal best only counts at full length, so a 5-frame game can't beat a 10-frame record.
  const fullLength = hooks.bestCounts ? hooks.bestCounts(summary) : summary.frames === 10;
  const bestKey = hooks.bestKey?.(summary) ?? null;
  if (bestKey) {
    const prev = ms.extras[bestKey];
    const lower = hooks.lowerIsBetter?.(summary) ?? false;
    report.newBest = fullLength && (prev === undefined || (lower ? pr.score < prev : pr.score > prev));
    if (report.newBest) ms.extras[bestKey] = pr.score;
  } else {
    report.newBest = fullLength && pr.score > ms.bestScore;
    if (fullLength) ms.bestScore = Math.max(ms.bestScore, pr.score);
  }
  ms.gamesPlayed += 1;
  ms.totalScore += pr.score;
  const extras: Record<string, number> = {
    ...pr.stats,
    wins: summary.winner === index && summary.players.length > 1 ? 1 : 0,
    score10Total: pr.score * (10 / Math.max(1, summary.frames))
  };
  const maxKeys = new Set([...MAX_EXTRAS, ...(hooks.maxExtras ?? [])]);
  const minKeys = new Set(hooks.minExtras ?? []);
  for (const [k, v] of Object.entries(extras)) {
    if (minKeys.has(k)) {
      if (v > 0) ms.extras[k] = ms.extras[k] ? Math.min(ms.extras[k], v) : v;
      continue;
    }
    ms.extras[k] = maxKeys.has(k) ? Math.max(ms.extras[k] ?? 0, v) : (ms.extras[k] ?? 0) + v;
  }

  const won = summary.players.length > 1 && summary.winner === index;
  report.xp = hooks.xp
    ? Math.max(0, Math.floor(hooks.xp(pr, summary, index)))
    : matchXp({ pins: pr.stats.pins ?? pr.score, strikes: pr.stats.strikes ?? 0, spares: pr.stats.spares ?? 0, won });
  profile.xp += report.xp;
  report.levelAfter = levelFromXp(profile.xp).level;

  report.achievements = evaluateAchievements({ summary, index, player: pr, profile });
  for (const id of report.achievements) profile.achievements[id] = now;
  report.unlocks = grantUnlocks(profile);
  return report;
}

/** Apply a finished match to every profile in it, save once, and announce what happened. */
export function applyMatch(save: SaveManager, summary: MatchSummary): PlayerReport[] {
  const reports: PlayerReport[] = [];
  summary.players.forEach((p, i) => {
    const prof = save.get(p.profileId);
    if (!prof) {
      reports.push({ index: i, profileId: null, xp: 0, levelBefore: 0, levelAfter: 0, newBest: false, achievements: [], unlocks: [] });
      return;
    }
    reports.push(applyMatchToProfile(prof, summary, i));
  });
  save.save();
  for (const r of reports) {
    if (!r.profileId) continue;
    for (const id of r.achievements) bus.emit('achievement', { profileId: r.profileId, id });
    if (r.levelAfter > r.levelBefore) bus.emit('levelUp', { profileId: r.profileId, level: r.levelAfter });
    for (const id of r.unlocks) bus.emit('unlock', { profileId: r.profileId, id });
  }
  return reports;
}

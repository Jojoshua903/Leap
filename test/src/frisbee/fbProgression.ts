import { registerAchievement, type AchievementDef } from '../progression/achievements';
import { registerUnlock, type Requirement, type UnlockCategory } from '../progression/unlocks';
import { registerSportHooks } from '../progression/sportHooks';
import { t } from '../i18n';
import type { MatchSummary, PlayerResult } from '../sports/types';

/**
 * Frisbee in the shared progression systems.
 *
 * Player stats (PlayerResult.stats):
 *   Dog:  points, catches, throws, midAir, leaps, bestStreak, longest (m), longestCatch (m), streak5 (runs of 5), perfect
 *   Golf: strokes, vsPar, holes, aces, eagles, birdies, pars, bogeys, ob, holesUnder, windBirdies, waterClean,
 *         bestPuttStreak, putts, longest (m), underPar
 * XP — Dog: 1 per 20 points + 25 per streak of 5 catches.
 *      Golf: 15 per hole under par + 40 per ace + 50 for a full round under par.
 * Golf personal bests are kept per course (fewest strokes) in extras `best_<course>`.
 */
const s = (p: PlayerResult, k: string): number => p.stats[k] ?? 0;
const isDog = (m: MatchSummary): boolean => m.mode === 'frisbeeDog';
const isGolf = (m: MatchSummary): boolean => m.mode === 'frisbeeGolf';
const fullGolf = (m: MatchSummary, p: PlayerResult): boolean => isGolf(m) && s(p, 'holes') >= m.frames;

const ach = (id: string, check: AchievementDef['check']) =>
  registerAchievement({ id, sport: 'frisbee', nameKey: `ach.${id}.name`, descKey: `ach.${id}.desc`, check });

/** Catches over every Frisbee Dog round (the profile already includes this match). */
const careerCatches = (c: Parameters<AchievementDef['check']>[0]): number => c.profile.stats.frisbee?.frisbeeDog?.extras.catches ?? 0;

ach('fb_good_boy', c => careerCatches(c) >= 10);
ach('fb_acrobat', c => isDog(c.summary) && s(c.player, 'midAir') >= 5);
ach('fb_perfect', c => isDog(c.summary) && s(c.player, 'perfect') >= 1);
ach('fb_long_shot', c => s(c.player, 'longest') >= 60);
ach('fb_ace', c => isGolf(c.summary) && s(c.player, 'aces') >= 1);
ach('fb_under_par', c => fullGolf(c.summary, c.player) && s(c.player, 'underPar') >= 1);
ach('fb_water_bound', c => isGolf(c.summary) && s(c.player, 'waterClean') >= 3);
ach('fb_wind_rider', c => isGolf(c.summary) && s(c.player, 'windBirdies') >= 1);
ach('fb_chain_reaction', c => isGolf(c.summary) && s(c.player, 'bestPuttStreak') >= 5);

const unlock = (category: UnlockCategory, value: string, req: Requirement) =>
  registerUnlock({ id: `${category}:${value}`, category, value, labelKey: `${category}.${value}`, req });

// dogs: the mutt from the start, faster and surer dogs with levels
unlock('dog', 'mutt', { type: 'default' });
unlock('dog', 'retriever', { type: 'level', n: 3 });
unlock('dog', 'collie', { type: 'level', n: 6 });
// 5 disc skins (plus the default)
unlock('disc', 'classic', { type: 'default' });
unlock('disc', 'ocean', { type: 'level', n: 2 });
unlock('disc', 'sunset', { type: 'games', sport: 'frisbee', n: 5 });
unlock('disc', 'neon', { type: 'achievement', id: 'fb_acrobat' });
unlock('disc', 'galaxy', { type: 'achievement', id: 'fb_ace' });
unlock('disc', 'gold', { type: 'achievement', id: 'fb_perfect' });
// 2 trail styles (plus the default)
unlock('discTrail', 'classic', { type: 'default' });
unlock('discTrail', 'sparkle', { type: 'level', n: 4 });
unlock('discTrail', 'rainbow', { type: 'achievement', id: 'fb_wind_rider' });
// courses: two from the start, the Night Course for a round under par
unlock('course', 'meadow', { type: 'default' });
unlock('course', 'cliffside', { type: 'default' });
unlock('course', 'night', { type: 'achievement', id: 'fb_under_par' });
// Buddy hats
unlock('acc', 'visor', { type: 'games', sport: 'frisbee', n: 3 });
unlock('acc', 'bucket', { type: 'achievement', id: 'fb_good_boy' });

export function fbXp(p: PlayerResult, m: MatchSummary): number {
  if (isDog(m)) return Math.floor(s(p, 'points') / 20) + 25 * s(p, 'streak5');
  return 15 * s(p, 'holesUnder') + 40 * s(p, 'aces') + (fullGolf(m, p) && s(p, 'underPar') ? 50 : 0);
}

const dash = '–';
const vs = (n: number): string => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));
const COURSE_IDS = ['meadow', 'cliffside', 'night'];

registerSportHooks('frisbee', {
  xp: (p, m) => fbXp(p, m),
  bestCounts: m => (isDog(m) ? m.players.every(p => s(p, 'throws') >= m.frames) : m.players.every(p => s(p, 'holes') >= m.frames)),
  lowerIsBetter: m => isGolf(m),
  bestKey: m => (isGolf(m) ? `best_${m.variant ?? 'meadow'}` : null),
  maxExtras: ['bestStreak', 'longest', 'longestCatch', 'bestPuttStreak'],
  resultLine: (p, m, best) => isDog(m)
    ? [`${t('fb.res.catches')} ${s(p, 'catches')}/${s(p, 'throws')}`, `${t('fb.res.midAir')} ${s(p, 'midAir')}`,
      `${t('fb.res.streak')} ${s(p, 'bestStreak')}`, `${t('fb.res.longest')} ${s(p, 'longestCatch')} m`,
      best !== null ? `${t('fb.res.best')} ${Math.max(best, p.score)}` : ''].filter(Boolean).join(' · ')
    : [t(`course.${m.variant ?? 'meadow'}`), `${t('fb.res.strokes')} ${p.score} (${vs(s(p, 'vsPar'))})`,
      `${t('fb.res.birdies')} ${s(p, 'birdies') + s(p, 'eagles')}`, `${t('fb.res.aces')} ${s(p, 'aces')}`, `OB ${s(p, 'ob')}`,
      best !== null ? `${t('fb.res.best')} ${Math.min(best, p.score)}` : ''].filter(Boolean).join(' · '),
  statColumns: [
    { labelKey: 'stats.played', value: ms => ms.gamesPlayed },
    { labelKey: 'stats.won', value: ms => ms.extras.wins ?? 0 },
    { labelKey: 'stats.fbBest', value: (ms, mode) => (mode === 'frisbeeDog' ? ms.bestScore
      : COURSE_IDS.map(id => ms.extras[`best_${id}`] ?? dash).join(' / ')) },
    { labelKey: 'stats.fbCatches', value: (ms, mode) => (mode === 'frisbeeDog' ? ms.extras.catches ?? 0 : (ms.extras.birdies ?? 0) + (ms.extras.eagles ?? 0)) },
    { labelKey: 'stats.fbTricks', value: (ms, mode) => (mode === 'frisbeeDog' ? ms.extras.midAir ?? 0 : ms.extras.aces ?? 0) },
    { labelKey: 'stats.longest', value: ms => `${ms.extras.longest ?? 0} m` }
  ]
});

import { registerAchievement, type AchievementDef } from '../progression/achievements';
import { registerUnlock, type Requirement, type UnlockCategory } from '../progression/unlocks';
import { registerSportHooks } from '../progression/sportHooks';
import { t } from '../i18n';
import type { MatchSummary, PlayerResult } from '../sports/types';
import { rankGrade } from './ShowdownRules';
import { DIRS } from './swMath';

/**
 * Swordplay in the shared progression systems.
 *
 * Player stats (PlayerResult.stats), every mode: slash_<dir> (slashes per direction, see DIRS)
 *   Speed Slice: good, wrong, missed, accPct, bestAcc, tier (0 bronze … 3 platinum), perfects, bestPerfectRun,
 *                maxMult, bestStreak, decoysCut, decoysDodged
 *   Duel:        won, lost, rounds, parries, kos, hits, damageTaken, flawless (won without taking damage)
 *   Showdown:    cleared, gradeRank (S 4 … C 1), bestTime (s, only when cleared), kills, parries, damage,
 *                bombs, cleanRun, bossDown
 * Kept as "best of": bestAcc, bestPerfectRun, maxMult, bestStreak, gradeRank; fastest: bestTime.
 * XP — Speed Slice 1 per 30 points; Duel 40 per win + 10 per parry; Showdown 100 per clear + 50 for an S.
 */
const s = (p: PlayerResult, k: string): number => p.stats[k] ?? 0;
const isSlice = (m: MatchSummary): boolean => m.mode === 'speedSlice';
const isDuel = (m: MatchSummary): boolean => m.mode === 'duel';
const isShowdown = (m: MatchSummary): boolean => m.mode === 'showdown';

const ach = (id: string, check: AchievementDef['check']) =>
  registerAchievement({ id, sport: 'swordplay', nameKey: `ach.${id}.name`, descKey: `ach.${id}.desc`, check });

type Ctx = Parameters<AchievementDef['check']>[0];
/** Bombs sliced away over every Showdown run (the profile already includes this match). */
const careerBombs = (c: Ctx): number => c.profile.stats.swordplay?.showdown?.extras.bombs ?? 0;

ach('sw_first_cherry', c => isSlice(c.summary) && s(c.player, 'good') >= 1);
ach('sw_straight_true', c => isSlice(c.summary) && s(c.player, 'bestPerfectRun') >= 10);
ach('sw_counter_master', c => isDuel(c.summary) && s(c.player, 'parries') >= 5);
ach('sw_untouchable', c => isDuel(c.summary) && s(c.player, 'flawless') >= 1);
ach('sw_bomb_squad', c => careerBombs(c) >= 10);
ach('sw_clean_run', c => isShowdown(c.summary) && s(c.player, 'cleanRun') >= 1);
ach('sw_scarecrow_slayer', c => isShowdown(c.summary) && s(c.player, 'bossDown') >= 1);
ach('sw_combo_king', c => isSlice(c.summary) && s(c.player, 'maxMult') >= 5);

const unlock = (category: UnlockCategory, value: string, req: Requirement) =>
  registerUnlock({ id: `${category}:${value}`, category, value, labelKey: `${category}.${value}`, req });

// 6 blade skins (wood is the default)
unlock('blade', 'wood', { type: 'default' });
unlock('blade', 'foam', { type: 'level', n: 2 });
unlock('blade', 'neon', { type: 'games', sport: 'swordplay', n: 5 });
unlock('blade', 'crystal', { type: 'achievement', id: 'sw_straight_true' });
unlock('blade', 'candy', { type: 'achievement', id: 'sw_combo_king' });
unlock('blade', 'galaxy', { type: 'achievement', id: 'sw_scarecrow_slayer' });
// 4 trails
unlock('bladeTrail', 'classic', { type: 'default' });
unlock('bladeTrail', 'sparkle', { type: 'level', n: 3 });
unlock('bladeTrail', 'rainbow', { type: 'achievement', id: 'sw_counter_master' });
unlock('bladeTrail', 'comet', { type: 'achievement', id: 'sw_untouchable' });
// 3 duel arenas
unlock('arena', 'courtyard', { type: 'default' });
unlock('arena', 'bamboo', { type: 'games', sport: 'swordplay', n: 8 });
unlock('arena', 'moonlit', { type: 'achievement', id: 'sw_clean_run' });
// outfits (none = just the Buddy)
unlock('outfit', 'none', { type: 'default' });
unlock('outfit', 'ninja', { type: 'level', n: 2 });
unlock('outfit', 'knight', { type: 'games', sport: 'swordplay', n: 3 });
unlock('outfit', 'samurai', { type: 'level', n: 5 });
unlock('outfit', 'pirate', { type: 'achievement', id: 'sw_bomb_squad' });

export function swXp(p: PlayerResult, m: MatchSummary): number {
  if (isSlice(m)) return Math.floor(p.score / 30);
  if (isDuel(m)) return 40 * s(p, 'won') + 10 * s(p, 'parries');
  return 100 * s(p, 'cleared') + (s(p, 'cleared') && s(p, 'gradeRank') >= 4 ? 50 : 0);
}

const dash = '–';
export const fmtTime = (sec: number): string => {
  if (!sec) return dash;
  const m = Math.floor(sec / 60), r = Math.round(sec - m * 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

registerSportHooks('swordplay', {
  xp: (p, m) => swXp(p, m),
  bestCounts: () => true,
  maxExtras: ['bestAcc', 'bestPerfectRun', 'maxMult', 'bestStreak', 'gradeRank'],
  minExtras: ['bestTime'],
  resultLine: (p, m, best) => {
    if (isSlice(m)) return [
      t(`sw.tier.${p.stats.tier === 3 ? 'platinum' : p.stats.tier === 2 ? 'gold' : p.stats.tier === 1 ? 'silver' : 'bronze'}`),
      `${t('sw.res.acc')} ${s(p, 'accPct')}%`, `${t('sw.res.perfect')} ${s(p, 'perfects')}`, `${t('sw.res.combo')} ×${s(p, 'maxMult')}`,
      best !== null ? `${t('sw.res.best')} ${Math.max(best, p.score)}` : ''
    ].filter(Boolean).join(' · ');
    if (isDuel(m)) return [
      `${t('sw.res.rounds')} ${s(p, 'rounds')}`, `${t('sw.res.parries')} ${s(p, 'parries')}`, `${t('sw.res.hits')} ${s(p, 'hits')}`,
      `${t('sw.res.taken')} ${s(p, 'damageTaken')}`
    ].join(' · ');
    return [
      s(p, 'cleared') ? `${t('sw.res.grade')} ${rankGrade(s(p, 'gradeRank')) ?? dash}` : t('sw.res.fell'),
      s(p, 'cleared') ? `${t('sw.res.time')} ${fmtTime(s(p, 'bestTime'))}` : '',
      `${t('sw.res.kills')} ${s(p, 'kills')}`, `${t('sw.res.parries')} ${s(p, 'parries')}`,
      best !== null ? `${t('sw.res.best')} ${Math.max(best, p.score)}` : ''
    ].filter(Boolean).join(' · ');
  },
  statColumns: [
    { labelKey: 'stats.played', value: ms => ms.gamesPlayed },
    { labelKey: 'stats.swBest', value: (ms, mode) => (mode === 'duel' ? `${ms.extras.won ?? 0}–${ms.extras.lost ?? 0}`
      : mode === 'showdown' ? `${rankGrade(ms.extras.gradeRank ?? 0) ?? dash} · ${fmtTime(ms.extras.bestTime ?? 0)}` : ms.bestScore) },
    { labelKey: 'stats.swSkill', value: (ms, mode) => (mode === 'duel' ? ms.extras.parries ?? 0
      : mode === 'showdown' ? ms.extras.kills ?? 0 : `${ms.extras.bestAcc ?? 0}%`) },
    { labelKey: 'stats.swExtra', value: (ms, mode) => (mode === 'duel' ? ms.extras.kos ?? 0
      : mode === 'showdown' ? ms.extras.parries ?? 0 : ms.extras.perfects ?? 0) },
    { labelKey: 'stats.swSlashes', value: ms => DIRS.reduce((a, d) => a + (ms.extras[`slash_${d}`] ?? 0), 0) }
  ]
});

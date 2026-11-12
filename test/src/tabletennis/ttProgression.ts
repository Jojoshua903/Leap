import { registerAchievement, type AchievementDef } from '../progression/achievements';
import { registerUnlock, type Requirement, type UnlockCategory } from '../progression/unlocks';
import { registerSportHooks } from '../progression/sportHooks';
import { t } from '../i18n';
import type { MatchSummary, PlayerResult } from '../sports/types';

/**
 * Table tennis in the shared progression systems.
 *
 * Player stats (PlayerResult.stats):
 *   Match Play: gamesWon, pointsWon, longestRally, longRallies (rallies over 10 shots), aces, smashes,
 *               spinPoints (points won with a spin shot), comebacks (games won after 0–5 down), perfectGames (11–0)
 *   Return Challenge: returns, targets, bestCombo, spinShots
 * XP: 20 per game won, +5 per rally over 10 shots, +1 per 20 Return Challenge points.
 */
const s = (p: PlayerResult, k: string): number => p.stats[k] ?? 0;
const isRC = (m: MatchSummary): boolean => m.mode === 'returnChallenge';

const ach = (id: string, check: AchievementDef['check']) =>
  registerAchievement({ id, sport: 'tabletennis', nameKey: `ach.${id}.name`, descKey: `ach.${id}.desc`, check });

ach('tt_first_ace', c => !isRC(c.summary) && s(c.player, 'aces') >= 1);
ach('tt_rally_king', c => !isRC(c.summary) && s(c.player, 'longestRally') >= 20);
// house reading of "win after being 0–5 down": win a game you trailed 0–5 in
ach('tt_comeback', c => !isRC(c.summary) && s(c.player, 'comebacks') >= 1);
ach('tt_perfect_game', c => !isRC(c.summary) && s(c.player, 'perfectGames') >= 1);
ach('tt_spin_master', c => !isRC(c.summary) && s(c.player, 'spinPoints') >= 10);
ach('tt_target_practice', c => isRC(c.summary) && s(c.player, 'targets') >= 10);

const unlock = (category: UnlockCategory, value: string, req: Requirement) =>
  registerUnlock({ id: `${category}:${value}`, category, value, labelKey: `${category}.${value}`, req });

// 5 paddle skins (plus the default)
unlock('paddle', 'classic', { type: 'default' });
unlock('paddle', 'ocean', { type: 'level', n: 2 });
unlock('paddle', 'sunset', { type: 'level', n: 4 });
unlock('paddle', 'carbon', { type: 'achievement', id: 'tt_first_ace' });
unlock('paddle', 'gold', { type: 'achievement', id: 'tt_rally_king' });
unlock('paddle', 'galaxy', { type: 'achievement', id: 'tt_perfect_game' });
// 3 table looks (plus the default)
unlock('table', 'blue', { type: 'default' });
unlock('table', 'green', { type: 'level', n: 3 });
unlock('table', 'night', { type: 'achievement', id: 'tt_spin_master' });
unlock('table', 'beach', { type: 'achievement', id: 'tt_target_practice' });
// a sports-hall theme (plus the default open-air island hall)
unlock('hall', 'island', { type: 'default' });
unlock('hall', 'arena', { type: 'achievement', id: 'tt_comeback' });

export function ttXp(p: PlayerResult, m: MatchSummary): number {
  if (isRC(m)) return Math.floor(p.score / 20);
  return 20 * s(p, 'gamesWon') + 5 * s(p, 'longRallies');
}

const dash = '–';
registerSportHooks('tabletennis', {
  xp: (p, m) => ttXp(p, m),
  bestCounts: m => isRC(m),
  maxExtras: ['longestRally', 'bestCombo'],
  resultLine: (p, m, best) => isRC(m)
    ? [`${t('tt.res.returns')} ${s(p, 'returns')}`, `${t('tt.res.targets')} ${s(p, 'targets')}`, `${t('tt.res.combo')} ×${s(p, 'bestCombo')}`,
      best !== null ? `${t('tt.res.best')} ${Math.max(best, p.score)}` : ''].filter(Boolean).join(' · ')
    : [`${t('tt.res.games')} ${s(p, 'gamesWon')}`, `${t('tt.res.longest')} ${s(p, 'longestRally')}`,
      `${t('tt.res.aces')} ${s(p, 'aces')}`, `${t('tt.res.smashes')} ${s(p, 'smashes')}`].join(' · '),
  statColumns: [
    { labelKey: 'stats.played', value: ms => ms.gamesPlayed },
    { labelKey: 'stats.won', value: (ms, mode) => (mode === 'returnChallenge' ? dash : ms.extras.wins ?? 0) },
    { labelKey: 'stats.winRate', value: (ms, mode) => (mode === 'returnChallenge' || !ms.gamesPlayed ? dash : `${Math.round(100 * (ms.extras.wins ?? 0) / ms.gamesPlayed)}%`) },
    { labelKey: 'stats.longestRally', value: (ms, mode) => (mode === 'returnChallenge' ? dash : ms.extras.longestRally ?? 0) },
    { labelKey: 'stats.aces', value: (ms, mode) => (mode === 'returnChallenge' ? dash : ms.extras.aces ?? 0) },
    { labelKey: 'stats.smashes', value: (ms, mode) => (mode === 'returnChallenge' ? dash : ms.extras.smashes ?? 0) },
    { labelKey: 'stats.bestRC', value: (ms, mode) => (mode === 'returnChallenge' ? ms.bestScore : dash) }
  ]
});

import { registerAchievement, type AchievementDef } from '../progression/achievements';
import { registerUnlock, type Requirement, type UnlockCategory } from '../progression/unlocks';
import { registerSportHooks } from '../progression/sportHooks';
import { t } from '../i18n';
import type { MatchSummary, PlayerResult } from '../sports/types';

/**
 * Basketball in the shared progression systems.
 *
 * Player stats (PlayerResult.stats):
 *   both modes: points, makes, attempts, swishes, bestStreak (makes in a row), swishStreaks (runs of 3 swishes)
 *   3-Point Contest: moneyMade, perfectRacks, buzzer (makes released in the last second), tiebreak
 *   Pickup: myPoints (scored by you), steals, blocks, assists, shutouts (won 11–0 / 21–0), target
 * XP: 1 per point, +10 per swish streak of 3, +50 per win, +30 for a contest score of 20+.
 */
const s = (p: PlayerResult, k: string): number => p.stats[k] ?? 0;
const isContest = (m: MatchSummary): boolean => m.mode === 'threePoint';

const ach = (id: string, check: AchievementDef['check']) =>
  registerAchievement({ id, sport: 'basketball', nameKey: `ach.${id}.name`, descKey: `ach.${id}.desc`, check });

/** Swishes over every basketball game (the profile already includes this match). */
const careerSwishes = (c: Parameters<AchievementDef['check']>[0]): number =>
  Object.values(c.profile.stats.basketball ?? {}).reduce((n, ms) => n + (ms.extras.swishes ?? 0), 0);

ach('bb_swish', c => careerSwishes(c) >= 10);
ach('bb_perfect_rack', c => isContest(c.summary) && s(c.player, 'perfectRacks') >= 1);
ach('bb_money_maker', c => isContest(c.summary) && s(c.player, 'moneyMade') >= 5);
ach('bb_hot_hand', c => s(c.player, 'bestStreak') >= 7);
ach('bb_buzzer', c => isContest(c.summary) && s(c.player, 'buzzer') >= 1);
ach('bb_shutout', c => !isContest(c.summary) && s(c.player, 'shutouts') >= 1);
ach('bb_lockdown', c => !isContest(c.summary) && s(c.player, 'steals') + s(c.player, 'blocks') >= 5);
ach('bb_playmaker', c => !isContest(c.summary) && s(c.player, 'assists') >= 5);

const unlock = (category: UnlockCategory, value: string, req: Requirement) =>
  registerUnlock({ id: `${category}:${value}`, category, value, labelKey: `${category}.${value}`, req });

// 4 ball skins (plus the default)
unlock('hoopball', 'classic', { type: 'default' });
unlock('hoopball', 'street', { type: 'level', n: 2 });
unlock('hoopball', 'glow', { type: 'games', sport: 'basketball', n: 5 });
unlock('hoopball', 'gold', { type: 'achievement', id: 'bb_money_maker' });
unlock('hoopball', 'galaxy', { type: 'achievement', id: 'bb_swish' });
// 3 jerseys (plus the default)
unlock('jersey', 'home', { type: 'default' });
unlock('jersey', 'stripes', { type: 'level', n: 3 });
unlock('jersey', 'retro', { type: 'achievement', id: 'bb_playmaker' });
unlock('jersey', 'neon', { type: 'achievement', id: 'bb_hot_hand' });
// 2 nets (plus the default)
unlock('net', 'white', { type: 'default' });
unlock('net', 'chain', { type: 'achievement', id: 'bb_lockdown' });
unlock('net', 'rainbow', { type: 'achievement', id: 'bb_perfect_rack' });
// a court look (plus the default gym)
unlock('court', 'gym', { type: 'default' });
unlock('court', 'street', { type: 'games', sport: 'basketball', n: 3 });

export function bbXp(p: PlayerResult, m: MatchSummary, index: number): number {
  let xp = s(p, 'points') + 10 * s(p, 'swishStreaks');
  if (m.players.length > 1 && m.winner === index) xp += 50;
  if (isContest(m) && p.score >= 20) xp += 30;
  return xp;
}

const dash = '–';
const pct = (made: number, att: number): string => (att ? `${Math.round(100 * made / att)}%` : dash);

registerSportHooks('basketball', {
  xp: (p, m, i) => bbXp(p, m, i),
  // contest: any full round can be a best score; pickup: the score is the game target, so no "best"
  bestCounts: m => isContest(m) && !m.practice,
  maxExtras: ['bestStreak'],
  resultLine: (p, m, best) => isContest(m)
    ? [`${t('bb.res.makes')} ${s(p, 'makes')}/${s(p, 'attempts')}`, `${t('bb.res.swishes')} ${s(p, 'swishes')}`,
      `${t('bb.res.money')} ${s(p, 'moneyMade')}`, `${t('bb.res.streak')} ${s(p, 'bestStreak')}`,
      best !== null ? `${t('bb.res.best')} ${Math.max(best, p.score)}` : ''].filter(Boolean).join(' · ')
    : p.profileId === null && s(p, 'attempts') === 0
      ? `${t('bb.res.points')} ${p.score}`
      : [`${t('bb.res.yours')} ${s(p, 'myPoints')}`, `${t('bb.res.makes')} ${s(p, 'makes')}/${s(p, 'attempts')}`,
        `${t('bb.res.assists')} ${s(p, 'assists')}`, `${t('bb.res.steals')} ${s(p, 'steals')}`, `${t('bb.res.blocks')} ${s(p, 'blocks')}`].join(' · '),
  statColumns: [
    { labelKey: 'stats.played', value: ms => ms.gamesPlayed },
    { labelKey: 'stats.won', value: (ms, mode) => (mode === 'threePoint' && !ms.extras.wins ? dash : ms.extras.wins ?? 0) },
    { labelKey: 'stats.bestContest', value: (ms, mode) => (mode === 'threePoint' ? ms.bestScore : dash) },
    { labelKey: 'stats.makePct', value: ms => pct(ms.extras.makes ?? 0, ms.extras.attempts ?? 0) },
    { labelKey: 'stats.swishes', value: ms => ms.extras.swishes ?? 0 },
    { labelKey: 'stats.hotStreak', value: ms => ms.extras.bestStreak ?? 0 }
  ]
});

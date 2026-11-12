import { describe, expect, it } from 'vitest';
import './swProgression';
import { fmtTime, swXp } from './swProgression';
import { achievementsFor, evaluateAchievements } from '../progression/achievements';
import { applyMatchToProfile } from '../progression/applyMatch';
import { unlocksIn } from '../progression/unlocks';
import { newProfile } from '../save/migrations';
import { defaultBuddy } from '../buddy/BuddyConfig';
import type { MatchSummary, ModeId, PlayerResult } from '../sports/types';

const player = (score: number, stats: Record<string, number>): PlayerResult =>
  ({ name: 'A', color: '#ff7a59', profileId: 'A', buddy: defaultBuddy('A'), score, total: score, handicap: 0, rolls: [], stats });
const match = (mode: ModeId, p: PlayerResult): MatchSummary =>
  ({ sport: 'swordplay', mode, practice: false, frames: 1, players: [p], winner: 0, history: [] });

describe('swordplay progression', () => {
  it('registers the eight achievements', () => {
    expect(achievementsFor('swordplay').map(a => a.id).sort()).toEqual([
      'sw_bomb_squad', 'sw_clean_run', 'sw_combo_king', 'sw_counter_master', 'sw_first_cherry', 'sw_scarecrow_slayer',
      'sw_straight_true', 'sw_untouchable'
    ]);
  });

  it('XP: slice 1 per 30 points, duel 40 per win + 10 per parry, showdown 100 per clear + 50 for an S', () => {
    expect(swXp(player(9000, {}), match('speedSlice', player(0, {})))).toBe(300);
    expect(swXp(player(2, { won: 1, parries: 4 }), match('duel', player(0, {})))).toBe(80);
    expect(swXp(player(13000, { cleared: 1, gradeRank: 4 }), match('showdown', player(0, {})))).toBe(150);
    expect(swXp(player(5000, { cleared: 1, gradeRank: 2 }), match('showdown', player(0, {})))).toBe(100);
    expect(swXp(player(5000, { cleared: 0, gradeRank: 4 }), match('showdown', player(0, {})))).toBe(0);
  });

  it('achievements fire from match stats', () => {
    const sl = player(30000, { good: 40, bestPerfectRun: 10, maxMult: 5 });
    expect(evaluateAchievements({ summary: match('speedSlice', sl), index: 0, player: sl, profile: newProfile('A') }).sort())
      .toEqual(['sw_combo_king', 'sw_first_cherry', 'sw_straight_true']);
    const du = player(2, { won: 1, parries: 5, flawless: 1 });
    expect(evaluateAchievements({ summary: match('duel', du), index: 0, player: du, profile: newProfile('A') }).sort())
      .toEqual(['sw_counter_master', 'sw_untouchable']);
    const sd = player(13000, { cleared: 1, cleanRun: 1, bossDown: 1, bombs: 4 });
    const prof = newProfile('A');
    prof.stats.swordplay = { showdown: { gamesPlayed: 3, bestScore: 0, totalScore: 0, extras: { bombs: 11 } } };
    expect(evaluateAchievements({ summary: match('showdown', sd), index: 0, player: sd, profile: prof }).sort())
      .toEqual(['sw_bomb_squad', 'sw_clean_run', 'sw_scarecrow_slayer']);
  });

  it('keeps the best showdown time as the fastest clear and best-of extras as maxima', () => {
    const prof = newProfile('A');
    applyMatchToProfile(prof, match('showdown', player(9000, { cleared: 1, bestTime: 410, gradeRank: 3 })), 0);
    applyMatchToProfile(prof, match('showdown', player(3000, { cleared: 0, bestTime: 0, gradeRank: 1 })), 0);
    applyMatchToProfile(prof, match('showdown', player(12500, { cleared: 1, bestTime: 395, gradeRank: 4 })), 0);
    applyMatchToProfile(prof, match('showdown', player(11000, { cleared: 1, bestTime: 450, gradeRank: 3 })), 0);
    const ms = prof.stats.swordplay.showdown;
    expect(ms.extras.bestTime).toBe(395);
    expect(ms.extras.gradeRank).toBe(4);
    expect(ms.bestScore).toBe(12500);
  });

  it('unlocks: 6 blades, 4 trails, 3 arenas, 4 outfits plus none', () => {
    expect(unlocksIn('blade').map(u => u.value)).toEqual(['wood', 'foam', 'neon', 'crystal', 'candy', 'galaxy']);
    expect(unlocksIn('bladeTrail')).toHaveLength(4);
    expect(unlocksIn('arena').map(u => u.value)).toEqual(['courtyard', 'bamboo', 'moonlit']);
    expect(unlocksIn('outfit').map(u => u.value)).toEqual(['none', 'ninja', 'knight', 'samurai', 'pirate']);
  });

  it('formats times', () => {
    expect(fmtTime(395)).toBe('6:35');
    expect(fmtTime(0)).toBe('–');
  });
});

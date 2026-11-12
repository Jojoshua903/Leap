import { describe, expect, it } from 'vitest';
import './ttProgression';
import { ttXp } from './ttProgression';
import { achievementsFor, evaluateAchievements } from '../progression/achievements';
import { applyMatchToProfile } from '../progression/applyMatch';
import { isUnlocked, unlocksIn } from '../progression/unlocks';
import { newProfile } from '../save/migrations';
import { defaultBuddy } from '../buddy/BuddyConfig';
import type { MatchSummary, PlayerResult } from '../sports/types';

const player = (name: string, score: number, stats: Record<string, number>): PlayerResult =>
  ({ name, color: '#2f8fd8', profileId: name, buddy: defaultBuddy(name), score, total: score, handicap: 0, rolls: [], stats });

const match = (players: PlayerResult[], winner: number, mode: 'matchPlay' | 'returnChallenge' = 'matchPlay'): MatchSummary =>
  ({ sport: 'tabletennis', mode, practice: false, frames: 3, players, winner, history: [] });

describe('table tennis progression', () => {
  it('registers the six achievements', () => {
    expect(achievementsFor('tabletennis').map(a => a.id).sort()).toEqual(
      ['tt_comeback', 'tt_first_ace', 'tt_perfect_game', 'tt_rally_king', 'tt_spin_master', 'tt_target_practice']
    );
  });

  it('XP: 20 per game won, +5 per rally over 10, +1 per 20 Return Challenge points', () => {
    const m = match([player('A', 2, { gamesWon: 2, longRallies: 3 }), player('B', 1, { gamesWon: 1 })], 0);
    expect(ttXp(m.players[0], m)).toBe(55);
    const rc = match([player('A', 1234, { returns: 40 })], 0, 'returnChallenge');
    expect(ttXp(rc.players[0], rc)).toBe(61);
  });

  it('achievements fire from match stats', () => {
    const prof = newProfile('A');
    const a = player('A', 2, { gamesWon: 2, aces: 1, longestRally: 21, comebacks: 1, perfectGames: 1, spinPoints: 10 });
    const m = match([a, player('B', 0, {})], 0);
    expect(evaluateAchievements({ summary: m, index: 0, player: a, profile: prof }).sort()).toEqual(
      ['tt_comeback', 'tt_first_ace', 'tt_perfect_game', 'tt_rally_king', 'tt_spin_master']
    );
    const rc = match([player('A', 500, { targets: 10 })], 0, 'returnChallenge');
    expect(evaluateAchievements({ summary: rc, index: 0, player: rc.players[0], profile: prof })).toEqual(['tt_target_practice']);
  });

  it('a Return Challenge score is a personal best; match play keeps the longest rally as a maximum', () => {
    const prof = newProfile('A');
    const rc = match([player('A', 800, { returns: 30, targets: 4, bestCombo: 12 })], 0, 'returnChallenge');
    expect(applyMatchToProfile(prof, rc, 0).newBest).toBe(true);
    expect(prof.stats.tabletennis.returnChallenge.bestScore).toBe(800);
    const m1 = match([player('A', 2, { gamesWon: 2, longestRally: 14 }), player('B', 0, {})], 0);
    applyMatchToProfile(prof, m1, 0);
    const m2 = match([player('A', 0, { gamesWon: 0, longestRally: 6 }), player('B', 2, {})], 1);
    const r = applyMatchToProfile(prof, m2, 0);
    expect(r.newBest).toBe(false);
    const ms = prof.stats.tabletennis.matchPlay;
    expect(ms.gamesPlayed).toBe(2);
    expect(ms.extras.wins).toBe(1);
    expect(ms.extras.longestRally).toBe(14);
  });

  it('5 paddle skins, 3 table looks and a hall theme to unlock', () => {
    expect(unlocksIn('paddle').filter(u => u.req.type !== 'default')).toHaveLength(5);
    expect(unlocksIn('table').filter(u => u.req.type !== 'default')).toHaveLength(3);
    expect(unlocksIn('hall').filter(u => u.req.type !== 'default')).toHaveLength(1);
    const prof = newProfile('A');
    expect(isUnlocked(prof, 'paddle:gold')).toBe(false);
    prof.achievements.tt_rally_king = 1;
    expect(isUnlocked(prof, 'paddle:gold')).toBe(true);
  });
});

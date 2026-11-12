import { describe, expect, it } from 'vitest';
import { allAchievements, evaluateAchievements, isComeback, registerAchievement } from './achievements';
import { applyMatchToProfile } from './applyMatch';
import { isUnlocked } from './unlocks';
import { newProfile } from '../save/migrations';
import { defaultBuddy } from '../buddy/BuddyConfig';
import { totalScore } from '../game/Scoring';
import type { MatchSummary, PlayerResult } from '../sports/types';

const rep = (v: number, n: number): number[] => Array.from({ length: n }, () => v);

function player(name: string, rolls: number[], stats: Record<string, number> = {}, handicap = 0): PlayerResult {
  const score = totalScore(rolls);
  return { name, color: '#ff5a5f', profileId: name, buddy: defaultBuddy(name), score, total: score + handicap, handicap, rolls, stats };
}

function summary(players: PlayerResult[], history: number[][] = [], over: Partial<MatchSummary> = {}): MatchSummary {
  let winner = 0;
  players.forEach((p, i) => { if (p.total > players[winner].total) winner = i; });
  return { sport: 'bowling', mode: 'standard', practice: false, frames: 10, players, winner, history, ...over };
}

describe('bowling achievements', () => {
  it('registers all 8', () => {
    expect(allAchievements().filter(a => a.sport === 'bowling').map(a => a.id).sort()).toEqual(
      ['comeback', 'first_strike', 'hook_master', 'perfect_game', 'score_200', 'ten_games', 'ten_spares', 'turkey']
    );
  });

  it('Turkey needs three strikes in a row', () => {
    const prof = newProfile('A');
    const two = summary([player('A', [10, 10, 5, 0, ...rep(0, 14)], { strikes: 2, bestStrikeStreak: 2 })]);
    expect(evaluateAchievements({ summary: two, index: 0, player: two.players[0], profile: prof })).not.toContain('turkey');
    const three = summary([player('A', [10, 10, 10, 0, 0, ...rep(0, 12)], { strikes: 3, bestStrikeStreak: 3 })]);
    const got = evaluateAchievements({ summary: three, index: 0, player: three.players[0], profile: prof });
    expect(got).toContain('turkey');
    expect(got).toContain('first_strike');
  });

  it('Perfect Game = 300 in a full Standard game only', () => {
    const prof = newProfile('A');
    const perfect = summary([player('A', rep(10, 12), { strikes: 12, bestStrikeStreak: 12 })]);
    expect(perfect.players[0].score).toBe(300);
    const got = evaluateAchievements({ summary: perfect, index: 0, player: perfect.players[0], profile: prof });
    expect(got).toEqual(expect.arrayContaining(['perfect_game', 'score_200', 'turkey']));
    const short = summary([player('A', rep(10, 12), { strikes: 12 })], [], { frames: 5 });
    expect(evaluateAchievements({ summary: short, index: 0, player: short.players[0], profile: prof })).not.toContain('perfect_game');
  });

  it('Comeback: win after trailing by 30+ at a frame boundary', () => {
    const a = player('A', rep(0, 20)); a.score = a.total = 150;
    const b = player('B', rep(0, 20)); b.score = b.total = 120;
    const trailing = summary([a, b], [[10, 45], [40, 80], [150, 120]]);
    expect(isComeback(trailing, 0)).toBe(true);
    expect(isComeback(trailing, 1)).toBe(false);                    // B lost
    const close = summary([a, b], [[10, 35], [150, 120]]);
    expect(isComeback(close, 0)).toBe(false);                        // only 25 behind
    const solo = summary([a]);
    expect(isComeback(solo, 0)).toBe(false);                         // needs an opponent
  });

  it('practice never awards anything', () => {
    const s = summary([player('A', rep(10, 12), { strikes: 12, bestStrikeStreak: 12 })], [], { practice: true });
    expect(evaluateAchievements({ summary: s, index: 0, player: s.players[0], profile: newProfile('A') })).toEqual([]);
  });

  it('already-earned achievements are not awarded twice', () => {
    const prof = newProfile('A');
    prof.achievements.first_strike = 1;
    const s = summary([player('A', [10, ...rep(0, 18)], { strikes: 1, bestStrikeStreak: 1 })]);
    expect(evaluateAchievements({ summary: s, index: 0, player: s.players[0], profile: prof })).not.toContain('first_strike');
  });

  it('other sports can register their own', () => {
    registerAchievement({ id: 'test_sport_win', sport: 'frisbee', nameKey: 'x', descKey: 'y', check: () => true });
    const s = summary([player('A', [])], [], { sport: 'frisbee' });
    expect(evaluateAchievements({ summary: s, index: 0, player: s.players[0], profile: newProfile('A') })).toEqual(['test_sport_win']);
  });
});

describe('applyMatchToProfile', () => {
  it('adds stats, XP, achievements and unlocks', () => {
    const prof = newProfile('A');
    const a = player('A', [10, 10, 10, ...rep(0, 14)], { strikes: 3, spares: 0, gutters: 14, pins: 60, bestStrikeStreak: 3, hookStrikes: 0 });
    const b = player('B', rep(0, 20), { pins: 0 });
    const s = summary([a, b]);
    const r = applyMatchToProfile(prof, s, 0, 5);
    // 60 pins = 6, 3 strikes = 60, win = 50
    expect(r.xp).toBe(116);
    expect(prof.xp).toBe(116);
    expect(r.levelAfter).toBe(2);
    const ms = prof.stats.bowling.standard;
    expect(ms.gamesPlayed).toBe(1);
    expect(ms.bestScore).toBe(60);
    expect(ms.extras.strikes).toBe(3);
    expect(ms.extras.wins).toBe(1);
    expect(r.newBest).toBe(true);
    expect(r.achievements).toEqual(expect.arrayContaining(['first_strike', 'turkey']));
    expect(prof.achievements.turkey).toBe(5);
    // flame ball is the Turkey reward, headband the First Strike reward, sparkle trail comes with level 2
    expect(r.unlocks).toEqual(expect.arrayContaining(['ball:flame', 'acc:headband', 'trail:sparkle']));
    expect(isUnlocked(prof, 'ball:flame')).toBe(true);
    expect(isUnlocked(null, 'ball:flame')).toBe(false);
  });

  it('a 5-frame game never sets the personal best', () => {
    const prof = newProfile('A');
    const s = summary([player('A', rep(10, 7), { strikes: 7, pins: 70 })], [], { frames: 5 });
    s.players[0].score = 150;
    const r = applyMatchToProfile(prof, s, 0);
    expect(r.newBest).toBe(false);
    expect(prof.stats.bowling.standard.bestScore).toBe(0);
    expect(prof.stats.bowling.standard.extras.score10Total).toBe(300);
  });
});

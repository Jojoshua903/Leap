import { describe, expect, it } from 'vitest';
import './fbProgression';
import { fbXp } from './fbProgression';
import { achievementsFor, evaluateAchievements } from '../progression/achievements';
import { applyMatchToProfile } from '../progression/applyMatch';
import { unlocksIn } from '../progression/unlocks';
import { sportHooks } from '../progression/sportHooks';
import { newProfile } from '../save/migrations';
import { defaultBuddy } from '../buddy/BuddyConfig';
import type { MatchSummary, PlayerResult } from '../sports/types';

const player = (name: string, score: number, stats: Record<string, number>): PlayerResult =>
  ({ name, color: '#3bb37a', profileId: name, buddy: defaultBuddy(name), score, total: score, handicap: 0, rolls: [], stats });

const dog = (players: PlayerResult[]): MatchSummary =>
  ({ sport: 'frisbee', mode: 'frisbeeDog', practice: false, frames: 10, players, winner: 0, history: [] });
const golf = (players: PlayerResult[], variant = 'meadow'): MatchSummary =>
  ({ sport: 'frisbee', mode: 'frisbeeGolf', practice: false, frames: 9, players, winner: 0, history: [], variant });

describe('frisbee progression', () => {
  it('registers the nine achievements', () => {
    expect(achievementsFor('frisbee').map(a => a.id).sort()).toEqual([
      'fb_ace', 'fb_acrobat', 'fb_chain_reaction', 'fb_good_boy', 'fb_long_shot', 'fb_perfect', 'fb_under_par', 'fb_water_bound', 'fb_wind_rider'
    ]);
  });

  it('XP: dog 1 per 20 points + 25 per streak of 5; golf 15 per hole under par, 40 per ace, +50 under par', () => {
    const d = dog([player('A', 430, { points: 430, streak5: 2, throws: 10 })]);
    expect(fbXp(d.players[0], d)).toBe(21 + 50);
    const g = golf([player('A', 25, { holes: 9, holesUnder: 4, aces: 1, underPar: 1 })]);
    expect(fbXp(g.players[0], g)).toBe(60 + 40 + 50);
  });

  it('achievements fire from match stats', () => {
    const prof = newProfile('A');
    const a = player('A', 900, { throws: 10, catches: 10, midAir: 6, perfect: 1, longest: 61 });
    const m = dog([a]);
    prof.stats.frisbee = { frisbeeDog: { gamesPlayed: 1, bestScore: 900, totalScore: 900, extras: { catches: 10 } } };
    expect(evaluateAchievements({ summary: m, index: 0, player: a, profile: prof }).sort()).toEqual(['fb_acrobat', 'fb_good_boy', 'fb_long_shot', 'fb_perfect']);
    const b = player('A', 24, { holes: 9, aces: 1, underPar: 1, waterClean: 3, windBirdies: 1, bestPuttStreak: 5 });
    expect(evaluateAchievements({ summary: golf([b]), index: 0, player: b, profile: newProfile('A') }).sort()).toEqual(
      ['fb_ace', 'fb_chain_reaction', 'fb_under_par', 'fb_water_bound', 'fb_wind_rider']
    );
  });

  it('golf: fewer strokes win and the best is kept per course', () => {
    const h = sportHooks('frisbee');
    expect(h.lowerIsBetter?.(golf([]))).toBe(true);
    expect(h.lowerIsBetter?.(dog([]))).toBe(false);
    const prof = newProfile('A');
    expect(applyMatchToProfile(prof, golf([player('A', 30, { holes: 9 })]), 0).newBest).toBe(true);
    expect(applyMatchToProfile(prof, golf([player('A', 33, { holes: 9 })]), 0).newBest).toBe(false);
    expect(applyMatchToProfile(prof, golf([player('A', 28, { holes: 9 })]), 0).newBest).toBe(true);
    expect(applyMatchToProfile(prof, golf([player('A', 40, { holes: 9 })], 'cliffside'), 0).newBest).toBe(true);
    const ms = prof.stats.frisbee.frisbeeGolf;
    expect(ms.extras.best_meadow).toBe(28);
    expect(ms.extras.best_cliffside).toBe(40);
  });

  it('dog: a full round can set the best score', () => {
    const prof = newProfile('A');
    expect(applyMatchToProfile(prof, dog([player('A', 420, { throws: 10 })]), 0).newBest).toBe(true);
    expect(prof.stats.frisbee.frisbeeDog.bestScore).toBe(420);
  });

  it('unlocks: 2 dogs, 5 disc skins, 2 trails, the Night Course and 2 hats', () => {
    expect(unlocksIn('dog').filter(u => u.req.type !== 'default').map(u => u.value)).toEqual(['retriever', 'collie']);
    expect(unlocksIn('disc').filter(u => u.req.type !== 'default')).toHaveLength(5);
    expect(unlocksIn('discTrail').filter(u => u.req.type !== 'default')).toHaveLength(2);
    expect(unlocksIn('course').filter(u => u.req.type !== 'default').map(u => u.value)).toEqual(['night']);
    expect(unlocksIn('acc').map(u => u.value)).toEqual(expect.arrayContaining(['visor', 'bucket']));
  });
});

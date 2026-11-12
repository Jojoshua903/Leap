/**
 * Experience points. XP per match: 1 per 10 pins, +20 per strike, +10 per spare, +50 for a win.
 * xpForLevel(n) is the XP needed to go from level n to level n+1 (levels start at 1).
 */
export interface XpInput { pins: number; strikes: number; spares: number; won: boolean }

export function matchXp(i: XpInput): number {
  return Math.floor(Math.max(0, i.pins) / 10) + 20 * Math.max(0, i.strikes) + 10 * Math.max(0, i.spares) + (i.won ? 50 : 0);
}

export const xpForLevel = (n: number): number => Math.round(100 * Math.pow(Math.max(1, n), 1.4));

export const MAX_LEVEL = 99;

export interface LevelInfo { level: number; into: number; need: number; progress: number }

export function levelFromXp(xp: number): LevelInfo {
  let level = 1, rest = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL && rest >= xpForLevel(level)) { rest -= xpForLevel(level); level += 1; }
  const need = xpForLevel(level);
  return { level, into: rest, need, progress: level >= MAX_LEVEL ? 1 : rest / need };
}

/** Total XP needed to reach a level from zero. */
export function totalXpForLevel(level: number): number {
  let s = 0;
  for (let n = 1; n < level; n++) s += xpForLevel(n);
  return s;
}

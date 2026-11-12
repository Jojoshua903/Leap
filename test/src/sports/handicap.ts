/**
 * Classic league handicap: (basis - average) * percentage, never negative, rounded down.
 * Scaled by frames/10 so a 5-frame game gets half the pins.
 * 100-Pin scores run up to 1000, so its basis is 800 instead of 200.
 */
export const HANDICAP_BASIS = 200;
export const HUNDRED_HANDICAP_BASIS = 800;
export const HANDICAP_PCT = 0.8;

export const basisFor = (mode: string): number => (mode === 'hundred' ? HUNDRED_HANDICAP_BASIS : HANDICAP_BASIS);

export function handicapFor(average: number, frames = 10, basis = HANDICAP_BASIS, pct = HANDICAP_PCT): number {
  if (!Number.isFinite(average) || average <= 0) return 0;
  const perTen = Math.max(0, (basis - average) * pct);
  return Math.floor(perTen * (frames / 10));
}

/** Average for handicap purposes: score per 10-frame game. No games yet = 0, which gives no handicap (the simplest fair default). */
export function handicapAverage(gamesPlayed: number, totalScore10: number): number {
  return gamesPlayed > 0 ? totalScore10 / gamesPlayed : 0;
}

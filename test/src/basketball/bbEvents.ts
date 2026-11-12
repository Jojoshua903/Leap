/**
 * Basketball facts on the event bus (see core/events.ts). Player numbers are indexes into the mode's
 * player list (contest) or the six players on court (pickup: 0–2 home team, 3–5 away).
 */
export interface BBEventMap {
  shotReleased: { shooter: number; team: number; dist: number; value: number; quality: number };
  rimHit: { speed: number };
  backboardHit: { speed: number };
  swish: { shooter: number };
  basket: { points: number; shooter: number; team: number; swish: boolean };
  miss: { shooter: number };
  steal: { by: number; from: number };
  block: { by: number; shooter: number };
  pass: { from: number; to: number };
  possessionChange: { team: number; reason: 'steal' | 'rebound' | 'basket' | 'out' | 'noClear' | 'block' | 'interception' };
  gameWon: { sport: 'basketball'; winner: number; score: number[] };
}

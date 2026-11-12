/**
 * Frisbee Dog scoring (house rules). One round = 10 throws.
 *
 * A catch scores   base + 1 per metre thrown + mid-air bonus + leap bonus,
 * times the zone multiplier (the catch was inside a coloured ring on the field)
 * times the streak multiplier (+0.25 per catch in a row before this one, up to ×2),
 * capped per throw so a perfect round is 1000. A miss scores 0 and resets the streak.
 * Change the feel here: every number is in DOG_SCORING.
 */
export const DOG_SCORING = {
  throws: 10,
  base: 10,
  perMetre: 1,
  midAir: 20,
  leap: 30,
  streakStep: 0.25,
  streakMax: 2,
  /** Per-throw cap: 10 throws × 100 = a 1000-point perfect round. */
  throwCap: 100
};

export interface DogZone { id: 'near' | 'mid' | 'far'; z: number; x: number; r: number; mult: number; color: string }

/** Rings along the field (thrower at the origin, throwing toward −z). */
export const DOG_ZONES: DogZone[] = [
  { id: 'near', x: 0, z: -20, r: 4.5, mult: 1.5, color: '#3cc8f0' },
  { id: 'mid', x: 0, z: -35, r: 4, mult: 2, color: '#ffd84a' },
  { id: 'far', x: 0, z: -50, r: 3.5, mult: 3, color: '#ff5fa2' }
];

export function zoneAt(x: number, z: number): DogZone | null {
  for (const zn of DOG_ZONES) if (Math.hypot(x - zn.x, z - zn.z) <= zn.r) return zn;
  return null;
}

export const streakMult = (catchesBefore: number): number =>
  Math.min(DOG_SCORING.streakMax, 1 + DOG_SCORING.streakStep * Math.max(0, catchesBefore));

export interface CatchInfo {
  caught: boolean;
  /** Metres from the throw point to the catch point. */
  distance: number;
  midAir: boolean;
  leap: boolean;
  zone: DogZone | null;
}

export interface ThrowScore {
  points: number;
  base: number;
  distPts: number;
  airPts: number;
  leapPts: number;
  zoneMult: number;
  streakMult: number;
  capped: boolean;
}

export function scoreThrow(c: CatchInfo, catchesBefore: number): ThrowScore {
  const S = DOG_SCORING;
  if (!c.caught) return { points: 0, base: 0, distPts: 0, airPts: 0, leapPts: 0, zoneMult: 1, streakMult: 1, capped: false };
  const distPts = Math.floor(Math.max(0, c.distance) * S.perMetre);
  const airPts = c.midAir ? S.midAir : 0;
  const leapPts = c.leap ? S.leap : 0;
  const zm = c.zone?.mult ?? 1, sm = streakMult(catchesBefore);
  const raw = Math.round((S.base + distPts + airPts + leapPts) * zm * sm);
  return { points: Math.min(S.throwCap, raw), base: S.base, distPts, airPts, leapPts, zoneMult: zm, streakMult: sm, capped: raw > S.throwCap };
}

export interface ThrowRecord extends CatchInfo { score: ThrowScore }

/** One player's round. */
export class DogRound {
  readonly throws: ThrowRecord[] = [];
  score = 0;
  streak = 0;
  bestStreak = 0;
  catches = 0;
  midAirCatches = 0;
  leapCatches = 0;
  longest = 0;

  constructor(readonly practice = false) {}

  get done(): boolean { return !this.practice && this.throws.length >= DOG_SCORING.throws; }
  get left(): number { return this.practice ? Infinity : DOG_SCORING.throws - this.throws.length; }

  record(c: CatchInfo): ThrowRecord {
    const sc = scoreThrow(c, this.streak);
    const rec: ThrowRecord = { ...c, score: this.practice ? { ...sc, points: 0 } : sc };
    this.throws.push(rec);
    this.longest = Math.max(this.longest, c.distance);
    if (c.caught) {
      this.catches += 1;
      if (c.midAir) this.midAirCatches += 1;
      if (c.leap) this.leapCatches += 1;
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else this.streak = 0;
    this.score += rec.score.points;
    return rec;
  }
}

/** The best possible round with these rules. */
export function maxRound(): number {
  let s = 0;
  const far = DOG_ZONES[DOG_ZONES.length - 1];
  for (let i = 0; i < DOG_SCORING.throws; i++) s += scoreThrow({ caught: true, distance: -far.z, midAir: true, leap: true, zone: far }, i).points;
  return s;
}

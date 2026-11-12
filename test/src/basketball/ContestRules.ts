import { COURT, CORNER_JOIN_Z } from './bbTuning';

/**
 * 3-Point Contest rules (pure logic, tested).
 *  - 5 racks around the arc: left corner, left wing, top, right wing, right corner. 5 balls each.
 *  - The 5th ball of every rack is a money ball (2 points), the others 1. Maximum 30.
 *  - Money rack option: one rack (random, shown before the round) is all money balls. Maximum 34.
 *  - 60 seconds. The shooter walks to the next rack when a rack is empty (the clock keeps running).
 *  - Ties for first place: sudden death, 5 shots from the top rack (money ball last), repeated if needed.
 */
export const RACK_IDS = ['leftCorner', 'leftWing', 'top', 'rightWing', 'rightCorner'] as const;
export type RackId = typeof RACK_IDS[number];
export const BALLS_PER_RACK = 5;
export const CONTEST_TIME = 60;
export const RACK_MOVE_TIME = 0.8;
export const TOP_RACK = 2;

export interface RackSpot {
  id: RackId;
  /** Where the shooter stands (just behind the line). */
  x: number;
  z: number;
  /** Where the ball rack stands (beside the shooter, toward the sideline / the shooter's right). */
  rackX: number;
  rackZ: number;
}

function spot(id: RackId, x: number, z: number): RackSpot {
  // the rack sits 0.9 m to the shooter's right (seen from the shooter facing the hoop)
  const d = Math.hypot(x, z) || 1;
  const fx = -x / d, fz = -z / d;          // facing the hoop
  const rx = -fz, rz = fx;                 // the shooter's right: facing × up
  return { id, x, z, rackX: x + rx * 0.9, rackZ: z + rz * 0.9 };
}

const R = COURT.threeRadius + 0.3;
const WING = Math.PI / 4;
export const RACK_SPOTS: RackSpot[] = [
  spot('leftCorner', -(COURT.cornerX + 0.3), Math.min(0.5, CORNER_JOIN_Z - 0.4)),
  spot('leftWing', -Math.sin(WING) * R, Math.cos(WING) * R),
  spot('top', 0, R),
  spot('rightWing', Math.sin(WING) * R, Math.cos(WING) * R),
  spot('rightCorner', COURT.cornerX + 0.3, Math.min(0.5, CORNER_JOIN_Z - 0.4))
];

export const isMoneyBall = (rack: number, ball: number, moneyRack: number | null): boolean =>
  ball === BALLS_PER_RACK - 1 || rack === moneyRack;

export const ballValue = (rack: number, ball: number, moneyRack: number | null): 1 | 2 =>
  isMoneyBall(rack, ball, moneyRack) ? 2 : 1;

export function maxScore(moneyRack: number | null, racks: readonly number[] = [0, 1, 2, 3, 4]): number {
  let s = 0;
  for (const r of racks) for (let b = 0; b < BALLS_PER_RACK; b++) s += ballValue(r, b, moneyRack);
  return s;
}

export interface ShotRecord {
  id: number;
  rack: number;
  ball: number;
  value: 1 | 2;
  money: boolean;
  /** Seconds left on the clock at the release (Infinity in practice). */
  clock: number;
  made: boolean | null;
}

export interface ContestOptions {
  moneyRack: number | null;
  practice?: boolean;
  /** Rack order (default all five; sudden death uses just the top rack). */
  racks?: readonly number[];
}

/** One player's round. The scene calls take() for each shot and resolve() when the ball is decided. */
export class ContestRound {
  readonly moneyRack: number | null;
  readonly practice: boolean;
  readonly racks: readonly number[];
  /** Index into `racks` of the current rack, and the next ball in it. */
  rackIdx = 0;
  ball = 0;
  score = 0;
  makes = 0;
  attempts = 0;
  streak = 0;
  bestStreak = 0;
  moneyMade = 0;
  moneyTaken = 0;
  perfectRacks = 0;
  readonly shots: ShotRecord[] = [];
  private madeInRack = new Map<number, number>();
  private resolvedInRack = new Map<number, number>();

  constructor(o: ContestOptions) {
    this.moneyRack = o.moneyRack;
    this.practice = !!o.practice;
    this.racks = o.racks ?? [0, 1, 2, 3, 4];
  }

  /** The rack (0..4 around the arc) the shooter is at. */
  get rack(): number { return this.racks[this.rackIdx % this.racks.length]; }
  get ballsLeft(): number { return BALLS_PER_RACK - this.ball; }
  /** Every ball has been shot (never in practice). */
  get allTaken(): boolean { return !this.practice && this.rackIdx >= this.racks.length; }
  /** Every ball has been shot and decided. */
  get finished(): boolean { return this.allTaken && this.shots.every(s => s.made !== null); }
  get max(): number { return maxScore(this.moneyRack, this.racks); }
  /** Whether the next ball is a money ball. */
  get nextIsMoney(): boolean { return isMoneyBall(this.rack, this.ball, this.moneyRack); }

  /** Shoot the next ball. Returns null when there are none left (or the shooter is between racks). */
  take(clock: number): ShotRecord | null {
    if (this.allTaken || this.ball >= BALLS_PER_RACK) return null;
    const rack = this.rack;
    const rec: ShotRecord = {
      id: this.shots.length, rack, ball: this.ball, value: ballValue(rack, this.ball, this.moneyRack),
      money: isMoneyBall(rack, this.ball, this.moneyRack), clock, made: null
    };
    this.shots.push(rec);
    this.ball += 1;
    this.attempts += 1;
    if (rec.money) this.moneyTaken += 1;
    return rec;
  }

  /** The rack is empty: go to the next one. Returns false if that was the last rack. */
  nextRack(): boolean {
    if (this.ball < BALLS_PER_RACK) return true;
    this.rackIdx += 1;
    this.ball = 0;
    return !this.allTaken;
  }

  /** A shot was decided. Returns the points it scored. */
  resolve(rec: ShotRecord, made: boolean): number {
    if (rec.made !== null) return 0;
    rec.made = made;
    const key = rec.rack * 1000 + Math.floor(rec.id / BALLS_PER_RACK);
    this.resolvedInRack.set(key, (this.resolvedInRack.get(key) ?? 0) + 1);
    if (made) {
      this.makes += 1;
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      if (!this.practice) this.score += rec.value;
      if (rec.money && rec.ball === BALLS_PER_RACK - 1) this.moneyMade += 1;
      this.madeInRack.set(key, (this.madeInRack.get(key) ?? 0) + 1);
    } else this.streak = 0;
    if (this.resolvedInRack.get(key) === BALLS_PER_RACK && this.madeInRack.get(key) === BALLS_PER_RACK) this.perfectRacks += 1;
    return made && !this.practice ? rec.value : 0;
  }
}

/** Indices of the players tied for the highest score (length > 1 means sudden death). */
export function tiedForFirst(scores: readonly number[]): number[] {
  if (!scores.length) return [];
  const best = Math.max(...scores);
  return scores.map((s, i) => (s === best ? i : -1)).filter(i => i >= 0);
}

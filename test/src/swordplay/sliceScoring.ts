import { SW_TUNING } from './swordTuning';
import { angleError } from './SlashDetector';
import { clamp, type Dir8 } from './swMath';

/**
 * Speed Slice scoring (pure).
 *  - Correct direction: 100 + up to 100 for straightness + up to 50 for speed, times the combo (×1…×5, one
 *    step per 5 good slices in a row), times 2 for a golden target.
 *  - Wrong direction: half of the base points (no combo) and the combo breaks.
 *  - PERFECT: exact direction (within perfectDeg) and straightness above perfectStraight.
 *  - Decoys: slicing one costs 150 (and staggers you); letting it pass gives 50.
 *  - A target that gets away breaks the combo.
 */
export const DECOY_PENALTY = 150;
export const DODGE_BONUS = 50;

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';
export const TIERS: Array<{ tier: Tier; score: number; acc: number }> = [
  { tier: 'platinum', score: 40000, acc: 0.9 },
  { tier: 'gold', score: 25000, acc: 0.75 },
  { tier: 'silver', score: 12000, acc: 0.6 }
];

export function tierFor(score: number, accuracy: number): Tier {
  for (const t of TIERS) if (score >= t.score && accuracy >= t.acc) return t.tier;
  return 'bronze';
}

export interface Judgement { dirOk: boolean; perfect: boolean; err: number }

/** How a slash at `angle` (degrees) with this straightness compares to the wanted direction. */
export function judge(angle: number, want: Dir8, straight: number): Judgement {
  const err = angleError(angle, want);
  const dirOk = Math.abs(err) <= SW_TUNING.dirTolerance;
  return { dirOk, err, perfect: dirOk && Math.abs(err) <= SW_TUNING.perfectDeg && straight > SW_TUNING.perfectStraight };
}

/** Base points of a slice before the combo and golden multipliers. */
export function basePoints(straight: number, speed: number): number {
  const speedK = clamp((speed - 4) / 10, 0, 1);
  return 100 + Math.round(100 * clamp(straight, 0, 1)) + Math.round(50 * speedK);
}

export interface SliceResult { points: number; mult: number; perfect: boolean; dirOk: boolean; comboUp: boolean }

export class SliceScore {
  score = 0;
  /** Good slices in a row. */
  streak = 0;
  bestStreak = 0;
  maxMult = 1;
  good = 0;
  wrong = 0;
  missed = 0;
  perfects = 0;
  perfectRun = 0;
  bestPerfectRun = 0;
  decoysCut = 0;
  decoysDodged = 0;
  readonly byDir: Record<Dir8, number> = { right: 0, upRight: 0, up: 0, upLeft: 0, left: 0, downLeft: 0, down: 0, downRight: 0 };

  get mult(): number { return Math.min(5, 1 + Math.floor(this.streak / 5)); }
  /** Targets that wanted a slice (decoys don't count). */
  get attempts(): number { return this.good + this.wrong + this.missed; }
  get accuracy(): number { return this.attempts ? this.good / this.attempts : 0; }

  slice(o: { want: Dir8; angle: number; dir: Dir8; straight: number; speed: number; golden: boolean }): SliceResult {
    const j = judge(o.angle, o.want, o.straight);
    const base = basePoints(o.straight, o.speed);
    this.byDir[o.dir] += 1;
    if (!j.dirOk) {
      const points = Math.floor(base / 2);
      this.score += points;
      this.wrong += 1;
      this.streak = 0;
      this.perfectRun = 0;
      return { points, mult: 1, perfect: false, dirOk: false, comboUp: false };
    }
    const mult = this.mult;
    const points = base * mult * (o.golden ? 2 : 1);
    this.score += points;
    this.good += 1;
    this.streak += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.maxMult = Math.max(this.maxMult, this.mult);
    if (j.perfect) { this.perfects += 1; this.perfectRun += 1; this.bestPerfectRun = Math.max(this.bestPerfectRun, this.perfectRun); }
    else this.perfectRun = 0;
    return { points, mult, perfect: j.perfect, dirOk: true, comboUp: this.mult > mult };
  }

  decoy(cut: boolean): number {
    if (cut) {
      const before = this.score;
      this.score = Math.max(0, this.score - DECOY_PENALTY);
      this.decoysCut += 1;
      this.streak = 0;
      this.perfectRun = 0;
      return this.score - before;
    }
    this.decoysDodged += 1;
    this.score += DODGE_BONUS;
    return DODGE_BONUS;
  }

  miss(): void { this.missed += 1; this.streak = 0; this.perfectRun = 0; }
}

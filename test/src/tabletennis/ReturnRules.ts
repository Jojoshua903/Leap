/**
 * Return Challenge rules (pure, tested). House rules:
 *  - 10 points per valid return (it bounces on the machine's half), +5 if it was a spin shot,
 *    +25 for every target it lands in.
 *  - Combo multiplier ×1…×5 for consecutive returns: returns 1–3 score ×1, 4–6 ×2, … 13+ ×5.
 *    A miss resets it.
 *  - 3 lives; a miss (whiff, net, out) costs one. 0 lives = game over.
 *  - Difficulty goes up one step every 10 returns, 5 steps in total.
 */
export const RC_RULES = {
  lives: 3,
  perReturn: 10,
  spinBonus: 5,
  targetBonus: 25,
  maxMultiplier: 5,
  returnsPerMultiplier: 3,
  returnsPerLevel: 10,
  levels: 5
} as const;

export interface ReturnResult { points: number; multiplier: number; levelUp: boolean; level: number }

export class ReturnScore {
  score = 0;
  lives: number = RC_RULES.lives;
  returns = 0;
  combo = 0;
  bestCombo = 0;
  targets = 0;
  spinShots = 0;
  misses = 0;

  /** Multiplier the next return will score with. */
  get multiplier(): number {
    return Math.min(RC_RULES.maxMultiplier, 1 + Math.floor(this.combo / RC_RULES.returnsPerMultiplier));
  }

  /** Difficulty step 1..5. */
  get level(): number { return levelFor(this.returns); }
  get over(): boolean { return this.lives <= 0; }

  addReturn(o: { spin: boolean; targets: number }): ReturnResult {
    const before = this.level;
    const multiplier = this.multiplier;
    const points = (RC_RULES.perReturn + (o.spin ? RC_RULES.spinBonus : 0) + RC_RULES.targetBonus * Math.max(0, o.targets)) * multiplier;
    this.score += points;
    this.returns += 1;
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.targets += Math.max(0, o.targets);
    if (o.spin) this.spinShots += 1;
    return { points, multiplier, levelUp: this.level > before, level: this.level };
  }

  /** Returns true when that was the last life. */
  miss(): boolean {
    if (this.over) return true;
    this.lives -= 1;
    this.misses += 1;
    this.combo = 0;
    return this.over;
  }
}

export const levelFor = (returns: number): number =>
  Math.min(RC_RULES.levels, 1 + Math.floor(Math.max(0, returns) / RC_RULES.returnsPerLevel));

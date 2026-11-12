import type { StageDef } from './stages/types';

/**
 * Showdown rules (pure): the run's health, hearts, score, grade and stage progression, plus the boss's
 * phases. The scene drives it with events; nothing here knows about Three.js.
 *
 * Score: points per enemy beaten (EnemyDef.score) + 10 × combo per hit (combo = hits in a row without
 * taking damage), 150 per perfect parry, 500 per stage cleared without damage, a speed bonus of 20 per
 * second under the stage's par time. Grade by score: S ≥ 12000, A ≥ 8000, B ≥ 4500, else C.
 */
export const SHOWDOWN = {
  hp: 100,
  heart: 25,
  parryPoints: 150,
  comboPoints: 10,
  noDamageBonus: 500,
  speedPerSecond: 20,
  grades: [{ grade: 'S', score: 12000 }, { grade: 'A', score: 8000 }, { grade: 'B', score: 4500 }] as const
} as const;

export type Grade = 'S' | 'A' | 'B' | 'C';
export const gradeFor = (score: number): Grade => {
  for (const g of SHOWDOWN.grades) if (score >= g.score) return g.grade;
  return 'C';
};
/** For "best grade" stats: S = 4 … C = 1. */
export const gradeRank = (g: Grade): number => ({ S: 4, A: 3, B: 2, C: 1 })[g];
export const rankGrade = (n: number): Grade | null => (n >= 4 ? 'S' : n === 3 ? 'A' : n === 2 ? 'B' : n === 1 ? 'C' : null);

export type RunPhase = 'walk' | 'fight' | 'heart' | 'cleared' | 'dead';

export class ShowdownRun {
  hp: number = SHOWDOWN.hp;
  stage = 0;
  wave = 0;
  phase: RunPhase = 'walk';
  score = 0;
  kills = 0;
  parries = 0;
  combo = 0;
  bestCombo = 0;
  damageTaken = 0;
  hearts = 0;
  time = 0;
  bombsSliced = 0;
  arrowsSliced = 0;
  /** Seconds in the current stage's fights, for the speed bonus. */
  private stageFight = 0;
  private stageDamage = 0;
  /** Per-stage results for the breakdown. */
  readonly stageLog: Array<{ id: string; time: number; damage: number; bonus: number }> = [];

  constructor(readonly stages: readonly StageDef[]) {}

  get current(): StageDef { return this.stages[Math.min(this.stage, this.stages.length - 1)]; }
  get isBoss(): boolean { return !!this.current.boss; }
  get done(): boolean { return this.phase === 'cleared' || this.phase === 'dead'; }
  get noDamage(): boolean { return this.damageTaken === 0; }
  get grade(): Grade { return gradeFor(this.score); }

  tick(dt: number): void {
    if (this.done) return;
    this.time += dt;
    if (this.phase === 'fight') this.stageFight += dt;
  }

  /** The walk to the stage's fight is over. */
  arrive(): void { if (this.phase === 'walk') { this.phase = 'fight'; this.wave = 0; } }

  hit(): number {
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const p = SHOWDOWN.comboPoints * this.combo;
    this.score += p;
    return p;
  }

  kill(points: number): number { this.kills += 1; this.score += points; return points; }

  parry(): number { this.parries += 1; this.score += SHOWDOWN.parryPoints; return SHOWDOWN.parryPoints; }

  /** Took damage: combo gone. Returns true if that was the end of the run. */
  hurt(dmg: number): boolean {
    if (this.done || dmg <= 0) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.damageTaken += dmg;
    this.stageDamage += dmg;
    this.combo = 0;
    if (this.hp <= 0) { this.phase = 'dead'; return true; }
    return false;
  }

  heart(): void {
    this.hearts += 1;
    this.hp = Math.min(SHOWDOWN.hp, this.hp + SHOWDOWN.heart);
    if (this.phase === 'heart') this.phase = 'fight';
  }

  /**
   * The current wave is beaten. Returns what comes next: another wave, a heart to pick up first, or the
   * stage end (the next walk, or the end of the run after the boss).
   */
  waveCleared(): 'wave' | 'heart' | 'stage' | 'cleared' {
    if (this.phase !== 'fight' && this.phase !== 'heart') return this.phase === 'cleared' ? 'cleared' : 'stage';
    const st = this.current;
    const heartNow = st.heartAfter === this.wave;
    this.wave += 1;
    if (this.wave < st.waves.length) {
      if (heartNow) { this.phase = 'heart'; return 'heart'; }
      return 'wave';
    }
    // stage done: bonuses
    const speed = Math.max(0, Math.round((st.parTime - this.stageFight) * SHOWDOWN.speedPerSecond));
    const clean = this.stageDamage === 0 ? SHOWDOWN.noDamageBonus : 0;
    this.score += speed + clean;
    this.stageLog.push({ id: st.id, time: this.stageFight, damage: this.stageDamage, bonus: speed + clean });
    this.stageFight = 0; this.stageDamage = 0;
    if (this.stage >= this.stages.length - 1) { this.phase = 'cleared'; return 'cleared'; }
    this.stage += 1;
    this.wave = 0;
    this.phase = 'walk';
    return heartNow ? 'heart' : 'stage';
  }
}

/* ---------------- the boss ---------------- */

export type BossPhase = 1 | 2 | 3 | 'final' | 'down';

/**
 * The Great Scarecrow Knight's health and phases: phase 1 above ⅔ HP, 2 above ⅓, then 3. At 0 HP it
 * wobbles ('final'): a big thrust within `finalWindow` seconds beats it ('down'); otherwise it recovers
 * `recover` of its HP and goes back to phase 3.
 */
export class BossBrain {
  hp: number;
  phase: BossPhase = 1;
  finalLeft = 0;
  /** Phase changes, for the scene (roar, music layer). */
  onPhase: ((p: BossPhase) => void) | null = null;
  static readonly finalWindow = 4;
  static readonly recover = 0.15;

  constructor(readonly maxHp: number) { this.hp = maxHp; }

  private set(p: BossPhase): void { if (p !== this.phase) { this.phase = p; this.onPhase?.(p); } }

  /** A weak point was hit. */
  damage(n: number): void {
    if (this.phase === 'final' || this.phase === 'down') return;
    this.hp = Math.max(0, this.hp - n);
    if (this.hp <= 0) { this.finalLeft = BossBrain.finalWindow; this.set('final'); return; }
    const k = this.hp / this.maxHp;
    this.set(k > 2 / 3 ? 1 : k > 1 / 3 ? (this.phase === 3 ? 3 : 2) : 3);
  }

  /** A thrust landed on it. Only counts in the final window. */
  thrust(): boolean {
    if (this.phase !== 'final') return false;
    this.set('down');
    return true;
  }

  tick(dt: number): void {
    if (this.phase !== 'final') return;
    this.finalLeft -= dt;
    if (this.finalLeft <= 0) {
      this.hp = Math.ceil(this.maxHp * BossBrain.recover);
      this.set(3);
    }
  }

  /** The script phase for EnemyDef.script (1–3). */
  get scriptPhase(): number { return typeof this.phase === 'number' ? this.phase : 3; }
}

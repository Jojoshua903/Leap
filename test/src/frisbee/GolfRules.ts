/**
 * Frisbee Golf rules (stroke play), independent of rendering so they can be tested.
 *
 * - Everyone tees off in "honours" order (hole 1: player order; after that the best score on the last
 *   hole first, ties keep the previous order). After the tee shots the player farthest from the basket
 *   throws next.
 * - Each throw is a stroke, from where the disc came to rest (the lie).
 * - Out of bounds (outside the hole's area or in water): +1 penalty stroke, re-throw from the last lie.
 * - Inside PUTT_DIST metres of the basket a throw is a putt (softer throw, putt animation).
 * - A hole stops at MAX_STROKES: you pick up and score the maximum.
 * - Lowest total wins; equal totals share the place.
 */
export const GOLF_RULES = { maxStrokes: 8, puttDist: 10, obPenalty: 1 };

export interface Lie { x: number; y: number; z: number }

export type ScoreName = 'ace' | 'albatross' | 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | 'triple';

export function scoreName(strokes: number, par: number): ScoreName {
  if (strokes === 1) return 'ace';
  const d = strokes - par;
  return d <= -3 ? 'albatross' : d === -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : d === 2 ? 'double' : 'triple';
}

export type ThrowOutcome = { kind: 'in' } | { kind: 'rest'; at: Lie } | { kind: 'ob' };

export interface HoleState {
  strokes: number;
  lie: Lie;
  /** Still on the tee (no in-bounds throw yet). */
  onTee: boolean;
  holed: boolean;
  /** Reached the stroke limit. */
  picked: boolean;
  ob: number;
}

export interface ThrowResult { strokes: number; penalty: boolean; holed: boolean; picked: boolean; putt: boolean }

const dist2 = (a: Lie, b: Lie): number => Math.hypot(a.x - b.x, a.z - b.z);

export class GolfRound {
  /** cards[player][hole] = strokes (null = not finished). */
  readonly cards: Array<Array<number | null>>;
  hole = -1;
  state: HoleState[] = [];
  basket: Lie = { x: 0, y: 0, z: 0 };
  /** Per-player counters for stats and achievements. */
  readonly obTotal: number[];
  readonly puttStreak: number[];
  readonly bestPuttStreak: number[];
  readonly puttsMade: number[];
  readonly longest: number[];
  private order: number[];

  constructor(readonly pars: number[], readonly players: number) {
    this.cards = Array.from({ length: players }, () => pars.map(() => null));
    this.obTotal = new Array(players).fill(0);
    this.puttStreak = new Array(players).fill(0);
    this.bestPuttStreak = new Array(players).fill(0);
    this.puttsMade = new Array(players).fill(0);
    this.longest = new Array(players).fill(0);
    this.order = Array.from({ length: players }, (_, i) => i);
  }

  get holes(): number { return this.pars.length; }
  get par(): number { return this.pars[this.hole]; }

  startHole(h: number, tee: Lie, basket: Lie): void {
    if (h > 0) {
      const prev = h - 1;
      // honours: best score on the last hole first, stable for ties
      this.order = [...this.order].sort((a, b) => (this.cards[a][prev] ?? 99) - (this.cards[b][prev] ?? 99));
    }
    this.hole = h;
    this.basket = { ...basket };
    this.state = Array.from({ length: this.players }, () => ({ strokes: 0, lie: { ...tee }, onTee: true, holed: false, picked: false, ob: 0 }));
  }

  /** Tee order of the current hole. */
  get teeOrder(): readonly number[] { return this.order; }

  finished(p: number): boolean { const s = this.state[p]; return s.holed || s.picked; }
  get holeDone(): boolean { return this.state.every((_, p) => this.finished(p)); }
  get done(): boolean { return this.hole === this.holes - 1 && this.holeDone; }

  distance(p: number): number { return dist2(this.state[p].lie, this.basket); }
  isPutt(p: number): boolean { return this.distance(p) <= GOLF_RULES.puttDist; }

  /** Who throws next: tee shots in honours order, then the farthest from the basket. */
  next(): number | null {
    for (const p of this.order) if (!this.finished(p) && this.state[p].onTee) return p;
    let best: number | null = null, bd = -1;
    for (const p of this.order) {
      if (this.finished(p)) continue;
      const d = this.distance(p);
      if (d > bd + 1e-6) { bd = d; best = p; }
    }
    return best;
  }

  record(p: number, o: ThrowOutcome): ThrowResult {
    const s = this.state[p];
    const putt = !s.onTee && this.isPutt(p);
    const from = s.lie;
    s.strokes += 1;
    let penalty = false;
    if (o.kind === 'in') {
      s.holed = true;
      this.longest[p] = Math.max(this.longest[p], dist2(from, this.basket));
    } else if (o.kind === 'ob') {
      s.strokes += GOLF_RULES.obPenalty;
      s.ob += 1;
      this.obTotal[p] += 1;
      penalty = true;                     // the lie stays where it was
    } else {
      this.longest[p] = Math.max(this.longest[p], dist2(from, o.at));
      s.lie = { ...o.at };
      s.onTee = false;
    }
    if (putt) {
      if (s.holed) { this.puttStreak[p] += 1; this.puttsMade[p] += 1; this.bestPuttStreak[p] = Math.max(this.bestPuttStreak[p], this.puttStreak[p]); }
      else this.puttStreak[p] = 0;
    }
    if (!s.holed && s.strokes >= GOLF_RULES.maxStrokes) { s.picked = true; s.strokes = GOLF_RULES.maxStrokes; }
    if (s.holed) s.strokes = Math.min(s.strokes, GOLF_RULES.maxStrokes);
    if (s.holed || s.picked) this.cards[p][this.hole] = s.strokes;
    return { strokes: s.strokes, penalty, holed: s.holed, picked: s.picked, putt };
  }

  total(p: number): number { return this.cards[p].reduce<number>((a, b) => a + (b ?? 0), 0); }

  /** Strokes relative to par over the holes finished so far. */
  vsPar(p: number): number {
    return this.cards[p].reduce<number>((a, b, h) => a + (b === null ? 0 : b - this.pars[h]), 0);
  }

  /** Every player with the lowest total. */
  winners(): number[] {
    const totals = this.cards.map((_, p) => this.total(p));
    const low = Math.min(...totals);
    return totals.map((v, i) => (v === low ? i : -1)).filter(i => i >= 0);
  }

  /** How many of `p`'s finished holes got each score name. */
  counts(p: number): Record<ScoreName, number> {
    const c: Record<ScoreName, number> = { ace: 0, albatross: 0, eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, triple: 0 };
    this.cards[p].forEach((s, h) => { if (s !== null) c[scoreName(s, this.pars[h])] += 1; });
    return c;
  }
}

/** A putt is a softer throw: map the full input range onto 3–12 m/s. */
export function puttSpeed(speed: number, min = 8, max = 19): number {
  const k = Math.max(0, Math.min(1, (speed - min) / Math.max(1, max - min)));
  return 3 + k * 9;
}

/** Recommended disc for a distance: driver for long, midrange for medium, putter close in. */
export function recommendDisc(dist: number): 'driver' | 'mid' | 'putter' {
  return dist > 55 ? 'driver' : dist > GOLF_RULES.puttDist * 2.2 ? 'mid' : 'putter';
}

/** Is a point inside the hole's area? */
export function inBounds(b: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number): boolean {
  return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
}

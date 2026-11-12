import { Rng } from '../tabletennis/BallPhysics';
import { DIRS, type Dir8 } from './swMath';

/**
 * Speed Slice waves, as data. A round is a seeded list of spawns; the same seed always gives the same round,
 * so hot-seat players can face the exact same targets.
 *
 * Each target flies in from far ahead to a hover point in front of the player (P frame: x right, y up,
 * z forward), hangs there for `hover` seconds and then drops away (a miss, or a dodge for a decoy).
 * Difficulty rises with time: shorter gaps, faster approach, shorter hover, more decoys. Every
 * `burstEvery` seconds a multi-slice burst sends 2–3 targets at once.
 */
export type TargetKind = 'log' | 'melon' | 'bamboo' | 'straw' | 'bomb' | 'rock';
export const DECOYS: readonly TargetKind[] = ['bomb', 'rock'];
export const isDecoy = (k: TargetKind): boolean => k === 'bomb' || k === 'rock';

export interface Spawn {
  /** Seconds into the round when it starts flying in. */
  t: number;
  kind: TargetKind;
  /** The direction to slash (decoys: null). */
  dir: Dir8 | null;
  golden: boolean;
  /** Hover point (P frame). */
  x: number;
  y: number;
  /** Seconds to fly in and to hover. */
  travel: number;
  hover: number;
  /** Part of a multi-slice burst. */
  burst: boolean;
}

export const WAVE = {
  duration: 60,
  intervalStart: 1.35, intervalEnd: 0.55,
  travelStart: 1.6, travelEnd: 0.9,
  hoverStart: 0.9, hoverEnd: 0.45,
  decoyStart: 0.06, decoyEnd: 0.16,
  golden: 0.05,
  burstEvery: 12,
  hoverZ: 0.95,
  spawnZ: 11,
  /** Practice: slow and steady, no decoys, a fixed number of targets. */
  practiceInterval: 2.4, practiceTravel: 1.8, practiceHover: 2.2, practiceCount: 40
} as const;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Difficulty 0..1 at time t (seconds). */
export const difficultyAt = (t: number): number => Math.max(0, Math.min(1, t / WAVE.duration));

export function paramsAt(t: number): { interval: number; travel: number; hover: number; decoy: number } {
  const k = difficultyAt(t);
  return {
    interval: lerp(WAVE.intervalStart, WAVE.intervalEnd, k),
    travel: lerp(WAVE.travelStart, WAVE.travelEnd, k),
    hover: lerp(WAVE.hoverStart, WAVE.hoverEnd, k),
    decoy: lerp(WAVE.decoyStart, WAVE.decoyEnd, k)
  };
}

/** Which directions suit a shape: a standing bamboo pole is cut across, a lying log is chopped down through. */
export function dirsFor(kind: TargetKind): readonly Dir8[] {
  switch (kind) {
    case 'bamboo': return ['right', 'left', 'upRight', 'upLeft', 'downLeft', 'downRight'];
    case 'log': return ['up', 'down', 'upRight', 'upLeft', 'downLeft', 'downRight'];
    default: return DIRS;
  }
}

const SLICEABLE: readonly TargetKind[] = ['log', 'melon', 'bamboo', 'straw'];

function target(rng: Rng, t: number, travel: number, hover: number, decoyChance: number, burst: boolean, x?: number): Spawn {
  const decoy = !burst && rng.next() < decoyChance;
  const kind: TargetKind = decoy ? DECOYS[Math.floor(rng.next() * DECOYS.length)] : SLICEABLE[Math.floor(rng.next() * SLICEABLE.length)];
  const options = dirsFor(kind);
  return {
    t, kind,
    dir: decoy ? null : options[Math.floor(rng.next() * options.length)],
    golden: !decoy && rng.next() < WAVE.golden,
    x: x ?? Math.round(rng.signed() * 0.42 * 100) / 100,
    y: Math.round((1.05 + rng.next() * 0.45) * 100) / 100,
    travel, hover, burst
  };
}

/** One full round. */
export function buildRound(seed: number): Spawn[] {
  const rng = new Rng(seed);
  const out: Spawn[] = [];
  let t = 1.2, nextBurst = WAVE.burstEvery;
  while (t < WAVE.duration - 1.5) {
    const p = paramsAt(t);
    if (t >= nextBurst) {
      nextBurst += WAVE.burstEvery;
      const n = t > WAVE.duration / 2 ? 3 : 2;
      const xs = n === 3 ? [-0.42, 0, 0.42] : [-0.3, 0.3];
      // a burst hangs a little longer so all of it can be reached
      for (let i = 0; i < n; i++) out.push(target(rng, t, p.travel, p.hover + 0.35 * n, 0, true, xs[i]));
      t += p.interval * (1.2 + 0.4 * n);
      continue;
    }
    out.push(target(rng, t, p.travel, p.hover, p.decoy, false));
    // ±10 % jitter so it doesn't feel metronomic
    t += p.interval * (0.9 + rng.next() * 0.2);
  }
  return out;
}

/** Practice: no timer pressure, no decoys, long hover. */
export function buildPractice(seed: number): Spawn[] {
  const rng = new Rng(seed);
  const out: Spawn[] = [];
  for (let i = 0; i < WAVE.practiceCount; i++) out.push(target(rng, 1.5 + i * WAVE.practiceInterval, WAVE.practiceTravel, WAVE.practiceHover, 0, false));
  return out;
}

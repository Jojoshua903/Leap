import { Rng, TABLE_HALF_LENGTH, TABLE_HALF_WIDTH, v3, type V3 } from './BallPhysics';
import type { ShotIntent } from './Shot';
import { TABLE, TT_TUNING } from './ttTuning';

/**
 * The Return Challenge ball machine on the far end (side 1). Each difficulty step (1..5) makes the
 * balls faster (lower arcs), spinnier, wider and more frequent, and the targets fewer and smaller.
 * Pure and seeded, so the difficulty curve is testable.
 */
export interface MachineStep {
  /** Arc height above the table: lower = faster ball. */
  apex: number;
  topMax: number;
  sideMax: number;
  /** Share of the half-width the balls spread over. */
  spread: number;
  /** Seconds between balls. */
  interval: number;
  targets: number;
  targetRadius: number;
}

export const MACHINE_STEPS: MachineStep[] = [
  { apex: 0.46, topMax: 0, sideMax: 0, spread: 0.15, interval: 2.4, targets: 1, targetRadius: 0.2 },
  { apex: 0.39, topMax: 50, sideMax: 0, spread: 0.32, interval: 2.15, targets: 1, targetRadius: 0.18 },
  { apex: 0.33, topMax: 90, sideMax: 30, spread: 0.48, interval: 1.95, targets: 2, targetRadius: 0.16 },
  { apex: 0.29, topMax: 120, sideMax: 50, spread: 0.6, interval: 1.75, targets: 2, targetRadius: 0.14 },
  { apex: 0.25, topMax: 150, sideMax: 70, spread: 0.7, interval: 1.55, targets: 3, targetRadius: 0.12 }
];

export const machineStep = (level: number): MachineStep => MACHINE_STEPS[Math.max(1, Math.min(5, Math.round(level))) - 1];

export interface MachineBall { from: V3; intent: ShotIntent }
export interface Target { x: number; z: number; r: number }

/** The machine's mouth: centre of the far end, a little above the table. */
export const MACHINE_POS = v3(0, TABLE.height + 0.16, -(TABLE_HALF_LENGTH + 0.32));

export class BallMachine {
  readonly rng: Rng;
  constructor(seed: number) { this.rng = new Rng(seed); }

  /** Next ball for a difficulty step: lands on the player's half (side 0). */
  next(level: number): MachineBall {
    const s = machineStep(level), r = this.rng;
    const from = v3(MACHINE_POS.x + r.signed() * 0.12, MACHINE_POS.y, MACHINE_POS.z);
    const x = r.signed() * (TABLE_HALF_WIDTH - 0.08) * s.spread;
    const z = 0.55 + r.next() * (TABLE_HALF_LENGTH - 0.75);
    const top = s.topMax ? r.signed() * s.topMax : 0;
    const side = s.sideMax ? r.signed() * s.sideMax : 0;
    return { from, intent: { target: { x, z }, apex: s.apex * (0.9 + 0.2 * r.next()), top, side } };
  }

  /** Fresh targets on the machine's half (z < 0), never overlapping. */
  targets(level: number): Target[] {
    const s = machineStep(level), r = this.rng, out: Target[] = [];
    for (let tries = 0; out.length < s.targets && tries < 60; tries++) {
      const t = {
        x: r.signed() * (TABLE_HALF_WIDTH - s.targetRadius - 0.04),
        z: -(0.3 + s.targetRadius + r.next() * (TABLE_HALF_LENGTH - 0.38 - 2 * s.targetRadius)),
        r: s.targetRadius
      };
      if (out.every(o => Math.hypot(o.x - t.x, o.z - t.z) > o.r + t.r + 0.05)) out.push(t);
    }
    return out;
  }
}

/** Targets a landing point hits. */
export const targetsHit = (landing: { x: number; z: number }, targets: readonly Target[]): number =>
  targets.filter(t => Math.hypot(landing.x - t.x, landing.z - t.z) <= t.r).length;

/** Is the shot a "spin shot" for the +5 bonus? */
export const isSpinShot = (top: number, side: number): boolean =>
  Math.abs(top) >= TT_TUNING.topspinMax * 0.4 || Math.abs(side) >= TT_TUNING.sidespinMax * 0.5;

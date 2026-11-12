import type { Rng } from '../tabletennis/BallPhysics';
import { COURT, isOutsideArc } from './bbTuning';
import { HOOP_CENTER, type ShotInput } from './ShotSolver';
import type { PickupSim, SimPlayer } from './PickupSim';

/**
 * Pickup AI: a small behaviour tree per player, re-evaluated every `reaction` seconds (movement is
 * continuous in between). Roles come from the situation: the ball handler, a spot-up shooter and a cutter
 * on offence; on-ball, deny and help on defence; everyone crashes or boxes out when a shot goes up.
 * The simulation does the steering (arrival + separation); the brain only picks targets and actions.
 * All randomness comes from the brain's own seeded Rng, so a game is deterministic for a seed.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

export interface AIParams {
  /** Seconds between decisions. */
  reaction: number;
  /** Multiplier on move speed. */
  speed: number;
  /** Launch-speed error std-dev (fraction) at 4 m; grows with distance. */
  powerSd: number;
  /** Direction error std-dev (degrees). */
  dirSd: number;
  /** Release-timing std-dev (ms). */
  timingSd: number;
  /** Multiplier on the contested-shot noise. */
  contestScale: number;
  /** Shot selection: minimum quality (0..1) before it shoots instead of looking for better. */
  shotIQ: number;
  /** 0..1, how well it reads passing lanes and finds the open teammate. */
  passIQ: number;
  /** Per decision, chance to swipe when it's in range of the ball handler. */
  aggression: number;
  stealChance: number;
  blockChance: number;
  intercept: number;
  /** How tight it guards (m from its man). */
  tightness: number;
}

export const AI_DIFFICULTY: Record<Difficulty, AIParams> = {
  easy: { reaction: 0.45, speed: 0.8, powerSd: 0.034, dirSd: 2.4, timingSd: 95, contestScale: 1.3, shotIQ: 0.25, passIQ: 0.3, aggression: 0.12, stealChance: 0.14, blockChance: 0.18, intercept: 0.12, tightness: 1.9 },
  normal: { reaction: 0.3, speed: 0.92, powerSd: 0.022, dirSd: 1.5, timingSd: 60, contestScale: 1, shotIQ: 0.45, passIQ: 0.6, aggression: 0.2, stealChance: 0.24, blockChance: 0.3, intercept: 0.25, tightness: 1.35 },
  hard: { reaction: 0.17, speed: 1.02, powerSd: 0.012, dirSd: 0.8, timingSd: 30, contestScale: 0.75, shotIQ: 0.62, passIQ: 0.9, aggression: 0.3, stealChance: 0.34, blockChance: 0.42, intercept: 0.4, tightness: 0.95 }
};

export type Role = 'handler' | 'spot' | 'cutter' | 'onBall' | 'deny' | 'help' | 'crash' | 'chase' | 'none';
export type AIState = 'wait' | 'dribble' | 'drive' | 'clear' | 'setShot' | 'pass' | 'spotUp' | 'cut' | 'guard' | 'swipe' | 'contest' | 'help' | 'rebound' | 'chase' | 'celebrate';

/** Spots the offence spreads to: top, left wing, right wing (index = slot), then the corners. */
export const SPOTS: Array<[number, number]> = [[0, 7.6], [-5.2, 5.0], [5.2, 5.0], [-6.9, 0.8], [6.9, 0.8]];

/* ---------------- behaviour tree ---------------- */

const S = { Fail: 0, Ok: 1, Running: 2 } as const;
type S = typeof S[keyof typeof S];
interface BB { sim: PickupSim; p: SimPlayer; brain: AIBrain }
type Node = (b: BB) => S;

const sel = (...ns: Node[]): Node => b => { for (const n of ns) { const r = n(b); if (r !== S.Fail) return r; } return S.Fail; };
const seq = (...ns: Node[]): Node => b => { for (const n of ns) { const r = n(b); if (r !== S.Ok) return r; } return S.Ok; };
const cond = (f: (b: BB) => boolean): Node => b => (f(b) ? S.Ok : S.Fail);
const act = (f: (b: BB) => S | void): Node => b => { const r = f(b); return typeof r === 'number' ? r : S.Ok; };

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
const inBounds = (x: number, z: number): [number, number] =>
  [clamp(x, -COURT.halfWidth + 0.5, COURT.halfWidth - 0.5), clamp(z, COURT.baselineZ + 0.5, COURT.halfCourtZ - 1)];

function goTo(b: BB, x: number, z: number, sprint = false): void {
  const [cx, cz] = inBounds(x, z);
  b.p.wantX = cx; b.p.wantZ = cz; b.p.sprint = sprint;
}

/** How good a shot from here is right now (0..1): distance, openness, a small bonus for 2-pointers. */
export function shotQuality(sim: PickupSim, p: SimPlayer): number {
  const d = sim.hoopDist(p);
  if (d > 8.2) return 0;
  const open = clamp((sim.openness(p) - 0.5) / 2, 0, 1);
  const range = d < 1.6 ? 1 : d < 4 ? 0.82 : d < 6.6 ? 0.62 : 0.55 - (d - 6.6) * 0.25;
  const bonus = isOutsideArc(p.x, p.z) ? 0.1 : 0;
  return clamp(range * (0.35 + 0.65 * open) + bonus, 0, 1);
}

/* ---- offence ---- */

const isCheck: Node = cond(({ sim }) => sim.phase !== 'live');
const waitCheck: Node = act(b => { b.brain.state = 'wait'; goTo(b, b.p.x, b.p.z); });

const mustClear: Node = cond(({ sim }) => !sim.rules.cleared);
const clearIt: Node = act(b => {
  b.brain.state = 'clear';
  const a = Math.atan2(b.p.x, Math.max(0.5, b.p.z));
  goTo(b, Math.sin(a) * (COURT.threeRadius + 0.9), Math.max(2.5, Math.cos(a) * (COURT.threeRadius + 0.9)), true);
});

const takeShot: Node = cond(b => {
  const q = shotQuality(b.sim, b.p);
  const hurry = clamp((b.brain.holdT - 3) / 4, 0, 0.5);      // the longer it holds, the less picky
  return q >= b.brain.params.shotIQ * (1 - hurry) + 0.12 && b.brain.rng.next() < 0.75;
});
const startShot: Node = act(b => { b.sim.setShot(b.p); b.brain.windup = 0.22 + b.brain.rng.next() * 0.16; b.brain.state = 'setShot'; });

const findPass: Node = act(b => {
  const { sim, p, brain } = b;
  const mine = shotQuality(sim, p);
  let best: SimPlayer | null = null, bestQ = mine + 0.12;
  for (const m of sim.teammates(p)) {
    if (!sim.laneClear(p.x, p.z, m.x, m.z, p.team, 0.55 + 0.35 * brain.params.passIQ)) continue;
    const q = shotQuality(sim, m) * (0.6 + 0.4 * brain.params.passIQ) + brain.rng.signed() * 0.1 * (1 - brain.params.passIQ);
    if (q > bestQ) { bestQ = q; best = m; }
  }
  // a careless pass now and then (easy)
  if (!best && brain.holdT > 2.5 && brain.rng.next() < 0.3 * (1 - brain.params.passIQ)) best = sim.teammates(p)[brain.rng.next() < 0.5 ? 0 : 1];
  if (!best || brain.holdT < 0.5) return S.Fail;
  brain.state = 'pass';
  sim.pass(p, best);
  return S.Ok;
});

const drive: Node = act(b => {
  const { sim, p, brain } = b;
  const d = sim.hoopDist(p);
  const laneOpen = sim.laneClear(p.x, p.z, HOOP_CENTER.x, 1.0, p.team, 0.8);
  if (laneOpen && d > 1.3 && brain.rng.next() < 0.4 + 0.4 * brain.params.passIQ) {
    brain.state = 'drive';
    goTo(b, p.x * 0.15, 1.0, true);
    return;
  }
  // dribble around a spot, probing
  brain.state = 'dribble';
  const a = brain.rng.signed() * 1.2;
  const r = clamp(d + brain.rng.signed() * 1.2, 2.5, 7.4);
  const base = Math.atan2(p.x, Math.max(0.5, p.z));
  goTo(b, Math.sin(base + a * 0.4) * r, Math.max(0.4, Math.cos(base + a * 0.4) * r));
});

const handler: Node = sel(
  seq(isCheck, waitCheck),
  seq(mustClear, clearIt),
  seq(takeShot, startShot),
  findPass,
  drive
);

const offBall: Node = act(b => {
  const { sim, p, brain } = b;
  if (sim.phase !== 'live') { brain.state = 'wait'; goTo(b, p.x, p.z); return; }
  const h = sim.holder();
  if (brain.role === 'cutter' && h && dist(h, p) > 2 && brain.rng.next() < 0.5) {
    brain.state = 'cut';
    goTo(b, (p.x > 0 ? 1 : -1) * 1.1, 1.2, true);
    if (sim.hoopDist(p) < 1.8) brain.role = 'spot';
    return;
  }
  // spot up: the slot's spot (or a corner), away from the handler
  brain.state = 'spotUp';
  let [x, z] = SPOTS[(p.slot + brain.spotShift) % SPOTS.length];
  if (h && Math.hypot(h.x - x, h.z - z) < 2.4) [x, z] = SPOTS[(p.slot + brain.spotShift + 2) % SPOTS.length];
  goTo(b, x, z);
});

/* ---- defence ---- */

const guard: Node = act(b => {
  const { sim, p, brain } = b;
  const man = sim.man(p);
  const h = sim.holder();
  const onBall = h === man;
  brain.role = onBall ? 'onBall' : 'deny';
  brain.state = 'guard';
  // between the man and the hoop; tighter on the ball, sagging off when far from it
  const dx = HOOP_CENTER.x - man.x, dz = HOOP_CENTER.z - man.z, d = Math.hypot(dx, dz) || 1;
  let gap = onBall ? brain.params.tightness * 0.8 : brain.params.tightness + (h ? Math.min(1.5, dist(h, man) * 0.2) : 0);
  gap = Math.min(gap, d * 0.6);
  let tx = man.x + dx / d * gap, tz = man.z + dz / d * gap;
  // help: the handler is driving near the rim and my man is far away
  if (!onBall && h && sim.hoopDist(h) < 3 && dist(man, h) > 3.5 && brain.rng.next() < 0.3 + 0.5 * brain.params.passIQ) {
    brain.role = 'help'; brain.state = 'help';
    tx = (h.x + HOOP_CENTER.x) / 2; tz = (h.z + 0.6) / 2;
  }
  goTo(b, tx, tz, onBall && dist(p, man) > 1.6);
  if (!onBall || !h || sim.phase !== 'live') return;
  // contest the shot: jump when the shooter rises
  if ((h.action === 'set' || h.action === 'shoot') && dist(p, h) < 1.6 && !sim.airborne(p)) {
    if (brain.rng.next() < 0.45 + 0.5 * brain.params.blockChance) { brain.state = 'contest'; sim.block(p); }
    return;
  }
  if (dist(p, h) < 1.2 && brain.rng.next() < brain.params.aggression) { brain.state = 'swipe'; sim.steal(p); }
});

/* ---- loose ball / shot in the air ---- */

const ballInAir: Node = cond(({ sim }) => sim.ball.state === 'shot');
const crash: Node = act(b => {
  const { sim, p, brain } = b;
  brain.role = 'crash'; brain.state = 'rebound';
  const offense = p.team === sim.offense;
  // offence: the two nearest crash, the shooter's far teammate gets back; defence: box out at the rim
  const near = offense ? sim.teammates(p).concat(p).sort((a, c) => sim.hoopDist(a) - sim.hoopDist(c)).indexOf(p) < 2 : true;
  if (!near) { goTo(b, 0, 6.8); return; }
  const a = Math.atan2(p.x, Math.max(0.3, p.z));
  const r = offense ? 2.0 : 1.4;
  goTo(b, Math.sin(a) * r, Math.max(0.3, Math.cos(a) * r), true);
});

const isLoose: Node = cond(({ sim }) => sim.ball.state === 'loose');
const chase: Node = act(b => {
  const { sim, p, brain } = b;
  const ball = sim.ball;
  const mates = sim.teamOf(p.id).sort((a, c) => dist(a, ball) - dist(c, ball));
  if (mates.indexOf(p) < 2) {
    brain.role = 'chase'; brain.state = 'chase';
    // aim where the ball will be, roughly
    const lead = brain.params.reaction * 1.5;
    goTo(b, ball.x + ball.vx * lead, ball.z + ball.vz * lead, true);
    if (ball.y > 1.8 && dist(p, ball) < 0.8 && !sim.airborne(p)) sim.block(p);       // jump for it
  } else { brain.state = 'spotUp'; goTo(b, p.x * 0.7, Math.max(3, p.z)); }
});

const celebrating: Node = cond(({ sim }) => sim.phase === 'over' || sim.phase === 'dead');
const idleOut: Node = act(b => { b.brain.state = b.p.action === 'celebrate' ? 'celebrate' : 'wait'; goTo(b, b.p.x, b.p.z); });

export const TREE: Node = sel(
  seq(celebrating, idleOut),
  seq(ballInAir, crash),
  seq(isLoose, chase),
  seq(cond(({ sim, p }) => sim.holder() === p), act(b => { b.brain.role = 'handler'; return handler(b); })),
  seq(cond(({ sim, p }) => p.team === sim.offense), offBall),
  guard
);

export class AIBrain {
  role: Role = 'none';
  state: AIState = 'wait';
  holdT = 0;
  windup = 0.3;
  spotShift = 0;
  private wait = 0;
  private hadBall = false;

  constructor(readonly params: AIParams, readonly rng: Rng) {}

  reset(): void { this.wait = 0; this.holdT = 0; this.state = 'wait'; this.role = 'none'; }

  /** Called every simulation step for AI players. */
  think(sim: PickupSim, p: SimPlayer, dt: number): void {
    const has = sim.holder() === p;
    if (has) this.holdT += dt; else this.holdT = 0;
    // a catch, a windup or a shot in the air need a reaction right away (still with the reaction delay)
    if (has !== this.hadBall) { this.hadBall = has; this.wait = Math.min(this.wait, this.params.reaction * 0.6); }
    if (p.action === 'set') {
      if (!has) p.action = 'idle';                      // lost the ball mid-windup
      else { if (p.actionT >= this.windup) sim.shoot(p); return; }
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.params.reaction * (0.8 + 0.4 * this.rng.next());
    // offence roles rotate a little so it doesn't look scripted
    if (p.team === sim.offense && !has) {
      if (this.rng.next() < 0.06) this.spotShift = (this.spotShift + 1) % 3;
      const mates = sim.teammates(p).filter(m => sim.holder() !== m);
      this.role = mates.length && mates[0].id < p.id ? 'cutter' : 'spot';
      if (this.rng.next() < 0.15) this.role = this.role === 'cutter' ? 'spot' : 'cutter';
    }
    TREE({ sim, p, brain: this });
  }

  /** This player's shot errors from `d` metres. */
  shotInput(d: number): ShotInput {
    const k = 0.7 + Math.max(0, d - 2) * 0.09;
    return {
      powerErr: this.rng.gauss() * this.params.powerSd * k,
      dirErrDeg: this.rng.gauss() * this.params.dirSd,
      timingMs: this.rng.gauss() * this.params.timingSd
    };
  }
}

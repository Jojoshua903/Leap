import { Rng, STEP, TABLE_HALF_LENGTH, TABLE_HALF_WIDTH, type V3 } from './BallPhysics';
import { Engine, type Prediction } from './Engine';
import { other, type Side } from './Rules';
import type { ShotIntent, ShotType } from './Shot';
import { TABLE, TT_TUNING } from './ttTuning';

/**
 * AI opponent. It predicts the ball with the same BallPhysics (Engine.predict), walks its paddle to
 * the contact point at a limited speed, then plans a shot to a target on the other half with
 * level-dependent errors. Low levels misjudge timing and aim (netting, long and wide balls);
 * Master almost never does. Deterministic for a given seed.
 */
export interface AILevel {
  id: number;
  nameKey: string;
  /** Delay before reacting to a new incoming ball. */
  reactionMs: number;
  /** Lateral paddle speed, m/s. */
  moveSpeed: number;
  /** Std-dev of the swing timing error, ms. */
  timingErrMs: number;
  /** Std-dev of the aim error at the target, m. */
  aimErr: number;
  /** 0..1: how often it mixes in lobs, spin and smashes. */
  variety: number;
  /** 0..1: how close to the lines it aims. */
  risk: number;
  /** Swing power range. */
  power: [number, number];
  /** How many times it re-plans a shot that would hit the net (0 = never checks). */
  care: number;
}

/** To add a level: append an entry here and the matching `ai.level.N` i18n keys. Ids must stay 0..N in order. */
export const AI_LEVELS: AILevel[] = [
  { id: 0, nameKey: 'ai.level.0', reactionMs: 420, moveSpeed: 1.6, timingErrMs: 75, aimErr: 0.3, variety: 0.1, risk: 0.15, power: [0.3, 0.55], care: 0 },
  { id: 1, nameKey: 'ai.level.1', reactionMs: 320, moveSpeed: 2.2, timingErrMs: 52, aimErr: 0.2, variety: 0.3, risk: 0.3, power: [0.35, 0.65], care: 1 },
  { id: 2, nameKey: 'ai.level.2', reactionMs: 240, moveSpeed: 2.9, timingErrMs: 34, aimErr: 0.13, variety: 0.55, risk: 0.5, power: [0.4, 0.75], care: 2 },
  { id: 3, nameKey: 'ai.level.3', reactionMs: 170, moveSpeed: 3.6, timingErrMs: 19, aimErr: 0.08, variety: 0.75, risk: 0.65, power: [0.45, 0.85], care: 3 },
  { id: 4, nameKey: 'ai.level.4', reactionMs: 110, moveSpeed: 4.5, timingErrMs: 8, aimErr: 0.035, variety: 0.9, risk: 0.75, power: [0.5, 0.9], care: 4 }
];

export const getLevel = (id: number): AILevel => AI_LEVELS[Math.max(0, Math.min(AI_LEVELS.length - 1, Math.round(id)))];

/** How far the paddle reaches from the body sideways without moving, m. */
const REACH = 0.55;

export class AIPlayer {
  readonly rng: Rng;
  /** Paddle position (world). The body follows it in the scene. */
  readonly paddle: V3;
  /** What the AI is about to do, for the debug overlay. */
  plan: Prediction | null = null;
  lastType: ShotType = 'drive';
  private reactAt = -1;
  private seenShot = -1;
  private whiffed = false;
  private tossAt = -1;
  private hitTiming = 0;
  private serveWait = 0;

  constructor(readonly side: Side, public level: AILevel, seed: number) {
    this.rng = new Rng(seed);
    const s = side === 0 ? 1 : -1;
    this.paddle = { x: 0, y: TABLE.height + 0.2, z: s * (TABLE_HALF_LENGTH + 0.3) };
  }

  /** Call every engine step. */
  tick(e: Engine, dt = STEP): void {
    if (e.phase === 'hold' && e.server === this.side) return this.thinkServe(e, dt);
    if (e.phase === 'toss' && e.server === this.side) return this.hitServe(e);
    if (e.phase !== 'live') { this.plan = null; this.seenShot = -1; return; }

    const incoming = e.heading === this.side;
    if (!incoming) { this.plan = null; this.drift(dt, 0); return; }
    // a new shot is on its way: react after the delay, then predict
    if (this.seenShot !== e.rallyLength) {
      this.seenShot = e.rallyLength;
      this.plan = null;
      this.whiffed = false;
      this.reactAt = e.time + this.level.reactionMs / 1000 * (0.8 + 0.4 * this.rng.next());
      this.hitTiming = this.rng.gauss() * this.level.timingErrMs;
    }
    if (e.time < this.reactAt || this.whiffed) return;
    if (!this.plan) this.plan = e.predict(this.side);
    const p = this.plan;
    if (!p) { this.drift(dt, 0); return; }
    this.drift(dt, p.pos.x);
    // swing at the predicted moment + this shot's timing error
    if (e.time + 1e-9 >= p.t + this.hitTiming / 1000) {
      const gap = Math.abs(this.paddle.x - e.ball.pos.x);
      // couldn't get there in time: the lateness adds to the timing error
      const lateMs = gap > REACH ? ((gap - REACH) / this.level.moveSpeed) * 1000 : 0;
      const timing = this.hitTiming + lateMs;
      this.plan = null;
      if (Math.abs(timing) > TT_TUNING.timingWindowMs || gap > REACH + 0.5) { this.whiffed = true; return; }  // whiff: no second try at this ball
      const { intent, type, power } = this.chooseShot(e.ball.pos);
      this.lastType = type;
      e.strike(this.side, intent, timing, type, power, this.level.care);
    }
  }

  private drift(dt: number, x: number): void {
    const d = x - this.paddle.x, max = this.level.moveSpeed * dt;
    this.paddle.x += Math.max(-max, Math.min(max, d));
  }

  private thinkServe(e: Engine, dt: number): void {
    this.serveWait += dt;
    if (this.tossAt < 0) this.tossAt = 0.45 + this.rng.next() * 0.5;
    if (this.serveWait >= this.tossAt) {
      this.serveWait = 0; this.tossAt = -1;
      this.hitTiming = this.rng.gauss() * this.level.timingErrMs * 0.6;
      e.toss();
    }
  }

  private hitServe(e: Engine): void {
    if (e.tossTimingMs() < this.hitTiming) return;
    const v = this.level.variety;
    const top = (this.rng.next() < v ? this.rng.signed() : 0) * TT_TUNING.topspinMax * 0.5;
    const side = (this.rng.next() < v * 0.6 ? this.rng.signed() : 0) * TT_TUNING.sidespinMax * 0.5;
    const dir = this.rng.signed() * (0.3 + 0.6 * this.level.risk);
    const power = 0.35 + 0.5 * this.rng.next();
    e.serve(dir + this.rng.gauss() * this.level.aimErr, power, top, side, e.tossTimingMs());
  }

  /** Pick a target on the other half, with this level's aim, risk and variety. */
  chooseShot(contact: V3): { intent: ShotIntent; type: ShotType; power: number } {
    const L = this.level, r = this.rng;
    const opp = other(this.side);
    const toward = opp === 0 ? 1 : -1;
    const margin = 0.3 - 0.24 * L.risk;                       // distance kept from the lines
    const xMax = TABLE_HALF_WIDTH - margin;
    const x = r.signed() * xMax * (0.35 + 0.65 * L.risk);
    const depthMin = 0.45, depthMax = TABLE_HALF_LENGTH - margin;
    const depth = depthMin + (depthMax - depthMin) * (0.4 + 0.6 * r.next());
    const height = contact.y - TABLE.height;
    const power = L.power[0] + (L.power[1] - L.power[0]) * r.next();

    let type: ShotType = 'drive';
    const roll = r.next();
    if (height > TT_TUNING.smashHeight && roll < L.variety * 0.8) type = 'smash';
    else if (roll < L.variety * 0.12) type = 'lob';
    else if (roll < L.variety * 0.55) type = 'topspin';
    else if (roll < L.variety * 0.7) type = 'chop';

    let apex = 0.28 + 0.12 * (1 - power), top = 0, side = 0;
    switch (type) {
      case 'smash': apex = height * 0.3; top = 40; break;
      case 'lob': apex = 0.9 + 0.3 * r.next(); top = 60; break;
      case 'topspin': top = TT_TUNING.topspinMax * (0.4 + 0.5 * r.next()); apex += 0.08; break;
      case 'chop': top = -TT_TUNING.topspinMax * (0.3 + 0.4 * r.next()); apex += 0.04; break;
      default: top = TT_TUNING.topspinMax * 0.15 * r.next();
    }
    if (L.variety > 0.5 && r.next() < 0.25) side = r.signed() * TT_TUNING.sidespinMax * 0.5;
    // human-like errors: aim, depth and a too-low or too-high arc
    const tx = x + r.gauss() * L.aimErr;
    const tz = toward * (depth + r.gauss() * L.aimErr * 1.2);
    apex = Math.max(0.02, apex * (1 + r.gauss() * L.aimErr * 1.4));
    return { intent: { target: { x: tx, z: tz }, apex, top, side }, type, power };
  }
}

/* ---------------- headless simulation (tests, balancing) ---------------- */

export interface SimResult { winner: Side; points: [number, number]; rallies: number; longest: number }

/** Play one game to 11 between two AI levels with no rendering. Deterministic for a seed. */
export function simulateGame(levelA: number, levelB: number, seed: number, firstServer: Side = 0): SimResult {
  const e = new Engine(1, firstServer, seed);
  const ai: [AIPlayer, AIPlayer] = [new AIPlayer(0, getLevel(levelA), seed * 7 + 1), new AIPlayer(1, getLevel(levelB), seed * 13 + 5)];
  let rallies = 0, longest = 0, overT = 0;
  for (let i = 0; i < 240 * 60 * 30 && !e.matchOver; i++) {
    ai[0].tick(e); ai[1].tick(e);
    e.step();
    if (e.phase === 'over') {
      overT += STEP;
      if (overT > 0.05) { rallies++; longest = Math.max(longest, e.rallyLength); overT = 0; if (!e.matchOver) e.startRally(); }
    }
  }
  const sc = e.rules.score;
  const winner: Side = sc.matchWinner ?? (sc.points[0] >= sc.points[1] ? 0 : 1);
  return { winner, points: (sc.finished[0] ?? sc.points) as [number, number], rallies, longest };
}

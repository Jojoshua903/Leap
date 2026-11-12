import { BallPhysics, Rng, STEP, TABLE_HALF_LENGTH, v3, type Contact, type V3 } from './BallPhysics';
import { TTRules, other, type BestOf, type RulesOutcome, type Side, type TTEmit } from './Rules';
import { executeHit, planServe, planShot, type Grade, type ShotIntent, type ShotPlan, type ShotType } from './Shot';
import { BALL, TABLE, TT_TUNING } from './ttTuning';

/**
 * One table, one ball, the rules, and the moments players act: hold → toss → serve → rally → over.
 * No rendering and no input, so the same engine runs the real match and the headless AI tests.
 * Players (human or AI) call toss() and strike(); the engine steps the ball at 240 Hz and turns
 * contacts into rule inputs.
 */
export type EnginePhase = 'hold' | 'toss' | 'live' | 'over';

export interface Prediction {
  /** Ball state at the moment it should be hit. */
  pos: V3;
  vel: V3;
  spin: V3;
  /** Engine time of that moment (s). */
  t: number;
  /** Where it first bounces on this side. */
  bounce: V3;
}

export interface HitInfo {
  side: Side;
  serve: boolean;
  type: ShotType;
  grade: Grade;
  timingMs: number;
  edge: number;
  /** 0..1 */
  power: number;
  spinShot: boolean;
  pos: V3;
  /** Planned landing, for the debug overlay. */
  landing: { x: number; z: number } | null;
}

export interface EngineListener {
  contact?(c: Contact): void;
  hit?(h: HitInfo): void;
  outcome?(o: RulesOutcome): void;
  toss?(side: Side): void;
}

const DEAD_SPEED = 0.08;
const MAX_SHOT_TIME = 6;          // s without a paddle contact before a stuck ball ends the point

/** Where a server holds the ball before the toss. */
export function holdPoint(side: Side, x = 0.18): V3 {
  const s = side === 0 ? 1 : -1;
  return v3(x * s, TABLE.height + 0.16, s * (TABLE_HALF_LENGTH + 0.22));
}

export class Engine {
  readonly ball: BallPhysics;
  readonly rules: TTRules;
  phase: EnginePhase = 'hold';
  time = 0;
  /** Where the server holds the ball; scenes move it with the server's hand. */
  hold: V3;
  private tossApexT = 0;
  private stillT = 0;
  private rallyT = 0;
  private lastHitter: Side | null = null;
  listeners: EngineListener[] = [];

  constructor(bestOf: BestOf, firstServer: Side, seed: number, emit?: TTEmit) {
    this.ball = new BallPhysics(new Rng(seed));
    this.rules = new TTRules(bestOf, firstServer, emit);
    this.hold = holdPoint(firstServer);
    this.startRally();
  }

  get server(): Side { return this.rules.rally.server; }
  get matchOver(): boolean { return this.rules.score.matchWinner !== null; }

  startRally(): void {
    this.rules.newRally();
    this.phase = 'hold';
    this.hold = holdPoint(this.server);
    this.ball.set(this.hold, v3(), v3());
    this.ball.live = false;
    this.rallyT = 0; this.stillT = 0; this.lastHitter = null;
  }

  /** Server throws the ball up (~20 cm). */
  toss(): void {
    if (this.phase !== 'hold') return;
    const vy = Math.sqrt(2 * 9.81 * TT_TUNING.tossHeight);
    this.ball.set(this.hold, v3(0, vy, 0), v3());
    this.tossApexT = this.time + vy / 9.81;
    this.phase = 'toss';
    for (const l of this.listeners) l.toss?.(this.server);
  }

  /** Signed ms from the toss apex (− = before). */
  tossTimingMs(): number { return (this.time - this.tossApexT) * 1000; }

  /**
   * Serve from the toss. `power` 0..1 sets the depth on the receiver's half, `direction` −1..1 the width.
   * Hitting far from the toss apex makes a weaker (but still legal) serve.
   */
  serve(direction: number, power: number, top: number, side: number, timingMs = this.tossTimingMs()): HitInfo | null {
    if (this.phase !== 'toss') return null;
    const s = this.server, fwd = s === 0 ? -1 : 1, right = s === 0 ? 1 : -1;
    const off = Math.min(1, Math.abs(timingMs) / TT_TUNING.timingWindowMs);
    const depth = 0.45 + 0.8 * Math.max(0, Math.min(1, power)) * (1 - 0.5 * off);
    const target = { x: Math.max(-0.62, Math.min(0.62, direction * 0.6)) * right, z: fwd * depth };
    const plan = planServe(this.ball.pos, target, s, top * (1 - off * 0.6), side * (1 - off * 0.6));
    const r = executeHit(this.ball, s, plan, timingMs * 0.4);
    this.phase = 'live';
    this.lastHitter = s;
    const info: HitInfo = {
      side: s, serve: true, type: 'drive', grade: r.grade, timingMs, edge: r.edge, power, pos: { ...this.ball.pos },
      spinShot: Math.abs(top) > TT_TUNING.topspinMax * 0.4 || Math.abs(side) > TT_TUNING.sidespinMax * 0.5, landing: plan.landing
    };
    this.feed({ type: 'serve', by: s });
    for (const l of this.listeners) l.hit?.(info);
    return info;
  }

  /** Fire a ball straight into a rally, as a shot by `by` (the Return Challenge machine). */
  launch(from: V3, plan: ShotPlan, by: Side): void {
    this.rules.newRally();
    this.ball.set(from, plan.vel, plan.spin);
    this.phase = 'live';
    this.rallyT = 0; this.stillT = 0; this.lastHitter = by;
    this.rules.rally.startAsHit(by);
  }

  /** A rally shot at the ball's current position. */
  strike(side: Side, intent: ShotIntent, timingMs: number, type: ShotType, power: number, retries = 3): HitInfo | null {
    if (this.phase !== 'live') return null;
    const plan = planShot(this.ball.pos, intent, side, retries);
    const r = executeHit(this.ball, side, plan, timingMs);
    this.lastHitter = side;
    this.stillT = 0;
    this.rallyT = 0;              // the time-out is per shot, so long rallies aren't cut off
    const info: HitInfo = {
      side, serve: false, type, grade: r.grade, timingMs, edge: r.edge, power, pos: { ...this.ball.pos },
      spinShot: Math.abs(intent.top) > TT_TUNING.topspinMax * 0.4 || Math.abs(intent.side) > TT_TUNING.sidespinMax * 0.5,
      landing: plan.landing
    };
    this.feed({ type: 'hit', by: side });
    for (const l of this.listeners) l.hit?.(info);
    return info;
  }

  private feed(e: Parameters<TTRules['feed']>[0]): void {
    if (this.phase === 'over') return;
    const out = this.rules.feed(e);
    if (out.kind === 'continue') return;
    this.phase = 'over';
    for (const l of this.listeners) l.outcome?.(out);
  }

  /** One 240 Hz step. */
  step(dt = STEP): void {
    this.time += dt;
    if (this.phase === 'hold') { this.ball.pos = { ...this.hold }; return; }
    const contacts = this.ball.step(dt);
    if (this.phase === 'toss') {
      // a toss that falls back past the hand goes back to the hand: no fault, just try again
      if (this.ball.pos.y < this.hold.y - 0.12 || contacts.length) { this.phase = 'hold'; this.ball.set(this.hold, v3()); this.ball.live = false; }
      return;
    }
    for (const c of contacts) {
      for (const l of this.listeners) l.contact?.(c);
      if (this.phase !== 'live') continue;
      if (c.kind === 'table') this.feed({ type: 'bounce', side: c.side });
      else if (c.kind === 'net') this.feed({ type: 'net' });
      else if (c.kind === 'netCord') this.feed({ type: 'netCord' });
      else if (c.kind === 'floor') this.feed({ type: 'floor' });
    }
    if (this.phase !== 'live') return;
    this.rallyT += dt;
    this.stillT = this.ball.speed < DEAD_SPEED ? this.stillT + dt : 0;
    const p = this.ball.pos;
    const gone = Math.abs(p.z) > TABLE_HALF_LENGTH + 4 || Math.abs(p.x) > 5;
    if (this.stillT > 0.4 || this.rallyT > MAX_SHOT_TIME || gone) this.feed(gone ? { type: 'floor' } : { type: 'dead' });
  }

  /** The side that must play the ball next (null while it flies toward the other side, or between rallies). */
  get toPlay(): Side | null { return this.phase === 'live' ? this.rules.rally.toPlay : null; }
  /** The side the ball is travelling toward. */
  get heading(): Side | null { return this.phase === 'live' ? this.rules.rally.heading : null; }
  get rallyLength(): number { return this.rules.rally.length; }
  get lastHit(): Side | null { return this.lastHitter; }

  /**
   * Where and when `side` should hit the ball: after it bounces on that half, at the top of the
   * bounce or as it passes the end line, whichever comes first. Null if the ball won't come back
   * into play on that side (net, out, wrong side).
   */
  predict(side: Side, maxT = 2.5): Prediction | null {
    if (this.phase !== 'live') return null;
    const b = this.ball.clone();
    let bounce: V3 | null = this.rules.rally.toPlay === side ? { ...b.pos } : null;
    const endZ = TABLE_HALF_LENGTH + 0.18;
    for (let t = 0; t < maxT; t += STEP) {
      const prevVy = b.vel.y;
      const cs = b.step(STEP);
      for (const c of cs) {
        if (c.kind === 'netCord') continue;
        if (c.kind === 'table' && !bounce) {
          if (c.side === side) { bounce = { ...c.pos }; continue; }
          if (other(side) === c.side) continue;             // a serve's first bounce on the server's half
        }
        return null;                                         // net, floor, a second bounce: nothing to hit
      }
      if (!bounce) continue;
      const past = side === 0 ? b.pos.z > endZ : b.pos.z < -endZ;
      const apex = prevVy > 0 && b.vel.y <= 0 && b.pos.y > TABLE.height + BALL.radius + 0.06;
      if (past || apex) return { pos: { ...b.pos }, vel: { ...b.vel }, spin: { ...b.spin }, t: this.time + t + STEP, bounce };
    }
    return null;
  }
}

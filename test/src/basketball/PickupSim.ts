import { Rng } from '../tabletennis/BallPhysics';
import { BB_TUNING, COURT, isOutsideArc, RELEASE_HEIGHT, type ShotAssist } from './bbTuning';
import { PickupScore, otherTeam, type Team } from './PickupRules';
import { applyError, HOOP_CENTER, isMake, predictOutcome, solveIdealShot, type ShotInput, type V3 } from './ShotSolver';
import { AIBrain, AI_DIFFICULTY, SPOTS, type Difficulty } from './bbAI';

/**
 * 3-on-3 half-court simulation: six players, one ball, the pickup rules. No rendering and no Rapier, so
 * it runs headless (AI tests, balancing) and drives the real game. In the game (`external: true`) the
 * ball's flight after a shot or a block is handed to Rapier: the scene launches it from onShot and feeds
 * its position back with externalBall() / externalBasket(). Headless, the ShotSolver predicts the result
 * and a simple bounce model handles rebounds. Deterministic for a seed.
 *
 * Players 0–2 are the home team (team 0), 3–5 the away team. Player i guards player i ± 3.
 */
export type Action = 'idle' | 'set' | 'shoot' | 'pass' | 'steal' | 'block' | 'celebrate' | 'sad';
export type BallState = 'held' | 'pass' | 'shot' | 'loose' | 'dead';
export type SimPhase = 'check' | 'live' | 'dead' | 'over';

export interface SimPlayer {
  id: number;
  team: Team;
  slot: number;
  x: number; z: number;
  vx: number; vz: number;
  facing: number;
  /** Steering target (AI) and sprint. */
  wantX: number; wantZ: number; sprint: boolean;
  /** Human-controlled: movement input (world x/z, −1..1) instead of a target. */
  human: boolean;
  moveX: number; moveZ: number;
  action: Action;
  actionT: number;
  /** Seconds since the jump started, −1 on the ground. */
  jumpT: number;
  stealCd: number;
  brain: AIBrain;
  /** Difficulty of this player's team. */
  diff: Difficulty;
}

export interface SimBall {
  state: BallState;
  holder: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  passFrom: number; passTo: number; passT: number; passDur: number;
  passFromPos: V3; passToPos: V3;
  shooter: number;
  shotX: number; shotZ: number;
  shotT: number;
  /** Headless: when the shot is decided and whether it goes in. */
  resolveT: number;
  willMake: boolean;
  wentHigh: boolean;
  lastTouch: Team;
  looseT: number;
  intercepted: Set<number>;
}

export interface PlayerStats { points: number; makes: number; attempts: number; swishes: number; steals: number; blocks: number; assists: number }

export interface SimShot {
  shooter: number;
  from: V3;
  vel: V3;
  spin: V3;
  blocked: boolean;
  /** For the HUD and debug overlay. */
  input: ShotInput;
  value: 1 | 2;
}

export interface SimEvents {
  shot?(s: SimShot): void;
  /** The ball was knocked away mid-flight (a late block): relaunch it with this velocity. */
  deflect?(from: V3, vel: V3): void;
  basket?(e: { team: Team; points: number; counted: boolean; shooter: number; assist: number | null; winner: Team | null }): void;
  steal?(by: number, from: number): void;
  block?(by: number, shooter: number): void;
  pass?(from: number, to: number): void;
  possession?(team: Team, reason: 'steal' | 'rebound' | 'basket' | 'out' | 'noClear' | 'block' | 'interception'): void;
  rebound?(by: number, offensive: boolean): void;
  check?(team: Team): void;
}

const CHECK_TIME = 1.1;
const DEAD_TIME = 1.6;
const JUMP_TIME = 0.56;
const PICKUP_R = 0.6;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const G = 9.81;

export class PickupSim {
  readonly players: SimPlayer[] = [];
  readonly ball: SimBall;
  readonly rules: PickupScore;
  readonly rng: Rng;
  readonly stats: PlayerStats[] = [];
  phase: SimPhase = 'check';
  phaseT = 0;
  time = 0;
  events: SimEvents = {};
  /** The ball's flight is driven by Rapier (game) instead of the built-in model (headless). */
  readonly external: boolean;
  /** Last pass, for assists. */
  private lastPass: { from: number; to: number; t: number } | null = null;
  private outPending: Team | null = null;

  constructor(o: { target: number; difficulty: [Difficulty, Difficulty]; seed: number; external?: boolean; firstOffense?: Team }) {
    this.rng = new Rng(o.seed);
    this.external = !!o.external;
    this.rules = new PickupScore(o.target, o.firstOffense ?? 0);
    for (let id = 0; id < 6; id++) {
      const team: Team = id < 3 ? 0 : 1, diff = o.difficulty[team];
      const p: SimPlayer = {
        id, team, slot: id % 3, x: 0, z: 6, vx: 0, vz: 0, facing: Math.PI,
        wantX: 0, wantZ: 6, sprint: false, human: false, moveX: 0, moveZ: 0,
        action: 'idle', actionT: 0, jumpT: -1, stealCd: 0, diff,
        brain: undefined as unknown as AIBrain
      };
      p.brain = new AIBrain(AI_DIFFICULTY[diff], new Rng((o.seed * 31 + id * 7919) >>> 0));
      this.players.push(p);
      this.stats.push({ points: 0, makes: 0, attempts: 0, swishes: 0, steals: 0, blocks: 0, assists: 0 });
    }
    this.ball = {
      state: 'held', holder: 0, x: 0, y: 1, z: COURT.checkZ, vx: 0, vy: 0, vz: 0,
      passFrom: -1, passTo: -1, passT: 0, passDur: 0, passFromPos: { x: 0, y: 0, z: 0 }, passToPos: { x: 0, y: 0, z: 0 },
      shooter: -1, shotX: 0, shotZ: 0, shotT: 0, resolveT: 0, willMake: false, wentHigh: false,
      lastTouch: 0, looseT: 0, intercepted: new Set()
    };
    this.setupCheck(this.rules.offense);
  }

  /* ---------------- queries ---------------- */

  get offense(): Team { return this.rules.offense; }
  teamOf(id: number): SimPlayer[] { return this.players.filter(p => p.team === this.players[id].team); }
  teammates(p: SimPlayer): SimPlayer[] { return this.players.filter(q => q.team === p.team && q.id !== p.id); }
  opponents(p: SimPlayer): SimPlayer[] { return this.players.filter(q => q.team !== p.team); }
  /** The player `p` guards (and who guards `p`). */
  man(p: SimPlayer): SimPlayer { return this.players[(p.id + 3) % 6]; }
  holder(): SimPlayer | null { return this.ball.state === 'held' ? this.players[this.ball.holder] : null; }
  hoopDist(p: { x: number; z: number }): number { return Math.hypot(p.x - HOOP_CENTER.x, p.z - HOOP_CENTER.z); }
  /** Distance to the nearest opponent. */
  openness(p: SimPlayer): number {
    let d = 9;
    for (const q of this.opponents(p)) d = Math.min(d, Math.hypot(q.x - p.x, q.z - p.z));
    return d;
  }
  /** Is the straight line from a to b free of opponents of `team` (within `r`)? */
  laneClear(ax: number, az: number, bx: number, bz: number, team: Team, r = 0.7): boolean {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    for (const q of this.players) {
      if (q.team === team) continue;
      const k = clamp(((q.x - ax) * dx + (q.z - az) * dz) / L2, 0, 1);
      if (Math.hypot(ax + dx * k - q.x, az + dz * k - q.z) < r) return false;
    }
    return true;
  }
  airborne(p: SimPlayer): boolean { return p.jumpT >= 0; }

  /* ---------------- set pieces ---------------- */

  private setupCheck(team: Team): void {
    this.phase = 'check';
    this.phaseT = 0;
    this.outPending = null;
    const off = this.players.filter(p => p.team === team), def = this.players.filter(p => p.team !== team);
    off.forEach((p, i) => { const [x, z] = SPOTS[i]; this.place(p, x, z + (i === 0 ? 0.3 : 0)); });
    def.forEach(p => {
      const m = this.man(p);
      const dx = HOOP_CENTER.x - m.x, dz = HOOP_CENTER.z - m.z, d = Math.hypot(dx, dz) || 1;
      this.place(p, m.x + dx / d * 1.3, m.z + dz / d * 1.3);
    });
    const checker = off[0];
    this.giveBall(checker);
    this.rules.check();
    this.events.check?.(team);
  }

  private place(p: SimPlayer, x: number, z: number): void {
    p.x = x; p.z = z; p.vx = 0; p.vz = 0; p.wantX = x; p.wantZ = z;
    p.facing = Math.atan2(HOOP_CENTER.x - x, HOOP_CENTER.z - z);
    p.action = 'idle'; p.actionT = 0; p.jumpT = -1;
    p.brain.reset();
  }

  private giveBall(p: SimPlayer): void {
    const b = this.ball;
    // whoever had it can't be stuck winding up a shot without the ball
    if (b.state === 'held' && b.holder !== p.id) { const prev = this.players[b.holder]; if (prev.action === 'set') prev.action = 'idle'; }
    b.state = 'held'; b.holder = p.id; b.lastTouch = p.team;
    b.x = p.x; b.y = 1; b.z = p.z; b.vx = b.vy = b.vz = 0;
  }

  /* ---------------- actions (AI and human) ---------------- */

  /** Begin a shot windup (the AI's "set"); the brain calls shoot() when it ends. */
  setShot(p: SimPlayer): void { if (this.holder() === p && p.action !== 'set') { p.action = 'set'; p.actionT = 0; } }

  /** Release a shot. `input`/`assist` for humans; the AI's own errors otherwise. */
  shoot(p: SimPlayer, input?: ShotInput, assist: ShotAssist = 0): SimShot | null {
    if (this.phase !== 'live' || this.holder() !== p) return null;
    const b = this.ball;
    const dx = HOOP_CENTER.x - p.x, dz = HOOP_CENTER.z - p.z, d = Math.hypot(dx, dz) || 1;
    const from: V3 = { x: p.x + dx / d * 0.22, y: RELEASE_HEIGHT + BB_TUNING.jumpHeight, z: p.z + dz / d * 0.22 };
    const value = PickupScore.value(p.x, p.z);
    p.action = 'shoot'; p.actionT = 0;
    if (p.jumpT < 0) p.jumpT = 0;
    this.stats[p.id].attempts += 1;
    b.shooter = p.id; b.shotX = p.x; b.shotZ = p.z; b.shotT = this.time; b.lastTouch = p.team;
    b.wentHigh = false;
    // a defender already in the air in front of the shooter can block it
    for (const q of this.opponents(p)) {
      if (!this.airborne(q) || q.jumpT > 0.42) continue;
      const dist = Math.hypot(q.x - p.x, q.z - p.z);
      if (dist > BB_TUNING.blockRange) continue;
      const front = ((q.x - p.x) * dx + (q.z - p.z) * dz) / d > -0.2;
      const chance = AI_DIFFICULTY[q.diff].blockChance * (1 - dist / BB_TUNING.blockRange) * (front ? 1 : 0.3) * (q.human ? 1.15 : 1);
      if (this.rng.next() < chance) return this.blocked(q, p, from, value, input ?? { powerErr: 0, dirErrDeg: 0, timingMs: 0 });
    }
    const ai = AI_DIFFICULTY[p.diff];
    const inp = input ?? p.brain.shotInput(this.hoopDist(p));
    const open = this.openness(p);
    const extra = BB_TUNING.contestErr * clamp(1 - (open - 0.6) / 1.6, 0, 1) + BB_TUNING.distErr * Math.max(0, d - 4);
    const ideal = solveIdealShot(from);
    const applied = applyError(ideal, inp, p.human ? assist : 0, extra * (p.human ? 1 : ai.contestScale), this.rng);
    b.state = 'shot';
    b.x = from.x; b.y = from.y; b.z = from.z;
    b.vx = applied.vel.x; b.vy = applied.vel.y; b.vz = applied.vel.z;
    if (!this.external) {
      const pr = predictOutcome(from, applied.vel);
      b.willMake = isMake(pr.outcome);
      b.resolveT = this.time + pr.t;
      if (b.willMake && pr.outcome === 'swish') this.pendingSwish = true; else this.pendingSwish = false;
    }
    const shot: SimShot = { shooter: p.id, from, vel: applied.vel, spin: applied.spin, blocked: false, input: inp, value };
    this.events.shot?.(shot);
    return shot;
  }
  private pendingSwish = false;

  private blocked(q: SimPlayer, p: SimPlayer, from: V3, value: 1 | 2, input: ShotInput): SimShot {
    const b = this.ball;
    this.stats[q.id].blocks += 1;
    const a = this.rng.signed() * Math.PI;
    const vel = { x: Math.sin(a) * 3.5, y: 1.5 + this.rng.next() * 2, z: Math.cos(a) * 3.5 };
    b.state = 'loose'; b.looseT = 0; b.lastTouch = q.team;
    b.x = from.x; b.y = from.y; b.z = from.z; b.vx = vel.x; b.vy = vel.y; b.vz = vel.z;
    this.events.block?.(q.id, p.id);
    const shot: SimShot = { shooter: p.id, from, vel, spin: { x: 0, y: 0, z: 0 }, blocked: true, input, value };
    this.events.shot?.(shot);
    return shot;
  }

  pass(p: SimPlayer, to: SimPlayer): boolean {
    if (this.phase !== 'live' || this.holder() !== p || to.team !== p.team || to.id === p.id) return false;
    const b = this.ball;
    const lead = 0.35;
    const tx = to.x + to.vx * lead, tz = to.z + to.vz * lead;
    const dist = Math.hypot(tx - p.x, tz - p.z);
    b.state = 'pass'; b.passFrom = p.id; b.passTo = to.id; b.passT = 0;
    b.passDur = Math.max(0.2, dist / BB_TUNING.passSpeed);
    b.passFromPos = { x: p.x, y: 1.25, z: p.z }; b.passToPos = { x: tx, y: 1.2, z: tz };
    b.intercepted.clear();
    b.lastTouch = p.team;
    p.action = 'pass'; p.actionT = 0;
    this.lastPass = { from: p.id, to: to.id, t: this.time };
    this.events.pass?.(p.id, to.id);
    return true;
  }

  /** A swipe at the ball handler. */
  steal(p: SimPlayer): boolean {
    if (this.phase !== 'live' || p.stealCd > 0) return false;
    p.action = 'steal'; p.actionT = 0;
    p.stealCd = 1.0;
    const h = this.holder();
    if (!h || h.team === p.team || h.action === 'shoot') return false;
    const d = Math.hypot(h.x - p.x, h.z - p.z);
    if (d > BB_TUNING.stealRange) return false;
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    const facing = clamp(((h.x - p.x) * fx + (h.z - p.z) * fz) / (d || 1), 0, 1);
    const base = AI_DIFFICULTY[p.diff].stealChance * (p.human ? 1.1 : 1);
    const chance = base * (1 - 0.6 * d / BB_TUNING.stealRange) * (0.35 + 0.65 * facing) * (h.action === 'set' ? 1.3 : 1);
    if (this.rng.next() >= chance) return false;
    this.stats[p.id].steals += 1;
    this.giveBall(p);
    this.rules.changePossession(p.team);
    this.lastPass = null;
    this.events.steal?.(p.id, h.id);
    this.events.possession?.(p.team, 'steal');
    return true;
  }

  /** Jump to block or contest. A shot released a moment ago can still be swatted. */
  block(p: SimPlayer): void {
    if (this.airborne(p) || this.phase !== 'live') return;
    p.jumpT = 0; p.action = 'block'; p.actionT = 0;
    const b = this.ball;
    if (b.state === 'shot' && this.time - b.shotT < 0.16) {
      const s = this.players[b.shooter];
      if (s.team === p.team) return;
      const dist = Math.hypot(s.x - p.x, s.z - p.z);
      if (dist > BB_TUNING.blockRange * 0.85) return;
      const chance = AI_DIFFICULTY[p.diff].blockChance * 0.7 * (1 - dist / BB_TUNING.blockRange) * (p.human ? 1.15 : 1);
      if (this.rng.next() >= chance) return;
      this.stats[p.id].blocks += 1;
      const a = this.rng.signed() * Math.PI;
      b.state = 'loose'; b.looseT = 0; b.lastTouch = p.team;
      b.vx = Math.sin(a) * 3; b.vy = 1 + this.rng.next() * 1.5; b.vz = Math.cos(a) * 3;
      this.events.block?.(p.id, s.id);
      this.events.deflect?.({ x: b.x, y: b.y, z: b.z }, { x: b.vx, y: b.vy, z: b.vz });
    }
  }

  /* ---------------- the game: external ball (Rapier) ---------------- */

  /** Game: where Rapier has the ball while it flies or rolls. */
  externalBall(p: V3, v: V3): void {
    const b = this.ball;
    if (b.state !== 'shot' && b.state !== 'loose') return;
    b.x = p.x; b.y = p.y; b.z = p.z; b.vx = v.x; b.vy = v.y; b.vz = v.z;
  }

  /** Game: Rapier's basket sensor fired for the shot in the air. */
  externalBasket(swish: boolean): void {
    if (this.ball.state === 'shot' || this.ball.state === 'loose') this.madeBasket(swish);
  }

  /* ---------------- stepping ---------------- */

  step(dt: number): void {
    this.time += dt;
    this.phaseT += dt;
    for (const p of this.players) {
      p.actionT += dt;
      if (p.jumpT >= 0) { p.jumpT += dt; if (p.jumpT > JUMP_TIME) p.jumpT = -1; }
      p.stealCd = Math.max(0, p.stealCd - dt);
      if ((p.action === 'pass' && p.actionT > 0.45) || (p.action === 'steal' && p.actionT > 0.5) || (p.action === 'block' && p.actionT > 0.75) || (p.action === 'shoot' && p.actionT > 0.95)) p.action = 'idle';
    }

    if (this.phase === 'over') { this.move(dt); return; }
    if (this.phase === 'dead') {
      this.move(dt);
      if (this.phaseT > (this.outPending !== null ? 0.8 : DEAD_TIME)) this.setupCheck(this.rules.offense);
      return;
    }
    if (this.phase === 'check') {
      if (this.phaseT > CHECK_TIME) { this.phase = 'live'; this.phaseT = 0; }
      for (const p of this.players) if (!p.human) p.brain.think(this, p, dt);
      this.move(dt * 0.4);
      this.syncHeld();
      return;
    }

    // live
    for (const p of this.players) if (!p.human) p.brain.think(this, p, dt);
    this.move(dt);
    this.updateBall(dt);
  }

  /** Steering with arrival and separation; humans steer by their stick. */
  private move(dt: number): void {
    const T = BB_TUNING;
    for (const p of this.players) {
      const fixed = p.action === 'set' || p.action === 'shoot' || p.action === 'celebrate' || p.action === 'sad';
      let dvx = 0, dvz = 0;
      const speed = (p.sprint ? T.sprintSpeed : T.moveSpeed) * (p.human ? 1 : AI_DIFFICULTY[p.diff].speed) * (this.holder() === p ? 0.88 : 1);
      if (!fixed) {
        if (p.human) {
          const m = Math.min(1, Math.hypot(p.moveX, p.moveZ));
          const l = Math.hypot(p.moveX, p.moveZ) || 1;
          dvx = p.moveX / l * speed * m; dvz = p.moveZ / l * speed * m;
        } else {
          const dx = p.wantX - p.x, dz = p.wantZ - p.z, d = Math.hypot(dx, dz);
          if (d > 0.05) { const s = Math.min(speed, d * 3); dvx = dx / d * s; dvz = dz / d * s; }
        }
        // separation: don't stack on top of each other
        for (const q of this.players) {
          if (q === p) continue;
          const sx = p.x - q.x, sz = p.z - q.z, sd = Math.hypot(sx, sz);
          if (sd < 0.85 && sd > 1e-4) { const k = (0.85 - sd) / 0.85 * 3.2; dvx += sx / sd * k; dvz += sz / sd * k; }
        }
      }
      const ax = clamp(dvx - p.vx, -T.accel * dt, T.accel * dt), az = clamp(dvz - p.vz, -T.accel * dt, T.accel * dt);
      p.vx += ax; p.vz += az;
      if (fixed) { p.vx *= 0.8; p.vz *= 0.8; }
      p.x = clamp(p.x + p.vx * dt, -COURT.halfWidth + 0.3, COURT.halfWidth - 0.3);
      p.z = clamp(p.z + p.vz * dt, COURT.baselineZ + 0.3, COURT.halfCourtZ - 0.3);
      // don't stand inside the pole / under the board
      if (p.z < -0.2 && Math.abs(p.x) < 0.7) p.z = -0.2;
      // face the way you move, or the hoop / the ball when standing
      const sp = Math.hypot(p.vx, p.vz);
      let look: number;
      if (p.action === 'set' || p.action === 'shoot') look = Math.atan2(HOOP_CENTER.x - p.x, HOOP_CENTER.z - p.z);
      else if (p.team !== this.offense) look = Math.atan2(this.ball.x - p.x, this.ball.z - p.z);
      else if (sp > 0.6) look = Math.atan2(p.vx, p.vz);
      else look = Math.atan2(HOOP_CENTER.x - p.x, HOOP_CENTER.z - p.z);
      let d = look - p.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      p.facing += clamp(d, -10 * dt, 10 * dt);
    }
  }

  private syncHeld(): void {
    const h = this.holder();
    if (!h) return;
    this.ball.x = h.x + Math.sin(h.facing) * 0.3; this.ball.z = h.z + Math.cos(h.facing) * 0.3; this.ball.y = 0.9;
  }

  private updateBall(dt: number): void {
    const b = this.ball;
    switch (b.state) {
      case 'held': {
        const h = this.players[b.holder];
        this.syncHeld();
        if (h.team === this.offense) this.rules.carry(h.x, h.z);
        break;
      }
      case 'pass': {
        b.passT += dt;
        const k = clamp(b.passT / b.passDur, 0, 1);
        b.x = b.passFromPos.x + (b.passToPos.x - b.passFromPos.x) * k;
        b.z = b.passFromPos.z + (b.passToPos.z - b.passFromPos.z) * k;
        b.y = b.passFromPos.y + (b.passToPos.y - b.passFromPos.y) * k + Math.sin(k * Math.PI) * 0.35;
        // interceptions
        for (const q of this.players) {
          if (q.team === b.lastTouch || b.intercepted.has(q.id)) continue;
          if (Math.hypot(q.x - b.x, q.z - b.z) < 0.6 && b.y < 2.1) {
            b.intercepted.add(q.id);
            if (this.rng.next() < AI_DIFFICULTY[q.diff].intercept * (q.human ? 1.1 : 1)) {
              this.stats[q.id].steals += 1;
              const from = this.players[b.passFrom];
              this.giveBall(q);
              this.rules.changePossession(q.team);
              this.lastPass = null;
              this.events.steal?.(q.id, from.id);
              this.events.possession?.(q.team, 'interception');
              return;
            }
          }
        }
        if (k >= 1) {
          const to = this.players[b.passTo];
          if (Math.hypot(to.x - b.x, to.z - b.z) < 1.1) this.giveBall(to);
          else { b.state = 'loose'; b.looseT = 0; b.vx = (b.passToPos.x - b.passFromPos.x) / b.passDur * 0.5; b.vz = (b.passToPos.z - b.passFromPos.z) / b.passDur * 0.5; b.vy = 0; }
        }
        break;
      }
      case 'shot': {
        if (!this.external) {
          b.vy -= G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          if (this.time >= b.resolveT) {
            if (b.willMake) { this.madeBasket(this.pendingSwish); return; }
            this.rimOut();
          }
        } else {
          if (b.y > HOOP_CENTER.y) b.wentHigh = true;
          // no basket and it came back down: a rebound
          if ((b.wentHigh && b.y < 2.4 && b.vy < 0) || this.time - b.shotT > 4) { b.state = 'loose'; b.looseT = 0; }
        }
        break;
      }
      case 'loose': {
        b.looseT += dt;
        if (!this.external) {
          b.vy -= G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          if (b.y < 0.12) { b.y = 0.12; b.vy = Math.abs(b.vy) > 1 ? -b.vy * 0.7 : 0; b.vx *= 0.85; b.vz *= 0.85; }
          if (b.y <= 0.12 && b.vy === 0) { b.vx *= 1 - 1.2 * dt; b.vz *= 1 - 1.2 * dt; }
        }
        // out of bounds
        if (b.y < 1.2 && (Math.abs(b.x) > COURT.halfWidth || b.z > COURT.halfCourtZ || b.z < COURT.baselineZ)) {
          const to = otherTeam(b.lastTouch);
          if (to !== this.offense) this.rules.changePossession(to);
          this.rules.offense = to;
          this.outPending = to;
          this.phase = 'dead'; this.phaseT = 0;
          this.events.possession?.(to, 'out');
          return;
        }
        // grab it
        let best: SimPlayer | null = null, bd = PICKUP_R;
        for (const p of this.players) {
          const d = Math.hypot(p.x - b.x, p.z - b.z);
          const reach = this.airborne(p) ? 2.6 : 1.7;
          if (d < bd && b.y < reach) { bd = d; best = p; }
        }
        if (!best && b.looseT > 6) best = this.players.reduce((a, p) => (Math.hypot(p.x - b.x, p.z - b.z) < Math.hypot(a.x - b.x, a.z - b.z) ? p : a));
        if (best) {
          const offensive = best.team === this.offense;
          this.giveBall(best);
          if (!offensive) { this.rules.changePossession(best.team); this.events.possession?.(best.team, 'rebound'); }
          this.events.rebound?.(best.id, offensive);
          this.lastPass = null;
        }
        break;
      }
      default: break;
    }
  }

  /** Headless: the ball came off the rim. */
  private rimOut(): void {
    const b = this.ball;
    const a = this.rng.signed() * Math.PI;
    b.x = HOOP_CENTER.x + Math.sin(a) * 0.25; b.z = HOOP_CENTER.z + Math.abs(Math.cos(a)) * 0.25; b.y = HOOP_CENTER.y;
    const sp = 1.5 + this.rng.next() * 2.5;
    b.vx = Math.sin(a) * sp; b.vz = Math.abs(Math.cos(a)) * sp + 0.5; b.vy = 1 + this.rng.next() * 2;
    b.state = 'loose'; b.looseT = 0;
  }

  private madeBasket(swish: boolean): void {
    const b = this.ball;
    const shooter = this.players[b.shooter];
    const team = shooter.team;
    const res = this.rules.basket(team, b.shotX, b.shotZ);
    let assist: number | null = null;
    if (res.counted) {
      this.stats[shooter.id].points += res.points;
      this.stats[shooter.id].makes += 1;
      if (swish) this.stats[shooter.id].swishes += 1;
      const lp = this.lastPass;
      if (lp && lp.to === shooter.id && this.time - lp.t <= 3 && this.players[lp.from].team === team) { assist = lp.from; this.stats[lp.from].assists += 1; }
    }
    this.lastPass = null;
    b.state = 'dead';
    this.events.basket?.({ team, points: res.points, counted: res.counted, shooter: shooter.id, assist, winner: res.winner });
    this.events.possession?.(res.nextOffense, res.counted ? 'basket' : 'noClear');
    for (const p of this.players) { if (p.action !== 'shoot') { p.action = res.counted ? (p.team === team ? 'celebrate' : 'sad') : 'idle'; p.actionT = 0; } }
    this.phase = res.winner !== null ? 'over' : 'dead';
    this.phaseT = 0;
  }

  /** Is (x, z) a 2-point spot? */
  static outside(x: number, z: number): boolean { return isOutsideArc(x, z); }
}

/** Play a whole headless game; returns the winner and the score. Deterministic for a seed. */
export function simulateGame(home: Difficulty, away: Difficulty, seed: number, target = 11): { winner: Team | null; points: [number, number]; time: number } {
  const sim = new PickupSim({ target, difficulty: [home, away], seed, firstOffense: (seed % 2) as Team });
  const dt = 1 / 60;
  while (sim.phase !== 'over' && sim.time < 1800) sim.step(dt);
  return { winner: sim.rules.winner, points: [...sim.rules.points] as [number, number], time: sim.time };
}

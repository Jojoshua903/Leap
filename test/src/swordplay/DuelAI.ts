import { Rng } from '../tabletennis/BallPhysics';
import type { GuardZone } from './SlashDetector';
import { SW_TUNING } from './swordTuning';
import {
  DUEL, bestGuard, canAct, covers, matchWinner, newFighter, resolve, roundWinner, setGuard, tickFighter, tryDodge,
  type Attack, type Fighter, type Resolution
} from './DuelRules';
import { DIRS, dirVec } from './swMath';

/**
 * Duel AI, levels 1–5. Seeded, so a duel can be replayed exactly. Every attack is telegraphed (a visible
 * wind-up of at least 0.4 s), so even level 5 can be read and parried.
 *
 *   reaction   seconds from seeing an attack start to moving the guard
 *   attackGap  mean seconds between its own attacks (÷ aggression)
 *   windup     telegraph time of its slashes
 *   guardAcc   chance it picks the right guard (and aims where you are open)
 *   feint      chance an attack is a feint: the wind-up switches direction part-way
 *   parry      chance it times the guard into a parry when it can
 *   dodge      chance it dodges a thrust instead of guarding
 *   power / straight  how hard its hits are
 */
export interface AILevel {
  reaction: number; attackGap: number; windup: number; guardAcc: number; feint: number; parry: number;
  aggression: number; dodge: number; power: number; straight: number;
}

export const AI_LEVELS: readonly AILevel[] = [
  { reaction: 0.55, attackGap: 2.6, windup: 0.75, guardAcc: 0.35, feint: 0, parry: 0, aggression: 0.6, dodge: 0, power: 0.3, straight: 0.5 },
  { reaction: 0.42, attackGap: 2.1, windup: 0.65, guardAcc: 0.5, feint: 0, parry: 0.05, aggression: 0.75, dodge: 0.1, power: 0.45, straight: 0.6 },
  { reaction: 0.32, attackGap: 1.7, windup: 0.56, guardAcc: 0.65, feint: 0.1, parry: 0.15, aggression: 0.9, dodge: 0.2, power: 0.55, straight: 0.7 },
  { reaction: 0.24, attackGap: 1.4, windup: 0.48, guardAcc: 0.8, feint: 0.2, parry: 0.3, aggression: 1.05, dodge: 0.3, power: 0.7, straight: 0.8 },
  { reaction: 0.17, attackGap: 1.15, windup: 0.42, guardAcc: 0.9, feint: 0.3, parry: 0.45, aggression: 1.2, dodge: 0.4, power: 0.8, straight: 0.9 }
];

export const levelOf = (n: number): AILevel => AI_LEVELS[Math.max(1, Math.min(5, Math.round(n))) - 1];

/** An attack on its way: started (visible) at `start`, lands at `land`. Feints never land. */
export interface Pending { attack: Attack; start: number; land: number; feint: boolean; switchAt: number }

/** What the AI sees of the other fighter's attack. `land` is unknown for a live player slash. */
export interface Incoming { attack: Attack; start: number; land: number | null }

export interface AIOutput {
  guard: GuardZone | null;
  attack: Pending | null;
  dodge: boolean;
}

export type AIState = 'idle' | 'guard' | 'react' | 'windup' | 'feint' | 'punish' | 'stunned';

const ZONES: readonly GuardZone[] = ['high', 'low', 'left', 'right', 'mid'];
const REST: readonly GuardZone[] = ['high', 'left', 'right'];

export class DuelAI {
  readonly p: AILevel;
  state: AIState = 'idle';
  private readonly rng: Rng;
  private nextAttack = 0;
  private rest: GuardZone = 'high';
  private restUntil = 0;
  private seen: Incoming | null = null;
  private plan: { at: number; zone: GuardZone | null; dodge: boolean } | null = null;
  private wantGuard: GuardZone | null = null;
  /** Its own attack in progress (the duel shows its wind-up). */
  pending: Pending | null = null;

  constructor(readonly level: number, seed: number) {
    this.p = levelOf(level);
    this.rng = new Rng(seed);
    this.nextAttack = 1 + this.rng.next() * 1.5;
  }

  private get reaction(): number { return this.p.reaction * SW_TUNING.aiReactionScale; }

  /** Pick an attack: higher levels aim where the guard is not, and thrust at a guard held too long. */
  private chooseAttack(foe: Fighter, now: number): Attack {
    const p = this.p;
    const longGuard = foe.guard !== null && now - foe.guardSince > DUEL.guardBreakAfter - 0.3;
    if ((longGuard && this.rng.next() < p.guardAcc) || this.rng.next() < 0.12) {
      return { kind: 'thrust', dx: 0, dy: 0, power: p.power, straight: p.straight };
    }
    for (let i = 0; i < 6; i++) {
      const d = dirVec(DIRS[Math.floor(this.rng.next() * 8)]);
      const a: Attack = { kind: 'slash', dx: d.x, dy: d.y, power: p.power, straight: p.straight };
      if (!covers(foe.guard, a) || this.rng.next() > p.guardAcc) return a;
    }
    const d = dirVec(DIRS[Math.floor(this.rng.next() * 8)]);
    return { kind: 'slash', dx: d.x, dy: d.y, power: p.power, straight: p.straight };
  }

  private startAttack(foe: Fighter, now: number, windupScale = 1): Pending {
    const a = this.chooseAttack(foe, now);
    const w = Math.max(0.4, (a.kind === 'thrust' ? Math.max(this.p.windup, DUEL.thrustWindup) + 0.12 : this.p.windup) * windupScale);
    const feint = a.kind === 'slash' && this.rng.next() < this.p.feint;
    return { attack: a, start: now, land: now + w, feint, switchAt: feint ? now + w * 0.55 : Infinity };
  }

  /** One decision step. `incoming` = the other fighter's attack in progress, if any. */
  update(now: number, me: Fighter, foe: Fighter, incoming: Incoming | null): AIOutput {
    const out: AIOutput = { guard: this.wantGuard, attack: null, dodge: false };
    if (!canAct(me)) {
      this.state = 'stunned'; this.pending = null; this.plan = null; this.seen = null;
      out.guard = null;
      return out;
    }

    // a feint switches to a real attack in another direction part-way through the wind-up
    if (this.pending && now >= this.pending.switchAt) {
      const old = this.pending.attack;
      let next = this.startAttack(foe, now, 0.7);
      for (let i = 0; i < 4 && next.attack.kind === 'slash' && Math.sign(next.attack.dx) === Math.sign(old.dx) && Math.sign(next.attack.dy) === Math.sign(old.dy); i++) next = this.startAttack(foe, now, 0.7);
      next.feint = false; next.switchAt = Infinity;
      this.pending = next;
      this.state = 'feint';
      out.attack = next;
      return out;
    }
    if (this.pending) {
      if (now >= this.pending.land) this.pending = null;
      else { this.state = 'windup'; out.guard = null; return out; }
    }

    // defend: notice a new attack, then react after the reaction time
    if (incoming && (!this.seen || this.seen.start !== incoming.start || this.seen.attack !== incoming.attack)) {
      this.seen = incoming;
      const p = this.p;
      const right = this.rng.next() < p.guardAcc;
      const want = bestGuard(incoming.attack);
      const wrong = ZONES.filter(z => z !== want && !covers(z, incoming.attack));
      const zone = right ? want : wrong[Math.floor(this.rng.next() * wrong.length)] ?? 'mid';
      const dodge = incoming.attack.kind === 'thrust' && this.rng.next() < p.dodge;
      let at = incoming.start + this.reaction;
      // a parry: hold the guard back so it goes up just before the hit
      if (right && !dodge && incoming.land !== null && this.rng.next() < p.parry) at = Math.max(at, incoming.land - DUEL.parryWindow * 0.6);
      this.plan = { at, zone, dodge };
    }
    if (!incoming) { this.seen = null; this.plan = null; }
    if (this.plan && now >= this.plan.at) {
      if (this.plan.dodge) out.dodge = true;
      else this.wantGuard = this.plan.zone;
      this.plan = null;
      this.state = 'react';
      out.guard = this.wantGuard;
      return out;
    }
    if (incoming) { out.guard = this.wantGuard; this.state = 'react'; return out; }

    // the opponent is open: punish at once
    if (foe.staggered > 0.3 && foe.hp > 0) {
      this.pending = this.startAttack(foe, now, 0.6);
      this.pending.feint = false; this.pending.switchAt = Infinity;
      this.state = 'punish';
      out.attack = this.pending;
      out.guard = null;
      this.nextAttack = now + this.gap();
      return out;
    }

    if (now >= this.nextAttack) {
      this.pending = this.startAttack(foe, now);
      this.nextAttack = this.pending.land + this.gap();
      this.state = 'windup';
      out.attack = this.pending;
      out.guard = null;
      return out;
    }

    // resting guard, changed now and then so a thrust can't simply break it
    if (now >= this.restUntil || this.wantGuard === null) {
      this.rest = REST[Math.floor(this.rng.next() * REST.length)];
      this.restUntil = now + 0.6 + this.rng.next() * 0.8;
      this.wantGuard = this.rest;
    }
    this.state = 'guard';
    out.guard = this.wantGuard;
    return out;
  }

  private gap(): number { return this.p.attackGap * (0.6 + 0.8 * this.rng.next()) / (this.p.aggression * SW_TUNING.aiAggression); }

  /** The duel calls this after a round: forget plans. */
  reset(now: number): void {
    this.pending = null; this.plan = null; this.seen = null; this.wantGuard = null;
    this.nextAttack = now + 1 + this.rng.next();
    this.state = 'idle';
  }
}

/* ---------------- headless duel (tests, balancing) ---------------- */

export interface SimResult { winner: 0 | 1; rounds: number; wins: [number, number]; time: number; log: Resolution[] }

/** Two AIs fight a best-of-3 at 60 Hz. Deterministic for a seed. */
export function simulateDuel(levelA: number, levelB: number, seed: number, maxRounds = 9): SimResult {
  const ais = [new DuelAI(levelA, seed * 2 + 1), new DuelAI(levelB, seed * 2 + 2)];
  const wins: [number, number] = [0, 0];
  const log: Resolution[] = [];
  const dt = 1 / 60;
  let now = 0, rounds = 0;
  while (matchWinner(wins) === null && rounds < maxRounds) {
    rounds += 1;
    const f: [Fighter, Fighter] = [newFighter(), newFighter()];
    const pend: [Pending | null, Pending | null] = [null, null];
    ais.forEach(a => a.reset(now));
    const start = now;
    let w: 0 | 1 | -1 | null = null;
    while (w === null) {
      now += dt;
      tickFighter(f[0], dt); tickFighter(f[1], dt);
      // land what is due first, so a new attack can never replace one that hasn't been resolved
      for (const i of [0, 1] as const) {
        const p = pend[i];
        if (!p) continue;
        if (f[i].staggered > 0) { pend[i] = null; continue; }
        if (now >= p.land && !p.feint) {
          log.push(resolve(f[i], f[i === 0 ? 1 : 0], p.attack, now));
          pend[i] = null;
        }
      }
      for (const i of [0, 1] as const) {
        const j = i === 0 ? 1 : 0;
        const inc: Incoming | null = pend[j] ? { attack: pend[j]!.attack, start: pend[j]!.start, land: pend[j]!.land } : null;
        const o = ais[i].update(now, f[i], f[j], inc);
        if (o.dodge) tryDodge(f[i]);
        setGuard(f[i], o.attack || ais[i].pending ? null : o.guard, now);
        if (o.attack) pend[i] = o.attack;
      }
      w = roundWinner(f[0], f[1], now - start);
    }
    // a dead heat is replayed; after too many, the fighter with more HP over the match takes it
    if (w === -1) {
      if (rounds < maxRounds) continue;
      w = f[0].hp >= f[1].hp ? 0 : 1;
    }
    wins[w] += 1;
  }
  const winner = matchWinner(wins) ?? (wins[0] >= wins[1] ? 0 : 1);
  return { winner, rounds, wins, time: now, log };
}

import type { GuardZone } from './SlashDetector';
import { clamp } from './swMath';

/**
 * Duel rules (pure; seconds everywhere). Two fighters face each other; one attack at a time is resolved
 * against the defender's state at the moment it lands.
 *
 * Directions: an attack is the blade's movement (dx, dy) as the ATTACKER sees it (x = their right, y up).
 * Seen by the defender it arrives FROM (dx, −dy): a slash to the attacker's right starts on the
 * attacker's left, which is the defender's right; an upward slash comes from below.
 * Guard zones cover the side the blade comes from: high = from above, low = from below, left / right =
 * from that side (diagonals are covered by either of their two zones), mid = thrusts. A thrust breaks any
 * guard held longer than guardBreakAfter.
 */
export const DUEL = {
  hp: 100,
  dmgMin: 10,
  dmgMax: 25,
  /** Stagger meter (0..100) added to an attacker whose slash is blocked: base + per power. */
  blockStagger: 25,
  blockStaggerPower: 20,
  /** A guard put up this soon before the hit is a parry. */
  parryWindow: 0.15,
  staggerTime: 0.8,
  invulnTime: 0.4,
  /** A thrust breaks a guard that has been held this long. */
  guardBreakAfter: 1.5,
  /** A thrust needs this long from start to landing (it is slow and shown). */
  thrustWindup: 0.35,
  dodgeTime: 0.35,
  dodgeCooldown: 0.7,
  roundTime: 90,
  roundsToWin: 2,
  /** Stagger meter drains this much per second. */
  staggerDrain: 12
} as const;

export interface Attack {
  kind: 'slash' | 'thrust';
  /** Blade movement as the attacker sees it (unit-ish). Ignored for thrusts. */
  dx: number;
  dy: number;
  power: number;
  straight: number;
}

export interface Fighter {
  hp: number;
  /** 0..100; at 100 the fighter is staggered and it resets. */
  meter: number;
  /** Seconds left staggered (no guard, no attacks). */
  staggered: number;
  invuln: number;
  guard: GuardZone | null;
  /** When the current guard went up (seconds, match clock). */
  guardSince: number;
  dodging: number;
  dodgeCd: number;
  /** After being parried the opponent's next hit is free (lands whatever the guard). */
  open: boolean;
  /** Counters for stats. */
  hits: number;
  blocks: number;
  parries: number;
  damageTaken: number;
}

export const newFighter = (): Fighter => ({
  hp: DUEL.hp, meter: 0, staggered: 0, invuln: 0, guard: null, guardSince: 0, dodging: 0, dodgeCd: 0, open: false,
  hits: 0, blocks: 0, parries: 0, damageTaken: 0
});

export type Outcome = 'hit' | 'block' | 'parry' | 'dodge' | 'guardBreak' | 'invuln' | 'stagger';

export interface Resolution {
  outcome: Outcome;
  damage: number;
  /** The attacker got staggered by this (a parry, or a full meter from blocks). */
  attackerStaggered: boolean;
  defenderStaggered: boolean;
}

/** Where an attack comes from as the defender sees it. */
export const arrivalOf = (a: Attack): { x: number; y: number } => ({ x: a.dx, y: -a.dy });

/** Does a guard zone cover this attack? */
export function covers(zone: GuardZone | null, a: Attack): boolean {
  if (!zone) return false;
  if (a.kind === 'thrust') return zone === 'mid';
  const r = arrivalOf(a), L = Math.hypot(r.x, r.y) || 1, x = r.x / L, y = r.y / L;
  switch (zone) {
    case 'high': return y > 0.5;
    case 'low': return y < -0.5;
    case 'right': return x > 0.5;
    case 'left': return x < -0.5;
    case 'mid': return false;
  }
}

/** The guard that best covers an attack (what a perfect defender would hold). */
export function bestGuard(a: Attack): GuardZone {
  if (a.kind === 'thrust') return 'mid';
  const r = arrivalOf(a);
  if (Math.abs(r.y) >= Math.abs(r.x)) return r.y > 0 ? 'high' : 'low';
  return r.x > 0 ? 'right' : 'left';
}

export const damageFor = (power: number, straight: number): number =>
  Math.round(DUEL.dmgMin + (DUEL.dmgMax - DUEL.dmgMin) * (0.6 * clamp(power, 0, 1) + 0.4 * clamp(straight, 0, 1)));

/** Put up (or drop) a guard at match time `now`. Staggered fighters can't guard. */
export function setGuard(f: Fighter, zone: GuardZone | null, now: number): void {
  if (f.staggered > 0) zone = null;
  if (zone === f.guard) return;
  f.guard = zone;
  f.guardSince = now;
}

export function canAct(f: Fighter): boolean { return f.staggered <= 0 && f.hp > 0; }

export function tryDodge(f: Fighter): boolean {
  if (!canAct(f) || f.dodgeCd > 0) return false;
  f.dodging = DUEL.dodgeTime;
  f.dodgeCd = DUEL.dodgeTime + DUEL.dodgeCooldown;
  return true;
}

function stagger(f: Fighter): void { f.staggered = DUEL.staggerTime; f.meter = 0; f.guard = null; }

/** Resolve an attack landing now. Mutates both fighters. */
export function resolve(att: Fighter, def: Fighter, a: Attack, now: number): Resolution {
  const res = (outcome: Outcome, damage = 0, attackerStaggered = false, defenderStaggered = false): Resolution =>
    ({ outcome, damage, attackerStaggered, defenderStaggered });
  if (att.staggered > 0) return res('stagger');
  if (def.dodging > 0) return res('dodge');
  if (def.invuln > 0) return res('invuln');
  const free = def.open || def.staggered > 0;
  // a thrust punches through any guard that has been held too long (turtling doesn't work)
  if (!free && a.kind === 'thrust' && def.guard && now - def.guardSince > DUEL.guardBreakAfter) {
    stagger(def);
    const dmg = Math.round(damageFor(a.power, a.straight) / 2);
    hurt(att, def, dmg);
    return res('guardBreak', dmg, false, true);
  }
  if (!free && covers(def.guard, a)) {
    if (now - def.guardSince <= DUEL.parryWindow) {
      stagger(att);
      att.open = true;
      def.parries += 1;
      return res('parry', 0, true);
    }
    def.blocks += 1;
    att.meter += DUEL.blockStagger + DUEL.blockStaggerPower * clamp(a.power, 0, 1);
    if (att.meter >= 100) { stagger(att); return res('block', 0, true); }
    return res('block');
  }
  const dmg = damageFor(a.power, a.straight);
  def.open = false;
  hurt(att, def, dmg);
  return res('hit', dmg);
}

function hurt(att: Fighter, def: Fighter, dmg: number): void {
  def.hp = Math.max(0, def.hp - dmg);
  def.invuln = DUEL.invulnTime;
  def.damageTaken += dmg;
  att.hits += 1;
}

/** Advance timers by dt seconds. */
export function tickFighter(f: Fighter, dt: number): void {
  f.staggered = Math.max(0, f.staggered - dt);
  if (f.staggered <= 0) f.open = false;
  f.invuln = Math.max(0, f.invuln - dt);
  f.dodging = Math.max(0, f.dodging - dt);
  f.dodgeCd = Math.max(0, f.dodgeCd - dt);
  f.meter = Math.max(0, f.meter - DUEL.staggerDrain * dt);
}

/**
 * Who won the round, or null while it is still on. 0 / 1 = fighter index, -1 = a dead heat (equal HP at the
 * bell and equal hits): the round is replayed.
 */
export function roundWinner(a: Fighter, b: Fighter, elapsed: number): 0 | 1 | -1 | null {
  if (a.hp <= 0 && b.hp <= 0) return -1;
  if (b.hp <= 0) return 0;
  if (a.hp <= 0) return 1;
  if (elapsed < DUEL.roundTime) return null;
  if (a.hp !== b.hp) return a.hp > b.hp ? 0 : 1;
  if (a.hits !== b.hits) return a.hits > b.hits ? 0 : 1;
  return -1;
}

/** Best of 3: the match winner once someone has `roundsToWin`, else null. */
export const matchWinner = (wins: [number, number], toWin: number = DUEL.roundsToWin): 0 | 1 | null =>
  wins[0] >= toWin ? 0 : wins[1] >= toWin ? 1 : null;

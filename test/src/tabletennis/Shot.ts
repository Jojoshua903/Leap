import { BallPhysics, Rng, TABLE_HALF_LENGTH, TABLE_HALF_WIDTH, v3, type V3 } from './BallPhysics';
import type { Side } from './Rules';
import { BALL, TABLE, TT_TUNING } from './ttTuning';

/**
 * Shot planning, shared by the assisted player paddle and the AI so both play by the same physics.
 *
 *  1. An intent (where to land, how high the arc, how much spin) is turned into the outgoing ball
 *     velocity by shooting: simulate the real BallPhysics and bisect the horizontal speed until the
 *     first bounce lands on target, then correct the aim once for Magnus curve.
 *  2. `paddleFor` inverts the paddle collision: it finds the face normal and paddle velocity that
 *     produce that outgoing velocity and spin from the incoming ball. The hit itself then goes through
 *     BallPhysics.hitWith, so outgoing = reflection about the face + paddle velocity, and spin comes
 *     from the paddle's tangential (brushing) velocity.
 */
export interface ShotIntent {
  /** Landing point of the first bounce, world x/z. */
  target: { x: number; z: number };
  /** Height of the arc above the table top (m). Below the contact height = a downward hit (smash). */
  apex: number;
  /** + topspin, − backspin (rad/s). */
  top: number;
  /** + curves to the hitter's left (rad/s about the up axis). */
  side: number;
}

export interface ShotPlan {
  vel: V3;
  spin: V3;
  /** First bounce is on the opponent's half. */
  clears: boolean;
  landing: { x: number; z: number } | null;
}

const G = 9.81;
const PLAN_DT = 1 / 120;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Spin vector for a ball travelling along horizontal unit (ux, uz). Topspin axis = up × u = (uz, 0, −ux). */
export function spinVector(ux: number, uz: number, top: number, side: number): V3 {
  return { x: uz * top, y: side, z: -ux * top };
}

/** Where the first contact of a ball launched with (vel, spin) from `from` happens. */
export function firstContact(from: V3, vel: V3, spin: V3, maxT = 2.5): { kind: string; pos: V3; side: 0 | 1 } | null {
  const b = new BallPhysics(new Rng(7));
  b.set(from, vel, spin);
  for (let t = 0; t < maxT; t += PLAN_DT) {
    const cs = b.step(PLAN_DT);
    if (cs.length) return { kind: cs[0].kind, pos: cs[0].pos, side: cs[0].side };
  }
  return null;
}

/**
 * `retries`: if the planned arc doesn't clear the net (or lands on the wrong half), raise the arc
 * by 12 cm and plan again, up to this many times. Careful players retry; sloppy ones don't.
 */
export function planShot(from: V3, intent: ShotIntent, hitter: Side, retries = 3): ShotPlan {
  let plan = planOnce(from, intent, hitter);
  for (let i = 0; i < retries && !plan.clears; i++) {
    intent = { ...intent, apex: intent.apex + 0.12 };
    plan = planOnce(from, intent, hitter);
  }
  return plan;
}

function planOnce(from: V3, intent: ShotIntent, hitter: Side): ShotPlan {
  const tableTop = TABLE.height + BALL.radius;
  const fwd = hitter === 0 ? -1 : 1;                     // the direction toward the opponent in z
  const rise = tableTop + intent.apex - from.y;
  const vy = rise > 0 ? Math.sqrt(2 * G * rise) : -Math.min(6, -rise * 4);
  let aim = { x: intent.target.x, z: intent.target.z };
  let best: ShotPlan = { vel: v3(0, vy, fwd * 6), spin: v3(), clears: false, landing: null };

  for (let pass = 0; pass < 2; pass++) {
    const dx = aim.x - from.x, dz = aim.z - from.z;
    const D = Math.hypot(dx, dz) || 1;
    const ux = dx / D, uz = dz / D;
    const spin = spinVector(ux, uz, intent.top, intent.side);
    let lo = 0.6, hi = 38, h = 6;
    for (let i = 0; i < 13; i++) {
      h = (lo + hi) / 2;
      const c = firstContact(from, { x: ux * h, y: vy, z: uz * h }, spin);
      let reach: number;
      if (!c) reach = D * 2;
      else if (c.kind === 'net' || c.kind === 'netCord' || c.kind === 'post') reach = -1;  // too slow: hit the net
      else reach = (c.pos.x - from.x) * ux + (c.pos.z - from.z) * uz;
      if (reach < D) lo = h; else hi = h;
    }
    const c = firstContact(from, { x: ux * h, y: vy, z: uz * h }, spin);
    const landing = c && c.kind === 'table' ? { x: c.pos.x, z: c.pos.z } : null;
    const clears = !!c && c.kind === 'table' && c.side !== hitter;
    const plan: ShotPlan = { vel: { x: ux * h, y: vy, z: uz * h }, spin, clears, landing };
    // keep the aim-corrected pass only if it is at least as good
    if (pass === 0 || clears || !best.clears) best = plan;
    if (!landing) break;
    // correct the aim by the landing error (mostly Magnus sideways curve)
    aim = { x: aim.x + (intent.target.x - landing.x), z: aim.z + (intent.target.z - landing.z) };
  }
  return best;
}

/**
 * Inverse paddle collision: the face normal n (pointing toward the incoming ball) and paddle velocity
 * that turn (vIn, wIn) into vOut with spin as close to wOut as the rubber's grip allows.
 */
export function paddleFor(vIn: V3, wIn: V3, vOut: V3, wOut: V3, e = TT_TUNING.paddleRestitution): { normal: V3; vel: V3 } {
  const R = BALL.radius;
  const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const norm = (a: V3): V3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

  const dv = sub(vOut, vIn);
  let n = norm(dv);
  let j = v3();
  for (let it = 0; it < 4; it++) {
    const dw = sub(wOut, wIn);
    const dwn = dot(dw, n);
    const dwt = { x: dw.x - dwn * n.x, y: dw.y - dwn * n.y, z: dw.z - dwn * n.z };
    j = cross(n, dwt);
    const k = R / 1.5;
    j = { x: j.x * k, y: j.y * k, z: j.z * k };
    // Coulomb cap: the normal impulse per unit mass is roughly the normal part of dv
    const cap = TT_TUNING.paddleGrip * Math.abs(dot(dv, n));
    const jl = Math.hypot(j.x, j.y, j.z);
    if (jl > cap && jl > 0) { const s = cap / jl; j = { x: j.x * s, y: j.y * s, z: j.z * s }; }
    n = norm(sub(dv, j));
  }
  const vInN = dot(vIn, n), vOutN = dot(vOut, n);
  const vpN = (vOutN + e * vInN) / (1 + e);
  // contact slip needed for impulse j is −2.5 j; slip = v_t,rel + ω × rc with rc = −n R
  const rc = { x: -n.x * R, y: -n.y * R, z: -n.z * R };
  const wr = cross(wIn, rc);
  const vInT = { x: vIn.x - vInN * n.x, y: vIn.y - vInN * n.y, z: vIn.z - vInN * n.z };
  const vtRel = { x: -2.5 * j.x - wr.x, y: -2.5 * j.y - wr.y, z: -2.5 * j.z - wr.z };
  const vpT = sub(vInT, vtRel);
  return { normal: n, vel: { x: vpT.x + vpN * n.x, y: vpT.y + vpN * n.y, z: vpT.z + vpN * n.z } };
}

/** Rotate a unit normal by `ang` radians toward the world-up / sideways mix given by (sx, sy). */
export function tiltNormal(n: V3, ang: number, sx: number, sy: number): V3 {
  const side = { x: -n.z, y: 0, z: n.x };                   // horizontal, perpendicular to n
  const sl = Math.hypot(side.x, side.z) || 1;
  const t = { x: side.x / sl * sx, y: sy, z: side.z / sl * sx };
  const tl = Math.hypot(t.x, t.y, t.z) || 1;
  const c = Math.cos(ang), s = Math.sin(ang);
  const r = { x: n.x * c + t.x / tl * s, y: n.y * c + t.y / tl * s, z: n.z * c + t.z / tl * s };
  const l = Math.hypot(r.x, r.y, r.z) || 1;
  return { x: r.x / l, y: r.y / l, z: r.z / l };
}

/* ---------------- player input → intent ---------------- */

export interface SwingInput {
  /** 0..1 swing strength. */
  power: number;
  /** -1 (hitter's left) .. 1 (hitter's right). */
  direction: number;
  /** 0 = flat drive .. 1 = full lob. */
  loft: number;
  /** -1 full backspin .. 1 full topspin. */
  topspin: number;
  /** -1 .. 1 sidespin. */
  sidespin: number;
}

export type ShotType = 'drive' | 'lob' | 'smash' | 'chop' | 'push' | 'topspin';

/**
 * Map a swing to an intent. Power sets the depth (a full swing can go long), direction the width
 * (full direction can go wide), loft the arc. A high ball hit hard becomes a smash.
 * `assist` (0..1) lifts low arcs so the net is cleared more often.
 */
export function intentFromSwing(sw: SwingInput, contact: V3, hitter: Side, assist = TT_TUNING.netClearAssist): { intent: ShotIntent; type: ShotType } {
  const T = TT_TUNING;
  const fwd = hitter === 0 ? -1 : 1;
  const right = hitter === 0 ? 1 : -1;                    // the hitter's right in world x
  const depth = T.shotDepthMin + (T.shotDepthMax - T.shotDepthMin) * clamp(sw.power, 0, 1.15);
  const target = { x: clamp(sw.direction, -1.2, 1.2) * T.shotWideMax * right, z: fwd * depth };
  const height = contact.y - TABLE.height;
  const smash = height > T.smashHeight && sw.power >= T.smashPower && sw.loft < 0.5;
  const drive = T.driveApex + 0.22 * (1 - clamp(sw.power, 0, 1));
  let apex = smash ? height * 0.3 : drive + (T.lobApex - drive) * clamp(sw.loft, 0, 1);
  // net assist: a low arc from a low contact gets lifted toward a safe minimum
  const safe = TABLE.netHeight + 0.06 + Math.max(0, 0.25 - height) * 0.4;
  if (!smash && apex < safe) apex += (safe - apex) * assist;
  const top = clamp(sw.topspin, -1, 1) * T.topspinMax;
  const side = clamp(sw.sidespin, -1, 1) * T.sidespinMax;
  const type: ShotType = smash ? 'smash' : sw.loft > 0.6 ? 'lob' : top > T.topspinMax * 0.4 ? 'topspin'
    : top < -T.topspinMax * 0.4 ? (sw.power < 0.4 ? 'push' : 'chop') : 'drive';
  return { intent: { target, apex, top: smash ? Math.max(top, 40) : top, side }, type };
}

/** True if a landing point is on the given half (with the ball radius as tolerance on the lines). */
export function onHalf(p: { x: number; z: number }, side: Side): boolean {
  const inX = Math.abs(p.x) <= TABLE_HALF_WIDTH + BALL.radius;
  return inX && (side === 0 ? p.z >= 0 && p.z <= TABLE_HALF_LENGTH : p.z < 0 && p.z >= -TABLE_HALF_LENGTH);
}

/* ---------------- serves ---------------- */

/**
 * A serve must bounce on the server's half, then the receiver's. The serve is hit slightly downward
 * (vy fixed) and the horizontal speed is bisected so the second bounce lands on `target`.
 */
export function planServe(from: V3, target: { x: number; z: number }, server: Side, top: number, side: number, vy = -1.1): ShotPlan {
  const dx = target.x - from.x, dz = target.z - from.z;
  const D = Math.hypot(dx, dz) || 1;
  const ux = dx / D, uz = dz / D;
  const spin = spinVector(ux, uz, top, side);
  const sim = (h: number): { reach: number; landing: { x: number; z: number } | null; legal: boolean } => {
    const b = new BallPhysics(new Rng(11));
    b.set(from, { x: ux * h, y: vy, z: uz * h }, spin);
    const cs: Array<{ kind: string; side: 0 | 1; pos: V3 }> = [];
    for (let t = 0; t < 2.5 && cs.length < 2; t += PLAN_DT) for (const c of b.step(PLAN_DT)) cs.push(c);
    const proj = (p: V3) => (p.x - from.x) * ux + (p.z - from.z) * uz;
    const [c1, c2] = cs;
    if (!c1) return { reach: D * 2, landing: null, legal: false };
    if (c1.kind === 'table' && c1.side !== server) return { reach: D * 2, landing: null, legal: false };   // too fast
    if (c1.kind !== 'table') return { reach: -1, landing: null, legal: false };                            // dropped short
    if (!c2) return { reach: D * 2, landing: null, legal: false };
    if (c2.kind === 'net' || c2.kind === 'netCord' || c2.kind === 'post') return { reach: -1, landing: null, legal: false };
    const legal = c2.kind === 'table' && c2.side !== server;
    return { reach: proj(c2.pos), landing: legal ? { x: c2.pos.x, z: c2.pos.z } : null, legal };
  };
  let lo = 0.8, hi = 20, h = 5;
  for (let i = 0; i < 13; i++) {
    h = (lo + hi) / 2;
    if (sim(h).reach < D) lo = h; else hi = h;
  }
  const r = sim(h);
  return { vel: { x: ux * h, y: vy, z: uz * h }, spin, clears: r.legal, landing: r.landing };
}

/* ---------------- executing a hit ---------------- */

export type Grade = 'perfect' | 'early' | 'late';

export interface HitResult {
  grade: Grade;
  /** 0 = sweet spot .. ~1 = the very edge of the blade. */
  edge: number;
  plan: ShotPlan;
  normal: V3;
  paddleVel: V3;
}

export function gradeFor(timingMs: number): Grade {
  if (Math.abs(timingMs) <= TT_TUNING.perfectMs) return 'perfect';
  return timingMs < 0 ? 'early' : 'late';
}

/**
 * Hit the ball where it is now. The planned shot is turned into a paddle (face + velocity), then
 * timing error moves the contact toward the edge: the face tilts (odd angle), the rubber rebounds
 * less and the paddle is slower. Early pulls the ball toward the hitter's left, late pushes it right.
 */
export function executeHit(ball: BallPhysics, hitter: Side, plan: ShotPlan, timingMs: number): HitResult {
  const T = TT_TUNING;
  const f = clamp(Math.abs(timingMs) / T.timingWindowMs, 0, 1) * T.edgeAtWindow;
  const e = T.paddleRestitution + (T.paddleEdgeRestitution - T.paddleRestitution) * f * f;
  const p = paddleFor(ball.vel, ball.spin, plan.vel, plan.spin, e);
  let normal = p.normal, vel = p.vel;
  // inside the PERFECT window the contact stays clean; beyond it the face tilts more and more
  const tilt = clamp((Math.abs(timingMs) - T.perfectMs) / Math.max(1, T.timingWindowMs - T.perfectMs), 0, 1);
  if (tilt > 0) {
    const right = hitter === 0 ? 1 : -1;
    const dir = (timingMs < 0 ? -1 : 1) * right;
    normal = tiltNormal(p.normal, tilt * 0.32, dir, timingMs < 0 ? -0.35 : 0.35);
    const k = 1 - 0.3 * tilt;
    vel = { x: vel.x * k, y: vel.y * k, z: vel.z * k };
  }
  ball.hitWith(normal, vel, e);
  return { grade: gradeFor(timingMs), edge: f, plan, normal, paddleVel: vel };
}

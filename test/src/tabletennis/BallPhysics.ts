import { BALL, PADDLE_HALF_THICKNESS, PADDLE_RADIUS, TABLE, TT_TUNING } from './ttTuning';

/**
 * Hand-written ping-pong ball physics. A 4 cm ball at 30 m/s moves further per step than its own size,
 * so a general physics engine tunnels through the net and paddle. Here every collider is swept
 * analytically: each step integrates the forces once, then moves the ball in straight segments from
 * time-of-impact to time-of-impact (table plane, floor, net plane, net tape, posts, moving paddles).
 *
 * Deterministic: the only randomness (net-cord deflection) comes from the seeded Rng passed in.
 * Units are SI. See ttTuning.ts for the coordinate frame.
 */
export interface V3 { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
const copy = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });

/** Small seeded PRNG (mulberry32) with a copyable state, so predictions can replay the same "random" net cords. */
export class Rng {
  constructor(private s: number) { this.s = s >>> 0; }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** -1 .. 1 */
  signed(): number { return this.next() * 2 - 1; }
  /** Standard normal (Box–Muller). */
  gauss(): number {
    const u = Math.max(1e-9, this.next()), v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  clone(): Rng { return new Rng(this.s); }
  get state(): number { return this.s; }
}

export type ContactKind = 'table' | 'floor' | 'net' | 'netCord' | 'post' | 'paddle';

export interface Contact {
  kind: ContactKind;
  /** Table half for 'table' (0 = z > 0), owner for 'paddle'. */
  side: 0 | 1;
  pos: V3;
  /** Ball speed just before the contact. */
  speed: number;
  /** Simulation time of the contact. */
  t: number;
}

/** A paddle as the physics sees it: a thin disc moving in a straight line during the step. */
export interface PaddleBody {
  side: 0 | 1;
  pos: V3;
  vel: V3;
  /** Unit face normal (either face can hit). */
  normal: V3;
  active: boolean;
  /** Rebound for this contact (lower toward the edge). Defaults to TT_TUNING.paddleRestitution. */
  restitution?: number;
}

export const STEP = 1 / 240;
const G = 9.81;
const R = BALL.radius;
const HALF_L = TABLE.length / 2;
const HALF_W = TABLE.width / 2;
const TABLE_Y = TABLE.height + R;               // ball centre height when touching the table
const TAPE_Y = TABLE.height + TABLE.netHeight;  // the top edge of the net
const M_OVER_I = BALL.mass / BALL.inertia;       // = 1.5 / r²
const MAX_EVENTS_PER_STEP = 6;
const NO_POS: V3[] = [];

export class BallPhysics {
  pos: V3 = v3(0, 1, 0);
  vel: V3 = v3();
  /** Angular velocity, rad/s. Topspin for a ball travelling toward -z is negative x. */
  spin: V3 = v3();
  time = 0;
  /** Set false to freeze the ball (between points). */
  live = true;

  constructor(public rng: Rng = new Rng(1)) {}

  set(pos: V3, vel: V3, spin: V3 = v3()): void {
    this.pos = copy(pos); this.vel = copy(vel); this.spin = copy(spin); this.live = true;
  }

  /** Independent copy, including the RNG state, so a prediction sees exactly what will happen. */
  clone(): BallPhysics {
    const b = new BallPhysics(this.rng.clone());
    b.pos = copy(this.pos); b.vel = copy(this.vel); b.spin = copy(this.spin); b.time = this.time; b.live = this.live;
    return b;
  }

  get speed(): number { return len(this.vel); }
  /** Spin magnitude in revolutions per minute. */
  get rpm(): number { return len(this.spin) * 60 / (2 * Math.PI); }

  /** Acceleration from gravity, quadratic drag and the Magnus force. */
  private accel(): V3 {
    const v = this.vel, s = len(v);
    const k = TT_TUNING.drag * s;
    const m = cross(this.spin, v);
    return {
      x: -k * v.x + TT_TUNING.magnus * m.x,
      y: -G - k * v.y + TT_TUNING.magnus * m.y,
      z: -k * v.z + TT_TUNING.magnus * m.z
    };
  }

  /**
   * One fixed step: integrate forces (semi-implicit Euler), then sweep the straight-line motion
   * against every collider, resolving contacts in time order. Returns the contacts of this step.
   */
  step(dt = STEP, paddles: readonly PaddleBody[] = []): Contact[] {
    const out: Contact[] = [];
    if (!this.live) return out;
    const a = this.accel();
    this.vel.x += a.x * dt; this.vel.y += a.y * dt; this.vel.z += a.z * dt;
    const decay = Math.max(0, 1 - TT_TUNING.spinDecay * dt);
    this.spin.x *= decay; this.spin.y *= decay; this.spin.z *= decay;

    let rem = dt;
    // paddles move during the step too; track how far along they are
    const pPos = paddles.length ? paddles.map(p => copy(p.pos)) : NO_POS;
    let elapsed = 0;
    for (let i = 0; i < MAX_EVENTS_PER_STEP && rem > 0; i++) {
      const hit = this.earliest(rem, paddles, pPos);
      if (!hit) break;
      this.pos.x += this.vel.x * hit.t; this.pos.y += this.vel.y * hit.t; this.pos.z += this.vel.z * hit.t;
      for (let k = 0; k < paddles.length; k++) {
        const p = paddles[k];
        pPos[k].x += p.vel.x * hit.t; pPos[k].y += p.vel.y * hit.t; pPos[k].z += p.vel.z * hit.t;
      }
      rem -= hit.t;
      elapsed += hit.t;
      const speed = this.speed;
      const side = this.resolve(hit.kind, hit.index, paddles, pPos);
      out.push({ kind: hit.kind, side, pos: copy(this.pos), speed, t: this.time + elapsed });
    }
    this.pos.x += this.vel.x * rem; this.pos.y += this.vel.y * rem; this.pos.z += this.vel.z * rem;
    this.time += dt;
    return out;
  }

  /** Run for `seconds` in fixed steps; returns every contact. */
  advance(seconds: number, paddles: readonly PaddleBody[] = []): Contact[] {
    const all: Contact[] = [];
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) for (const c of this.step(STEP, paddles)) all.push(c);
    return all;
  }

  /* ---------------- sweeping ---------------- */

  private earliest(rem: number, paddles: readonly PaddleBody[], pPos: V3[]): { t: number; kind: ContactKind; index: number } | null {
    const p = this.pos, v = this.vel;
    // `as` keeps TypeScript from narrowing these to their initial values (they change inside `consider`)
    let best = rem + 1e-12, kind = null as ContactKind | null, index = -1;
    const consider = (t: number, k: ContactKind, i = -1) => { if (t >= 0 && t < best) { best = t; kind = k; index = i; } };

    // table top
    if (v.y < 0 && p.y >= TABLE_Y - 1e-9) {
      const t = (TABLE_Y - p.y) / v.y;
      const x = p.x + v.x * t, z = p.z + v.z * t;
      if (Math.abs(x) <= HALF_W && Math.abs(z) <= HALF_L) consider(Math.max(0, t), 'table');
    }
    // floor
    if (v.y < 0 && p.y >= R - 1e-9) consider(Math.max(0, (R - p.y) / v.y), 'floor');

    // net plane (the mesh below the tape)
    if (Math.abs(p.z) >= R - 1e-9 && v.z !== 0) {
      const s = Math.sign(p.z);
      if (v.z * s < 0) {
        const t = (s * R - p.z) / v.z;
        const x = p.x + v.x * t, y = p.y + v.y * t;
        if (Math.abs(x) <= TABLE.netHalfWidth && y >= TABLE.height && y <= TAPE_Y) consider(Math.max(0, t), 'net');
      }
    }
    // net tape: an infinite cylinder along x at (y = TAPE_Y, z = 0), radius = ball radius
    {
      const dy = p.y - TAPE_Y, dz = p.z;
      const qa = v.y * v.y + v.z * v.z, qb = 2 * (dy * v.y + dz * v.z), qc = dy * dy + dz * dz - R * R;
      if (qa > 1e-12 && qc > 0 && qb < 0) {
        const disc = qb * qb - 4 * qa * qc;
        if (disc >= 0) {
          const t = (-qb - Math.sqrt(disc)) / (2 * qa);
          const x = p.x + v.x * t, y = p.y + v.y * t;
          if (Math.abs(x) <= TABLE.netHalfWidth && y >= TAPE_Y - R * 0.5) consider(t, 'netCord');
        }
      }
    }
    // posts: vertical cylinders at x = ±netHalfWidth
    for (const sx of [-1, 1]) {
      const dx = p.x - sx * TABLE.netHalfWidth, dz = p.z, rr = R + TABLE.postRadius;
      const qa = v.x * v.x + v.z * v.z, qb = 2 * (dx * v.x + dz * v.z), qc = dx * dx + dz * dz - rr * rr;
      if (qa > 1e-12 && qc > 0 && qb < 0) {
        const disc = qb * qb - 4 * qa * qc;
        if (disc >= 0) {
          const t = (-qb - Math.sqrt(disc)) / (2 * qa);
          const y = p.y + v.y * t;
          if (y >= TABLE.height && y <= TAPE_Y + R) consider(t, 'post', sx > 0 ? 1 : 0);
        }
      }
    }
    // paddles: moving thin discs, tested in the paddle's frame
    for (let k = 0; k < paddles.length; k++) {
      const pd = paddles[k];
      if (!pd.active) continue;
      const n = pd.normal;
      const q0 = { x: p.x - pPos[k].x, y: p.y - pPos[k].y, z: p.z - pPos[k].z };
      const w = { x: v.x - pd.vel.x, y: v.y - pd.vel.y, z: v.z - pd.vel.z };
      const d = dot(q0, n), wn = dot(w, n);
      const s = d !== 0 ? Math.sign(d) : -Math.sign(wn);
      if (wn * s >= 0) continue;                         // moving apart
      const half = R + PADDLE_HALF_THICKNESS;
      const t = Math.abs(d) > half ? (s * half - d) / wn : 0;
      const q = { x: q0.x + w.x * t, y: q0.y + w.y * t, z: q0.z + w.z * t };
      const qn = dot(q, n);
      const radial = Math.hypot(q.x - qn * n.x, q.y - qn * n.y, q.z - qn * n.z);
      if (radial <= PADDLE_RADIUS + R * 0.5) consider(t, 'paddle', k);
    }
    return kind ? { t: best, kind, index } : null;
  }

  /* ---------------- responses ---------------- */

  private resolve(kind: ContactKind, index: number, paddles: readonly PaddleBody[], pPos: V3[]): 0 | 1 {
    const p = this.pos, v = this.vel;
    switch (kind) {
      case 'table':
        p.y = TABLE_Y;
        this.surfaceBounce({ x: 0, y: 1, z: 0 }, TT_TUNING.tableRestitution, TT_TUNING.tableFriction);
        if (Math.abs(v.y) < 0.06) v.y = 0;               // come to rest instead of micro-bouncing
        return p.z >= 0 ? 0 : 1;
      case 'floor':
        p.y = R;
        this.surfaceBounce({ x: 0, y: 1, z: 0 }, TT_TUNING.floorRestitution, 0.3);
        if (Math.abs(v.y) < 0.1) v.y = 0;
        return p.z >= 0 ? 0 : 1;
      case 'net': {
        const s = Math.sign(p.z) || 1;
        // the mesh swallows the ball: almost all forward speed goes, it drops on the hitter's side
        v.z = -v.z * 0.1; v.x *= 0.35; v.y *= 0.35;
        this.spin.x *= 0.3; this.spin.y *= 0.3; this.spin.z *= 0.3;
        p.z = s * (R + 1e-6);
        return s > 0 ? 0 : 1;
      }
      case 'netCord': {
        const ny = p.y - TAPE_Y, nz = p.z, l = Math.hypot(ny, nz) || 1;
        const n = { x: 0, y: ny / l, z: nz / l };
        const vn = dot(v, n);
        if (vn < 0) { const k = (1 + TT_TUNING.netCordRestitution) * vn; v.x -= k * n.x; v.y -= k * n.y; v.z -= k * n.z; }
        const damp = TT_TUNING.netCordDamp;
        v.x *= damp; v.y *= damp; v.z *= damp;
        // seeded "random" deflection: rotate the horizontal velocity a little and nudge it up or down
        const ang = this.rng.signed() * TT_TUNING.netCordDeflectDeg * Math.PI / 180;
        const c = Math.cos(ang), s = Math.sin(ang);
        const vx = v.x * c - v.z * s, vz = v.x * s + v.z * c;
        v.x = vx; v.z = vz;
        v.y += this.rng.signed() * 0.25;
        this.spin.x *= 0.5; this.spin.y *= 0.5; this.spin.z *= 0.5;
        p.y = TAPE_Y + n.y * (R + 1e-6); p.z = n.z * (R + 1e-6);
        return p.z >= 0 ? 0 : 1;
      }
      case 'post': {
        const sx = index === 1 ? 1 : -1;
        const dx = p.x - sx * TABLE.netHalfWidth, dz = p.z, l = Math.hypot(dx, dz) || 1;
        const n = { x: dx / l, y: 0, z: dz / l };
        const vn = dot(v, n);
        if (vn < 0) { const k = 1.5 * vn; v.x -= k * n.x; v.z -= k * n.z; }
        return p.z >= 0 ? 0 : 1;
      }
      case 'paddle': {
        const pd = paddles[index];
        const q = { x: p.x - pPos[index].x, y: p.y - pPos[index].y, z: p.z - pPos[index].z };
        const s = Math.sign(dot(q, pd.normal)) || 1;
        const n = { x: pd.normal.x * s, y: pd.normal.y * s, z: pd.normal.z * s };
        this.surfaceBounce(n, pd.restitution ?? TT_TUNING.paddleRestitution, TT_TUNING.paddleGrip, pd.vel);
        // make sure the ball leaves the rubber this step
        const sep = R + PADDLE_HALF_THICKNESS + 1e-5 - dot(q, n);
        if (sep > 0) { p.x += n.x * sep; p.y += n.y * sep; p.z += n.z * sep; }
        return pd.side;
      }
    }
  }

  /**
   * Bounce off a surface with outward normal n moving at surfaceVel.
   * Normal part: reversed and scaled by e. Tangential part: a friction impulse that drives the contact
   * point toward rolling, capped by Coulomb (mu · normal impulse). For a hollow shell that impulse per
   * unit mass is j = −0.4 · v_contact, because Δv_contact = j · (1 + m r²/I) = 2.5 j.
   * This is what makes topspin kick forward off the table, backspin check up, and a brushing paddle create spin.
   */
  surfaceBounce(n: V3, e: number, mu: number, surfaceVel: V3 = v3()): void {
    const v = this.vel, w = this.spin;
    const rel = { x: v.x - surfaceVel.x, y: v.y - surfaceVel.y, z: v.z - surfaceVel.z };
    const vn = dot(rel, n);
    if (vn >= 0) return;
    const vt = { x: rel.x - vn * n.x, y: rel.y - vn * n.y, z: rel.z - vn * n.z };
    const rc = { x: -n.x * R, y: -n.y * R, z: -n.z * R };           // centre → contact point
    const wr = cross(w, rc);
    const vc = { x: vt.x + wr.x, y: vt.y + wr.y, z: vt.z + wr.z };  // slip velocity of the contact point
    const slip = len(vc);
    let j = v3();
    if (slip > 1e-9) {
      const mag = Math.min(0.4 * slip, mu * (1 + e) * -vn);
      j = { x: -vc.x / slip * mag, y: -vc.y / slip * mag, z: -vc.z / slip * mag };
    }
    const dw = cross(rc, j);
    w.x += dw.x * M_OVER_I; w.y += dw.y * M_OVER_I; w.z += dw.z * M_OVER_I;
    v.x = surfaceVel.x + vt.x + j.x - e * vn * n.x;
    v.y = surfaceVel.y + vt.y + j.y - e * vn * n.y;
    v.z = surfaceVel.z + vt.z + j.z - e * vn * n.z;
  }

  /** Instant paddle contact at the ball's current position (assisted hits): same response as a swept contact. */
  hitWith(normal: V3, paddleVel: V3, restitution: number): void {
    const n = { ...normal };
    // the face must point from the paddle toward the ball's incoming direction
    if (dot(this.vel, n) - dot(paddleVel, n) > 0) { n.x = -n.x; n.y = -n.y; n.z = -n.z; }
    this.surfaceBounce(n, restitution, TT_TUNING.paddleGrip, paddleVel);
  }
}

/** Which half a z coordinate belongs to. */
export const sideOfZ = (z: number): 0 | 1 => (z >= 0 ? 0 : 1);
export const TABLE_CONTACT_Y = TABLE_Y;
export const NET_TAPE_Y = TAPE_Y;
export const TABLE_HALF_LENGTH = HALF_L;
export const TABLE_HALF_WIDTH = HALF_W;

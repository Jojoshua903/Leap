import { Rng } from '../tabletennis/BallPhysics';
import { DISC, DISC_TYPES, FB_TUNING, type DiscType } from './frisbeeTuning';

/**
 * Hand-written flying-disc model at a fixed 1/240 s step (no Rapier). Deterministic for a seed.
 *
 * Aerodynamics (relative to the air, so wind matters): with v̂ the airflow direction and n the disc normal,
 *   angle of attack  α = −asin(n·v̂)            (nose-up = positive)
 *   lift   L = ½ρAv²·CL(α)  along n with the v̂ part removed
 *   drag   D = ½ρAv²·CD(α)  along −v̂
 * with a stall above `stallDeg` (lift falls away, drag rises toward a flat plate's).
 *
 * Moments: the pitching moment M = ½ρAv²d·CM about the disc's pitch axis (f × n, f = the airflow direction
 * in the disc plane) doesn't pitch a spinning disc: gyroscopic precession turns it into a bank,
 * dn/dt = M (f × n) / (I ω). Nose-up M with clockwise spin (right-hand backhand) banks left: that is the fade.
 * The disc's `turn` adds a nose-down moment at high speed (the turn to the right), `fade` a nose-up one
 * as it slows down. More spin = slower precession = a more stable flight. A small roll moment (crr) drifts
 * the nose down. Wobble (a dirty release) adds drag and random precession that dies down.
 *
 * Ground: a low bounce, a skid with surface friction, or a roll on the edge when the disc lands steeply
 * banked; water stops it; trees and rocks deflect it and kill its lift.
 */
export interface V3 { x: number; y: number; z: number }
export interface Q4 { x: number; y: number; z: number; w: number }

export type Surface = 'grass' | 'fairway' | 'rough' | 'sand' | 'water' | 'rock';
export type ObstacleKind = 'trunk' | 'canopy' | 'rock' | 'pole';
export interface Obstacle { x: number; z: number; r: number; y0: number; y1: number; kind: ObstacleKind }

export interface Ground {
  height(x: number, z: number): number;
  surface(x: number, z: number): Surface;
  readonly obstacles: readonly Obstacle[];
}

export const FLAT_GROUND: Ground = { height: () => 0, surface: () => 'grass', obstacles: [] };

export const STEP = 1 / 240;
const G = 9.81;
const D2R = Math.PI / 180;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/* ---------------- vector + quaternion helpers ---------------- */

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const norm = (a: V3): V3 => { const l = len(a); return l > 1e-9 ? scale(a, 1 / l) : v3(0, 1, 0); };

export function qMulQ(a: Q4, b: Q4): Q4 {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  };
}
export function qAxis(axis: V3, angle: number): Q4 {
  const a = norm(axis), s = Math.sin(angle / 2);
  return { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(angle / 2) };
}
export function qApply(q: Q4, v: V3): V3 {
  // v' = v + w·t + u × t, with u = q.xyz and t = 2 u × v
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx)
  };
}
const qNorm = (q: Q4): Q4 => { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; };

/* ---------------- wind ---------------- */

/**
 * A constant wind plus gentle gusts: smooth seeded value noise on the strength (±gust) and a little
 * sideways sway. `at(t)` is the same for the same seed and time.
 */
export class Wind {
  private readonly table: number[] = [];
  constructor(public base: V3 = v3(), public gust = 0, seed = 1) {
    const r = new Rng(seed);
    for (let i = 0; i < 64; i++) this.table.push(r.signed());
  }
  static calm(): Wind { return new Wind(v3(), 0, 1); }
  /** Wind toward `dirDeg` (0 = −z, the throwing direction; 90 = +x) at `speed` m/s. */
  static from(dirDeg: number, speed: number, gust: number, seed: number): Wind {
    const a = dirDeg * D2R;
    return new Wind(v3(Math.sin(a) * speed, 0, -Math.cos(a) * speed), gust, seed);
  }
  private noise(t: number, off: number): number {
    const x = t / 1.6 + off, i = Math.floor(x), f = x - i;
    const a = this.table[((i % 64) + 64) % 64], b = this.table[(((i + 1) % 64) + 64) % 64];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  }
  at(t: number): V3 {
    const sp = Math.hypot(this.base.x, this.base.z);
    if (sp < 1e-6 && this.gust <= 0) return v3();
    const k = 1 + this.gust * this.noise(t, 0);
    const side = this.gust * this.noise(t, 17.3) * 0.35;
    // perpendicular to the wind, in the ground plane
    const px = sp > 1e-6 ? -this.base.z / sp : 0, pz = sp > 1e-6 ? this.base.x / sp : 0;
    return v3(this.base.x * k + px * side * sp, 0, this.base.z * k + pz * side * sp);
  }
  get speed(): number { return Math.hypot(this.base.x, this.base.z); }
}

/* ---------------- launch ---------------- */

export interface Launch {
  pos: V3;
  /** m/s along the launch direction. */
  speed: number;
  /** Direction in degrees: 0 = straight ahead (−z), + = to the right. */
  yawDeg: number;
  /** Elevation of the launch velocity (degrees, + = up). */
  loftDeg: number;
  /** Disc pitch relative to the velocity (degrees, + = nose up). */
  noseDeg: number;
  /** Disc bank (degrees, + = right edge down). */
  bankDeg: number;
  /** rad/s about the disc normal, + = counter-clockwise seen from above (right-hand forehand). */
  spin: number;
  /** 0..1 from a dirty release. */
  wobble: number;
}

export type DiscPhase = 'held' | 'flight' | 'skid' | 'roll' | 'rest' | 'water';
export type DiscEventKind = 'land' | 'bounce' | 'obstacle' | 'water' | 'rest' | 'roll';
export interface DiscEvent { kind: DiscEventKind; pos: V3; speed: number; t: number; surface: Surface; obstacle?: ObstacleKind }

/** For the debug overlay. */
export interface DiscAero { alphaDeg: number; cl: number; cd: number; cm: number; air: number }

export class Disc {
  pos: V3 = v3();
  vel: V3 = v3();
  /** Orientation of the disc plane (local +y = the normal). The spin itself is `spinAngle`. */
  q: Q4 = { x: 0, y: 0, z: 0, w: 1 };
  spin = 0;
  spinAngle = 0;
  /** Precession rates (rad/s) about the pitch and roll axes, for the overlay. */
  pitchRate = 0;
  rollRate = 0;
  wobble = 0;
  phase: DiscPhase = 'held';
  t = 0;
  bounces = 0;
  /** A tree or rock took its lift away. */
  knocked = false;
  landed = false;
  aero: DiscAero = { alphaDeg: 0, cl: 0, cd: 0, cm: 0, air: 0 };
  private rollDir = v3(0, 0, -1);
  private readonly rng: Rng;

  constructor(public type: DiscType = DISC_TYPES.dog, seed = 1) { this.rng = new Rng(seed); }

  get normal(): V3 { return qApply(this.q, v3(0, 1, 0)); }
  get speed(): number { return len(this.vel); }
  /** Bank angle of the normal from vertical (rad). */
  get tilt(): number { return Math.acos(clamp(this.normal.y, -1, 1)); }
  get flying(): boolean { return this.phase === 'flight'; }
  get stopped(): boolean { return this.phase === 'rest' || this.phase === 'water'; }

  hold(p: V3): void { this.phase = 'held'; this.pos = { ...p }; this.vel = v3(); }

  launch(l: Launch): void {
    const yaw = l.yawDeg * D2R, loft = l.loftDeg * D2R;
    const f = v3(Math.sin(yaw), 0, -Math.cos(yaw));
    const right = v3(-f.z, 0, f.x);
    this.pos = { ...l.pos };
    this.vel = v3(f.x * Math.cos(loft) * l.speed, Math.sin(loft) * l.speed, f.z * Math.cos(loft) * l.speed);
    // pitch the plane nose-up about `right`, then bank about the forward axis
    const pitch = qAxis(right, (l.loftDeg + l.noseDeg) * D2R);
    const fPitched = qApply(pitch, f);
    this.q = qNorm(qMulQ(qAxis(fPitched, l.bankDeg * D2R), pitch));
    this.spin = l.spin;
    this.spinAngle = 0;
    this.wobble = clamp(l.wobble, 0, 1);
    this.phase = 'flight';
    this.t = 0;
    this.bounces = 0;
    this.knocked = false;
    this.landed = false;
  }

  /** One fixed step. Returns what happened (landing, bounce, obstacle, water, rest). */
  step(dt: number, wind: Wind, ground: Ground): DiscEvent[] {
    const ev: DiscEvent[] = [];
    if (this.phase === 'held' || this.stopped) return ev;
    this.t += dt;
    this.spinAngle += this.spin * dt;
    if (this.phase === 'flight') this.flight(dt, wind, ground, ev);
    else this.onGround(dt, ground, ev);
    return ev;
  }

  private flight(dt: number, wind: Wind, ground: Ground, ev: DiscEvent[]): void {
    const T = FB_TUNING, D = this.type;
    const n = this.normal;
    const w0 = wind.at(this.t);
    const air = { x: this.vel.x - w0.x, y: this.vel.y - w0.y, z: this.vel.z - w0.z };
    const va = len(air);
    let fx = 0, fy = -G * DISC.mass, fz = 0;
    if (va > 1e-3) {
      const vh = scale(air, 1 / va);
      const nv = clamp(dot(n, vh), -1, 1);
      const alpha = -Math.asin(nv);
      const stall = D.stallDeg * D2R;
      const a = Math.abs(alpha), sg = Math.sign(alpha) || 1;
      let cl: number, cd: number;
      if (a <= stall) {
        cl = D.cl0 + D.cla * alpha;
        cd = D.cd0 + D.cda * (alpha - D.alpha0) ** 2;
      } else {
        const clS = D.cl0 + D.cla * stall * sg, cdS = D.cd0 + D.cda * (stall * sg - D.alpha0) ** 2;
        const k = clamp((a - stall) / (Math.PI / 2 - stall), 0, 1);
        cl = clS * (1 - k);
        cd = cdS + (1.15 - cdS) * Math.sin(k * Math.PI / 2);
      }
      cd *= 1 + T.wobbleDrag * this.wobble;
      if (this.knocked) cl *= 0.2;
      const qa = 0.5 * DISC.rho * DISC.area * va * va;
      // lift: along n with the airflow part removed
      const lraw = { x: n.x - nv * vh.x, y: n.y - nv * vh.y, z: n.z - nv * vh.z };
      const ll = len(lraw);
      if (ll > 1e-6) { fx += lraw.x / ll * qa * cl; fy += lraw.y / ll * qa * cl; fz += lraw.z / ll * qa * cl; }
      fx -= vh.x * qa * cd; fy -= vh.y * qa * cd; fz -= vh.z * qa * cd;

      // moments → precession of the normal
      const fr = { x: vh.x - nv * n.x, y: vh.y - nv * n.y, z: vh.z - nv * n.z };
      const fl = len(fr);
      let cm = D.cm0 + D.cma * (alpha - D.alpha0);
      cm += T.fadeK * D.fade * clamp(1 - va / D.fadeSpeed, 0, 1);
      cm -= T.turnK * D.turn * clamp((va - D.turnSpeed) / T.turnRange, 0, 1);
      this.aero = { alphaDeg: alpha / D2R, cl, cd, cm, air: va };
      if (fl > 1e-4) {
        const f = scale(fr, 1 / fl);
        const pitchAxis = cross(f, n);
        const w = Math.sign(this.spin || 1) * Math.max(Math.abs(this.spin), T.minSpin);
        const Iw = DISC.inertia * w;
        const M = qa * DISC.diameter * cm;
        // roll moment: always drifts the nose down a little (precession about the pitch axis)
        const R = qa * DISC.diameter * T.crr * Math.abs(w) * DISC.diameter / (2 * Math.max(va, 1));
        let dn = { x: pitchAxis.x * M / Iw + f.x * R / Math.abs(Iw), y: pitchAxis.y * M / Iw + f.y * R / Math.abs(Iw), z: pitchAxis.z * M / Iw + f.z * R / Math.abs(Iw) };
        if (this.wobble > 0.01) {
          const k = T.wobbleNoise * this.wobble;
          dn = { x: dn.x + pitchAxis.x * this.rng.gauss() * k + f.x * this.rng.gauss() * k * 0.5, y: dn.y + pitchAxis.y * this.rng.gauss() * k, z: dn.z + pitchAxis.z * this.rng.gauss() * k + f.z * this.rng.gauss() * k * 0.5 };
        }
        // keep dn perpendicular to n, then rotate the plane by ω_p = n × dn
        const nd = dot(dn, n);
        dn = { x: dn.x - nd * n.x, y: dn.y - nd * n.y, z: dn.z - nd * n.z };
        this.pitchRate = dot(dn, f);
        this.rollRate = dot(dn, pitchAxis);
        const wp = cross(n, dn);
        const wl = len(wp);
        if (wl > 1e-9) this.q = qNorm(qMulQ(qAxis(wp, wl * dt), this.q));
      }
    }
    this.spin *= Math.exp(-T.spinDecay * dt);
    this.wobble *= Math.exp(-dt / T.wobbleDecay);
    // semi-implicit Euler
    this.vel.x += fx / DISC.mass * dt; this.vel.y += fy / DISC.mass * dt; this.vel.z += fz / DISC.mass * dt;
    this.pos.x += this.vel.x * dt; this.pos.y += this.vel.y * dt; this.pos.z += this.vel.z * dt;
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.vel.x + this.vel.y + this.vel.z)) {
      // never let a bad number escape: drop it where it is
      this.vel = v3(); this.pos = { x: Number.isFinite(this.pos.x) ? this.pos.x : 0, y: 0, z: Number.isFinite(this.pos.z) ? this.pos.z : 0 };
    }
    this.obstacles(ground, ev);
    this.groundContact(ground, ev);
  }

  private obstacles(ground: Ground, ev: DiscEvent[]): void {
    const R = DISC.radius;
    for (const o of ground.obstacles) {
      if (this.pos.y < o.y0 - R || this.pos.y > o.y1 + R) continue;
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z, d = Math.hypot(dx, dz);
      if (d >= o.r + R || d < 1e-6) continue;
      const nx = dx / d, nz = dz / d;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn >= 0) continue;                                   // already moving away
      const speed = this.speed;
      const keep = o.kind === 'canopy' ? 0.35 : o.kind === 'rock' ? 0.45 : 0.3;
      this.vel.x = (this.vel.x - 2 * vn * nx) * keep + this.rng.signed() * 0.4;
      this.vel.z = (this.vel.z - 2 * vn * nz) * keep + this.rng.signed() * 0.4;
      this.vel.y = Math.min(this.vel.y, 0) * 0.5;
      this.pos.x = o.x + nx * (o.r + R + 0.01); this.pos.z = o.z + nz * (o.r + R + 0.01);
      this.knocked = true;
      this.spin *= 0.5;
      ev.push({ kind: 'obstacle', pos: { ...this.pos }, speed, t: this.t, surface: ground.surface(this.pos.x, this.pos.z), obstacle: o.kind });
    }
  }

  private groundContact(ground: Ground, ev: DiscEvent[]): void {
    const T = FB_TUNING;
    const h = ground.height(this.pos.x, this.pos.z);
    const tilt = this.tilt;
    const bottom = h + 0.012 + DISC.radius * Math.sin(Math.min(tilt, Math.PI / 2)) * 0.9;
    if (this.pos.y > bottom) return;
    const surf = ground.surface(this.pos.x, this.pos.z);
    const speed = this.speed;
    this.pos.y = bottom;
    if (!this.landed) { this.landed = true; ev.push({ kind: 'land', pos: { ...this.pos }, speed, t: this.t, surface: surf }); }
    if (surf === 'water') {
      this.vel = v3(); this.phase = 'water';
      ev.push({ kind: 'water', pos: { ...this.pos }, speed, t: this.t, surface: surf });
      return;
    }
    const hs = Math.hypot(this.vel.x, this.vel.z), vs = -this.vel.y;
    const rest = (surf === 'sand' ? T.bounce / 3 : T.bounce) * (surf === 'rock' ? 1.6 : 1);
    if (vs > 2.2 && this.bounces < 3) {
      this.bounces += 1;
      this.vel.y = vs * rest;
      this.vel.x *= T.skidKeep; this.vel.z *= T.skidKeep;
      this.spin *= 0.6;
      ev.push({ kind: 'bounce', pos: { ...this.pos }, speed, t: this.t, surface: surf });
      return;
    }
    this.vel.y = 0;
    const keep = this.bounces === 0 ? T.skidKeep : 0.85;
    this.vel.x *= keep; this.vel.z *= keep;
    if (tilt > T.rollTiltDeg * D2R && hs * keep > 3) {
      this.phase = 'roll';
      this.rollDir = norm(v3(this.vel.x, 0, this.vel.z));
      // stand it up on its edge, facing the way it rolls
      const side = cross(this.rollDir, v3(0, 1, 0));
      const lean = Math.sign(dot(this.normal, side)) || 1;
      this.q = qNorm(qMulQ(qAxis(this.rollDir, lean * -(Math.PI / 2 - 0.25)), { x: 0, y: 0, z: 0, w: 1 }));
      ev.push({ kind: 'roll', pos: { ...this.pos }, speed, t: this.t, surface: surf });
    } else {
      this.phase = 'skid';
      this.flatten();
    }
  }

  private flatten(): void {
    // lie flat (keep the heading)
    this.q = { x: 0, y: 0, z: 0, w: 1 };
  }

  private onGround(dt: number, ground: Ground, ev: DiscEvent[]): void {
    const T = FB_TUNING;
    const surf = ground.surface(this.pos.x, this.pos.z);
    if (surf === 'water') { this.vel = v3(); this.phase = 'water'; ev.push({ kind: 'water', pos: { ...this.pos }, speed: 0, t: this.t, surface: surf }); return; }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.phase === 'roll') {
      // a rolling disc slows down and curls toward the side it leans to, then falls over
      const n = this.normal;
      const side = cross(this.rollDir, v3(0, 1, 0));
      const lean = dot(n, side);
      const ns = Math.max(0, hs - T.rollDecel * dt * surfaceFriction(surf) / 0.55);
      const turn = -lean * 0.9 * dt;
      const c = Math.cos(turn), s = Math.sin(turn);
      this.rollDir = norm(v3(this.rollDir.x * c - this.rollDir.z * s, 0, this.rollDir.x * s + this.rollDir.z * c));
      this.vel = v3(this.rollDir.x * ns, 0, this.rollDir.z * ns);
      this.spinAngle += ns / DISC.radius * dt;
      if (ns < 1.2) { this.phase = 'skid'; this.flatten(); }
    } else {
      const dec = T.friction * surfaceFriction(surf) / 0.55 * G * dt;
      if (hs <= dec || hs < 0.12) {
        this.vel = v3();
        this.phase = 'rest';
        this.spin = 0;
        ev.push({ kind: 'rest', pos: { ...this.pos }, speed: 0, t: this.t, surface: surf });
      } else {
        const k = (hs - dec) / hs;
        this.vel.x *= k; this.vel.z *= k;
        this.spin *= Math.exp(-4 * dt);
      }
    }
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.pos.y = ground.height(this.pos.x, this.pos.z) + (this.phase === 'roll' ? DISC.radius * 0.9 : 0.012);
    // rolling into a tree trunk or rock stops it
    for (const o of ground.obstacles) {
      if (o.kind === 'canopy' || this.pos.y > o.y1) continue;
      if (Math.hypot(this.pos.x - o.x, this.pos.z - o.z) < o.r + DISC.radius && hs > 0) {
        this.vel = v3(); this.phase = 'rest'; this.flatten();
        ev.push({ kind: 'rest', pos: { ...this.pos }, speed: 0, t: this.t, surface: surf });
        break;
      }
    }
  }
}

/** Friction per surface, relative to grass (0.55). */
export function surfaceFriction(s: Surface): number {
  switch (s) {
    case 'sand': return 1.1;
    case 'rough': return 0.85;
    case 'fairway': return 0.42;
    case 'rock': return 0.35;
    default: return 0.55;
  }
}

/* ---------------- whole flights (tests, the dog's prediction, aim aids) ---------------- */

export interface FlightSample { t: number; x: number; y: number; z: number }
export interface FlightResult {
  path: FlightSample[];
  /** Where it first touched the ground (or water). */
  landing: V3 | null;
  landT: number;
  /** Where it ended up. */
  final: V3;
  outcome: 'rest' | 'water' | 'timeout';
  maxHeight: number;
  hitObstacle: boolean;
  events: DiscEvent[];
}

export function simulateFlight(
  l: Launch, type: DiscType = DISC_TYPES.dog,
  o: { wind?: Wind; ground?: Ground; maxT?: number; sampleEvery?: number; seed?: number; untilLand?: boolean } = {}
): FlightResult {
  const wind = o.wind ?? Wind.calm(), ground = o.ground ?? FLAT_GROUND;
  const maxT = o.maxT ?? 12, every = o.sampleEvery ?? 1 / 30;
  const d = new Disc(type, o.seed ?? 1);
  d.launch(l);
  const res: FlightResult = { path: [{ t: 0, ...d.pos }], landing: null, landT: -1, final: { ...d.pos }, outcome: 'timeout', maxHeight: d.pos.y, hitObstacle: false, events: [] };
  let nextSample = every;
  while (d.t < maxT) {
    const ev = d.step(STEP, wind, ground);
    for (const e of ev) {
      res.events.push(e);
      if (e.kind === 'land' && !res.landing) { res.landing = { ...e.pos }; res.landT = e.t; }
      if (e.kind === 'obstacle') res.hitObstacle = true;
    }
    res.maxHeight = Math.max(res.maxHeight, d.pos.y);
    if (d.t >= nextSample) { res.path.push({ t: d.t, ...d.pos }); nextSample += every; }
    if (o.untilLand && res.landing) break;
    if (d.stopped) { res.outcome = d.phase === 'water' ? 'water' : 'rest'; break; }
  }
  res.final = { ...d.pos };
  return res;
}

/** Horizontal distance from the launch point. */
export const flatDist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.z - b.z);

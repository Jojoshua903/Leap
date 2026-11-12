import { Rng } from '../tabletennis/BallPhysics';
import { FB_TUNING } from './frisbeeTuning';
import type { DiscPhase, FlightResult, FlightSample, V3 } from './DiscPhysics';

/**
 * The dog. Deterministic for a seed. States:
 *   idle    wanders a few metres out in the field, watching the Buddy
 *   chase   after a reaction delay, picks the earliest point on the predicted flight it can reach in time
 *           (where the disc is low enough to snatch, or jump for, or on its first bounce) and sprints there
 *           with limited acceleration and turning; weaker dogs misjudge the spot a little
 *   jump    leaps when the disc will pass overhead within jump reach
 *   catch   one attempt each time the disc comes within reach of the mouth: the chance depends on the
 *           breed's skill, the disc's speed and wobble, and how far off the ideal spot the mouth was
 *   return  trots back with the disc and drops it at the Buddy
 *   fetch   after a miss: walks to where the disc stopped, picks it up, then returns
 *
 * The prediction is DiscPhysics.simulateFlight with the same seed and wind as the real disc, so the dog's
 * "eye" is good; its skill noise is what makes it miss.
 */
export type DogBreedId = 'mutt' | 'retriever' | 'collie';
export interface DogBreed {
  id: DogBreedId;
  /** Top speed (m/s), acceleration (m/s²), turn rate (rad/s). */
  speed: number; accel: number; turn: number;
  /** How high it can jump (m, extra mouth height). */
  jump: number;
  /** 0..1 catching skill (and how well it reads the flight). */
  skill: number;
  /** Multiplier on the reaction delay. */
  reaction: number;
  /** Coat colours: body, ears/patches, collar. */
  coat: [string, string, string];
  size: number;
}

export const DOG_BREEDS: Record<DogBreedId, DogBreed> = {
  mutt: { id: 'mutt', speed: 8.5, accel: 9, turn: 5, jump: 0.55, skill: 0.4, reaction: 1.4, coat: ['#c98a4b', '#7a4a26', '#ff5a5f'], size: 0.85 },
  retriever: { id: 'retriever', speed: 10, accel: 11, turn: 6, jump: 0.8, skill: 0.72, reaction: 1, coat: ['#e8c27a', '#c9974e', '#2f8fd8'], size: 1 },
  collie: { id: 'collie', speed: 12, accel: 14, turn: 8, jump: 1.15, skill: 1, reaction: 0.7, coat: ['#2b2f38', '#f2f2f2', '#3bb37a'], size: 0.95 }
};

export type DogState = 'idle' | 'chase' | 'jump' | 'return' | 'fetch' | 'drop';
export type DogEvent =
  | { kind: 'catch'; midAir: boolean; leap: boolean; at: V3 }
  | { kind: 'fumble'; at: V3 }
  | { kind: 'miss' }
  | { kind: 'pickup'; at: V3 }
  | { kind: 'returned' };

/** What the dog can see of the disc each step. */
export interface DiscView { pos: V3; phase: DiscPhase; landed: boolean; t: number; speed: number; wobble: number }

const CATCH_R = 0.5;
/** Seconds after the first touch during which a grab still counts ("on the first bounce"). */
const GROUND_WINDOW = 0.8;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export class DogAI {
  readonly pos: V3 = { x: 0, y: 0, z: -6 };
  heading = 0;            // radians, 0 = facing −z (down the field); + turns toward +x
  speed = 0;
  state: DogState = 'idle';
  /** Height of the jump above the ground (m). */
  jumpY = 0;
  carrying = false;
  /** For the debug overlay and the camera. */
  target: V3 | null = null;
  readonly breed: DogBreed;
  private readonly rng: Rng;
  private pred: FlightResult | null = null;
  private react = 0;
  private aimErr = { x: 0, z: 0 };
  private jumpT = -1;
  private jumpDur = 0;
  private jumpH = 0;
  private triedAir = false;
  private triedGround = false;
  private landT = -1;
  private wanderT = 0;
  private wander: V3 = { x: 0, y: 0, z: -7 };
  private dropT = 0;
  private home: V3 = { x: 0, y: 0, z: -1.4 };
  private done = false;
  /** Closest mouth-to-disc distance of the current approach (Infinity = not in reach). */
  private closest = Infinity;

  constructor(breed: DogBreed, seed: number) { this.breed = breed; this.rng = new Rng(seed); }

  get mouthY(): number { return FB_TUNING.dogMouthY * this.breed.size + this.jumpY; }
  get mouth(): V3 {
    return { x: this.pos.x + Math.sin(this.heading) * 0.42 * this.breed.size, y: this.mouthY, z: this.pos.z - Math.cos(this.heading) * 0.42 * this.breed.size };
  }
  get busy(): boolean { return this.state !== 'idle'; }

  /** Back to the Buddy's side (start of a turn), `home` is where the Buddy stands. */
  reset(home: V3, at?: V3): void {
    this.home = { x: home.x, y: 0, z: home.z - 1.4 };
    const p = at ?? { x: home.x + 1.5, y: 0, z: home.z - 6 };
    this.pos.x = p.x; this.pos.y = 0; this.pos.z = p.z;
    this.heading = Math.PI; this.speed = 0; this.state = 'idle'; this.carrying = false;
    this.pred = null; this.target = null; this.jumpT = -1; this.jumpY = 0;
  }

  /** A throw just left the hand; `pred` is its predicted flight. */
  throwStarted(pred: FlightResult): void {
    this.pred = pred;
    this.state = 'chase';
    this.react = FB_TUNING.dogReaction * this.breed.reaction;
    const e = (1 - this.breed.skill) * 1.4;
    this.aimErr = { x: this.rng.gauss() * e, z: this.rng.gauss() * e };
    this.triedAir = false; this.triedGround = false; this.landT = -1; this.done = false; this.closest = Infinity;
    this.target = null;
  }

  /** One step. Returns at most one event. */
  update(dt: number, disc: DiscView | null): DogEvent | null {
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      const k = this.jumpT / this.jumpDur;
      this.jumpY = k >= 1 ? 0 : 4 * this.jumpH * k * (1 - k);
      if (k >= 1) { this.jumpT = -1; if (this.state === 'jump') this.state = 'chase'; }
    }
    switch (this.state) {
      case 'idle': this.idle(dt); return null;
      case 'chase': case 'jump': return this.chase(dt, disc);
      case 'fetch': return this.fetch(dt, disc);
      case 'return': return this.returnHome(dt);
      case 'drop':
        this.dropT -= dt;
        this.move(dt, this.home, 0);
        if (this.dropT <= 0) { this.state = 'idle'; return { kind: 'returned' }; }
        return null;
    }
  }

  private idle(dt: number): void {
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = 1.5 + this.rng.next() * 2.5;
      this.wander = { x: this.home.x + this.rng.signed() * 3, y: 0, z: this.home.z - 4 - this.rng.next() * 4 };
    }
    this.move(dt, this.wander, 2.2);
    if (this.speed < 0.3) this.face(this.home.x, this.home.z, dt);
  }

  /** The earliest predicted sample the dog can get to in time and grab (or jump for). */
  private pickTarget(now: number): { s: FlightSample; jump: boolean } | null {
    const p = this.pred;
    if (!p) return null;
    const reach = FB_TUNING.dogMouthY * this.breed.size + 0.25, jumpReach = reach + this.breed.jump;
    const endT = p.landT >= 0 ? p.landT + GROUND_WINDOW : Infinity;
    let fallback: FlightSample | null = null;
    for (const s of p.path) {
      if (s.t < now + 0.05 || s.t > endT) continue;
      const lowEnough = s.y <= jumpReach;
      if (!lowEnough) continue;
      const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z) - CATCH_R;
      if (this.timeToRun(d) <= s.t - now) return { s, jump: s.y > reach };
      fallback = s;
    }
    // can't make it: run to the last catchable spot anyway (it may still bounce our way)
    return fallback ? { s: fallback, jump: false } : null;
  }

  private timeToRun(d: number): number {
    if (d <= 0) return 0;
    const B = this.breed, v0 = this.speed;
    const tAcc = Math.max(0, (B.speed - v0) / B.accel);
    const dAcc = v0 * tAcc + 0.5 * B.accel * tAcc * tAcc;
    if (d <= dAcc) return (-v0 + Math.sqrt(v0 * v0 + 2 * B.accel * d)) / B.accel;
    return tAcc + (d - dAcc) / B.speed;
  }

  private chase(dt: number, disc: DiscView | null): DogEvent | null {
    if (!disc || this.done) { this.state = 'idle'; return null; }
    if (disc.landed && this.landT < 0) this.landT = disc.t;
    this.react -= dt;
    if (this.react > 0) { this.face(disc.pos.x, disc.pos.z, dt); return null; }

    const pick = this.pickTarget(disc.t);
    if (pick) {
      const far = clamp(Math.hypot(pick.s.x - this.pos.x, pick.s.z - this.pos.z) / 8, 0, 1);
      this.target = { x: pick.s.x + this.aimErr.x * far, y: pick.s.y, z: pick.s.z + this.aimErr.z * far };
      // jump when the disc will pass overhead in about half a jump
      if (pick.jump && this.jumpT < 0 && !disc.landed) {
        const h = clamp(pick.s.y - FB_TUNING.dogMouthY * this.breed.size, 0.2, this.breed.jump);
        const dur = 2 * Math.sqrt(2 * h / 9.81);
        const tArr = pick.s.t - disc.t;
        const near = Math.hypot(pick.s.x - this.pos.x, pick.s.z - this.pos.z) < 1.6;
        if (near && tArr <= dur / 2 + 0.03) { this.jumpT = 0; this.jumpDur = dur; this.jumpH = h; this.state = 'jump'; }
      }
    } else this.target = { x: disc.pos.x, y: 0, z: disc.pos.z };
    // arrive at the spot; slow down to wait for it
    this.move(dt, this.target, this.breed.speed);
    if (Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < 0.6) this.face(disc.pos.x, disc.pos.z, dt);

    // a catch attempt at the closest approach once the disc is within reach of the mouth
    // (on the ground the dog lowers its head, so only the horizontal distance counts)
    const m = this.mouth;
    const inAir = !disc.landed;
    const d = inAir ? Math.hypot(m.x - disc.pos.x, m.y - disc.pos.y, m.z - disc.pos.z) : Math.hypot(m.x - disc.pos.x, m.z - disc.pos.z);
    const groundOk = disc.landed && this.landT >= 0 && disc.t - this.landT <= GROUND_WINDOW && disc.phase !== 'water';
    const canTry = (inAir && !this.triedAir) || (groundOk && !this.triedGround);
    if (canTry && d < CATCH_R && d < this.closest - 1e-4 && d > 0.08) { this.closest = d; return null; }
    if (canTry && (this.closest < CATCH_R || d < CATCH_R)) {
      const at = Math.min(this.closest, d);
      this.closest = Infinity;
      if (inAir) this.triedAir = true; else this.triedGround = true;
      if (this.rng.next() < this.catchChance(disc, at)) {
        this.carrying = true;
        this.done = true;
        const leap = this.jumpY > 0.3;
        this.state = 'return';
        return { kind: 'catch', midAir: inAir, leap: inAir && leap, at: { ...disc.pos } };
      }
      return { kind: 'fumble', at: { ...disc.pos } };
    }
    if (d >= CATCH_R) this.closest = Infinity;
    // too late: the disc is down and past the window, or in the water
    if (disc.phase === 'water' || (disc.landed && this.landT >= 0 && disc.t - this.landT > GROUND_WINDOW)) {
      this.done = true;
      this.state = disc.phase === 'water' ? 'return' : 'fetch';
      return { kind: 'miss' };
    }
    return null;
  }

  /** Chance of holding on once the disc is at the mouth. */
  catchChance(disc: { speed: number; wobble: number }, mouthDist: number): number {
    const B = this.breed, T = FB_TUNING;
    let p = T.dogCatchBase * (0.45 + 0.55 * B.skill);
    p -= Math.max(0, disc.speed - 12) * 0.03 * (1.2 - B.skill);
    p -= 0.3 * disc.wobble * (1.2 - B.skill);
    p -= Math.max(0, mouthDist / CATCH_R - 0.6) * 0.5;
    return clamp(p, 0.02, 0.99);
  }

  private fetch(dt: number, disc: DiscView | null): DogEvent | null {
    if (!disc) { this.state = 'return'; return null; }
    if (disc.phase !== 'rest' && disc.phase !== 'skid' && disc.phase !== 'roll') { this.move(dt, disc.pos, this.breed.speed * 0.7); return null; }
    this.move(dt, disc.pos, this.breed.speed * 0.6);
    if (Math.hypot(this.mouth.x - disc.pos.x, this.mouth.z - disc.pos.z) < 0.55) {
      this.carrying = true;
      this.state = 'return';
      return { kind: 'pickup', at: { ...disc.pos } };
    }
    return null;
  }

  private returnHome(dt: number): DogEvent | null {
    this.move(dt, this.home, this.breed.speed * 0.55);
    if (Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z) < 0.5) {
      this.state = 'drop';
      this.dropT = 0.5;
      this.carrying = false;
      this.face(this.home.x, this.home.z + 2, 1);
    }
    return null;
  }

  /** Steer toward a point with the breed's acceleration and turn limits, braking to arrive. */
  private move(dt: number, to: V3, maxSpeed: number): void {
    const B = this.breed;
    const dx = to.x - this.pos.x, dz = to.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.05) this.face(to.x, to.z, dt);
    const brake = Math.sqrt(2 * B.accel * Math.max(0, d - 0.2));
    const want = Math.min(maxSpeed, brake);
    this.speed += clamp(want - this.speed, -B.accel * 1.6 * dt, B.accel * dt);
    if (this.speed < 0) this.speed = 0;
    // a turning dog loses some speed
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z -= Math.cos(this.heading) * this.speed * dt;
  }

  private face(x: number, z: number, dt: number): void {
    const want = Math.atan2(x - this.pos.x, -(z - this.pos.z));
    let d = want - this.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const max = this.breed.turn * dt;
    this.heading += clamp(d, -max, max);
    if (Math.abs(d) > 1.2) this.speed *= 1 - Math.min(0.5, dt * 2);
  }
}

import type { BuddyRig, Expression, JointName } from './BuddyBuilder';

/**
 * Small pose-based animation system for Buddies.
 *
 * A state is a function of time that returns a pose (rotation/offset per joint). Switching states blends
 * from the current pose over `blend` seconds. Per-joint overrides let a sport drive a joint live, e.g.
 * bowling sets the right shoulder from the player's real swing angle while aiming.
 *
 * Sports add their own states with `BuddyAnimator.define(name, state)`, so the system grows without edits here.
 */
export interface Channels { rx: number; ry: number; rz: number; y: number }
export type Pose = Partial<Record<JointName, Partial<Channels>>>;

export interface AnimState {
  /** Seconds. Non-looping states hold their last pose (or play `next`) after this. */
  duration: number;
  loop: boolean;
  next?: string;
  expression?: Expression;
  pose(t: number, params: Record<string, number>): Pose;
}

const JOINTS: JointName[] = ['root', 'hips', 'spine', 'neck', 'head', 'shoulderL', 'shoulderR', 'handL', 'handR', 'hipL', 'hipR'];
const MIRROR: Partial<Record<JointName, JointName>> = { shoulderL: 'shoulderR', shoulderR: 'shoulderL', handL: 'handR', handR: 'handL', hipL: 'hipR', hipR: 'hipL' };
const ZERO: Channels = { rx: 0, ry: 0, rz: 0, y: 0 };

const REGISTRY = new Map<string, AnimState>();

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const seg = (t: number, a: number, b: number) => ease((t - a) / (b - a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export class BuddyAnimator {
  static define(name: string, state: AnimState): void { REGISTRY.set(name, state); }
  static has(name: string): boolean { return REGISTRY.has(name); }

  /** Swap left/right so a left-handed player throws with the left arm. */
  mirror = false;
  current = 'idle';
  private t = 0;
  private params: Record<string, number> = {};
  private blendDur = 0;
  private blendT = 0;
  private from = new Map<JointName, Channels>();
  private now = new Map<JointName, Channels>();
  private base = new Map<JointName, { y: number }>();
  private overrides = new Map<JointName, (c: Channels) => Partial<Channels> | null>();
  private onDone: (() => void) | null = null;

  constructor(private rig: BuddyRig) {
    // Shoulders: raise sideways (z), then swing (x), then turn inward (y), so "arm forward and across the chest" works.
    rig.joints.shoulderL.rotation.order = 'YXZ';
    rig.joints.shoulderR.rotation.order = 'YXZ';
    for (const j of JOINTS) {
      this.base.set(j, { y: rig.joints[j].position.y });
      this.now.set(j, { ...ZERO });
    }
    this.play('idle', { blend: 0 });
  }

  /** `startAt` starts the state part-way in (seconds), so a swing can be lined up with a contact that is already close. */
  play(name: string, o: { blend?: number; params?: Record<string, number>; restart?: boolean; onDone?: () => void; startAt?: number } = {}): void {
    if (!REGISTRY.has(name)) name = 'idle';
    if (name === this.current && !o.restart) { if (o.params) this.params = o.params; return; }
    for (const j of JOINTS) this.from.set(j, { ...this.now.get(j)! });
    this.current = name;
    this.t = Math.max(0, o.startAt ?? 0);
    this.params = o.params ?? {};
    this.blendDur = o.blend ?? 0.2;
    this.blendT = 0;
    this.onDone = o.onDone ?? null;
    const ex = REGISTRY.get(name)!.expression;
    this.rig.setExpression(ex ?? 'normal');
  }

  setParam(k: string, v: number): void { this.params[k] = v; }

  /** Drive one joint directly. Return null from the function to fall back to the animation. */
  setOverride(joint: JointName, fn: ((c: Channels) => Partial<Channels> | null) | null): void {
    if (fn) this.overrides.set(joint, fn); else this.overrides.delete(joint);
  }

  get time(): number { return this.t; }

  update(dt: number): void {
    let name = this.current;
    let st = REGISTRY.get(name)!;
    this.t += dt;
    if (!st.loop && this.t >= st.duration) {
      const done = this.onDone; this.onDone = null;
      done?.();
      // onDone may already have started another state; only follow `next` if it didn't.
      if (this.current === name && st.next) this.play(st.next, { blend: 0.3 });
      name = this.current; st = REGISTRY.get(name)!;
    }
    const t = st.loop ? this.t % st.duration : Math.min(this.t, st.duration);
    const pose = st.pose(t, this.params);
    this.blendT += dt;
    const k = this.blendDur > 0 ? ease(this.blendT / this.blendDur) : 1;

    for (const j of JOINTS) {
      const src = this.mirror ? (MIRROR[j] ?? j) : j;
      const p = pose[src];
      let target: Channels = { rx: p?.rx ?? 0, ry: p?.ry ?? 0, rz: p?.rz ?? 0, y: p?.y ?? 0 };
      if (this.mirror) target = { ...target, ry: -target.ry, rz: -target.rz };
      const ov = this.overrides.get(j);
      if (ov) { const o = ov(target); if (o) target = { ...target, ...o }; }
      const f = this.from.get(j)!;
      const c: Channels = k >= 1 ? target : { rx: lerp(f.rx, target.rx, k), ry: lerp(f.ry, target.ry, k), rz: lerp(f.rz, target.rz, k), y: lerp(f.y, target.y, k) };
      this.now.set(j, c);
      const obj = this.rig.joints[j];
      obj.rotation.set(c.rx, c.ry, c.rz);
      obj.position.y = this.base.get(j)!.y + c.y;
    }
  }
}

/* ---------------- built-in states ---------------- */

const breathe = (t: number) => Math.sin(t * 2.2);

BuddyAnimator.define('idle', {
  duration: Math.PI * 2 / 0.7 * 4, loop: true,
  pose: t => ({
    hips: { y: 0.006 * breathe(t) },
    spine: { rx: 0.02 * breathe(t) },
    head: { ry: 0.12 * Math.sin(t * 0.7), rz: 0.04 * Math.sin(t * 0.5) },
    shoulderL: { rz: -0.12 - 0.03 * breathe(t) },
    shoulderR: { rz: 0.12 + 0.03 * breathe(t) }
  })
});

/** Holding a ball at the chest, ready to step up. Right arm carries, left hand supports. */
BuddyAnimator.define('hold', {
  duration: 4, loop: true,
  pose: t => ({
    hips: { y: 0.005 * breathe(t) },
    spine: { rx: 0.08 },
    head: { rx: 0.12 },
    shoulderR: { rx: -0.9, ry: -0.35, rz: 0.15 },
    shoulderL: { rx: -0.8, ry: 0.45, rz: -0.1 }
  })
});

/**
 * Aiming: the right arm is driven by the `swing` param (radians, + = back, − = forward),
 * usually fed live from the controller. The body leans into it.
 */
BuddyAnimator.define('aim', {
  duration: 4, loop: true, expression: 'focus',
  pose: (_t, p) => {
    const s = p.swing ?? 0;
    return {
      spine: { rx: 0.3 + Math.max(0, s) * 0.1, ry: -0.08 },
      hips: { y: -0.05 },
      head: { rx: -0.1 },
      hipL: { rx: -0.25 }, hipR: { rx: 0.15 },
      shoulderR: { rx: s, rz: 0.08 },
      shoulderL: { rx: -0.35, rz: -0.55 }
    };
  }
});

/** Release and follow-through. Plays after the ball leaves the hand. */
BuddyAnimator.define('throw', {
  duration: 1.2, loop: false, next: 'watch',
  pose: t => {
    const fwd = seg(t, 0, 0.18), settle = seg(t, 0.6, 1.2);
    return {
      hips: { y: lerp(-0.12, -0.06, settle) },
      spine: { rx: lerp(0.45, 0.25, settle) },
      hipL: { rx: -0.65 }, hipR: { rx: lerp(0.55, 0.4, settle), rz: 0.15 },
      shoulderR: { rx: lerp(-0.2, -1.9, fwd) + 0.3 * settle, rz: 0.05 },
      shoulderL: { rx: -0.3, rz: lerp(-0.8, -0.6, settle) },
      head: { rx: -0.25 }
    };
  }
});

/** Standing up and watching the ball roll, hands near the chest. */
BuddyAnimator.define('watch', {
  duration: 3, loop: true,
  pose: t => ({
    spine: { rx: 0.12 + 0.02 * Math.sin(t * 4) },
    head: { rx: -0.08 },
    shoulderR: { rx: -0.7, ry: -0.5, rz: 0.2 },
    shoulderL: { rx: -0.7, ry: 0.5, rz: -0.2 }
  })
});

BuddyAnimator.define('strike', {
  duration: 0.7, loop: true, expression: 'happy',
  pose: t => {
    const j = Math.abs(Math.sin((t / 0.7) * Math.PI));
    return {
      hips: { y: 0.16 * j },
      spine: { rx: -0.12 },
      head: { rx: -0.2 },
      shoulderL: { rz: -2.7 + 0.2 * j, rx: -0.2 },
      shoulderR: { rz: 2.7 - 0.2 * j, rx: -0.2 },
      hipL: { rx: -0.3 * j }, hipR: { rx: 0.3 * j }
    };
  }
});

BuddyAnimator.define('spare', {
  duration: 0.8, loop: true, expression: 'happy',
  pose: t => {
    const pump = Math.sin((t / 0.8) * Math.PI * 2);
    return {
      hips: { y: 0.03 * Math.abs(pump) },
      spine: { rx: 0.05 },
      shoulderR: { rx: -1.4 - 0.5 * pump, rz: 0.35 },
      shoulderL: { rz: -0.25 },
      head: { rz: 0.08 * pump }
    };
  }
});

BuddyAnimator.define('gutterShrug', {
  duration: 1.6, loop: false, next: 'idle', expression: 'sad',
  pose: t => {
    const up = seg(t, 0, 0.3) * (1 - seg(t, 1.1, 1.6));
    return {
      hips: { y: 0.03 * up },
      spine: { rx: -0.05 * up },
      head: { rz: 0.28 * up, rx: 0.1 },
      shoulderL: { rz: -0.9 * up, rx: -0.5 * up },
      shoulderR: { rz: 0.9 * up, rx: -0.5 * up }
    };
  }
});

BuddyAnimator.define('shocked', {
  duration: 1.4, loop: false, next: 'idle', expression: 'shocked',
  pose: t => {
    const jolt = seg(t, 0, 0.12), relax = seg(t, 0.9, 1.4);
    const k = jolt * (1 - relax * 0.6);
    return {
      hips: { y: 0.06 * jolt * (1 - seg(t, 0.12, 0.35)) },
      spine: { rx: -0.2 * k },
      head: { rx: -0.15 * k },
      shoulderL: { rz: -1.5 * k, rx: -0.7 * k },
      shoulderR: { rz: 1.5 * k, rx: -0.7 * k }
    };
  }
});

/** Podium winner: jumping with one arm waving. */
BuddyAnimator.define('cheer', {
  duration: 0.9, loop: true, expression: 'happy',
  pose: t => {
    const j = Math.abs(Math.sin((t / 0.9) * Math.PI));
    const wave = Math.sin((t / 0.9) * Math.PI * 4);
    return {
      hips: { y: 0.12 * j },
      shoulderR: { rz: 2.6 + 0.25 * wave },
      shoulderL: { rz: -2.2, rx: -0.3 },
      head: { rz: 0.1 * wave }
    };
  }
});

BuddyAnimator.define('clap', {
  duration: 0.4, loop: true, expression: 'happy',
  pose: t => {
    const c = Math.sin((t / 0.4) * Math.PI * 2) * 0.5 + 0.5;
    return {
      hips: { y: 0.01 * c },
      shoulderR: { rx: -1.2, ry: -0.3 - 0.35 * c },
      shoulderL: { rx: -1.2, ry: 0.3 + 0.35 * c }
    };
  }
});

BuddyAnimator.define('sad', {
  duration: 3, loop: true, expression: 'sad',
  pose: t => ({
    spine: { rx: 0.2 },
    head: { rx: 0.35, rz: 0.05 * Math.sin(t) },
    shoulderL: { rz: -0.05 }, shoulderR: { rz: 0.05 }
  })
});

BuddyAnimator.define('wave', {
  duration: 0.6, loop: true, expression: 'happy',
  pose: t => ({
    shoulderR: { rz: 2.3 + 0.35 * Math.sin((t / 0.6) * Math.PI * 2) },
    shoulderL: { rz: -0.12 },
    head: { rz: -0.08 }
  })
});

/* ---------------- table tennis ----------------
 * Every swing reaches the ball at TT_CONTACT_AT seconds into the state. Scenes start the state with
 * startAt = TT_CONTACT_AT − (time until contact), so the arm is at its peak exactly at contact.
 * The Buddy holds the paddle in the right hand (mirror for left-handers).
 */
export const TT_CONTACT_AT = 0.18;

/** Knees bent, paddle in front, a light bounce on the toes. */
BuddyAnimator.define('ttReady', {
  duration: 0.8, loop: true, expression: 'focus',
  pose: t => {
    const b = Math.sin((t / 0.8) * Math.PI * 2);
    return {
      hips: { y: -0.07 + 0.012 * b },
      spine: { rx: 0.32 },
      head: { rx: -0.22 },
      hipL: { rx: -0.25 }, hipR: { rx: -0.25 },
      shoulderR: { rx: -0.75, ry: -0.2, rz: 0.4 },
      shoulderL: { rx: -0.5, rz: -0.35 }
    };
  }
});

/** Shared shape of a swing: wind-up → fast to contact → follow-through → back to ready. */
const swingK = (t: number) => ({
  wind: seg(t, 0, 0.12) * (1 - seg(t, 0.12, TT_CONTACT_AT)),
  hit: seg(t, 0.12, TT_CONTACT_AT),
  follow: seg(t, TT_CONTACT_AT, 0.34),
  back: seg(t, 0.38, 0.6)
});

BuddyAnimator.define('ttForehand', {
  duration: 0.6, loop: false, next: 'ttReady', expression: 'focus',
  pose: t => {
    const k = swingK(t), live = 1 - k.back;
    const turn = lerp(-0.55 * k.wind, 0.55, k.hit) * live + 0.1 * k.follow * live;
    return {
      hips: { y: -0.08 },
      spine: { rx: 0.3, ry: turn },
      head: { rx: -0.2, ry: -turn * 0.5 },
      hipL: { rx: -0.3 }, hipR: { rx: 0.1 },
      shoulderR: { rx: lerp(-0.75, -1.15, k.hit) * live - 0.75 * k.back, ry: lerp(0.9 * k.wind, -0.9, k.hit) * live, rz: lerp(0.4, 1.1, Math.max(k.wind, k.hit)) * live + 0.4 * k.back },
      shoulderL: { rx: -0.5, rz: -0.45 }
    };
  }
});

BuddyAnimator.define('ttBackhand', {
  duration: 0.6, loop: false, next: 'ttReady', expression: 'focus',
  pose: t => {
    const k = swingK(t), live = 1 - k.back;
    const turn = lerp(0.4 * k.wind, -0.3, k.hit) * live;
    return {
      hips: { y: -0.08 },
      spine: { rx: 0.34, ry: turn },
      head: { rx: -0.2 },
      hipL: { rx: 0.1 }, hipR: { rx: -0.3 },
      shoulderR: { rx: lerp(-0.9, -1.3, k.hit) * live - 0.75 * k.back, ry: lerp(-1.1 * k.wind - 0.2, 0.55, k.hit) * live - 0.2 * k.back, rz: lerp(0.3, 0.7, k.hit) * live + 0.4 * k.back },
      shoulderL: { rx: -0.45, rz: -0.3 }
    };
  }
});

/** Overhead smash: arm up high, then down through the ball, with a little hop. */
BuddyAnimator.define('ttSmash', {
  duration: 0.7, loop: false, next: 'ttReady', expression: 'happy',
  pose: t => {
    const up = seg(t, 0, 0.12), hit = seg(t, 0.12, TT_CONTACT_AT), back = seg(t, 0.4, 0.7);
    const live = 1 - back;
    return {
      hips: { y: (0.06 * up * (1 - hit) - 0.1 * hit) * live - 0.07 * back },
      spine: { rx: lerp(-0.1, 0.55, hit) * live + 0.32 * back, ry: lerp(-0.3, 0.4, hit) * live },
      head: { rx: lerp(-0.4, -0.1, hit) },
      shoulderR: { rx: lerp(-2.7 * up, -0.4, hit) * live - 0.75 * back, rz: 0.5 * live + 0.4 * back },
      shoulderL: { rx: -1.2 * up * (1 - hit) - 0.5, rz: -0.4 }
    };
  }
});

/** A big step out to reach a wide or short ball. */
BuddyAnimator.define('ttLunge', {
  duration: 0.75, loop: false, next: 'ttReady', expression: 'shocked',
  pose: t => {
    const reach = seg(t, 0, TT_CONTACT_AT), back = seg(t, 0.4, 0.75), k = reach * (1 - back);
    return {
      hips: { y: -0.16 * k - 0.07 * back },
      spine: { rx: 0.32 + 0.3 * k },
      hipL: { rx: -0.85 * k }, hipR: { rx: 0.55 * k },
      shoulderR: { rx: -0.75 - 0.6 * k, rz: 0.4 + 0.5 * k },
      shoulderL: { rx: -0.3, rz: -0.9 * k - 0.3 }
    };
  }
});

/** Serve: the free hand throws the ball up while the paddle arm cocks back. Holds until the hit. */
BuddyAnimator.define('ttServe', {
  duration: 0.9, loop: false, expression: 'focus',
  pose: t => {
    const toss = seg(t, 0, 0.2), cock = seg(t, 0.05, 0.3);
    return {
      hips: { y: -0.05 },
      spine: { rx: 0.25, ry: -0.35 * cock },
      head: { rx: -0.35 * toss },
      shoulderL: { rx: -0.6 - 1.4 * toss, rz: -0.3 },
      shoulderR: { rx: -0.6, ry: 0.8 * cock, rz: 0.4 + 0.5 * cock }
    };
  }
});

/** Point won: fist pumps and a jump. */
BuddyAnimator.define('ttCelebrate', {
  duration: 0.6, loop: true, expression: 'happy',
  pose: t => {
    const j = Math.abs(Math.sin((t / 0.6) * Math.PI));
    const pump = Math.sin((t / 0.6) * Math.PI * 2);
    return {
      hips: { y: 0.1 * j },
      spine: { rx: -0.1 },
      head: { rx: -0.2 },
      shoulderR: { rz: 2.4 + 0.3 * pump, rx: -0.3 },
      shoulderL: { rz: -1.0, rx: -1.0 - 0.3 * pump }
    };
  }
});

/** Point lost: shoulders drop, head shakes. */
BuddyAnimator.define('ttDisappointed', {
  duration: 1.6, loop: false, next: 'ttReady', expression: 'sad',
  pose: t => {
    const k = seg(t, 0, 0.25) * (1 - seg(t, 1.2, 1.6));
    return {
      hips: { y: -0.03 * k },
      spine: { rx: 0.35 * k },
      head: { rx: 0.4 * k, ry: 0.25 * Math.sin(t * 9) * k },
      shoulderR: { rx: -0.3 * k, rz: 0.15 },
      shoulderL: { rx: -0.1, rz: -0.1 }
    };
  }
});

/* ---------------- basketball ----------------
 * The shot is three states so the release can land exactly on the flick peak:
 *   bbSet (trigger held: crouched, ball up) → bbRise (the jump: arms go up) → bbShoot, started AT the release,
 * so its t = 0 is the moment the ball leaves the hands. The ball is drawn by the scene, between the hands.
 * Dribbling is driven by params: `hand` (1 = right, −1 = left) and `high` (0 = low, 1 = high/sprint).
 * One bounce takes BB_DRIBBLE_PERIOD seconds; the hand is at the top at t = 0.
 */
export const BB_DRIBBLE_PERIOD = 0.5;
export const BB_PASS_AT = 0.14;

BuddyAnimator.define('bbReady', {
  duration: 1, loop: true, expression: 'focus',
  pose: t => {
    const b = Math.sin((t / 1) * Math.PI * 2);
    return {
      hips: { y: -0.06 + 0.01 * b },
      spine: { rx: 0.22 },
      head: { rx: -0.15 },
      hipL: { rx: -0.2 }, hipR: { rx: -0.2 },
      shoulderR: { rx: -0.85, ry: -0.45, rz: 0.15 },
      shoulderL: { rx: -0.85, ry: 0.45, rz: -0.15 }
    };
  }
});

BuddyAnimator.define('bbDribble', {
  duration: BB_DRIBBLE_PERIOD, loop: true, expression: 'focus',
  pose: (t, p) => {
    const hand = (p.hand ?? 1) >= 0 ? 1 : -1, high = p.high ?? 0;
    const ph = (t / BB_DRIBBLE_PERIOD) * Math.PI * 2;
    const push = 0.5 - 0.5 * Math.cos(ph);                  // 0 at the top, 1 when the ball hits the floor
    const arm = { rx: -0.55 - 0.35 * high + 0.35 * push, rz: 0.25, ry: 0 };
    const free = { rx: -0.6, rz: 0.35, ry: 0 };
    const bounce = Math.abs(Math.sin(ph)) * 0.02;
    return {
      hips: { y: -0.08 + 0.05 * high + bounce },
      spine: { rx: 0.32 - 0.12 * high, ry: -0.12 * hand },
      head: { rx: -0.25 },
      hipL: { rx: -0.25 - 0.15 * Math.sin(ph) * high }, hipR: { rx: -0.25 + 0.15 * Math.sin(ph) * high },
      shoulderR: hand > 0 ? arm : { ...free, rz: 0.5 },
      shoulderL: hand > 0 ? { ...free, rz: -0.5 } : { ...arm, rz: -0.25 }
    };
  }
});

/** Shot set: crouched, ball held up in front of the forehead. */
BuddyAnimator.define('bbSet', {
  duration: 1.2, loop: true, expression: 'focus',
  pose: t => ({
    hips: { y: -0.13 + 0.008 * Math.sin(t * 6) },
    spine: { rx: 0.12 },
    head: { rx: -0.3 },
    hipL: { rx: -0.45 }, hipR: { rx: -0.45 },
    shoulderR: { rx: -2.0, ry: -0.35, rz: 0.1 },
    shoulderL: { rx: -1.9, ry: 0.5, rz: -0.1 }
  })
});

/** The jump: legs extend, arms lift the ball overhead. Holds at the top until the release. */
BuddyAnimator.define('bbRise', {
  duration: 0.3, loop: false, expression: 'focus',
  pose: t => {
    const k = seg(t, 0, 0.3);
    return {
      hips: { y: lerp(-0.13, 0, k) },
      spine: { rx: lerp(0.12, -0.05, k) },
      head: { rx: -0.35 },
      hipL: { rx: lerp(-0.45, 0.1, k) }, hipR: { rx: lerp(-0.45, 0.15, k) },
      shoulderR: { rx: lerp(-2.0, -2.75, k), ry: -0.25, rz: 0.08 },
      shoulderL: { rx: lerp(-1.9, -2.45, k), ry: 0.45, rz: -0.08 }
    };
  }
});

/** t = 0 is the release: the shooting arm snaps up and the wrist follows through, then back to ready. */
BuddyAnimator.define('bbShoot', {
  duration: 0.95, loop: false, next: 'bbReady', expression: 'focus',
  pose: t => {
    const snap = seg(t, 0, 0.08), hold = 1 - seg(t, 0.5, 0.95);
    return {
      hips: { y: -0.02 * hold },
      spine: { rx: -0.06 * hold + 0.2 * (1 - hold) },
      head: { rx: -0.35 * hold },
      hipL: { rx: 0.05 }, hipR: { rx: 0.1 },
      shoulderR: { rx: lerp(-2.75, -2.95, snap) * hold - 0.85 * (1 - hold), ry: -0.2, rz: 0.06 },
      shoulderL: { rx: lerp(-2.45, -2.1, snap) * hold - 0.85 * (1 - hold), ry: 0.4 * hold, rz: -0.25 * snap }
    };
  }
});

/** Chest pass: both arms push forward; the ball leaves at BB_PASS_AT. */
BuddyAnimator.define('bbPass', {
  duration: 0.45, loop: false, next: 'bbReady', expression: 'focus',
  pose: t => {
    const push = seg(t, 0.02, BB_PASS_AT), back = seg(t, 0.26, 0.45);
    const k = push * (1 - back);
    return {
      hips: { y: -0.07 },
      spine: { rx: 0.2 + 0.15 * k },
      hipL: { rx: -0.5 * k }, hipR: { rx: 0.2 * k },
      shoulderR: { rx: lerp(-0.9, -1.55, k), ry: lerp(-0.6, -0.1, k), rz: 0.1 },
      shoulderL: { rx: lerp(-0.9, -1.55, k), ry: lerp(0.6, 0.1, k), rz: -0.1 }
    };
  }
});

/** Steal swipe: a quick low sweep with the near arm. param `dir`: 1 = to the Buddy's right. */
BuddyAnimator.define('bbSteal', {
  duration: 0.5, loop: false, next: 'bbDefend', expression: 'shocked',
  pose: (t, p) => {
    const d = (p.dir ?? 1) >= 0 ? 1 : -1;
    const k = seg(t, 0, 0.14) * (1 - seg(t, 0.3, 0.5));
    return {
      hips: { y: -0.14 * k - 0.06 },
      spine: { rx: 0.45 * k + 0.2, ry: -0.4 * d * k },
      hipL: { rx: -0.6 * k }, hipR: { rx: 0.3 * k },
      shoulderR: d > 0 ? { rx: -1.3 * k - 0.4, ry: lerp(0.6, -0.7, k), rz: 0.3 } : { rx: -0.5, rz: 0.4 },
      shoulderL: d < 0 ? { rx: -1.3 * k - 0.4, ry: lerp(-0.6, 0.7, k), rz: -0.3 } : { rx: -0.5, rz: -0.4 }
    };
  }
});

/** Block jump: both arms straight up. The scene moves the whole Buddy up for the jump. */
BuddyAnimator.define('bbBlock', {
  duration: 0.75, loop: false, next: 'bbDefend', expression: 'shocked',
  pose: t => {
    const k = seg(t, 0, 0.12) * (1 - seg(t, 0.5, 0.75));
    return {
      hips: { y: -0.1 * (1 - k) * seg(t, 0, 0.05) },
      spine: { rx: -0.05 },
      head: { rx: -0.4 * k },
      hipL: { rx: 0.15 * k }, hipR: { rx: 0.2 * k },
      shoulderR: { rx: -0.8 - 2.15 * k, rz: 0.15 + 0.15 * k },
      shoulderL: { rx: -0.8 - 2.15 * k, rz: -0.15 - 0.15 * k }
    };
  }
});

/** Defensive stance: low, wide, arms out, shuffling. */
BuddyAnimator.define('bbDefend', {
  duration: 0.7, loop: true, expression: 'focus',
  pose: t => {
    const s = Math.sin((t / 0.7) * Math.PI * 2);
    return {
      hips: { y: -0.12 + 0.01 * Math.abs(s) },
      spine: { rx: 0.35 },
      head: { rx: -0.3 },
      hipL: { rx: -0.35, rz: -0.25 }, hipR: { rx: -0.35, rz: 0.25 },
      shoulderR: { rx: -0.9 + 0.1 * s, rz: 0.75 },
      shoulderL: { rx: -0.9 - 0.1 * s, rz: -0.75 }
    };
  }
});

BuddyAnimator.define('bbCelebrate', {
  duration: 0.6, loop: true, expression: 'happy',
  pose: t => {
    const j = Math.abs(Math.sin((t / 0.6) * Math.PI));
    const pump = Math.sin((t / 0.6) * Math.PI * 2);
    return {
      hips: { y: 0.12 * j },
      spine: { rx: -0.12 },
      head: { rx: -0.25 },
      shoulderR: { rz: 2.5 + 0.3 * pump, rx: -0.2 },
      shoulderL: { rz: -2.5 - 0.3 * pump, rx: -0.2 }
    };
  }
});

/** Missed it: hands go to the head, then drop. */
BuddyAnimator.define('bbDisappointed', {
  duration: 1.5, loop: false, next: 'bbReady', expression: 'sad',
  pose: t => {
    const k = seg(t, 0, 0.25) * (1 - seg(t, 1.1, 1.5));
    return {
      hips: { y: -0.02 * k },
      spine: { rx: -0.1 * k },
      head: { rx: -0.25 * k, rz: 0.1 * Math.sin(t * 6) * k },
      shoulderR: { rx: -2.6 * k, rz: 0.9 * k, ry: -0.6 * k },
      shoulderL: { rx: -2.6 * k, rz: -0.9 * k, ry: 0.6 * k }
    };
  }
});

/* ---------------- frisbee ----------------
 * The throw is two states so the release lands exactly on the flick peak:
 *   fbGrip (trigger held: wound up, the disc held back) → fbBackhand / fbForehand / fbPutt, started AT the
 *   release, so t = 0 is the moment the disc leaves the hand. The scene draws the disc at the right hand.
 * fbGrip's param `fh` = 1 winds up for a forehand, `putt` = 1 for a putt.
 */
BuddyAnimator.define('fbReady', {
  duration: 2, loop: true,
  pose: t => {
    const b = Math.sin((t / 2) * Math.PI * 2);
    return {
      hips: { y: -0.02 + 0.008 * b },
      spine: { rx: 0.06 },
      hipL: { rx: -0.05 }, hipR: { rx: -0.05 },
      shoulderR: { rx: -0.55, ry: -0.35, rz: 0.12 },
      shoulderL: { rx: -0.2, rz: -0.18 + 0.03 * b }
    };
  }
});

BuddyAnimator.define('fbGrip', {
  duration: 1.4, loop: true, expression: 'focus',
  pose: (t, p) => {
    const fh = (p.fh ?? 0) > 0.5, putt = (p.putt ?? 0) > 0.5;
    const s = 0.01 * Math.sin(t * 5);
    if (putt) return {
      hips: { y: -0.1 + s }, spine: { rx: 0.25 }, head: { rx: -0.2 },
      hipL: { rx: -0.45 }, hipR: { rx: 0.1 },
      shoulderR: { rx: -0.6, ry: -0.2, rz: 0.1 }, shoulderL: { rx: -0.5, rz: -0.3 }
    };
    if (fh) return {
      hips: { y: -0.06 + s }, spine: { rx: 0.15, ry: -0.45 }, head: { ry: 0.35 },
      hipL: { rx: -0.3 }, hipR: { rx: 0.15 },
      shoulderR: { rx: -0.9, ry: 0.75, rz: 0.75 }, shoulderL: { rx: -0.4, rz: -0.45 }
    };
    return {
      hips: { y: -0.07 + s }, spine: { rx: 0.18, ry: 0.65 }, head: { ry: -0.5 },
      hipL: { rx: 0.1 }, hipR: { rx: -0.35 },
      shoulderR: { rx: -1.35, ry: -1.25, rz: 0.2 }, shoulderL: { rx: -0.3, ry: 0.3, rz: -0.5 }
    };
  }
});

/** t = 0 is the release: the arm finishes its sweep out to the right and the torso unwinds. */
BuddyAnimator.define('fbBackhand', {
  duration: 0.9, loop: false, next: 'fbReady', expression: 'focus',
  pose: t => {
    const k = seg(t, 0, 0.12), back = seg(t, 0.45, 0.9);
    return {
      hips: { y: -0.05 * (1 - back) },
      spine: { rx: 0.12 * (1 - back), ry: lerp(0.1, -0.55, k) * (1 - back) },
      head: { ry: 0.2 * (1 - back) },
      hipL: { rx: -0.3 * (1 - back) }, hipR: { rx: 0.25 * (1 - back) },
      shoulderR: { rx: lerp(-1.5, -1.4, k) * (1 - back) - 0.55 * back, ry: lerp(-0.2, 0.9, k) * (1 - back) - 0.35 * back, rz: 0.2 + 0.25 * k * (1 - back) },
      shoulderL: { rx: -0.3, rz: lerp(-0.5, -0.8, k) * (1 - back) - 0.18 * back }
    };
  }
});

/** Forehand (sidearm): the arm whips forward across the body to the left. */
BuddyAnimator.define('fbForehand', {
  duration: 0.9, loop: false, next: 'fbReady', expression: 'focus',
  pose: t => {
    const k = seg(t, 0, 0.12), back = seg(t, 0.45, 0.9);
    return {
      hips: { y: -0.05 * (1 - back) },
      spine: { rx: 0.15 * (1 - back), ry: lerp(-0.1, 0.5, k) * (1 - back) },
      hipL: { rx: -0.35 * (1 - back) }, hipR: { rx: 0.2 * (1 - back) },
      shoulderR: { rx: lerp(-1.1, -1.3, k) * (1 - back) - 0.55 * back, ry: lerp(0.2, -0.9, k) * (1 - back) - 0.35 * back, rz: lerp(0.6, 0.3, k) * (1 - back) + 0.12 * back },
      shoulderL: { rx: -0.35, rz: -0.45 }
    };
  }
});

/** Putt: a short push forward with a step, the arm held out at the end. */
BuddyAnimator.define('fbPutt', {
  duration: 0.8, loop: false, next: 'fbReady', expression: 'focus',
  pose: t => {
    const k = seg(t, 0, 0.1), back = seg(t, 0.5, 0.8);
    return {
      hips: { y: -0.08 * (1 - back) },
      spine: { rx: 0.25 * (1 - back) },
      hipL: { rx: -0.5 * (1 - back) }, hipR: { rx: 0.15 * (1 - back) },
      shoulderR: { rx: lerp(-0.7, -1.45, k) * (1 - back) - 0.55 * back, ry: -0.1, rz: 0.08 },
      shoulderL: { rx: -0.45, rz: -0.35 }
    };
  }
});

BuddyAnimator.define('fbWalk', {
  duration: 0.7, loop: true,
  pose: t => {
    const s = Math.sin((t / 0.7) * Math.PI * 2);
    return {
      hips: { y: 0.02 * Math.abs(s) },
      spine: { rx: 0.05, ry: 0.06 * s },
      hipL: { rx: 0.5 * s }, hipR: { rx: -0.5 * s },
      shoulderR: { rx: 0.35 * s - 0.2, rz: 0.1 },
      shoulderL: { rx: -0.35 * s, rz: -0.1 }
    };
  }
});

BuddyAnimator.define('fbCelebrate', {
  duration: 0.7, loop: true, expression: 'happy',
  pose: t => {
    const j = Math.abs(Math.sin((t / 0.7) * Math.PI));
    const w = Math.sin((t / 0.7) * Math.PI * 2);
    return {
      hips: { y: 0.1 * j },
      spine: { rx: -0.1 },
      head: { rx: -0.2 },
      shoulderR: { rz: 2.6 + 0.25 * w, rx: -0.1 },
      shoulderL: { rz: -2.3 - 0.25 * w, rx: -0.1 }
    };
  }
});

BuddyAnimator.define('fbDisappointed', {
  duration: 1.4, loop: false, next: 'fbReady', expression: 'sad',
  pose: t => {
    const k = seg(t, 0, 0.25) * (1 - seg(t, 1, 1.4));
    return {
      hips: { y: -0.03 * k },
      spine: { rx: 0.3 * k },
      head: { rx: 0.35 * k, ry: 0.25 * Math.sin(t * 5) * k },
      shoulderR: { rx: -0.2 * k, rz: 0.15 },
      shoulderL: { rx: -0.2 * k, rz: -0.15 }
    };
  }
});

/* ---------------- swordplay ----------------
 * Body clips only: the sword arm is driven live by arm IK toward the hilt (see `armTowards`), for the player
 * from the controller and for AI fighters from their scripted blade path. The clips still give the sword arm
 * (authored on shoulderR, as everywhere) a sensible pose for when no IK is set.
 * swGuard param `zone`: 0 high, 1 mid, 2 low, 3 left, 4 right. swSlash param `ax`, `ay`: the slash direction
 * (x right, y up, as the fighter sees it) and swDodge param `side` (+1 = right) are authored for a mirrored
 * (right-handed) rig; for an unmirrored rig the scene flips ax and side (see SwordBase.Fighter.side()).
 */

/**
 * Shoulder angles (YXZ, ry = 0) that point a resting (straight down) arm along the unit direction (dx, dy, dz),
 * given in the shoulder's parent space.
 */
export function armTowards(dx: number, dy: number, dz: number): { rx: number; rz: number } {
  const rz = Math.asin(Math.max(-1, Math.min(1, dx)));
  return { rz, rx: Math.atan2(-dz, -dy) };
}

BuddyAnimator.define('swReady', {
  duration: 0.9, loop: true, expression: 'focus',
  pose: t => {
    const b = Math.sin((t / 0.9) * Math.PI * 2);
    return {
      hips: { y: -0.08 + 0.012 * b },
      spine: { rx: 0.18, ry: -0.15 },
      head: { rx: -0.12, ry: 0.12 },
      hipL: { rx: -0.35, rz: -0.08 }, hipR: { rx: 0.25, rz: 0.08 },
      shoulderR: { rx: -1.0, ry: -0.3, rz: 0.25 },
      shoulderL: { rx: -0.25, rz: -0.5 }
    };
  }
});

BuddyAnimator.define('swGuard', {
  duration: 1, loop: true, expression: 'focus',
  pose: (t, p) => {
    const z = Math.round(p.zone ?? 1), s = 0.006 * Math.sin(t * 7);
    const lean = z === 0 ? -0.08 : z === 2 ? 0.4 : 0.22;
    const turn = z === 3 ? 0.3 : z === 4 ? -0.3 : 0;
    return {
      hips: { y: (z === 2 ? -0.16 : -0.1) + s },
      spine: { rx: lean, ry: turn },
      head: { rx: z === 0 ? -0.3 : -0.1 },
      hipL: { rx: -0.4 }, hipR: { rx: 0.3 },
      shoulderR: { rx: -1.4, ry: -0.5, rz: 0.4 },
      shoulderL: { rx: -1.1, ry: 0.6, rz: -0.3 }
    };
  }
});

BuddyAnimator.define('swSlash', {
  duration: 0.42, loop: false, next: 'swReady', expression: 'focus',
  pose: (t, p) => {
    const ax = p.ax ?? 1, ay = p.ay ?? 0;
    const k = seg(t, 0, 0.12), back = seg(t, 0.22, 0.42), live = 1 - back;
    // the torso winds against the slash and unwinds with it; a downward cut bends forward
    const turn = lerp(0.35 * ax, -0.45 * ax, k) * live;
    return {
      hips: { y: (-0.1 - 0.04 * k) * live - 0.08 * back },
      spine: { rx: (0.2 - 0.25 * ay * k) * live + 0.18 * back, ry: turn },
      head: { rx: -0.15, ry: -turn * 0.4 },
      hipL: { rx: -0.5 * live - 0.35 * back }, hipR: { rx: 0.35 * live + 0.25 * back },
      shoulderR: { rx: lerp(-1.7, -1.0, k), ry: lerp(-0.8 * ax, 0.8 * ax, k) * live, rz: 0.3 },
      shoulderL: { rx: -0.3, rz: lerp(-0.4, -0.8, k) * live - 0.5 * back }
    };
  }
});

BuddyAnimator.define('swThrust', {
  duration: 0.55, loop: false, next: 'swReady', expression: 'focus',
  pose: t => {
    const coil = seg(t, 0, 0.12) * (1 - seg(t, 0.12, 0.2)), go = seg(t, 0.12, 0.22), back = seg(t, 0.32, 0.55);
    const k = go * (1 - back);
    return {
      hips: { y: -0.1 - 0.08 * k },
      spine: { rx: 0.2 + 0.25 * k - 0.1 * coil, ry: 0.25 * coil - 0.2 * k },
      head: { rx: -0.25 * k - 0.1 },
      hipL: { rx: -0.35 - 0.6 * k }, hipR: { rx: 0.25 + 0.4 * k },
      shoulderR: { rx: -1.0 - 0.6 * k + 0.3 * coil, ry: -0.1, rz: 0.2 },
      shoulderL: { rx: -0.2 + 0.5 * k, rz: -0.5 - 0.3 * k }
    };
  }
});

/** Bounced off a block or a parry: the arm flies back, the fighter rocks on the heels. */
BuddyAnimator.define('swRecoil', {
  duration: 0.5, loop: false, next: 'swReady', expression: 'shocked',
  pose: t => {
    const k = seg(t, 0, 0.08) * (1 - seg(t, 0.25, 0.5));
    return {
      hips: { y: -0.06 },
      spine: { rx: 0.18 - 0.4 * k },
      head: { rx: -0.3 * k },
      hipL: { rx: -0.2 + 0.3 * k }, hipR: { rx: 0.2 },
      shoulderR: { rx: -1.0 - 1.1 * k, rz: 0.3 + 0.5 * k },
      shoulderL: { rx: -0.5 * k, rz: -0.6 - 0.5 * k }
    };
  }
});

/** Took a hit: a quick flinch. */
BuddyAnimator.define('swHit', {
  duration: 0.45, loop: false, next: 'swReady', expression: 'shocked',
  pose: t => {
    const k = seg(t, 0, 0.06) * (1 - seg(t, 0.2, 0.45));
    return {
      hips: { y: -0.08 - 0.04 * k },
      spine: { rx: 0.18 - 0.3 * k, rz: 0.12 * k },
      head: { rx: -0.35 * k, rz: 0.15 * k },
      shoulderR: { rx: -1.0, rz: 0.3 + 0.3 * k },
      shoulderL: { rx: -0.4, rz: -0.6 - 0.6 * k }
    };
  }
});

/** Staggered: dizzy wobble, guard down. */
BuddyAnimator.define('swStagger', {
  duration: 0.8, loop: true, expression: 'shocked',
  pose: t => {
    const w = Math.sin((t / 0.8) * Math.PI * 2);
    return {
      hips: { y: -0.05 + 0.015 * Math.abs(w) },
      spine: { rx: -0.05, rz: 0.14 * w },
      head: { rz: -0.25 * w, rx: 0.1 },
      hipL: { rx: 0.1 * w }, hipR: { rx: -0.1 * w },
      shoulderR: { rx: -0.3, rz: 0.5 + 0.2 * w },
      shoulderL: { rx: -0.2, rz: -0.6 + 0.2 * w }
    };
  }
});

BuddyAnimator.define('swDodge', {
  duration: 0.45, loop: false, next: 'swReady', expression: 'shocked',
  pose: (t, p) => {
    const s = (p.side ?? 1) >= 0 ? 1 : -1, k = seg(t, 0, 0.1) * (1 - seg(t, 0.25, 0.45));
    // authored for the mirrored rig: after mirroring, rz > 0 tips the top toward the rig's −x, the fighter's right
    return {
      hips: { y: -0.1 - 0.1 * k },
      spine: { rx: 0.25, rz: -0.35 * s * k },
      head: { rz: 0.2 * s * k },
      hipL: { rx: -0.4, rz: -0.3 * s * k }, hipR: { rx: 0.3, rz: -0.3 * s * k },
      shoulderR: { rx: -1.0, rz: 0.3 },
      shoulderL: { rx: -0.3, rz: -0.6 - 0.5 * k }
    };
  }
});

BuddyAnimator.define('swVictory', {
  duration: 0.8, loop: true, expression: 'happy',
  pose: t => {
    const j = Math.abs(Math.sin((t / 0.8) * Math.PI));
    return {
      hips: { y: 0.12 * j },
      spine: { rx: -0.12 },
      head: { rx: -0.25 },
      shoulderR: { rx: -2.9, rz: 0.15 },
      shoulderL: { rz: -1.1 - 0.4 * j, rx: -0.2 }
    };
  }
});

BuddyAnimator.define('swDefeat', {
  duration: 1.2, loop: false, expression: 'sad',
  pose: t => {
    const k = seg(t, 0, 0.6);
    return {
      hips: { y: -0.32 * k },
      spine: { rx: 0.45 * k },
      head: { rx: 0.4 * k },
      hipL: { rx: -1.3 * k }, hipR: { rx: 0.2 * k, rz: 0.1 * k },
      shoulderR: { rx: -0.3 * k, rz: 0.2 },
      shoulderL: { rx: -0.6 * k, rz: -0.2 }
    };
  }
});

BuddyAnimator.define('swWalk', {
  duration: 0.6, loop: true,
  pose: t => {
    const s = Math.sin((t / 0.6) * Math.PI * 2);
    return {
      hips: { y: 0.02 * Math.abs(s) - 0.02 },
      spine: { rx: 0.12, ry: 0.06 * s },
      hipL: { rx: 0.5 * s }, hipR: { rx: -0.5 * s },
      shoulderR: { rx: -1.0, ry: -0.3, rz: 0.25 },
      shoulderL: { rx: -0.35 * s, rz: -0.15 }
    };
  }
});

export const BUILTIN_STATES = [
  'idle', 'hold', 'aim', 'throw', 'watch', 'strike', 'spare', 'gutterShrug', 'shocked', 'cheer', 'clap', 'sad', 'wave',
  'ttReady', 'ttForehand', 'ttBackhand', 'ttSmash', 'ttLunge', 'ttServe', 'ttCelebrate', 'ttDisappointed',
  'bbReady', 'bbDribble', 'bbSet', 'bbRise', 'bbShoot', 'bbPass', 'bbSteal', 'bbBlock', 'bbDefend', 'bbCelebrate', 'bbDisappointed',
  'fbReady', 'fbGrip', 'fbBackhand', 'fbForehand', 'fbPutt', 'fbWalk', 'fbCelebrate', 'fbDisappointed',
  'swReady', 'swGuard', 'swSlash', 'swThrust', 'swRecoil', 'swHit', 'swStagger', 'swDodge', 'swVictory', 'swDefeat', 'swWalk'
] as const;

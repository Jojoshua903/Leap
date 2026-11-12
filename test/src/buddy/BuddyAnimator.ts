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

  play(name: string, o: { blend?: number; params?: Record<string, number>; restart?: boolean; onDone?: () => void } = {}): void {
    if (!REGISTRY.has(name)) name = 'idle';
    if (name === this.current && !o.restart) { if (o.params) this.params = o.params; return; }
    for (const j of JOINTS) this.from.set(j, { ...this.now.get(j)! });
    this.current = name;
    this.t = 0;
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

export const BUILTIN_STATES = ['idle', 'hold', 'aim', 'throw', 'watch', 'strike', 'spare', 'gutterShrug', 'shocked', 'cheer', 'clap', 'sad', 'wave'] as const;

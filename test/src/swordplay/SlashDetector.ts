import { SW_TUNING } from './swordTuning';
import type { BladeSample } from './BladeTracker';
import { clamp, dirAngle, dirFromAngle, dist, wrapDeg, type Dir8, type V3 } from './swMath';

/** A finished slash (or a thrust). Angles and directions are in the P frame as the player sees it. */
export interface Slash {
  kind: 'slash' | 'thrust';
  /** Movement angle in degrees (0 = right, 90 = up); for a thrust the sideways drift. */
  angle: number;
  dir: Dir8;
  /** Peak tip speed, m/s. */
  speed: number;
  /** 0..1 from the peak speed. */
  power: number;
  /** 0..1, how close the tip path stayed to a straight line (on the screen plane). */
  straightness: number;
  /** ms */
  duration: number;
  start: V3;
  end: V3;
  /** True for a right-hander's right-to-left (or a left-hander's left-to-right) sideways swing. */
  forehand: boolean;
  /** ms, when it ended (or the thrust peaked). */
  t: number;
  /** Counter, so a target can tell one slash from the next. */
  id: number;
  /** The 2D tip path (x, y), for the debug trail. */
  path: Array<{ x: number; y: number }>;
}

/** A slash in progress: what is known so far (for cutting at the moment of contact). */
export interface LiveSlash {
  id: number;
  angle: number;
  dir: Dir8;
  speed: number;
  power: number;
  straightness: number;
  length: number;
  start: V3;
}

export type GuardZone = 'high' | 'mid' | 'low' | 'left' | 'right';
export interface GuardState { zone: GuardZone; since: number }

export type DetectorEvent =
  | { kind: 'slash'; slash: Slash }
  | { kind: 'ignored'; slash: Slash; reason: 'short' | 'backswing' }
  | { kind: 'guard'; guard: GuardState | null };

/**
 * Turns blade samples into slashes, thrusts and guards. Pure logic (no Three.js, no clock of its own), so it
 * can be tested with synthetic tip paths.
 *
 * - Slash: starts when the tip speed passes `startSpeed`, ends when it stays under `endSpeed` for `endSamples`
 *   samples (hysteresis). Direction = start → end on the screen plane, snapped to 8 directions.
 *   Straightness = 1 − (RMS distance of the path from that line) / (¼ of its length).
 * - Thrust: forward acceleration with little rotation (motion controllers), or a tip path that goes mostly
 *   forward (the mouse lunge).
 * - Guard: the blade near horizontal or vertical, in front, steady for `guardMs`. The zone comes from where the
 *   blade is (high / mid / low, or held up on the left / right).
 * - Backswing filter: a roughly opposite slash within `backswingMs` of the last one is dropped unless it is
 *   fast (≥ backswingFactor × the last peak and ≥ backswingMinSpeed).
 *
 * `sensitivity` (0.5–1.5, from Settings) scales the speed thresholds: higher = a softer swing counts.
 */
export class SlashDetector {
  handed: 'right' | 'left' = 'right';
  sensitivity = 1;
  /** Mouse: right button held = guard, whatever the steadiness. */
  forceGuard = false;
  /** Mouse: the zone picked from where the cursor is (overrides the blade-pose zone while forceGuard). */
  forceZone: GuardZone | null = null;
  /** Live state for the overlay and the scenes. */
  live: LiveSlash | null = null;
  guard: GuardState | null = null;
  last: Slash | null = null;
  tipSpeed = 0;

  private nextId = 1;
  private active = false;
  private path: V3[] = [];
  private times: number[] = [];
  private peak = 0;
  private below = 0;
  private prev: BladeSample | null = null;
  private pre: V3[] = [];
  private steadySince = -1;
  private lastThrustT = -1e9;
  private thrustRun = 0;
  private lastEnd: { t: number; angle: number; peak: number } | null = null;

  constructor(handed: 'right' | 'left' = 'right') { this.handed = handed; }

  private get sens(): number { return clamp(this.sensitivity, 0.5, 1.5); }

  /** Feed one blade sample; returns what happened on it (usually nothing). */
  feed(s: BladeSample): DetectorEvent[] {
    const T = SW_TUNING, out: DetectorEvent[] = [];
    const startSpeed = T.startSpeed / this.sens, endSpeed = T.endSpeed / this.sens;
    let speed = 0;
    if (this.prev) {
      const dt = (s.t - this.prev.t) / 1000;
      if (dt > 0.0005 && dt < 0.1) speed = dist(s.tip, this.prev.tip) / dt;
    }
    this.tipSpeed = speed;

    /* ---- slash ---- */
    if (!this.active) {
      this.pre.push({ ...s.tip });
      if (this.pre.length > 2) this.pre.shift();
      if (speed > startSpeed) {
        this.active = true;
        // include the sample before the crossing so the start point isn't late
        this.path = this.pre.length > 1 ? [this.pre[0], { ...s.tip }] : [{ ...s.tip }];
        this.times = this.path.length > 1 ? [this.prev?.t ?? s.t, s.t] : [s.t];
        this.peak = speed;
        this.below = 0;
        this.live = this.liveFrom();
      }
    } else {
      this.path.push({ ...s.tip });
      this.times.push(s.t);
      this.peak = Math.max(this.peak, speed);
      this.live = this.liveFrom();
      if (speed < endSpeed) this.below += 1; else this.below = 0;
      if (this.below >= T.endSamples || this.path.length > 400) {
        const ev = this.finishSlash(s.t);
        if (ev) out.push(ev);
        this.active = false;
        this.live = null;
        this.pre = [{ ...s.tip }];
      }
    }

    /* ---- thrust from the accelerometer ---- */
    if (s.accelFwd > T.thrustAccel && s.gyro < T.thrustMaxGyro) this.thrustRun += 1; else this.thrustRun = 0;
    if (this.thrustRun >= 2 && s.t - this.lastThrustT > T.thrustCooldownMs) {
      this.lastThrustT = s.t;
      const th = this.makeThrust(s, Math.min(1, s.accelFwd / (T.thrustAccel * 2)));
      this.last = th;
      out.push({ kind: 'slash', slash: th });
    }

    /* ---- guard ---- */
    const g = this.guardFrom(s);
    if ((g?.zone ?? null) !== (this.guard?.zone ?? null)) {
      this.guard = g;
      out.push({ kind: 'guard', guard: g });
    }
    this.prev = s;
    return out;
  }

  /** Guard pose check for this sample. */
  private guardFrom(s: BladeSample): GuardState | null {
    const T = SW_TUNING;
    const steady = this.forceGuard || (s.gyro < T.guardMaxGyro && !this.active);
    if (!steady) { this.steadySince = -1; return null; }
    if (this.steadySince < 0) this.steadySince = s.t;
    if (!this.forceGuard && s.t - this.steadySince < T.guardMs) return this.guard;
    const zone = this.forceGuard && this.forceZone ? this.forceZone : guardZone(s.dir, s.tip, this.forceGuard);
    if (!zone) return null;
    // keep the original `since` while the zone stays the same
    if (this.guard && this.guard.zone === zone) return this.guard;
    return { zone, since: this.forceGuard ? s.t : this.steadySince + T.guardMs };
  }

  private liveFrom(): LiveSlash {
    const a = this.path[0], b = this.path[this.path.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    return {
      id: this.nextId, angle, dir: dirFromAngle(angle), speed: this.peak, power: this.power(this.peak),
      straightness: straightness(this.path), length: pathLength(this.path), start: a
    };
  }

  private power(peak: number): number {
    const T = SW_TUNING;
    return clamp((peak * this.sens - T.powerMin) / (T.powerMax - T.powerMin), 0, 1);
  }

  private finishSlash(tEnd: number): DetectorEvent | null {
    const T = SW_TUNING;
    const a = this.path[0], b = this.path[this.path.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const lateral = Math.hypot(dx, dy);
    const L = pathLength(this.path);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const duration = tEnd - this.times[0];
    const id = this.nextId++;
    // a mostly-forward tip path is a thrust (the mouse lunge, or a real stab that tilts the blade forward)
    if (dz > T.thrustMinDz && dz > lateral * T.thrustTipRatio) {
      if (tEnd - this.lastThrustT <= T.thrustCooldownMs) return null;
      this.lastThrustT = tEnd;
      const th: Slash = {
        kind: 'thrust', angle, dir: dirFromAngle(angle), speed: this.peak, power: this.power(this.peak), straightness: 1,
        duration, start: a, end: b, forehand: false, t: tEnd, id, path: this.path.map(p => ({ x: p.x, y: p.y }))
      };
      this.last = th;
      return { kind: 'slash', slash: th };
    }
    const sl: Slash = {
      kind: 'slash', angle, dir: dirFromAngle(angle), speed: this.peak, power: this.power(this.peak),
      straightness: straightness(this.path), duration, start: a, end: b,
      forehand: this.handed === 'right' ? dx < 0 : dx > 0, t: tEnd, id, path: this.path.map(p => ({ x: p.x, y: p.y }))
    };
    if (L < T.minLen || lateral < T.minLen * 0.6) return { kind: 'ignored', slash: sl, reason: 'short' };
    // backswing filter: the return motion right after a slash
    const le = this.lastEnd;
    if (le && tEnd - le.t - duration < T.backswingMs && Math.abs(wrapDeg(angle - le.angle)) > 135) {
      const fastEnough = this.peak >= Math.max(T.backswingMinSpeed / this.sens, le.peak * T.backswingFactor);
      // the ignored return doesn't become the reference: a new slash the original way counts normally
      if (!fastEnough) return { kind: 'ignored', slash: sl, reason: 'backswing' };
    }
    this.lastEnd = { t: tEnd, angle, peak: this.peak };
    this.last = sl;
    return { kind: 'slash', slash: sl };
  }

  private makeThrust(s: BladeSample, power: number): Slash {
    return {
      kind: 'thrust', angle: 90, dir: 'up', speed: 0, power, straightness: 1, duration: 0, start: s.tip, end: s.tip,
      forehand: false, t: s.t, id: this.nextId++, path: []
    };
  }

  /** Drop any slash in progress (pause, teleport, stagger). */
  reset(): void { this.active = false; this.live = null; this.path = []; this.pre = []; this.prev = null; this.below = 0; this.steadySince = -1; }
}

export function pathLength(p: V3[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += dist(p[i], p[i - 1]);
  return L;
}

/** 1 − RMS perpendicular distance of the screen-plane path from its start→end line, over ¼ of the line length. */
export function straightness(p: V3[]): number {
  if (p.length < 3) return 1;
  const a = p[0], b = p[p.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  if (L < 1e-4) return 0;
  const nx = -dy / L, ny = dx / L;
  let s2 = 0;
  for (const q of p) { const d = (q.x - a.x) * nx + (q.y - a.y) * ny; s2 += d * d; }
  const rms = Math.sqrt(s2 / p.length);
  return clamp(1 - rms / (0.25 * L), 0, 1);
}

/**
 * Which guard a blade pose is, or null if it isn't one. Horizontal blade: high above the head, low under the
 * chest, mid in between. Vertical blade: left / right when held to the side, mid when centred. A blade pointing
 * down-forward is a low guard.
 */
export function guardZone(dir: V3, tip: V3, force = false): GuardZone | null {
  const T = SW_TUNING;
  const elev = Math.asin(clamp(dir.y, -1, 1)) * 180 / Math.PI;
  const inFront = dir.z > -0.2 || Math.abs(dir.y) > 0.7;
  if (!inFront && !force) return null;
  if (Math.abs(elev) <= T.guardHorizDeg || (force && Math.abs(elev) < 45)) {
    if (tip.y > T.anchorY + 0.4) return 'high';
    if (tip.y < T.anchorY - 0.2) return 'low';
    return 'mid';
  }
  if (elev >= 90 - T.guardVertDeg || (force && elev >= 45)) {
    if (tip.x < -0.18) return 'left';
    if (tip.x > 0.18) return 'right';
    return 'mid';
  }
  if (elev < -45) return 'low';
  return force ? 'mid' : null;
}

/** Signed angle difference (degrees) between a slash angle and a wanted direction. */
export const angleError = (angle: number, want: Dir8): number => wrapDeg(angle - dirAngle(want));

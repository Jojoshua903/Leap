import type { V3 } from './BallPhysics';

/**
 * Records the ball and both paddles during each rally (at 60 Hz, a few KB), so the match-winning
 * point can be replayed from the side camera at half speed. Playback interpolates between frames.
 */
export interface ReplayFrame {
  t: number;
  ball: V3;
  paddles: [V3, V3];
  normals: [V3, V3];
}

const RATE = 1 / 60;
const MAX_FRAMES = 60 * 20;           // a 20 s rally is plenty

const copy = (v: V3): V3 => ({ x: v.x, y: v.y, z: v.z });

export class ReplayRecorder {
  private frames: ReplayFrame[] = [];
  private lastT = -Infinity;

  /** Start a new rally. */
  reset(): void { this.frames = []; this.lastT = -Infinity; }

  push(t: number, ball: V3, paddles: [V3, V3], normals: [V3, V3]): void {
    if (t - this.lastT < RATE - 1e-6) return;
    this.lastT = t;
    this.frames.push({ t, ball: copy(ball), paddles: [copy(paddles[0]), copy(paddles[1])], normals: [copy(normals[0]), copy(normals[1])] });
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  /** The rally so far, ready for playback. */
  take(): ReplayFrame[] { return this.frames.slice(); }
  get length(): number { return this.frames.length; }
}

const lerpV = (a: V3, b: V3, k: number): V3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

export class ReplayPlayer {
  private time: number;
  private i = 0;
  done = false;

  /** `lead` trims the replay to its last `lead` seconds, plus a short tail after the end. */
  constructor(private readonly frames: ReplayFrame[], private readonly speed = 0.5, lead = 6, private readonly tail = 0.6) {
    const end = frames.length ? frames[frames.length - 1].t : 0;
    this.time = frames.length ? Math.max(frames[0].t, end - lead) : 0;
    if (!frames.length) this.done = true;
  }

  get progress(): number {
    if (!this.frames.length) return 1;
    const a = this.frames[0].t, b = this.frames[this.frames.length - 1].t + this.tail;
    return Math.min(1, (this.time - a) / Math.max(1e-6, b - a));
  }

  skip(): void { this.done = true; }

  /** Advance by real time; returns the interpolated frame, or null when finished. */
  update(dt: number): ReplayFrame | null {
    if (this.done) return null;
    this.time += dt * this.speed;
    const f = this.frames;
    const last = f[f.length - 1];
    if (this.time > last.t + this.tail) { this.done = true; return null; }
    if (this.time >= last.t) return last;
    while (this.i < f.length - 2 && f[this.i + 1].t <= this.time) this.i++;
    while (this.i > 0 && f[this.i].t > this.time) this.i--;
    const a = f[this.i], b = f[this.i + 1] ?? a;
    const k = b.t > a.t ? Math.max(0, Math.min(1, (this.time - a.t) / (b.t - a.t))) : 0;
    return {
      t: this.time,
      ball: lerpV(a.ball, b.ball, k),
      paddles: [lerpV(a.paddles[0], b.paddles[0], k), lerpV(a.paddles[1], b.paddles[1], k)],
      normals: [k < 0.5 ? a.normals[0] : b.normals[0], k < 0.5 ? a.normals[1] : b.normals[1]]
    };
  }
}

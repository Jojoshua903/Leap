import type { V3 } from './ShotSolver';

/**
 * Records the six players and the ball during pickup (60 Hz, the last 6 s), so the game-winning basket can
 * be replayed from the side camera: the last 4 s at half speed, skippable. Positions are interpolated,
 * animations are replayed by name (a change of name starts the clip again).
 */
export interface ReplayBody { x: number; z: number; facing: number; anim: string; jump: boolean }
export interface BBReplayFrame { t: number; ball: V3 | null; bodies: ReplayBody[] }

const RATE = 1 / 60;
const KEEP = 6;

export class BBReplayRecorder {
  private frames: BBReplayFrame[] = [];
  private lastT = -Infinity;

  reset(): void { this.frames = []; this.lastT = -Infinity; }

  push(t: number, ball: V3 | null, bodies: ReplayBody[]): void {
    if (t - this.lastT < RATE - 1e-6) return;
    this.lastT = t;
    this.frames.push({ t, ball: ball ? { x: ball.x, y: ball.y, z: ball.z } : null, bodies: bodies.map(b => ({ ...b })) });
    while (this.frames.length > 2 && t - this.frames[0].t > KEEP) this.frames.shift();
  }

  take(): BBReplayFrame[] { return this.frames.slice(); }
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const lerpAngle = (a: number, b: number, k: number): number => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

export class BBReplayPlayer {
  private time: number;
  private readonly end: number;
  private i = 0;
  done = false;

  /** The last `lead` seconds, at `speed`, with a short `tail` held on the last frame. */
  constructor(private readonly frames: BBReplayFrame[], private readonly speed = 0.5, lead = 4, private readonly tail = 0.5) {
    this.end = frames.length ? frames[frames.length - 1].t : 0;
    this.time = frames.length ? Math.max(frames[0].t, this.end - lead) : 0;
    if (frames.length < 2) this.done = true;
  }

  skip(): void { this.done = true; }

  update(dt: number): BBReplayFrame | null {
    if (this.done) return null;
    this.time += dt * this.speed;
    const f = this.frames;
    if (this.time > this.end + this.tail) { this.done = true; return null; }
    if (this.time >= this.end) return f[f.length - 1];
    while (this.i < f.length - 2 && f[this.i + 1].t <= this.time) this.i++;
    const a = f[this.i], b = f[this.i + 1] ?? a;
    const k = b.t > a.t ? Math.max(0, Math.min(1, (this.time - a.t) / (b.t - a.t))) : 0;
    return {
      t: this.time,
      ball: a.ball && b.ball ? { x: lerp(a.ball.x, b.ball.x, k), y: lerp(a.ball.y, b.ball.y, k), z: lerp(a.ball.z, b.ball.z, k) } : (k < 0.5 ? a.ball : b.ball),
      bodies: a.bodies.map((p, j) => {
        const q = b.bodies[j] ?? p;
        return { x: lerp(p.x, q.x, k), z: lerp(p.z, q.z, k), facing: lerpAngle(p.facing, q.facing, k), anim: k < 0.5 ? p.anim : q.anim, jump: k < 0.5 ? p.jump : q.jump };
      })
    };
  }
}

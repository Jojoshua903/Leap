import { HOOP } from './bbTuning';
import { HOOP_CENTER, type V3 } from './ShotSolver';

/**
 * Basket detection with two horizontal sensor planes: one just above the rim, one below it.
 * A basket counts only when the ball centre crosses the TOP plane going down, inside the rim, and then
 * the BOTTOM plane going down, inside the rim, within `window` seconds. So:
 *  - a ball that drops onto the rim and bounces back up and out: crossed the top plane, then went back up → cancelled
 *  - a ball that comes up through the hoop from below: blocked for a moment, so it can't fall back in for points
 *  - a pass or a rebound that flies through the planes outside the rim: never inside → nothing
 * Pure logic, fed the ball centre once per physics step.
 */
export class BasketSensor {
  private topT = -1;
  private fromBelowUntil = -1;
  readonly topY: number;
  readonly botY: number;

  constructor(
    readonly hoop: V3 = HOOP_CENTER,
    readonly radius = HOOP.rimRadius,
    topDy = 0.1,
    botDy = -0.18,
    readonly window = 0.6
  ) {
    this.topY = hoop.y + topDy;
    this.botY = hoop.y + botDy;
  }

  /** The bottom plane allows a little more: a ball dropping at an angle drifts toward the back of the net. */
  private get botRadius(): number { return this.radius * 1.15; }

  reset(): void { this.topT = -1; this.fromBelowUntil = -1; }

  /** True between the two crossings (the ball is "in the cylinder"). */
  get armed(): boolean { return this.topT >= 0; }

  /** Horizontal distance from the hoop axis where the segment prev→cur crosses height y. */
  private crossDist(prev: V3, cur: V3, y: number): number {
    const k = (prev.y - y) / (prev.y - cur.y || 1e-9);
    const x = prev.x + (cur.x - prev.x) * k, z = prev.z + (cur.z - prev.z) * k;
    return Math.hypot(x - this.hoop.x, z - this.hoop.z);
  }

  /** Feed one step (time in seconds). Returns true once, on the step that completes a basket. */
  update(t: number, prev: V3, cur: V3): boolean {
    const r = this.radius;
    // coming up through the hoop from below: no basket for a while (can't score from underneath)
    if (prev.y < this.botY && cur.y >= this.botY && this.crossDist(prev, cur, this.botY) < r) {
      this.fromBelowUntil = t + 1.2;
      this.topT = -1;
    }
    // back up through the top plane (bounced off the rim) cancels
    if (prev.y < this.topY && cur.y >= this.topY) this.topT = -1;
    if (prev.y > this.topY && cur.y <= this.topY) {
      this.topT = this.crossDist(prev, cur, this.topY) < r && t >= this.fromBelowUntil ? t : -1;
    }
    if (this.topT >= 0 && t - this.topT > this.window) this.topT = -1;
    if (this.topT >= 0 && prev.y > this.botY && cur.y <= this.botY) {
      const ok = this.crossDist(prev, cur, this.botY) < this.botRadius;
      this.topT = -1;
      return ok;
    }
    return false;
  }
}

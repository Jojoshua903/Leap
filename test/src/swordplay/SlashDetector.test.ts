import { describe, expect, it } from 'vitest';
import { Rng } from '../tabletennis/BallPhysics';
import { SlashDetector, guardZone, straightness, type DetectorEvent, type Slash } from './SlashDetector';
import type { BladeSample } from './BladeTracker';
import { SW_TUNING } from './swordTuning';
import { DIRS, dirVec, mirrorDir, norm, v3, type V3 } from './swMath';

const HZ = 120, DT = 1000 / HZ;
const CENTER = v3(0.1, 1.25, 0.9);

/** Feed samples of a tip moving from `a` to `b` in `dur` ms (smooth ease), with still time before and after. */
function swing(det: SlashDetector, a: V3, b: V3, dur: number, t0: number, rng: Rng | null, noise = 0.004, still = 12): { events: DetectorEvent[]; t: number } {
  const events: DetectorEvent[] = [];
  let t = t0;
  const n = (k: number) => (rng ? rng.gauss() * k : 0);
  const sample = (p: V3): void => {
    const tip = v3(p.x + n(noise), p.y + n(noise), p.z + n(noise));
    const s: BladeSample = { t, tip, dir: norm(v3(tip.x - 0.2, tip.y - 1.05, tip.z - 0.35)), gyro: 5, accelFwd: 0, roll: 0 };
    events.push(...det.feed(s));
    t += DT;
  };
  for (let i = 0; i < still; i++) sample(a);
  const steps = Math.max(2, Math.round(dur / DT));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps, e = 0.5 - 0.5 * Math.cos(Math.PI * k);
    sample(v3(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, a.z + (b.z - a.z) * e));
  }
  for (let i = 0; i < still; i++) sample(b);
  return { events, t };
}

const slashes = (ev: DetectorEvent[]): Slash[] => ev.filter((e): e is Extract<DetectorEvent, { kind: 'slash' }> => e.kind === 'slash').map(e => e.slash);

describe('SlashDetector', () => {
  it('detects all 8 directions under noise (≥ 98 %)', () => {
    const rng = new Rng(42);
    let ok = 0, total = 0;
    for (const d of DIRS) {
      const v = dirVec(d);
      for (let k = 0; k < 60; k++) {
        const det = new SlashDetector();
        const L = 0.5 + rng.next() * 0.35, dur = 90 + rng.next() * 120;
        const c = v3(CENTER.x + rng.signed() * 0.15, CENTER.y + rng.signed() * 0.15, CENTER.z + rng.signed() * 0.1);
        // a little wobble off the line so it isn't perfectly clean
        const a = v3(c.x - v.x * L / 2, c.y - v.y * L / 2, c.z), b = v3(c.x + v.x * L / 2 + rng.signed() * 0.03, c.y + v.y * L / 2 + rng.signed() * 0.03, c.z);
        const s = slashes(swing(det, a, b, dur, 1000, rng).events);
        total++;
        if (s.length === 1 && s[0].kind === 'slash' && s[0].dir === d) ok++;
      }
    }
    expect(ok / total).toBeGreaterThanOrEqual(0.98);
  });

  it('reports speed, power, straightness and duration', () => {
    const det = new SlashDetector();
    const s = slashes(swing(det, v3(-0.35, 1.2, 0.9), v3(0.35, 1.2, 0.9), 110, 0, null).events)[0];
    expect(s.dir).toBe('right');
    expect(s.speed).toBeGreaterThan(6);
    expect(s.power).toBeGreaterThan(0.2);
    expect(s.straightness).toBeGreaterThan(0.95);
    expect(s.duration).toBeGreaterThan(80);
    expect(s.duration).toBeLessThan(200);
    expect(s.end.x).toBeGreaterThan(s.start.x);
  });

  it('ignores a slow return right after a slash, but counts a fast opposite slash', () => {
    const det = new SlashDetector();
    const L = v3(-0.35, 1.2, 0.9), R = v3(0.35, 1.2, 0.9);
    const first = swing(det, L, R, 100, 0, null, 0, 4);
    // slow-ish return (about 60 % of the speed), right away
    const back = swing(det, R, L, 170, first.t, null, 0, 4);
    expect(slashes(first.events)).toHaveLength(1);
    expect(slashes(back.events)).toHaveLength(0);
    expect(back.events.some(e => e.kind === 'ignored' && e.reason === 'backswing')).toBe(true);
    // a real slash back the other way, just as fast
    const det2 = new SlashDetector();
    const f2 = swing(det2, L, R, 100, 0, null, 0, 4);
    const b2 = swing(det2, R, L, 95, f2.t, null, 0, 4);
    expect(slashes(b2.events).map(s => s.dir)).toEqual(['left']);
  });

  it('after an ignored return, the next slash the original way still counts', () => {
    const det = new SlashDetector();
    const L = v3(-0.35, 1.2, 0.9), R = v3(0.35, 1.2, 0.9);
    const a = swing(det, L, R, 100, 0, null, 0, 4);
    const b = swing(det, R, L, 170, a.t, null, 0, 4);
    const c = swing(det, L, R, 100, b.t, null, 0, 4);
    expect(slashes(c.events).map(s => s.dir)).toEqual(['right']);
  });

  it('tells a thrust from a slash', () => {
    const det = new SlashDetector();
    // the mouse lunge: the tip goes straight forward
    const th = slashes(swing(det, v3(0.1, 1.3, 0.8), v3(0.11, 1.31, 1.15), 80, 0, null).events);
    expect(th.map(s => s.kind)).toEqual(['thrust']);
    // a motion controller: forward acceleration with little rotation
    const det2 = new SlashDetector();
    const ev: DetectorEvent[] = [];
    for (let i = 0; i < 6; i++) ev.push(...det2.feed({ t: i * DT, tip: v3(0.1, 1.3, 1.2), dir: v3(0, 0.1, 1), gyro: 1, accelFwd: i >= 2 && i <= 4 ? 22 : 0, roll: 0 }));
    expect(slashes(ev).map(s => s.kind)).toEqual(['thrust']);
    // a sideways slash is not a thrust
    const sl = slashes(swing(new SlashDetector(), v3(-0.35, 1.2, 0.9), v3(0.35, 1.2, 1.0), 110, 0, null).events);
    expect(sl.map(s => s.kind)).toEqual(['slash']);
  });

  it('detects a steady guard after guardMs, with the zone from the blade', () => {
    const det = new SlashDetector();
    const feedStill = (dir: V3, tip: V3, ms: number, t0: number): DetectorEvent[] => {
      const ev: DetectorEvent[] = [];
      for (let t = t0; t < t0 + ms; t += DT) ev.push(...det.feed({ t, tip, dir, gyro: 0.2, accelFwd: 0, roll: 0 }));
      return ev;
    };
    // horizontal blade above the head
    const early = feedStill(norm(v3(-1, 0.05, 0.3)), v3(-0.4, 1.75, 0.6), SW_TUNING.guardMs - 20, 0);
    expect(det.guard).toBeNull();
    expect(early.some(e => e.kind === 'guard' && e.guard)).toBe(false);
    feedStill(norm(v3(-1, 0.05, 0.3)), v3(-0.4, 1.75, 0.6), 80, SW_TUNING.guardMs - 20);
    expect(det.guard?.zone).toBe('high');
    // a moving blade is no guard
    det.feed({ t: 400, tip: v3(0, 1.4, 0.9), dir: v3(0, 0.3, 1), gyro: 6, accelFwd: 0, roll: 0 });
    expect(det.guard).toBeNull();
    expect(guardZone(norm(v3(0, 1, 0.2)), v3(-0.3, 1.9, 0.5))).toBe('left');
    expect(guardZone(norm(v3(0, 1, 0.2)), v3(0.35, 1.9, 0.5))).toBe('right');
    expect(guardZone(norm(v3(1, 0, 0.3)), v3(0.4, 1.1, 0.6))).toBe('mid');
    expect(guardZone(norm(v3(0, -0.8, 0.6)), v3(0.2, 0.4, 0.9))).toBe('low');
  });

  it('mirrors for left-handers', () => {
    for (const d of DIRS) {
      const v = dirVec(d);
      const a = v3(-v.x * 0.3, 1.25 - v.y * 0.3, 0.9), b = v3(v.x * 0.3, 1.25 + v.y * 0.3, 0.9);
      const rh = slashes(swing(new SlashDetector('right'), a, b, 110, 0, null).events)[0];
      const lh = slashes(swing(new SlashDetector('left'), v3(-a.x, a.y, a.z), v3(-b.x, b.y, b.z), 110, 0, null).events)[0];
      expect(lh.dir).toBe(mirrorDir(rh.dir));
      // a forehand stays a forehand when mirrored
      expect(lh.forehand).toBe(rh.forehand);
    }
  });

  it('is deterministic', () => {
    const run = () => {
      const det = new SlashDetector(), rng = new Rng(99);
      const out: string[] = [];
      let t = 0;
      for (const d of DIRS) {
        const v = dirVec(d);
        const r = swing(det, v3(-v.x * 0.3, 1.2 - v.y * 0.3, 0.9), v3(v.x * 0.3, 1.2 + v.y * 0.3, 0.9), 120, t, rng, 0.004, 40);
        t = r.t;
        out.push(...slashes(r.events).map(s => `${s.dir}:${s.speed.toFixed(4)}:${s.straightness.toFixed(4)}`));
      }
      return out;
    };
    expect(run()).toEqual(run());
    expect(run()).toHaveLength(8);
  });

  it('straightness: a straight path beats a curved one', () => {
    const line: V3[] = [], arc: V3[] = [];
    for (let i = 0; i <= 20; i++) {
      const k = i / 20;
      line.push(v3(-0.4 + 0.8 * k, 1.2, 0.9));
      arc.push(v3(-0.4 + 0.8 * k, 1.2 + 0.25 * Math.sin(Math.PI * k), 0.9));
    }
    expect(straightness(line)).toBeCloseTo(1);
    expect(straightness(arc)).toBeLessThan(0.5);
  });
});

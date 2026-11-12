import { describe, expect, it } from 'vitest';
import { BasketSensor } from './HoopSensor';
import { G, SIM_DT, solveIdealShot, type V3 } from './ShotSolver';

/** Gravity-only flight (no collisions), fed to the sensor. Returns how many baskets it saw. */
function fly(from: V3, vel: V3, seconds = 3, sensor = new BasketSensor()): number {
  const p = { ...from }, v = { ...vel };
  let n = 0;
  for (let t = 0; t < seconds; t += SIM_DT) {
    const prev = { ...p };
    v.y -= G * SIM_DT;
    p.x += v.x * SIM_DT; p.y += v.y * SIM_DT; p.z += v.z * SIM_DT;
    if (sensor.update(t, prev, p)) n++;
    if (p.y < 0.2) break;
  }
  return n;
}

/** Feed a hand-made list of positions, one per step. */
function feed(points: V3[], sensor = new BasketSensor()): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) if (sensor.update(i * SIM_DT, points[i - 1], points[i])) n++;
  return n;
}

const lerpPath = (a: V3, b: V3, steps: number): V3[] =>
  Array.from({ length: steps + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps, z: a.z + (b.z - a.z) * i / steps }));

describe('BasketSensor', () => {
  it('counts a ball falling down through both planes', () => {
    expect(fly({ x: 0, y: 4, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(1);
  });

  it('counts an ideal jump shot exactly once', () => {
    const from = { x: 0, y: 2.3, z: 6.9 };
    expect(fly(from, solveIdealShot(from).vel)).toBe(1);
  });

  it('does not count a ball that goes up through the hoop and falls back through it', () => {
    expect(fly({ x: 0, y: 2.2, z: 0 }, { x: 0, y: 5, z: 0 })).toBe(0);
  });

  it('does not count a bounce on the rim top that goes out', () => {
    const down = lerpPath({ x: 0.17, y: 3.4, z: 0 }, { x: 0.17, y: 3.1, z: 0 }, 12);
    const up = lerpPath({ x: 0.17, y: 3.1, z: 0 }, { x: 0.3, y: 3.5, z: 0 }, 12);
    const out = lerpPath({ x: 0.3, y: 3.5, z: 0 }, { x: 0.7, y: 1.5, z: 0 }, 30);
    expect(feed([...down, ...up.slice(1), ...out.slice(1)])).toBe(0);
  });

  it('does not count passes or rebounds flying past outside the rim', () => {
    expect(fly({ x: -3, y: 2, z: 2 }, { x: 4, y: 4, z: -1.5 })).toBe(0);
    expect(feed(lerpPath({ x: 0.6, y: 3.6, z: 0.2 }, { x: 0.6, y: 2.2, z: 0.2 }, 20))).toBe(0);
  });

  it('does not count a ball that sits on the rim longer than the window before dropping', () => {
    const s = new BasketSensor();
    const pts: V3[] = [{ x: 0, y: 3.3, z: 0 }, { x: 0, y: 3.15, z: 0 }];
    for (let i = 0; i < 90; i++) pts.push({ x: 0, y: 3.15, z: 0 });   // 0.75 s between the planes
    pts.push({ x: 0, y: 2.6, z: 0 });
    expect(feed(pts, s)).toBe(0);
  });

  it('a ball entering at the edge of the rim and dropping out the side is not a basket', () => {
    const path = [...lerpPath({ x: 0.2, y: 3.4, z: 0 }, { x: 0.2, y: 3.0, z: 0 }, 10), ...lerpPath({ x: 0.2, y: 3.0, z: 0 }, { x: 0.6, y: 2.5, z: 0 }, 10).slice(1)];
    expect(feed(path)).toBe(0);
  });
});

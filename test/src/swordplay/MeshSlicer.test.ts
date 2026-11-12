import { describe, expect, it } from 'vitest';
import { buildShape, slicePlane, type SliceShape, type TriMesh } from './MeshSlicer';
import { v3, type V3 } from './swMath';

/** Weld corners (quantised), drop zero-size triangles, and check every directed edge has its twin. */
function closed(pos: number[]): { ok: boolean; tris: number } {
  const key = (i: number) => `${Math.round(pos[i] * 1e5)},${Math.round(pos[i + 1] * 1e5)},${Math.round(pos[i + 2] * 1e5)}`;
  const edges = new Map<string, number>();
  let tris = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const k = [key(i), key(i + 3), key(i + 6)];
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
    tris++;
    for (let j = 0; j < 3; j++) {
      const e = `${k[j]}|${k[(j + 1) % 3]}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  for (const [e, c] of edges) {
    const [a, b] = e.split('|');
    if ((edges.get(`${b}|${a}`) ?? 0) !== c) return { ok: false, tris };
  }
  return { ok: true, tris };
}

/** Signed volume (positive when the triangles face outward). */
function volume(pos: number[]): number {
  let v = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = pos.slice(i, i + 9);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

const SHAPES: Record<string, SliceShape> = {
  box: { kind: 'box', hx: 0.3, hy: 0.2, hz: 0.25 },
  cylinder: { kind: 'cylinder', r: 0.12, h: 0.8, seg: 14 },
  sphere: { kind: 'sphere', r: 0.2, seg: 16, rings: 10 }
};
const PLANES: { n: V3; d: number }[] = [
  { n: v3(1, 0.2, 0.1), d: 0.03 },
  { n: v3(0.3, 1, -0.2), d: -0.05 },
  { n: v3(-0.5, 0.4, 0.8), d: 0.0123 },
  { n: v3(1, 1, 0), d: 0 },
  { n: v3(0, 1, 0), d: 0.07 }
];

describe('MeshSlicer', () => {
  for (const [name, s] of Object.entries(SHAPES)) {
    const whole: TriMesh = buildShape(s);

    it(`${name}: the uncut shape is closed and faces outward`, () => {
      expect(closed(whole.pos).ok).toBe(true);
      expect(volume(whole.pos)).toBeGreaterThan(0);
    });

    it(`${name}: every cut gives two closed halves that add up to the whole`, () => {
      const vol = volume(whole.pos);
      for (const p of PLANES) {
        const r = slicePlane(whole, p.n, p.d)!;
        expect(r).not.toBeNull();
        const f = closed(r.front.pos), b = closed(r.back.pos);
        expect(f.ok).toBe(true);
        expect(b.ok).toBe(true);
        const vf = volume(r.front.pos), vb = volume(r.back.pos);
        expect(vf).toBeGreaterThan(0);
        expect(vb).toBeGreaterThan(0);
        expect(vf + vb).toBeCloseTo(vol, 6);
        expect(r.front.capStart).toBeGreaterThan(0);
        expect(r.front.capStart).toBeLessThan(r.front.pos.length);
      }
    });
  }

  it('a plane that misses gives nothing', () => {
    expect(slicePlane(buildShape(SHAPES.box), v3(1, 0, 0), 2)).toBeNull();
  });

  it('a straight cut through the middle of a box (cut points in a row along each face) stays closed', () => {
    const r = slicePlane(buildShape(SHAPES.box), v3(1, 0, 0), 0)!;
    expect(closed(r.front.pos).ok && closed(r.back.pos).ok).toBe(true);
    expect(volume(r.front.pos)).toBeCloseTo(volume(r.back.pos), 8);
  });
});

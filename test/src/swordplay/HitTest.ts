import { add, clamp, dist, dot, lerpV, norm, scale, sub, v3, type V3 } from './swMath';

/** Target shapes. Boxes may be turned about the vertical axis (`yaw`, radians). */
export type Shape =
  | { kind: 'sphere'; c: V3; r: number }
  | { kind: 'capsule'; a: V3; b: V3; r: number }
  | { kind: 'box'; c: V3; half: V3; yaw?: number };

/** The blade as a segment (hilt → tip). */
export interface Segment { a: V3; b: V3 }

export interface Hit {
  /** On the shape's surface, closest to the blade at the moment of contact. */
  point: V3;
  /** Surface normal there (pointing out of the shape, toward the blade). */
  normal: V3;
  /** 0..1 between the previous and the current blade pose. */
  t: number;
  /** Direction the blade's contact point was moving (unit, world), i.e. the slash direction at the target. */
  dir: V3;
  /** Where along the blade it touched, 0 = hilt, 1 = tip. */
  along: number;
}

/** Closest point on segment ab to p, with its parameter. */
export function closestOnSegment(a: V3, b: V3, p: V3): { t: number; q: V3 } {
  const ab = sub(b, a), L2 = dot(ab, ab);
  const t = L2 > 1e-12 ? clamp(dot(sub(p, a), ab) / L2, 0, 1) : 0;
  return { t, q: add(a, scale(ab, t)) };
}

/** Closest points between segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection §5.1.9). */
export function closestSegSeg(p1: V3, q1: V3, p2: V3, q2: V3): { s: number; t: number; c1: V3; c2: V3 } {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s: number, t: number;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = dot(d1, d2), denom = a * e - b * b;
      s = denom > 1e-12 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  return { s, t, c1: add(p1, scale(d1, s)), c2: add(p2, scale(d2, t)) };
}

const toBox = (p: V3, c: V3, yaw: number): V3 => {
  const d = sub(p, c), cs = Math.cos(-yaw), sn = Math.sin(-yaw);
  return v3(d.x * cs + d.z * sn, d.y, -d.x * sn + d.z * cs);
};
const fromBox = (p: V3, c: V3, yaw: number): V3 => {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return add(c, v3(p.x * cs + p.z * sn, p.y, -p.x * sn + p.z * cs));
};
const clampBox = (p: V3, h: V3): V3 => v3(clamp(p.x, -h.x, h.x), clamp(p.y, -h.y, h.y), clamp(p.z, -h.z, h.z));

/** Distance from segment ab to a shape's surface (≤ 0 inside), with the closest points on both. */
export function segmentDistance(a: V3, b: V3, s: Shape): { d: number; onSeg: V3; onShape: V3; along: number } {
  switch (s.kind) {
    case 'sphere': {
      const { t, q } = closestOnSegment(a, b, s.c);
      const dc = dist(q, s.c);
      const n = dc > 1e-9 ? scale(sub(q, s.c), 1 / dc) : v3(0, 1, 0);
      return { d: dc - s.r, onSeg: q, onShape: add(s.c, scale(n, s.r)), along: t };
    }
    case 'capsule': {
      const r = closestSegSeg(a, b, s.a, s.b);
      const dc = dist(r.c1, r.c2);
      const n = dc > 1e-9 ? scale(sub(r.c1, r.c2), 1 / dc) : v3(0, 1, 0);
      return { d: dc - s.r, onSeg: r.c1, onShape: add(r.c2, scale(n, s.r)), along: r.s };
    }
    case 'box': {
      const yaw = s.yaw ?? 0;
      const la = toBox(a, s.c, yaw), lb = toBox(b, s.c, yaw);
      // the distance from a point moving along a line to a convex box is convex in t: ternary search
      const f = (t: number): number => { const p = lerpV(la, lb, t); return dist(p, clampBox(p, s.half)); };
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (f(m1) <= f(m2)) hi = m2; else lo = m1;
      }
      const t = (lo + hi) / 2, p = lerpV(la, lb, t), q = clampBox(p, s.half);
      let d = dist(p, q);
      let onShapeL = q;
      if (d < 1e-9) {
        // inside: push out through the nearest face
        const h = s.half, gaps = [h.x - Math.abs(p.x), h.y - Math.abs(p.y), h.z - Math.abs(p.z)];
        const i = gaps.indexOf(Math.min(...gaps));
        d = -gaps[i];
        onShapeL = { ...p };
        if (i === 0) onShapeL.x = Math.sign(p.x || 1) * h.x; else if (i === 1) onShapeL.y = Math.sign(p.y || 1) * h.y; else onShapeL.z = Math.sign(p.z || 1) * h.z;
      }
      return { d, onSeg: fromBox(p, s.c, yaw), onShape: fromBox(onShapeL, s.c, yaw), along: t };
    }
  }
}

/** Smallest feature size of a shape, to choose the sub-step length. */
function shapeSize(s: Shape): number {
  if (s.kind === 'box') return Math.min(s.half.x, s.half.y, s.half.z) * 2;
  return s.r * 2;
}

/**
 * Swept blade capsule (radius `radius`) moving from `prev` to `cur` against a shape. The motion is cut into
 * sub-steps no longer than half the blade radius plus the shape size, so a fast swing can't tunnel through a
 * thin target; the first touching sub-step is refined by bisection. Returns null for a miss.
 */
export function sweepCapsule(prev: Segment, cur: Segment, radius: number, shape: Shape): Hit | null {
  const travel = Math.max(dist(prev.a, cur.a), dist(prev.b, cur.b));
  const step = Math.max(0.005, (radius * 2 + shapeSize(shape)) * 0.5);
  const n = clamp(Math.ceil(travel / step), 1, 128);
  const at = (k: number) => segmentDistance(lerpV(prev.a, cur.a, k), lerpV(prev.b, cur.b, k), shape);
  if (at(0).d <= radius) return makeHit(prev, cur, 0, at(0));
  let k0 = 0;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    if (at(k).d <= radius) {
      let lo = k0, hi = k;
      for (let j = 0; j < 8; j++) { const m = (lo + hi) / 2; if (at(m).d <= radius) hi = m; else lo = m; }
      return makeHit(prev, cur, hi, at(hi));
    }
    k0 = k;
  }
  return null;
}

function makeHit(prev: Segment, cur: Segment, k: number, r: { onSeg: V3; onShape: V3; along: number }): Hit {
  const p0 = lerpV(prev.a, prev.b, r.along), p1 = lerpV(cur.a, cur.b, r.along);
  const mv = sub(p1, p0);
  const dir = dot(mv, mv) > 1e-12 ? norm(mv) : v3(1, 0, 0);
  const nrm = sub(r.onSeg, r.onShape);
  const normal = dot(nrm, nrm) > 1e-12 ? norm(nrm) : scale(dir, -1);
  return { point: r.onShape, normal, t: k, dir, along: r.along };
}

/** Is a point inside a shape (for decoys touching the player etc.)? */
export function pointInside(p: V3, s: Shape): boolean { return segmentDistance(p, p, s).d <= 0; }

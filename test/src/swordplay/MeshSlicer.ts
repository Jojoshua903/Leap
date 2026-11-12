import * as THREE from 'three';
import { cross, dot, norm, sub, v3, type V3 } from './swMath';

/**
 * Plane-split for the Speed Slice targets. The shapes are built here from triangles (not taken from Three's
 * geometries) so the same corner always has bit-identical coordinates: that keeps the cut halves closed.
 * All targets are convex (box / cylinder / sphere), so each cut face is one convex polygon.
 */

/** Triangles as a flat list: 9 numbers (3 corners × xyz) per triangle, counter-clockwise seen from outside. */
export interface TriMesh { pos: number[] }

export type SliceShape =
  | { kind: 'box'; hx: number; hy: number; hz: number }
  | { kind: 'cylinder'; r: number; h: number; seg: number }
  | { kind: 'sphere'; r: number; seg: number; rings: number };

const pushTri = (out: number[], a: V3, b: V3, c: V3): void => { out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); };

export function buildBox(hx: number, hy: number, hz: number): TriMesh {
  const c = (i: number): V3 => v3(i & 1 ? hx : -hx, i & 2 ? hy : -hy, i & 4 ? hz : -hz);
  // quads given counter-clockwise from outside
  const quads = [[1, 3, 7, 5], [0, 4, 6, 2], [2, 6, 7, 3], [0, 1, 5, 4], [4, 5, 7, 6], [0, 2, 3, 1]];
  const pos: number[] = [];
  for (const [a, b, cc, d] of quads) { pushTri(pos, c(a), c(b), c(cc)); pushTri(pos, c(a), c(cc), c(d)); }
  return { pos };
}

/** Upright cylinder (logs, bamboo, straw bundles), centred on the origin. */
export function buildCylinder(r: number, h: number, seg: number): TriMesh {
  const ring = (i: number, y: number): V3 => { const a = ((i % seg) / seg) * Math.PI * 2; return v3(Math.cos(a) * r, y, -Math.sin(a) * r); };
  const top = v3(0, h / 2, 0), bot = v3(0, -h / 2, 0), pos: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = ring(i, -h / 2), a1 = ring(i + 1, -h / 2), b0 = ring(i, h / 2), b1 = ring(i + 1, h / 2);
    pushTri(pos, a0, a1, b1); pushTri(pos, a0, b1, b0);
    pushTri(pos, top, b0, b1);
    pushTri(pos, bot, a1, a0);
  }
  return { pos };
}

/** UV sphere with single-vertex poles (fans), so there are no zero-area triangles. */
export function buildSphere(r: number, seg: number, rings: number): TriMesh {
  const at = (i: number, j: number): V3 => {
    if (j === 0) return v3(0, r, 0);
    if (j === rings) return v3(0, -r, 0);
    const th = (j / rings) * Math.PI, ph = ((i % seg) / seg) * Math.PI * 2;
    return v3(Math.sin(th) * Math.cos(ph) * r, Math.cos(th) * r, -Math.sin(th) * Math.sin(ph) * r);
  };
  const pos: number[] = [];
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
      if (j !== 0) pushTri(pos, a, c, b);
      if (j !== rings - 1) pushTri(pos, b, c, d);
    }
  }
  return { pos };
}

export function buildShape(s: SliceShape): TriMesh {
  switch (s.kind) {
    case 'box': return buildBox(s.hx, s.hy, s.hz);
    case 'cylinder': return buildCylinder(s.r, s.h, s.seg);
    case 'sphere': return buildSphere(s.r, s.seg, s.rings);
  }
}

export interface SliceHalf {
  /** Outer skin then the cut face; `capStart` is the first number of the cut face in `pos`. */
  pos: number[];
  capStart: number;
}

const lessV = (a: V3, b: V3): boolean => (a.x !== b.x ? a.x < b.x : a.y !== b.y ? a.y < b.y : a.z < b.z);

/**
 * Where edge ab crosses the plane. The two ends are put in a fixed order first, so the two triangles that share
 * the edge get exactly the same point — the halves stay closed.
 */
function edgeCut(a: V3, sa: number, b: V3, sb: number): V3 {
  if (lessV(b, a)) { const t = a; a = b; b = t; const ts = sa; sa = sb; sb = ts; }
  const t = sa / (sa - sb);
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  return v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

const EPS_SIDE = 1e-7;

/**
 * Cut a closed convex mesh with the plane n·p = d. `front` is the n side. Returns null when the plane misses.
 * Each half gets a cap (a fan from the centre of the cut polygon) facing out of that half.
 */
export function slicePlane(mesh: TriMesh, nIn: V3, dIn: number): { front: SliceHalf; back: SliceHalf } | null {
  const L = Math.hypot(nIn.x, nIn.y, nIn.z);
  if (L < 1e-9) return null;
  const n = norm(nIn), d = dIn / L;
  const fp: number[] = [], bp: number[] = [];
  const cutPts: V3[] = [];
  const P = mesh.pos;
  for (let i = 0; i < P.length; i += 9) {
    const vs = [v3(P[i], P[i + 1], P[i + 2]), v3(P[i + 3], P[i + 4], P[i + 5]), v3(P[i + 6], P[i + 7], P[i + 8])];
    // a corner exactly on the plane counts as front (nudged), so every edge has a definite side
    const sd = vs.map(p => { const s = dot(n, p) - d; return Math.abs(s) < EPS_SIDE ? EPS_SIDE : s; });
    const nf = sd.filter(s => s > 0).length;
    if (nf === 3) { pushTri(fp, vs[0], vs[1], vs[2]); continue; }
    if (nf === 0) { pushTri(bp, vs[0], vs[1], vs[2]); continue; }
    const front: V3[] = [], back: V3[] = [];
    for (let k = 0; k < 3; k++) {
      const a = vs[k], b = vs[(k + 1) % 3], sa = sd[k], sb = sd[(k + 1) % 3];
      (sa > 0 ? front : back).push(a);
      if ((sa > 0) !== (sb > 0)) {
        const c = edgeCut(a, sa, b, sb);
        front.push(c); back.push(c); cutPts.push(c);
      }
    }
    for (let k = 1; k + 1 < front.length; k++) pushTri(fp, front[0], front[k], front[k + 1]);
    for (let k = 1; k + 1 < back.length; k++) pushTri(bp, back[0], back[k], back[k + 1]);
  }
  if (fp.length === 0 || bp.length === 0 || cutPts.length < 3) return null;

  // the cut polygon: unique points sorted by angle around their centre (convex, so this is the outline)
  const seen = new Map<string, V3>();
  for (const p of cutPts) seen.set(`${p.x},${p.y},${p.z}`, p);
  const pts = [...seen.values()];
  const c = pts.reduce((s, p) => v3(s.x + p.x / pts.length, s.y + p.y / pts.length, s.z + p.z / pts.length), v3(0, 0, 0));
  const ref = Math.abs(n.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const u = norm(cross(ref, n)), w = cross(n, u); // u × w = n
  const ang = (p: V3): number => { const r = sub(p, c); return Math.atan2(dot(r, w), dot(r, u)); };
  pts.sort((a, b) => ang(a) - ang(b));

  const frontCap = fp.length, backCap = bp.length;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    pushTri(bp, c, a, b); // counter-clockwise about +n: faces out of the back half
    pushTri(fp, c, b, a); // reversed: faces −n, out of the front half
  }
  return { front: { pos: fp, capStart: frontCap }, back: { pos: bp, capStart: backCap } };
}

/** The centre of a half (for spinning it about itself and for the push-apart direction). */
export function halfCentre(h: SliceHalf): V3 {
  let x = 0, y = 0, z = 0;
  const m = h.pos.length / 3;
  for (let i = 0; i < h.pos.length; i += 3) { x += h.pos[i]; y += h.pos[i + 1]; z += h.pos[i + 2]; }
  return v3(x / m, y / m, z / m);
}

// ---- Three side --------------------------------------------------------------------------------------------

const meshCache = new Map<string, TriMesh>();
/** Built once per shape; slicing reads it, never writes. */
export function cachedShape(s: SliceShape): TriMesh {
  const key = JSON.stringify(s);
  let m = meshCache.get(key);
  if (!m) { m = buildShape(s); meshCache.set(key, m); }
  return m;
}

/** A whole (uncut) target as flat-shaded geometry. */
export function shapeGeometry(s: SliceShape): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(cachedShape(s).pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Write a half into a pooled geometry: group 0 = skin (material 0), group 1 = the cut face (material 1, the
 * inside colour). The half is re-centred so it can spin about its own middle; returns that centre (local).
 */
export function writeHalf(g: THREE.BufferGeometry, h: SliceHalf): V3 {
  const c = halfCentre(h);
  const arr = new Float32Array(h.pos.length);
  for (let i = 0; i < h.pos.length; i += 3) { arr[i] = h.pos[i] - c.x; arr[i + 1] = h.pos[i + 1] - c.y; arr[i + 2] = h.pos[i + 2] - c.z; }
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  g.clearGroups();
  g.addGroup(0, h.capStart / 3, 0);
  g.addGroup(h.capStart / 3, (h.pos.length - h.capStart) / 3, 1);
  g.computeBoundingSphere();
  return c;
}

/** World cut plane (normal + a point) into an object's local space, as n·p = d. */
export function planeToLocal(nWorld: V3, pWorld: V3, obj: THREE.Object3D): { n: V3; d: number } {
  obj.updateWorldMatrix(true, false);
  const inv = obj.matrixWorld.clone().invert();
  const p = new THREE.Vector3(pWorld.x, pWorld.y, pWorld.z).applyMatrix4(inv);
  const nm = new THREE.Matrix3().getNormalMatrix(inv);
  const n = new THREE.Vector3(nWorld.x, nWorld.y, nWorld.z).applyMatrix3(nm).normalize();
  return { n: v3(n.x, n.y, n.z), d: n.dot(p) };
}

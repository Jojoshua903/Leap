import * as THREE from 'three';
import { Rng } from '../tabletennis/BallPhysics';
import { gradientMap } from '../render/Toon';
import type { Ground, Obstacle, Surface } from './DiscPhysics';

/**
 * Heightmap terrain shared by both frisbee modes. The height is analytic (seeded value-noise hills, flattened
 * pads for tees, baskets and the dog field, dips for ponds), so the disc physics can ask for it anywhere
 * without a mesh lookup, and the mesh is just a sampled copy with a limited number of segments (by quality).
 * Surfaces: water inside pond ellipses, sand patches, a fairway band along a polyline, rough far off it.
 */
export interface Pad { x: number; z: number; r: number; h?: number }
export interface Ellipse { x: number; z: number; rx: number; rz: number; rot?: number }
export interface TerrainSpec {
  /** Centre and size (m) of the area. */
  cx: number; cz: number; w: number; d: number;
  seed: number;
  /** Hill height (m) and feature size (m). */
  hills: number; scale: number;
  /** Overall slope (m per m) along x and z. */
  slopeX?: number; slopeZ?: number;
  pads?: Pad[];
  ponds?: Ellipse[];
  sand?: Ellipse[];
  /** Fairway centre line and half width; outside 2.5× the width is rough. */
  fairway?: Array<{ x: number; z: number }>;
  fairwayW?: number;
  /** Treat everything as one surface (the beach field uses grass with sand at the edges). */
  base?: Surface;
  waterLevel?: number;
}

export interface TerrainPalette { grass: string; fairway: string; rough: string; sand: string; rock: string; bed: string }

const smooth = (e0: number, e1: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function ellipseK(e: Ellipse, x: number, z: number): number {
  const c = Math.cos(-(e.rot ?? 0)), s = Math.sin(-(e.rot ?? 0));
  const dx = x - e.x, dz = z - e.z;
  const u = dx * c - dz * s, v = dx * s + dz * c;
  return (u / e.rx) ** 2 + (v / e.rz) ** 2;
}

function distToPolyline(pts: Array<{ x: number; z: number }>, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    best = Math.min(best, Math.hypot(a.x + dx * k - x, a.z + dz * k - z));
  }
  return best;
}

export class Terrain implements Ground {
  readonly obstacles: Obstacle[] = [];
  readonly waterLevel: number;
  private readonly perm: Float32Array;

  constructor(readonly spec: TerrainSpec) {
    const r = new Rng(spec.seed);
    this.perm = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.perm[i] = r.next();
    this.waterLevel = spec.waterLevel ?? -0.35;
  }

  private hash(ix: number, iz: number): number {
    const h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) >>> 0;
    return this.perm[(h ^ (h >>> 13)) & 255];
  }

  private noise(x: number, z: number): number {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = this.hash(ix, iz), b = this.hash(ix + 1, iz), c = this.hash(ix, iz + 1), d = this.hash(ix + 1, iz + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz;
  }

  /** Raw hills before pads and ponds. */
  private hillsAt(x: number, z: number): number {
    const S = this.spec;
    if (S.hills <= 0) return (S.slopeX ?? 0) * (x - S.cx) + (S.slopeZ ?? 0) * (z - S.cz);
    const f = 1 / Math.max(1, S.scale);
    const n = this.noise(x * f, z * f) * 0.6 + this.noise(x * f * 2.1 + 31, z * f * 2.1 + 17) * 0.3 + this.noise(x * f * 4.3 + 7, z * f * 4.3 + 91) * 0.1;
    return (n - 0.5) * 2 * S.hills + (S.slopeX ?? 0) * (x - S.cx) + (S.slopeZ ?? 0) * (z - S.cz);
  }

  height(x: number, z: number): number {
    const S = this.spec;
    let h = this.hillsAt(x, z);
    for (const p of S.pads ?? []) {
      const k = smooth(p.r, p.r * 1.8 + 2, Math.hypot(x - p.x, z - p.z));
      const flat = p.h ?? this.hillsAt(p.x, p.z);
      h = flat + (h - flat) * k;
    }
    for (const e of S.ponds ?? []) {
      const k = ellipseK(e, x, z);
      if (k < 2.2) h = Math.min(h, h * smooth(0.6, 2.2, k) + (this.waterLevel - 0.7) * (1 - smooth(0.6, 2.2, k)));
    }
    return h;
  }

  surface(x: number, z: number): Surface {
    const S = this.spec;
    for (const e of S.ponds ?? []) if (ellipseK(e, x, z) < 1) return 'water';
    for (const e of S.sand ?? []) if (ellipseK(e, x, z) < 1) return 'sand';
    if (S.fairway && S.fairway.length > 1) {
      const d = distToPolyline(S.fairway, x, z), w = S.fairwayW ?? 8;
      if (d < w) return 'fairway';
      if (d > w * 2.5) return 'rough';
      return 'grass';
    }
    return S.base ?? 'grass';
  }

  /** Mesh of the terrain with vertex colours per surface (limited segments: `seg` per side). */
  buildMesh(pal: TerrainPalette, seg: number): THREE.Mesh {
    const S = this.spec;
    const sx = Math.max(16, Math.round(seg * Math.min(1, S.w / S.d))), sz = Math.max(16, Math.round(seg * Math.min(1, S.d / S.w)));
    const g = new THREE.PlaneGeometry(S.w, S.d, sx, sz);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const cols: Record<string, THREE.Color> = {
      grass: new THREE.Color(pal.grass), fairway: new THREE.Color(pal.fairway), rough: new THREE.Color(pal.rough),
      sand: new THREE.Color(pal.sand), rock: new THREE.Color(pal.rock), water: new THREE.Color(pal.bed)
    };
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + S.cx, z = pos.getZ(i) + S.cz;
      pos.setXYZ(i, x, this.height(x, z), z);
      const s = this.surface(x, z);
      c.copy(cols[s] ?? cols.grass);
      // a little variation so big areas don't look flat
      const v = (this.hash(Math.floor(x * 0.7), Math.floor(z * 0.7)) - 0.5) * 0.06;
      c.offsetHSL(0, 0, v);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() }));
    m.receiveShadow = true;
    return m;
  }

  /** Flat water surfaces over every pond (one mesh). */
  buildWater(color: string): THREE.Mesh | null {
    const ponds = this.spec.ponds ?? [];
    if (!ponds.length) return null;
    const geos: THREE.BufferGeometry[] = [];
    for (const e of ponds) {
      const g = new THREE.CircleGeometry(1, 40);
      g.rotateX(-Math.PI / 2);
      g.scale(e.rx * 1.08, 1, e.rz * 1.08);
      g.rotateY(e.rot ?? 0);
      g.translate(e.x, this.waterLevel, e.z);
      geos.push(g);
    }
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    const m = new THREE.Mesh(merged, new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), transparent: true, opacity: 0.86 }));
    m.receiveShadow = true;
    return m;
  }
}

/** Minimal merge for non-indexed + indexed geometries with position/normal/uv (avoids pulling in examples/). */
export function mergeGeometries(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = gs.map(g => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const q = (g.attributes.normal as THREE.BufferAttribute | undefined) ?? null;
    for (let i = 0; i < p.count; i++) {
      pos[(o + i) * 3] = p.getX(i); pos[(o + i) * 3 + 1] = p.getY(i); pos[(o + i) * 3 + 2] = p.getZ(i);
      if (q) { nor[(o + i) * 3] = q.getX(i); nor[(o + i) * 3 + 1] = q.getY(i); nor[(o + i) * 3 + 2] = q.getZ(i); }
    }
    o += p.count;
  }
  parts.forEach((g, i) => { if (g !== gs[i]) g.dispose(); });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/* ---------------- trees (instanced) ---------------- */

export type TreeKind = 'round' | 'pine' | 'palm';
export interface TreeSpot { x: number; z: number; s?: number }

const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x1d2a3a, side: THREE.BackSide });

/**
 * A stand of trees as a few InstancedMeshes (trunks, canopies, and their outlines), with matching
 * obstacles (a trunk cylinder and a softer canopy) added to `ground`. Returns a group and a dispose.
 */
export function plantTrees(ground: Terrain, spots: TreeSpot[], kind: TreeKind, colors: { trunk: string; leaf: string }, seed: number): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];
  if (!spots.length) return { group, dispose: () => undefined };
  const r = new Rng(seed);
  const trunkGeo = kind === 'palm' ? new THREE.CylinderGeometry(0.13, 0.2, 1, 7) : new THREE.CylinderGeometry(0.16, 0.24, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const leafGeo = kind === 'pine' ? new THREE.ConeGeometry(1, 1, 8) : kind === 'palm' ? new THREE.BoxGeometry(1, 0.06, 0.32) : new THREE.IcosahedronGeometry(1, 1);
  if (kind === 'palm') leafGeo.translate(0.5, 0, 0);
  const trunkMat = new THREE.MeshToonMaterial({ color: colors.trunk, gradientMap: gradientMap() });
  const leafMat = new THREE.MeshToonMaterial({ color: colors.leaf, gradientMap: gradientMap() });
  disposables.push(trunkGeo, leafGeo, trunkMat, leafMat);
  const leavesPer = kind === 'palm' ? 6 : 1;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, spots.length * leavesPer);
  const trunkLine = new THREE.InstancedMesh(trunkGeo, OUTLINE, spots.length);
  const leafLine = new THREE.InstancedMesh(leafGeo, OUTLINE, spots.length * leavesPer);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), e = new THREE.Euler();
  spots.forEach((s, i) => {
    const size = (s.s ?? 1) * (0.8 + r.next() * 0.45);
    const y0 = ground.height(s.x, s.z);
    const trunkH = kind === 'palm' ? 5.2 * size : kind === 'pine' ? 1.6 * size : 2.2 * size;
    const lean = kind === 'palm' ? r.signed() * 0.15 : 0;
    e.set(lean, r.next() * 6.28, kind === 'palm' ? r.signed() * 0.15 : 0);
    q.setFromEuler(e);
    p.set(s.x, y0 - 0.1, s.z);
    sc.set(size, trunkH, size);
    m.compose(p, q, sc); trunks.setMatrixAt(i, m);
    sc.multiplyScalar(1.12); sc.y = trunkH * 1.01; m.compose(p, q, sc); trunkLine.setMatrixAt(i, m);
    // canopy
    const top = new THREE.Vector3(0, trunkH, 0).applyQuaternion(q).add(p);
    let canopyR: number, canopyY0: number, canopyY1: number;
    if (kind === 'palm') {
      for (let k = 0; k < leavesPer; k++) {
        e.set(0, (k / leavesPer) * Math.PI * 2 + r.next() * 0.4, -0.35 - r.next() * 0.25);
        q.setFromEuler(e);
        sc.set(2.3 * size, 1, 1.1 * size);
        m.compose(top, q, sc); leaves.setMatrixAt(i * leavesPer + k, m);
        sc.multiplyScalar(1.08); m.compose(top, q, sc); leafLine.setMatrixAt(i * leavesPer + k, m);
      }
      canopyR = 2.1 * size; canopyY0 = top.y - 1; canopyY1 = top.y + 0.4;
    } else {
      const cr = (kind === 'pine' ? 1.5 : 1.9) * size, ch = kind === 'pine' ? 4.2 * size : 1.7 * size;
      const c = top.clone(); c.y += kind === 'pine' ? ch * 0.45 : ch * 0.55;
      q.identity();
      sc.set(cr, ch, cr);
      m.compose(c, q, sc); leaves.setMatrixAt(i, m);
      sc.multiplyScalar(1.07); m.compose(c, q, sc); leafLine.setMatrixAt(i, m);
      canopyR = cr * 0.9; canopyY0 = c.y - ch * 0.5; canopyY1 = c.y + ch * 0.5;
    }
    ground.obstacles.push({ x: s.x, z: s.z, r: 0.22 * size, y0: y0 - 0.2, y1: canopyY0 + 0.3, kind: 'trunk' });
    ground.obstacles.push({ x: top.x, z: top.z, r: canopyR, y0: canopyY0, y1: canopyY1, kind: 'canopy' });
  });
  for (const im of [trunks, leaves]) { im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; }
  for (const im of [trunkLine, leafLine]) im.instanceMatrix.needsUpdate = true;
  group.add(trunks, leaves, trunkLine, leafLine);
  return {
    group,
    dispose: () => { for (const d of disposables) d.dispose(); for (const im of [trunks, leaves, trunkLine, leafLine]) im.dispose(); }
  };
}

/** Rocks as instanced squashed icosahedra, with obstacles. */
export function placeRocks(ground: Terrain, spots: TreeSpot[], color: string, seed: number): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  if (!spots.length) return { group, dispose: () => undefined };
  const r = new Rng(seed);
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
  const im = new THREE.InstancedMesh(geo, mat, spots.length), line = new THREE.InstancedMesh(geo, OUTLINE, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  spots.forEach((s, i) => {
    const size = (s.s ?? 1) * (0.6 + r.next() * 0.6);
    p.set(s.x, ground.height(s.x, s.z) + size * 0.25, s.z);
    q.setFromEuler(new THREE.Euler(r.next(), r.next() * 6, r.next()));
    sc.set(size * 1.2, size * 0.7, size);
    m.compose(p, q, sc); im.setMatrixAt(i, m);
    sc.multiplyScalar(1.06); m.compose(p, q, sc); line.setMatrixAt(i, m);
    ground.obstacles.push({ x: s.x, z: s.z, r: size * 0.95, y0: p.y - size, y1: p.y + size * 0.6, kind: 'rock' });
  });
  im.castShadow = true; im.receiveShadow = true;
  group.add(im, line);
  return { group, dispose: () => { geo.dispose(); mat.dispose(); im.dispose(); line.dispose(); } };
}

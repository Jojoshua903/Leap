import * as THREE from 'three';
import { addOutline, toon } from '../render/Toon';
import { Rng } from '../tabletennis/BallPhysics';
import type { SceneLook } from './SwordBase';
import type { Area } from './stages/types';

/**
 * Swordplay places, all built from simple shapes: three duel arenas (a round wooden platform in a lantern
 * courtyard, a bamboo grove, a moonlit yard), the Speed Slice practice range and the Showdown path
 * (rope bridge → ruins → lantern forest → the boss clearing).
 */
export type ArenaId = 'courtyard' | 'bamboo' | 'moonlit';

export const ARENA_LOOK: Record<ArenaId | 'range' | 'path', SceneLook> = {
  courtyard: { sky: '#9fd8ff', fog: '#cfe9ff', fogNear: 18, fogFar: 60, hemiSky: '#ffffff', hemiGround: '#b08a5a', hemi: 0.75, sun: '#fff1d6', sunI: 1.5, sunDir: [6, 14, 5] },
  bamboo: { sky: '#bfe6c8', fog: '#d6f0dc', fogNear: 10, fogFar: 40, hemiSky: '#f4fff2', hemiGround: '#5f8a4a', hemi: 0.8, sun: '#fff8e0', sunI: 1.3, sunDir: [4, 15, 6] },
  moonlit: { sky: '#1b2246', fog: '#232c58', fogNear: 12, fogFar: 45, hemiSky: '#7f8fd8', hemiGround: '#2a2440', hemi: 0.55, sun: '#c9d6ff', sunI: 0.9, sunDir: [-5, 12, 6] },
  range: { sky: '#a8dcff', fog: '#d8efff', fogNear: 20, fogFar: 80, hemiSky: '#ffffff', hemiGround: '#9a7a52', hemi: 0.8, sun: '#fff1d6', sunI: 1.4, sunDir: [5, 14, 3] },
  path: { sky: '#a9d6f5', fog: '#d4ecff', fogNear: 14, fogFar: 55, hemiSky: '#ffffff', hemiGround: '#7a6a4a', hemi: 0.8, sun: '#fff1d6', sunI: 1.4, sunDir: [6, 14, 4] }
};

/** Builds meshes with shared toon materials and remembers what to dispose. */
export class Kit {
  readonly disposables: Array<{ dispose(): void }> = [];
  private readonly mats = new Map<string, THREE.Material>();
  constructor(readonly root: THREE.Object3D) {}

  material(color: string, basic = false): THREE.Material {
    const key = `${basic ? 'b' : 't'}${color}`;
    let m = this.mats.get(key);
    if (!m) { m = basic ? new THREE.MeshBasicMaterial({ color }) : toon(color); this.mats.set(key, m); this.disposables.push(m); }
    return m;
  }

  mesh(geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, o: { outline?: number; shadow?: boolean; basic?: boolean; parent?: THREE.Object3D } = {}): THREE.Mesh {
    this.disposables.push(geo);
    const m = new THREE.Mesh(geo, this.material(color, o.basic));
    m.position.set(x, y, z);
    m.castShadow = o.shadow ?? false;
    m.receiveShadow = !o.basic;
    if (o.outline) addOutline(m, o.outline);
    (o.parent ?? this.root).add(m);
    return m;
  }

  dispose(): void { for (const d of this.disposables) d.dispose(); this.mats.clear(); }
}

/** A paper lantern on a post (unlit glow, no extra light). */
export function lantern(k: Kit, x: number, z: number, h = 1.6, glow = '#ffcf7a'): void {
  k.mesh(new THREE.BoxGeometry(0.1, h, 0.1), '#5a3a22', x, h / 2, z, { outline: 0.06, shadow: true });
  k.mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), '#5a3a22', x, h, z);
  const l = k.mesh(new THREE.SphereGeometry(0.17, 14, 10), glow, x + 0.2, h - 0.25, z, { basic: true, outline: 0.06 });
  l.scale.set(1, 1.3, 1);
  k.mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 10), '#2b2f38', x + 0.2, h - 0.03, z);
}

function tree(k: Kit, x: number, z: number, s = 1, leaf = '#5cbf5a'): void {
  k.mesh(new THREE.CylinderGeometry(0.12 * s, 0.17 * s, 1.6 * s, 8), '#7a5233', x, 0.8 * s, z, { outline: 0.05, shadow: true });
  k.mesh(new THREE.IcosahedronGeometry(0.9 * s, 0), leaf, x, 2.0 * s, z, { outline: 0.04, shadow: true });
  k.mesh(new THREE.IcosahedronGeometry(0.6 * s, 0), leaf, x + 0.3 * s, 2.6 * s, z - 0.1, { outline: 0.04 });
}

function bambooStalk(k: Kit, x: number, z: number, h: number): void {
  const g = new THREE.CylinderGeometry(0.06, 0.07, h, 7);
  k.mesh(g, '#7cc36b', x, h / 2, z, { outline: 0.06 });
  for (let y = 0.6; y < h; y += 0.7) k.mesh(new THREE.TorusGeometry(0.068, 0.012, 4, 10), '#5a9a4a', x, y, z).rotation.x = Math.PI / 2;
  k.mesh(new THREE.ConeGeometry(0.22, 0.5, 5), '#6fbf5f', x + 0.12, h - 0.2, z, {}).rotation.z = -0.8;
}

/** The round wooden duel platform with plank lines and a rope edge. */
function platform(k: Kit, wood: string, rope: string): void {
  k.mesh(new THREE.CylinderGeometry(3.3, 3.4, 0.3, 40), wood, 0, 0.15, 0, { outline: 0.02, shadow: true });
  for (let i = -6; i <= 6; i++) {
    const w = Math.sqrt(Math.max(0, 3.25 * 3.25 - (i * 0.5) ** 2)) * 2;
    if (w > 0.2) k.mesh(new THREE.BoxGeometry(0.02, 0.005, w), '#8a5a32', i * 0.5, 0.302, 0);
  }
  k.mesh(new THREE.TorusGeometry(3.3, 0.05, 6, 48), rope, 0, 0.3, 0).rotation.x = Math.PI / 2;
}

/** A duel arena around the origin (the platform is 0.3 m high: fighters stand at y = 0.3). */
export function buildArena(scene: THREE.Scene, id: ArenaId): Kit {
  const k = new Kit(scene);
  const r = new Rng(id === 'courtyard' ? 3 : id === 'bamboo' ? 5 : 9);
  const ground = id === 'bamboo' ? '#8fcf6a' : id === 'moonlit' ? '#3a3f60' : '#d9c7a0';
  k.mesh(new THREE.CircleGeometry(40, 40).rotateX(-Math.PI / 2), ground, 0, 0, 0);
  platform(k, id === 'moonlit' ? '#7a5a42' : '#b98a5a', id === 'moonlit' ? '#c9d6ff' : '#e8d3a0');
  if (id === 'courtyard') {
    // stone walls with a gate, lanterns, trees
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      if (i === 4) continue; // the gate gap
      k.mesh(new THREE.BoxGeometry(2.6, 1.2, 0.5), '#cbbfa8', Math.cos(a) * 9, 0.6, Math.sin(a) * 9, { outline: 0.02 }).rotation.y = -a + Math.PI / 2;
    }
    const gx = 0, gz = 9;
    for (const s of [-1, 1]) k.mesh(new THREE.BoxGeometry(0.3, 3, 0.3), '#c0392b', gx + s * 1.3, 1.5, gz, { outline: 0.04, shadow: true });
    k.mesh(new THREE.BoxGeometry(3.6, 0.25, 0.4), '#c0392b', gx, 3.05, gz, { outline: 0.04 });
    k.mesh(new THREE.BoxGeometry(3.0, 0.15, 0.3), '#c0392b', gx, 2.55, gz, { outline: 0.04 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; lantern(k, Math.cos(a) * 4.4, Math.sin(a) * 4.4); }
    for (let i = 0; i < 10; i++) { const a = r.next() * Math.PI * 2; tree(k, Math.cos(a) * (11 + r.next() * 6), Math.sin(a) * (11 + r.next() * 6), 0.9 + r.next() * 0.6, '#f2a7c3'); }
  } else if (id === 'bamboo') {
    for (let i = 0; i < 70; i++) {
      const a = r.next() * Math.PI * 2, d = 5 + r.next() * 12;
      bambooStalk(k, Math.cos(a) * d, Math.sin(a) * d, 4 + r.next() * 4);
    }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; lantern(k, Math.cos(a) * 4.3, Math.sin(a) * 4.3, 1.2, '#fff2b0'); }
  } else {
    // night: a moon, glowing lanterns, a little pond of light
    k.mesh(new THREE.CircleGeometry(3, 32), '#fff6d8', -14, 16, 28, { basic: true }).lookAt(0, 2, 0);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; lantern(k, Math.cos(a) * 4.4, Math.sin(a) * 4.4, 1.7, '#ffb85c'); }
    for (let i = 0; i < 40; i++) k.mesh(new THREE.SphereGeometry(0.05, 6, 4), '#ffffff', (r.next() - 0.5) * 80, 10 + r.next() * 20, 25 + r.next() * 15, { basic: true });
    for (let i = 0; i < 8; i++) { const a = r.next() * Math.PI * 2; tree(k, Math.cos(a) * (10 + r.next() * 6), Math.sin(a) * (10 + r.next() * 6), 1 + r.next() * 0.5, '#3a5a7a'); }
  }
  return k;
}

/**
 * The Speed Slice range: the player stands on a small deck at the origin facing −z (world); targets fly in
 * from far ahead out of a wooden launcher. Banners in the axis colours line the lane.
 */
export function buildRange(scene: THREE.Scene): Kit {
  const k = new Kit(scene);
  const r = new Rng(21);
  k.mesh(new THREE.CircleGeometry(60, 40).rotateX(-Math.PI / 2), '#9ed36a', 0, 0, -10);
  k.mesh(new THREE.BoxGeometry(2.4, 0.12, 2.4), '#b98a5a', 0, 0.06, 0.3, { outline: 0.02 });
  k.mesh(new THREE.BoxGeometry(3, 0.04, 14), '#e8d3a0', 0, 0.02, -8);
  // launcher
  k.mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.6, 16), '#8a5a32', 0, 0.8, -13, { outline: 0.03, shadow: true });
  k.mesh(new THREE.TorusGeometry(0.95, 0.08, 6, 20), '#ffd23a', 0, 1.6, -13).rotation.x = Math.PI / 2;
  const colors = ['#3c8cff', '#ff4f5e', '#ffd23a'];
  for (let i = 0; i < 6; i++) {
    for (const s of [-1, 1]) {
      const z = -2 - i * 2.2, x = s * 2.2;
      k.mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), '#5a3a22', x, 1.3, z);
      const b = k.mesh(new THREE.PlaneGeometry(0.5, 1.1), colors[(i + (s > 0 ? 1 : 0)) % 3], x - s * 0.27, 2.0, z, { outline: 0 });
      (b.material as THREE.Material).side = THREE.DoubleSide;
    }
  }
  for (let i = 0; i < 14; i++) tree(k, (r.next() > 0.5 ? 1 : -1) * (6 + r.next() * 10), -4 - r.next() * 30, 1 + r.next() * 0.7);
  for (let i = 0; i < 5; i++) k.mesh(new THREE.SphereGeometry(8 + r.next() * 6, 12, 8), '#7fbf6a', (r.next() - 0.5) * 70, -4, -45 - r.next() * 10);
  return k;
}

/** Where each Showdown area starts along the path (world −z is forward). */
export const AREA_START: Record<Area, number> = { bridge: 0, ruins: 32, forest: 64 };
export const PATH_END = 110;

/**
 * The Showdown path along −z: a rope bridge over a gorge (0–30 m), castle ruins (32–62), a lantern forest
 * (64–98) and the boss clearing (100–110). The Buddy walks along x = 0.
 */
export function buildPath(scene: THREE.Scene): Kit {
  const k = new Kit(scene);
  const r = new Rng(77);
  // gorge: far ground low, cliffs on both ends of the bridge
  k.mesh(new THREE.PlaneGeometry(80, 40).rotateX(-Math.PI / 2), '#5f9fcf', 0, -6, -15);
  k.mesh(new THREE.BoxGeometry(14, 6, 6), '#a88a6a', 0, -3, 3, { outline: 0.01 });
  k.mesh(new THREE.BoxGeometry(20, 6, 4), '#a88a6a', 0, -3, -31, { outline: 0.01 });
  for (let z = -1; z > -29; z -= 0.45) k.mesh(new THREE.BoxGeometry(1.8, 0.06, 0.38), r.next() > 0.1 ? '#b98a5a' : '#9a6a3a', 0, -0.03, z);
  for (const s of [-1, 1]) {
    for (let z = 0; z >= -29; z -= 4) k.mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), '#6b4226', s * 0.95, 0.5, z, { outline: 0.06 });
    const rope = k.mesh(new THREE.CylinderGeometry(0.025, 0.025, 29, 5), '#e8d3a0', s * 0.95, 0.95, -14.5);
    rope.rotation.x = Math.PI / 2;
  }
  // ruins
  k.mesh(new THREE.PlaneGeometry(30, 34).rotateX(-Math.PI / 2), '#b9c79a', 0, 0, -47);
  k.mesh(new THREE.BoxGeometry(2.2, 0.02, 30), '#cbbfa8', 0, 0.01, -47);
  for (let i = 0; i < 14; i++) {
    const z = -34 - i * 2.1, s = i % 2 ? 1 : -1, h = 1 + r.next() * 3;
    k.mesh(new THREE.CylinderGeometry(0.35, 0.4, h, 10), '#d8cfbc', s * (2.6 + r.next()), h / 2, z, { outline: 0.03, shadow: true });
    if (r.next() > 0.6) k.mesh(new THREE.BoxGeometry(1.2, 0.5, 0.6), '#c8bfa8', s * (3.5 + r.next() * 2), 0.25, z - 0.5, { outline: 0.03 });
  }
  for (const z of [-40, -52]) {
    for (const s of [-1, 1]) k.mesh(new THREE.BoxGeometry(0.6, 3.4, 0.8), '#d8cfbc', s * 1.8, 1.7, z, { outline: 0.03, shadow: true });
    k.mesh(new THREE.BoxGeometry(4.2, 0.6, 0.8), '#d8cfbc', 0, 3.6, z, { outline: 0.03 });
  }
  // forest
  k.mesh(new THREE.PlaneGeometry(40, 50).rotateX(-Math.PI / 2), '#6fbf5f', 0, -0.006, -86);
  k.mesh(new THREE.BoxGeometry(2, 0.02, 36), '#c9a878', 0, 0.01, -82);
  for (let i = 0; i < 40; i++) {
    const s = r.next() > 0.5 ? 1 : -1;
    tree(k, s * (3 + r.next() * 9), -64 - r.next() * 34, 1 + r.next() * 0.8, r.next() > 0.5 ? '#4fa35a' : '#5cbf5a');
  }
  for (let z = -66; z > -98; z -= 5) for (const s of [-1, 1]) lantern(k, s * 1.6, z, 1.5);
  for (let i = 0; i < 16; i++) {
    const x = (r.next() > 0.5 ? 1 : -1) * (1.3 + r.next() * 3), z = -64 - r.next() * 34;
    k.mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 6), '#f4eede', x, 0.09, z);
    k.mesh(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#ff5a5f', x, 0.17, z, { outline: 0.06 });
  }
  // boss clearing: a ring of standing stones in a straw field
  k.mesh(new THREE.CircleGeometry(9, 32).rotateX(-Math.PI / 2), '#e9cf7a', 0, 0.015, -104);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) < 0.3 && Math.cos(a) > 0) continue;
    k.mesh(new THREE.BoxGeometry(0.7, 1.6 + r.next(), 0.5), '#9aa6b2', Math.sin(a) * 7.5, 0.9, -104 + Math.cos(a) * 7.5, { outline: 0.03, shadow: true });
  }
  return k;
}

import * as THREE from 'three';
import { addOutline, toon } from '../render/Toon';
import { DISC } from './frisbeeTuning';
import type { V3 } from './DiscPhysics';

/**
 * The target basket: a pole with a tray at the bottom, a cone of chains and a top band.
 * Heights are above the ground at the pole.
 *
 * "In" logic (basketCheck, pure and seeded): the disc entering the chain cylinder
 *  - slowly (≤ inSpeed) and low (between the tray and lowY) is in;
 *  - otherwise, still between the tray and the chains' top, it rattles: in with a chance that falls with
 *    speed and height, else it spits out (rattle-out);
 *  - at the band or the tray rim / stand it glances off;
 *  - dropping into the tray from above is in.
 */
export const BASKET = {
  trayY: 0.62,
  trayR: 0.3,
  chainsY0: 0.72,
  chainsY1: 1.3,
  bandY: 1.38,
  chainR: 0.28,
  inSpeed: 8,
  lowY: 1.15
};

export type BasketHit = 'none' | 'in' | 'rattle' | 'band' | 'cage';

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** The disc moved from `prev` to `cur` at `speed`; `base` is the pole's foot. */
export function basketCheck(prev: V3, cur: V3, speed: number, base: V3, rng: { next(): number }): BasketHit {
  const B = BASKET;
  const R = B.chainR + DISC.radius * 0.5;
  const r0 = Math.hypot(prev.x - base.x, prev.z - base.z), r1 = Math.hypot(cur.x - base.x, cur.z - base.z);
  const y0 = prev.y - base.y, y1 = cur.y - base.y;
  // falling into the tray from above
  if (r1 <= B.trayR && y0 > B.trayY && y1 <= B.trayY + 0.04 && y0 < B.bandY + 2.5 && r0 <= R) return 'in';
  if (!(r0 > R && r1 <= R)) return 'none';
  if (y1 > B.bandY + 0.04 || y1 < 0.05) return 'none';
  if (y1 > B.chainsY1) return 'band';
  if (y1 < B.chainsY0) return 'cage';
  if (speed <= B.inSpeed && y1 <= B.lowY) return 'in';
  const pIn = clamp(0.85 - Math.max(0, speed - B.inSpeed) * 0.09 - Math.max(0, y1 - B.lowY) * 2.5, 0.05, 0.9);
  return rng.next() < pIn ? 'in' : 'rattle';
}

/** Where a holed disc rests: in the tray, a little off the pole. */
export function restInTray(base: V3, from: V3): V3 {
  const dx = from.x - base.x, dz = from.z - base.z, d = Math.hypot(dx, dz) || 1;
  return { x: base.x + (dx / d) * 0.12, y: base.y + BASKET.trayY + 0.03, z: base.z + (dz / d) * 0.12 };
}

/**
 * Velocity after bouncing off the basket: back out along the horizontal normal, much slower, dropping.
 * `kind` 'rattle' keeps a little sideways motion (the chains spit it out to one side).
 */
export function bounceOff(vel: V3, pos: V3, base: V3, kind: 'rattle' | 'band' | 'cage', rng: { next(): number }): V3 {
  const dx = pos.x - base.x, dz = pos.z - base.z, d = Math.hypot(dx, dz) || 1;
  const nx = dx / d, nz = dz / d;
  const vn = vel.x * nx + vel.z * nz;
  const keep = kind === 'band' ? 0.35 : kind === 'rattle' ? 0.18 : 0.3;
  const side = (rng.next() * 2 - 1) * (kind === 'rattle' ? 1.2 : 0.4);
  // reflect the normal part and damp everything
  const rx = (vel.x - 2 * vn * nx) * keep - nz * side;
  const rz = (vel.z - 2 * vn * nz) * keep + nx * side;
  return { x: rx, y: Math.min(vel.y, 0) * 0.3 - 0.4, z: rz };
}

/** The basket model with swinging chains. */
export class BasketView {
  readonly group = new THREE.Group();
  private readonly chains: THREE.Group;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private sway = 0;
  private swayV = 0;
  private swayDir = 0;

  constructor(scene: THREE.Scene, glow: boolean) {
    const own = <T extends { dispose(): void }>(x: T): T => { this.disposables.push(x); return x; };
    const metal = own(toon('#c9d1db'));
    const band = own(glow ? new THREE.MeshBasicMaterial({ color: '#ffd84a' }) : toon('#ffd84a'));
    const chainMat = own(toon('#9aa4b2'));
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, outline = 0.02): THREE.Mesh => {
      const m = new THREE.Mesh(own(geo), mat);
      m.position.y = y; m.castShadow = true;
      if (outline) addOutline(m, outline);
      this.group.add(m);
      return m;
    };
    mesh(new THREE.CylinderGeometry(0.03, 0.03, BASKET.bandY + 0.08, 8), metal, (BASKET.bandY + 0.08) / 2);
    mesh(new THREE.CylinderGeometry(BASKET.trayR + 0.04, BASKET.trayR - 0.03, 0.16, 20, 1, true), band, BASKET.trayY - 0.06);
    mesh(new THREE.CircleGeometry(BASKET.trayR, 20).rotateX(-Math.PI / 2), metal, BASKET.trayY - 0.12, 0);
    mesh(new THREE.TorusGeometry(BASKET.chainR + 0.04, 0.03, 6, 24).rotateX(Math.PI / 2), band, BASKET.bandY);
    // chains: two rings of thin lines from the band to the pole, hanging in a cone
    this.chains = new THREE.Group();
    this.chains.position.y = BASKET.bandY;
    this.group.add(this.chains);
    const chainGeo = own(new THREE.CylinderGeometry(0.008, 0.008, 1, 3));
    chainGeo.translate(0, -0.5, 0);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const outer = i % 2 === 0 ? BASKET.chainR : BASKET.chainR * 0.7;
      const top = new THREE.Vector3(Math.cos(a) * outer, 0, Math.sin(a) * outer);
      const bottom = new THREE.Vector3(Math.cos(a) * 0.05, BASKET.chainsY0 - BASKET.bandY + 0.06, Math.sin(a) * 0.05);
      const dir = bottom.clone().sub(top);
      const c = new THREE.Mesh(chainGeo, chainMat);
      c.position.copy(top);
      c.scale.set(1, dir.length(), 1);
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
      this.chains.add(c);
    }
    if (glow) {
      const light = new THREE.PointLight('#ffd84a', 1.2, 9);
      light.position.y = BASKET.bandY;
      this.group.add(light);
    }
    scene.add(this.group);
  }

  place(x: number, y: number, z: number): void { this.group.position.set(x, y, z); }

  /** Kick the chains (a hit, 0..1) from horizontal direction `dir` (radians). */
  hit(power: number, dir: number): void { this.swayV += power * 2.2; this.swayDir = dir; }

  update(dt: number): void {
    // a damped spring
    this.swayV += (-this.sway * 30 - this.swayV * 4) * dt;
    this.sway += this.swayV * dt;
    const s = clamp(this.sway, -0.5, 0.5);
    this.chains.rotation.set(Math.cos(this.swayDir) * s * 0.3, 0, Math.sin(this.swayDir) * s * 0.3);
    this.chains.position.x = Math.sin(this.swayDir) * s * 0.03;
  }

  dispose(): void { for (const d of this.disposables) d.dispose(); this.group.removeFromParent(); }
}

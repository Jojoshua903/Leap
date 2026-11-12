import * as THREE from 'three';
import { toon } from '../render/Toon';
import type { QualityLevel } from '../core/Quality';
import { Terrain, plantTrees, placeRocks } from './Terrain';
import { BasketView } from './Basket';
import type { CourseDef, HoleDef } from './courses';
import type { FlightSample } from './DiscPhysics';

const MARGIN = 26;

/**
 * One hole on screen: the terrain built from the HoleDef (fairway, ponds, sand, slope toward the
 * basket), trees and rocks with their obstacles, the tee pad, the basket, OB flags along the bounds,
 * and the aids: preview arc, landing ring and aim arrow. Rebuilt for every hole.
 */
export class HoleView {
  readonly ground: Terrain;
  readonly basket: BasketView;
  readonly basketPos: THREE.Vector3;
  readonly teePos: THREE.Vector3;
  private readonly group = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly arc: THREE.Line;
  private readonly arcPos: Float32Array;
  private readonly ring: THREE.Mesh;
  private readonly arrow: THREE.Mesh;
  static readonly ARC_N = 160;

  constructor(readonly scene: THREE.Scene, readonly course: CourseDef, readonly hole: HoleDef, index: number, quality: QualityLevel) {
    const h = hole, b = h.bounds;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const bz = h.basket.z || -1;
    this.ground = new Terrain({
      cx, cz, w: b.x1 - b.x0 + MARGIN * 2, d: b.z1 - b.z0 + MARGIN * 2,
      seed: course.seed + index * 97, hills: h.hills ?? 0.8, scale: 18,
      // a linear rise from the tee to the basket
      slopeZ: (h.elev ?? 0) / bz, slopeX: 0,
      pads: [{ x: 0, z: 0, r: 2.6 }, { x: h.basket.x, z: h.basket.z, r: 3.5 }],
      ponds: h.ponds, sand: h.sand,
      fairway: h.fairway ?? [{ x: 0, z: 0 }, h.basket], fairwayW: h.fairwayW ?? 8,
      base: 'grass'
    });
    const seg = quality === 'low' ? 70 : quality === 'med' ? 110 : 150;
    const terrain = this.ground.buildMesh(course.palette, seg);
    this.own(terrain.geometry, terrain.material as THREE.Material);
    this.group.add(terrain);
    const water = this.ground.buildWater(course.water);
    if (water) { this.own(water.geometry, water.material as THREE.Material); this.group.add(water); }
    if (h.trees?.length) {
      const tr = plantTrees(this.ground, h.trees, h.treeKind ?? 'round', course.trees, course.seed + index);
      this.disposables.push(tr); this.group.add(tr.group);
    }
    if (h.rocks?.length) {
      const rk = placeRocks(this.ground, h.rocks, course.rock, course.seed + index + 50);
      this.disposables.push(rk); this.group.add(rk.group);
    }
    // tee pad
    this.teePos = new THREE.Vector3(0, this.ground.height(0, 0), 0);
    const pad = new THREE.Mesh(this.own(new THREE.BoxGeometry(1.6, 0.06, 3)), this.own(toon(course.night ? '#6a6f86' : '#c9b79a')));
    pad.position.set(0, this.teePos.y + 0.02, 0.4); pad.receiveShadow = true;
    this.group.add(pad);
    // basket
    this.basketPos = new THREE.Vector3(h.basket.x, this.ground.height(h.basket.x, h.basket.z), h.basket.z);
    this.basket = new BasketView(scene, !!course.night);
    this.basket.place(this.basketPos.x, this.basketPos.y, this.basketPos.z);
    // OB flags at the corners and along the sides every ~20 m
    const flagGeo = this.own(new THREE.ConeGeometry(0.12, 0.7, 6)); flagGeo.translate(0, 0.35, 0);
    const flagMat = this.own(course.night ? new THREE.MeshBasicMaterial({ color: '#ff5a5f' }) : toon('#ff5a5f'));
    const flags: Array<[number, number]> = [];
    for (let x = b.x0; x <= b.x1 + 0.1; x += (b.x1 - b.x0) / Math.max(1, Math.round((b.x1 - b.x0) / 20))) flags.push([x, b.z0], [x, b.z1]);
    for (let z = b.z0; z <= b.z1 + 0.1; z += (b.z1 - b.z0) / Math.max(1, Math.round((b.z1 - b.z0) / 20))) flags.push([b.x0, z], [b.x1, z]);
    const flagIm = new THREE.InstancedMesh(flagGeo, flagMat, flags.length);
    const m = new THREE.Matrix4();
    flags.forEach(([x, z], i) => { m.makeTranslation(x, this.ground.height(x, z), z); flagIm.setMatrixAt(i, m); });
    flagIm.instanceMatrix.needsUpdate = true;
    this.own(flagIm);
    this.group.add(flagIm);

    // aids
    this.arcPos = new Float32Array(HoleView.ARC_N * 3);
    const ag = this.own(new THREE.BufferGeometry());
    ag.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3));
    ag.setDrawRange(0, 0);
    this.arc = new THREE.Line(ag, this.own(new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.85, depthTest: false })));
    this.arc.renderOrder = 5;
    this.arc.frustumCulled = false;
    this.group.add(this.arc);
    const rg = this.own(new THREE.RingGeometry(0.9, 1.2, 32)); rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rg, this.own(new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.9, depthWrite: false })));
    this.ring.renderOrder = 4;
    this.ring.visible = false;
    this.group.add(this.ring);
    const arrowGeo = this.own(new THREE.ConeGeometry(0.25, 0.9, 3)); arrowGeo.rotateX(-Math.PI / 2);
    this.arrow = new THREE.Mesh(arrowGeo, this.own(new THREE.MeshBasicMaterial({ color: '#3ff2ff', transparent: true, opacity: 0.85, depthWrite: false })));
    this.arrow.visible = false;
    this.group.add(this.arrow);
    scene.add(this.group);
  }

  private own<T extends { dispose(): void }>(x: T): T { this.disposables.push(x); return x; }

  /** Preview arc from flight samples (null hides it); `upTo` seconds of it, and the landing ring. */
  preview(path: FlightSample[] | null, upTo: number, landing: { x: number; z: number } | null): void {
    const g = this.arc.geometry;
    if (!path || !path.length) { g.setDrawRange(0, 0); this.ring.visible = false; return; }
    let n = 0;
    const step = Math.max(1, Math.ceil(path.length / HoleView.ARC_N));
    for (let i = 0; i < path.length && n < HoleView.ARC_N; i += step) {
      const s = path[i];
      if (s.t > upTo) break;
      this.arcPos.set([s.x, s.y, s.z], n * 3);
      n++;
    }
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, n);
    this.arc.computeLineDistances();
    this.ring.visible = !!landing;
    if (landing) this.ring.position.set(landing.x, this.ground.height(landing.x, landing.z) + 0.05, landing.z);
  }

  /** Aim arrow on the ground in front of the lie. */
  aim(x: number, z: number, headingDeg: number | null): void {
    this.arrow.visible = headingDeg !== null;
    if (headingDeg === null) return;
    const a = headingDeg * Math.PI / 180;
    const px = x + Math.sin(a) * 2.2, pz = z - Math.cos(a) * 2.2;
    this.arrow.position.set(px, this.ground.height(px, pz) + 0.08, pz);
    this.arrow.rotation.set(0, -a, 0);
  }

  update(dt: number): void { this.basket.update(dt); }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.basket.dispose();
    this.group.removeFromParent();
  }
}

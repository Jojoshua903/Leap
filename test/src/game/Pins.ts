import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TUNING } from '../tuning';
import { toon } from '../render/Toon';
import type { LaneSpec } from './dims';

export const PIN_HEIGHT = 0.381;
const DOWN_COS = Math.cos(Math.PI / 4);        // tilted more than 45° = down
const WOBBLE_COS = Math.cos(Math.PI / 7);      // used to detect "a strike is coming" early
const OUTLINE = 0.05;

/* ---------- shared pin geometry ---------- */
let pinGeo: THREE.LatheGeometry | null = null;
function pinGeometry(detail: 'full' | 'simple'): THREE.LatheGeometry {
  if (detail === 'full' && pinGeo) return pinGeo;
  // [radius, height] profile of a ten-pin, base at y = 0
  const profile: Array<[number, number]> = [
    [0, 0], [0.026, 0], [0.031, 0.02], [0.045, 0.06], [0.058, 0.11], [0.0605, 0.14], [0.056, 0.18],
    [0.042, 0.23], [0.026, 0.27], [0.022, 0.29], [0.028, 0.315], [0.032, 0.335], [0.029, 0.355], [0.018, 0.372], [0, PIN_HEIGHT]
  ];
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), detail === 'full' ? 18 : 9);
  if (detail === 'full') pinGeo = g;
  return g;
}
function stripeGeometry(segments: number): THREE.BufferGeometry {
  const parts = [0.282, 0.302].map(y => {
    const t = new THREE.TorusGeometry(0.0235, 0.0045, 6, segments);
    t.rotateX(Math.PI / 2); t.translate(0, y, 0);
    return t;
  });
  return mergeGeometries(parts)!;
}
/** Outline hull: the pin scaled up around its middle, so it can share the body's instance matrices. */
function outlineGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  const s = 1 + OUTLINE;
  g.translate(0, -PIN_HEIGHT / 2, 0); g.scale(s, s, s); g.translate(0, PIN_HEIGHT / 2, 0);
  return g;
}
const pinMat = toon('#fffdf7');
const stripeMat = toon('#e2232e');
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1d2a3a, side: THREE.BackSide });

/** A single decorative pin (neighbour lanes, podium props). Origin at the base. */
export function makePinMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(pinGeometry('full'), pinMat);
  body.castShadow = true;
  g.add(body, new THREE.Mesh(outlineGeometry(pinGeometry('full')), outlineMat), new THREE.Mesh(stripeGeometry(14), stripeMat));
  return g;
}

/**
 * A rack of physics pins drawn with InstancedMesh (one draw call each for bodies, stripes and outlines),
 * so 100 pins cost about the same to draw as 10. Bodies are allowed to sleep; scoring and settle checks
 * skip sleeping pins, which keeps the 100-pin wall cheap once it stops moving.
 */
export class PinSet {
  readonly count: number;
  readonly bodies: RAPIER.RigidBody[] = [];
  /** false once a pin was knocked down and cleared by the sweep. */
  readonly inPlay: boolean[] = [];
  readonly group = new THREE.Group();
  private readonly handleToPin = new Map<number, number>();
  private readonly prevP: THREE.Vector3[] = [];
  private readonly currP: THREE.Vector3[] = [];
  private readonly prevQ: THREE.Quaternion[] = [];
  private readonly currQ: THREE.Quaternion[] = [];
  private readonly wobbleT: Float32Array;
  private readonly downCache: Int8Array;          // -1 unknown, 0 standing, 1 down (per physics step)
  private body!: THREE.InstancedMesh;
  private stripes!: THREE.InstancedMesh;
  private outline!: THREE.InstancedMesh;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly up = new THREE.Vector3();
  private readonly m4 = new THREE.Matrix4();
  private readonly s3 = new THREE.Vector3();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private detail: 'full' | 'simple' = 'full';

  constructor(scene: THREE.Scene, private readonly world: RAPIER.World, private readonly spec: LaneSpec) {
    this.count = spec.spots.length;
    this.wobbleT = new Float32Array(this.count);
    this.downCache = new Int8Array(this.count).fill(-1);
    const k = spec.pinScale;
    const m = TUNING.pinMass * k * k * k;
    for (let i = 0; i < this.count; i++) {
      const [x, z] = spec.spots[i];
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.0005, z).setLinearDamping(0.15).setAngularDamping(0.35)
          .setCcdEnabled(this.count <= 10).setCanSleep(true)
      );
      // base, belly, neck and head: centre of mass ≈ 0.16 m (stable at rest)
      const parts: Array<[RAPIER.ColliderDesc, number, number]> = [
        [RAPIER.ColliderDesc.cylinder(0.035 * k, 0.03 * k), 0.035 * k, 0.17],
        [RAPIER.ColliderDesc.cylinder(0.08 * k, 0.06 * k), 0.14 * k, 0.6],
        [RAPIER.ColliderDesc.cylinder(0.04 * k, 0.024 * k), 0.27 * k, 0.13],
        [RAPIER.ColliderDesc.ball(0.032 * k), 0.335 * k, 0.1]
      ];
      for (const [desc, y, share] of parts) {
        desc.setTranslation(0, y, 0).setMass(m * share).setFriction(0.4).setRestitution(TUNING.pinRestitution)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        const c = world.createCollider(desc, body);
        this.handleToPin.set(c.handle, i);
      }
      this.bodies.push(body);
      this.inPlay.push(true);
      this.prevP.push(new THREE.Vector3(x, 0, z)); this.currP.push(new THREE.Vector3(x, 0, z));
      this.prevQ.push(new THREE.Quaternion()); this.currQ.push(new THREE.Quaternion());
    }
    [this.body, this.stripes, this.outline] = this.makeMeshes('full');
    scene.add(this.group);
    this.rack();
  }

  private makeMeshes(detail: 'full' | 'simple'): [THREE.InstancedMesh, THREE.InstancedMesh, THREE.InstancedMesh] {
    const geo = pinGeometry(detail);
    const body = new THREE.InstancedMesh(geo, pinMat, this.count);
    body.castShadow = detail === 'full';
    body.receiveShadow = true;
    const stripes = new THREE.InstancedMesh(stripeGeometry(detail === 'full' ? 14 : 8), stripeMat, this.count);
    const outline = new THREE.InstancedMesh(outlineGeometry(geo), outlineMat, this.count);
    for (const im of [body, stripes, outline]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      this.group.add(im);
    }
    return [body, stripes, outline];
  }

  /** Lower detail for the 100-pin wall on Low/Medium quality. Outlines can be switched off entirely. */
  setDetail(detail: 'full' | 'simple', outlines = true): void {
    if (detail !== this.detail) {
      for (const im of [this.body, this.stripes, this.outline]) {
        this.group.remove(im);
        if (im.geometry !== pinGeo) im.geometry.dispose();
        im.dispose();
      }
      [this.body, this.stripes, this.outline] = this.makeMeshes(detail);
      this.detail = detail;
      this.render(1, 0);
    }
    this.outline.visible = outlines;
  }

  /** Pin index for a collider handle, or -1. */
  indexOf(handle: number): number { return this.handleToPin.get(handle) ?? -1; }

  /** Full fresh rack of standing pins. */
  rack(): void {
    for (let i = 0; i < this.count; i++) {
      const [x, z] = this.spec.spots[i], b = this.bodies[i];
      b.setEnabled(true);
      b.setTranslation({ x, y: 0.0005, z }, true);
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      b.sleep();
      this.inPlay[i] = true;
      this.prevP[i].set(x, 0, z); this.currP[i].set(x, 0, z);
      this.prevQ[i].identity(); this.currQ[i].identity();
    }
    this.downCache.fill(-1);
    this.render(1, 0);
  }

  /** Stop any leftover motion on standing pins before the next ball. */
  settleStanding(): void {
    for (let i = 0; i < this.count; i++) {
      if (!this.inPlay[i]) continue;
      const b = this.bodies[i];
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      b.sleep();
    }
  }

  private tilt(i: number): number {
    const r = this.bodies[i].rotation();
    this.tmpQ.set(r.x, r.y, r.z, r.w);
    return this.up.set(0, 1, 0).applyQuaternion(this.tmpQ).y;
  }

  /** Down = tilted past 45°, fallen off the deck, or in the pit / gutter. */
  isDown(i: number): boolean {
    if (!this.inPlay[i]) return true;
    const c = this.downCache[i];
    if (c >= 0) return c === 1;
    const p = this.bodies[i].translation();
    const down = p.y < -0.05 || p.z < this.spec.deckEndZ - 0.02 || Math.abs(p.x) > this.spec.halfW + this.spec.gutterW * 0.3 || this.tilt(i) < DOWN_COS;
    this.downCache[i] = down ? 1 : 0;
    return down;
  }

  standingCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.inPlay[i] && !this.isDown(i)) n++;
    return n;
  }

  /** Pins visibly falling right now (tilted > ~25°), for the early strike slow-motion. */
  tippingCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.inPlay[i] && (this.isDown(i) || this.tilt(i) < WOBBLE_COS)) n++;
    return n;
  }

  /** The sweep: clear fallen pins out of play. */
  removeDown(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.inPlay[i] && this.isDown(i)) {
        this.inPlay[i] = false;
        this.bodies[i].setEnabled(false);
      }
    }
    this.render(1, 0);
  }

  /** Fastest moving pin in play (m/s, angular speed weighted in), for settle detection. Sleeping pins are skipped. */
  maxSpeed(): number {
    let m = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.inPlay[i]) continue;
      const b = this.bodies[i];
      if (b.isSleeping()) continue;
      const v = b.linvel(), w = b.angvel();
      m = Math.max(m, Math.hypot(v.x, v.y, v.z) + 0.05 * Math.hypot(w.x, w.y, w.z));
    }
    return m;
  }

  /** Number of pins still simulating (not asleep), for the performance governor. */
  awakeCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.inPlay[i] && !this.bodies[i].isSleeping()) n++;
    return n;
  }

  wobble(i: number): void { if (i >= 0) this.wobbleT[i] = 0.35; }

  /** Call after every physics step: shift current → previous and read the new pose. */
  snapshot(): void {
    this.downCache.fill(-1);
    for (let i = 0; i < this.count; i++) {
      if (!this.inPlay[i]) continue;
      const b = this.bodies[i];
      this.prevP[i].copy(this.currP[i]); this.prevQ[i].copy(this.currQ[i]);
      if (b.isSleeping()) continue;
      const p = b.translation(), r = b.rotation();
      this.currP[i].set(p.x, p.y, p.z); this.currQ[i].set(r.x, r.y, r.z, r.w);
    }
  }

  /** Interpolate between the last two physics states; dt is real time for the wobble squash. */
  render(alpha: number, dt: number): void {
    const k = this.spec.pinScale;
    const pos = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let i = 0; i < this.count; i++) {
      if (!this.inPlay[i]) {
        this.body.setMatrixAt(i, this.hidden); this.stripes.setMatrixAt(i, this.hidden); this.outline.setMatrixAt(i, this.hidden);
        continue;
      }
      pos.lerpVectors(this.prevP[i], this.currP[i], alpha);
      q.slerpQuaternions(this.prevQ[i], this.currQ[i], alpha);
      let w = 0;
      if (this.wobbleT[i] > 0) {
        this.wobbleT[i] = Math.max(0, this.wobbleT[i] - dt);
        w = Math.sin((0.35 - this.wobbleT[i]) * 40) * this.wobbleT[i] * 0.4;
      }
      this.s3.set(k * (1 + w), k * (1 - w), k * (1 + w));
      this.m4.compose(pos, q, this.s3);
      this.body.setMatrixAt(i, this.m4); this.stripes.setMatrixAt(i, this.m4); this.outline.setMatrixAt(i, this.m4);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.stripes.instanceMatrix.needsUpdate = true;
    this.outline.instanceMatrix.needsUpdate = true;
  }

  /** Centre of the rack, for confetti and camera targets. */
  centre(): THREE.Vector3 {
    let z = 0;
    for (const [, sz] of this.spec.spots) z += sz;
    return new THREE.Vector3(0, 0.4, z / this.count);
  }

  dispose(): void {
    this.bodies.forEach(b => this.world.removeRigidBody(b));
    for (const im of [this.body, this.stripes, this.outline]) { if (im.geometry !== pinGeo) im.geometry.dispose(); im.dispose(); }
    this.group.removeFromParent();
  }
}

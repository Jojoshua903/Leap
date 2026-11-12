import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BALL, BB_TUNING, COURT, HOOP } from './bbTuning';
import { BasketSensor } from './HoopSensor';
import { HOOP_CENTER, type V3 } from './ShotSolver';

/**
 * Rapier setup for basketball (fixed step 1/120 s): floor, backboard, a rim made of 20 small capsules
 * (so the ball rattles), the pole, invisible walls around the court, and a pool of balls with CCD.
 * Each ball carries its own BasketSensor and remembers whether it touched rim or glass (for swishes).
 *
 * Restitution: the ball has 0 with the Max combine rule, so every bounce uses the surface's value
 * (floor 0.75, glass 0.6, rim 0.55) and the tuning sliders change them live.
 */
export type BBContactKind = 'rim' | 'board' | 'floor' | 'pole' | 'wall';

export interface BBContact { ball: BBBall; kind: BBContactKind; speed: number; pos: V3 }

let rapierReady: Promise<void> | null = null;
export const ensureRapier = (): Promise<void> => (rapierReady ??= RAPIER.init());

const copy = (v: { x: number; y: number; z: number }): V3 => ({ x: v.x, y: v.y, z: v.z });

export class BBBall {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly sensor = new BasketSensor();
  /** Physics is running (shot or loose ball). */
  live = false;
  touchedRim = false;
  touchedBoard = false;
  touchedFloor = false;
  /** A basket has been counted for this flight. */
  scored = false;
  releaseT = 0;
  /** Whatever the mode wants to remember about this shot (value, shooter…). */
  tag: unknown = null;
  readonly prev: V3 = { x: 0, y: 0, z: 0 };
  readonly cur: V3 = { x: 0, y: 0, z: 0 };
  readonly prevQ = new THREE.Quaternion();
  readonly curQ = new THREE.Quaternion();

  constructor(world: RAPIER.World, readonly index: number) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -5 - index, 0).setCcdEnabled(true)
        .setLinearDamping(0).setAngularDamping(0.15).setEnabled(false)
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.ball(BALL.radius).setMass(BALL.mass)
        .setRestitution(0).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setFriction(0.7).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body
    );
  }

  /** Throw it: from `pos` with velocity and spin, on physics time `t`. */
  launch(pos: V3, vel: V3, spin: V3, t: number): void {
    this.body.setEnabled(true);
    this.body.setTranslation(pos, true);
    this.body.setLinvel(vel, true);
    this.body.setAngvel(spin, true);
    this.body.wakeUp();
    this.live = true;
    this.touchedRim = false; this.touchedBoard = false; this.touchedFloor = false; this.scored = false;
    this.releaseT = t;
    this.sensor.reset();
    Object.assign(this.prev, pos); Object.assign(this.cur, pos);
  }

  /** Physics off (in someone's hands, or parked). */
  hold(pos?: V3): void {
    if (this.live) this.body.setEnabled(false);
    this.live = false;
    if (pos) { Object.assign(this.prev, pos); Object.assign(this.cur, pos); }
  }

  get velocity(): V3 { return this.live ? copy(this.body.linvel()) : { x: 0, y: 0, z: 0 }; }
  get speed(): number { const v = this.velocity; return Math.hypot(v.x, v.y, v.z); }
}

export class HoopWorld {
  readonly world: RAPIER.World;
  readonly balls: BBBall[] = [];
  readonly hoop: V3 = HOOP_CENTER;
  time = 0;
  private readonly events = new RAPIER.EventQueue(true);
  private readonly kinds = new Map<number, BBContactKind>();
  private readonly byCollider = new Map<number, BBBall>();
  private readonly floor: RAPIER.Collider;
  private readonly board: RAPIER.Collider;
  private readonly rim: RAPIER.Collider[] = [];

  constructor(ballCount: number) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 120;
    const fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const add = (desc: RAPIER.ColliderDesc, kind: BBContactKind): RAPIER.Collider => {
      const c = this.world.createCollider(desc, fixed);
      this.kinds.set(c.handle, kind);
      return c;
    };
    const T = BB_TUNING, H = HOOP;

    // floor: a big slab whose top is y = 0
    this.floor = add(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 6).setRestitution(T.floorRestitution).setFriction(0.8), 'floor');

    // backboard
    const bh = H.boardHeight / 2;
    this.board = add(RAPIER.ColliderDesc.cuboid(H.boardWidth / 2, bh, H.boardThickness / 2)
      .setTranslation(this.hoop.x, H.boardBottom + bh, H.boardZ - H.boardThickness / 2)
      .setRestitution(T.boardRestitution).setFriction(0.5), 'board');

    // rim: capsules laid tangentially around the ring
    const ring = H.rimRadius + H.tube;
    const half = (Math.PI * ring) / H.rimSegments;          // half the arc length of one segment
    const up = new THREE.Vector3(0, 1, 0), tan = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let i = 0; i < H.rimSegments; i++) {
      const a = (i + 0.5) / H.rimSegments * Math.PI * 2;
      tan.set(-Math.sin(a), 0, Math.cos(a));
      q.setFromUnitVectors(up, tan);
      this.rim.push(add(RAPIER.ColliderDesc.capsule(half, H.tube)
        .setTranslation(this.hoop.x + Math.cos(a) * ring, this.hoop.y, this.hoop.z + Math.sin(a) * ring)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setRestitution(T.rimRestitution).setFriction(0.6), 'rim'));
    }
    // the bracket between rim and board, so a ball can't slip through the gap
    const rimBack = this.hoop.z - ring;
    add(RAPIER.ColliderDesc.cuboid(0.06, 0.02, (rimBack - H.boardZ) / 2)
      .setTranslation(this.hoop.x, this.hoop.y - 0.01, (rimBack + H.boardZ) / 2)
      .setRestitution(0.3), 'rim');

    // pole and its arm behind the board
    add(RAPIER.ColliderDesc.cuboid(0.12, H.boardBottom / 2 + 0.3, 0.12).setTranslation(0, H.boardBottom / 2 + 0.3, COURT.baselineZ - 0.6).setRestitution(0.4), 'pole');

    // invisible walls a little outside the court, so loose balls stay nearby
    const W = COURT.halfWidth + 2.5;
    add(RAPIER.ColliderDesc.cuboid(0.2, 4, 20).setTranslation(-W, 4, 6).setRestitution(0.5), 'wall');
    add(RAPIER.ColliderDesc.cuboid(0.2, 4, 20).setTranslation(W, 4, 6).setRestitution(0.5), 'wall');
    add(RAPIER.ColliderDesc.cuboid(W, 4, 0.2).setTranslation(0, 4, COURT.baselineZ - 2.5).setRestitution(0.5), 'wall');
    add(RAPIER.ColliderDesc.cuboid(W, 4, 0.2).setTranslation(0, 4, COURT.halfCourtZ + 3).setRestitution(0.5), 'wall');

    for (let i = 0; i < ballCount; i++) {
      const b = new BBBall(this.world, i);
      this.balls.push(b);
      this.byCollider.set(b.collider.handle, b);
    }
  }

  /** Re-read restitution values after a tuning slider moved. */
  applyTuning(): void {
    const T = BB_TUNING;
    this.floor.setRestitution(T.floorRestitution);
    this.board.setRestitution(T.boardRestitution);
    for (const r of this.rim) r.setRestitution(T.rimRestitution);
  }

  /** A ball that is not in flight, for the next shot (or null if all are busy). */
  freeBall(): BBBall | null { return this.balls.find(b => !b.live) ?? null; }

  /**
   * One 1/120 s step. Applies net drag and rolling resistance, steps Rapier, then returns the contacts and
   * the balls that completed a basket during this step.
   */
  step(dt: number): { contacts: BBContact[]; baskets: BBBall[] } {
    const T = BB_TUNING, H = HOOP;
    for (const b of this.balls) {
      if (!b.live) continue;
      const p = b.body.translation(), v = b.body.linvel();
      const rho = Math.hypot(p.x - this.hoop.x, p.z - this.hoop.z);
      // inside the net: it grabs the ball, so a make drops instead of flying out the bottom
      if (rho < H.rimRadius && p.y < this.hoop.y && p.y > this.hoop.y - H.netDepth) {
        const k = Math.max(0, 1 - T.netDrag * dt);
        const pull = 3 * dt;
        b.body.setLinvel({ x: v.x * k - (p.x - this.hoop.x) * pull, y: v.y * (0.5 + 0.5 * k), z: v.z * k - (p.z - this.hoop.z) * pull }, true);
      } else if (p.y < BALL.radius + 0.015 && Math.abs(v.y) < 0.6) {
        const k = Math.max(0, 1 - T.rollDrag * dt);
        b.body.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
      }
    }
    this.world.step(this.events);
    this.time += dt;

    const contacts: BBContact[] = [];
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const ball = this.byCollider.get(h1) ?? this.byCollider.get(h2);
      if (!ball) return;
      const other = this.byCollider.has(h1) ? h2 : h1;
      const kind = this.kinds.get(other);
      if (!kind) return;
      if (kind === 'rim') ball.touchedRim = true;
      else if (kind === 'board') ball.touchedBoard = true;
      else if (kind === 'floor') ball.touchedFloor = true;
      contacts.push({ ball, kind, speed: ball.speed, pos: copy(ball.body.translation()) });
    });

    const baskets: BBBall[] = [];
    for (const b of this.balls) {
      if (!b.live) continue;
      const p = b.body.translation(), r = b.body.rotation();
      Object.assign(b.prev, b.cur);
      b.cur.x = p.x; b.cur.y = p.y; b.cur.z = p.z;
      b.prevQ.copy(b.curQ); b.curQ.set(r.x, r.y, r.z, r.w);
      if (!b.scored && b.sensor.update(this.time, b.prev, b.cur)) { b.scored = true; baskets.push(b); }
    }
    return { contacts, baskets };
  }

  dispose(): void {
    this.events.free();
    this.world.free();
  }
}

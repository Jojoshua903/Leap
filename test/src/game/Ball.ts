import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../tuning';
import { toon, addOutline } from '../render/Toon';
import { Lane } from './Lane';
import type { LaneSpec } from './dims';
import type { Throw } from '../types';

const G = 9.81;

export type BallSkin = 'solid' | 'stripes' | 'galaxy' | 'marble' | 'flame';

/** Equirectangular canvas textures for the unlockable ball skins. `base` is the player's colour. */
function skinTexture(skin: BallSkin, base: string): THREE.CanvasTexture | null {
  if (skin === 'solid') return null;
  const W = 256, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  switch (skin) {
    case 'stripes':
      g.fillStyle = base; g.fillRect(0, 0, W, H);
      g.fillStyle = '#ffffff';
      for (let y = 18; y < H; y += 32) g.fillRect(0, y, W, 9);
      break;
    case 'galaxy': {
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, '#1b0f4a'); grad.addColorStop(0.5, '#4a1f8a'); grad.addColorStop(1, '#0d2a6a');
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 6; i++) {
        const x = rnd() * W, y = rnd() * H, r = 20 + rnd() * 40;
        const neb = g.createRadialGradient(x, y, 0, x, y, r);
        neb.addColorStop(0, i % 2 ? 'rgba(255,90,200,.45)' : 'rgba(80,200,255,.4)'); neb.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = neb; g.fillRect(0, 0, W, H);
      }
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 140; i++) { g.globalAlpha = 0.4 + rnd() * 0.6; g.fillRect(rnd() * W, rnd() * H, rnd() < 0.1 ? 2 : 1, rnd() < 0.1 ? 2 : 1); }
      g.globalAlpha = 1;
      break;
    }
    case 'marble': {
      g.fillStyle = '#f4f1ec'; g.fillRect(0, 0, W, H);
      g.lineCap = 'round';
      for (let k = 0; k < 9; k++) {
        g.strokeStyle = k % 3 === 0 ? base : k % 3 === 1 ? 'rgba(40,40,60,.35)' : 'rgba(255,255,255,.8)';
        g.lineWidth = 3 + rnd() * 9;
        g.beginPath();
        let y = rnd() * H;
        g.moveTo(0, y);
        for (let x = 0; x <= W; x += 16) { y += (rnd() - 0.5) * 22; g.lineTo(x, y); }
        g.stroke();
      }
      break;
    }
    case 'flame': {
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#2b0a0a'); grad.addColorStop(1, '#5a1208');
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 9; i++) {
        const x = (i / 9) * W, w = W / 9;
        for (const [col, sc] of [['#ff4a1a', 1], ['#ff9a1a', 0.7], ['#ffe36a', 0.4]] as const) {
          g.fillStyle = col;
          g.beginPath();
          g.moveTo(x, H);
          g.quadraticCurveTo(x + w * 0.1, H - H * 0.55 * sc, x + w * 0.5, H - H * 0.8 * sc - rnd() * 10);
          g.quadraticCurveTo(x + w * 0.9, H - H * 0.55 * sc, x + w, H);
          g.fill();
        }
      }
      break;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The bowling ball: a Rapier sphere plus the custom hook force, with an interpolated toon mesh. */
export class Ball {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh = new THREE.Group();
  /** Hook spin in rad/s (+ hooks left). Kept separately from Rapier's angular velocity on purpose. */
  spin = 0;
  /** Spin at release, for the Hook Master achievement and practice stats. */
  releaseSpin = 0;
  inGutter = false;
  inPit = false;
  /** true while the physics body is live (after release). */
  live = false;
  private readonly mat = toon('#ff5a5f');
  private readonly prevP = new THREE.Vector3();
  private readonly currP = new THREE.Vector3();
  private readonly prevQ = new THREE.Quaternion();
  private readonly currQ = new THREE.Quaternion();
  private squashT = 0;
  private skin: BallSkin = 'solid';
  private skinTex: THREE.Texture | null = null;
  private colour = '#ff5a5f';

  constructor(scene: THREE.Scene, private readonly world: RAPIER.World, private readonly spec: LaneSpec) {
    const r = TUNING.ballRadius;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, r, 1).setCcdEnabled(true).setLinearDamping(0.02).setAngularDamping(0.02).setEnabled(false)
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.ball(r).setMass(TUNING.ballMass).setFriction(1).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0.15).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body
    );

    const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), this.mat);
    sphere.castShadow = true;
    addOutline(sphere, 0.06);
    this.mesh.add(sphere);
    // three finger holes and a sparkle band so the roll is readable
    const holeMat = new THREE.MeshBasicMaterial({ color: '#1d2a3a' });
    for (const [ax, az] of [[-0.028, -0.02], [0.028, -0.02], [0, 0.035]]) {
      const h = new THREE.Mesh(new THREE.CircleGeometry(0.012, 10), holeMat);
      const n = new THREE.Vector3(ax, r, az).normalize();
      h.position.copy(n.clone().multiplyScalar(r + 0.0015));
      h.lookAt(n.clone().multiplyScalar(2));
      this.mesh.add(h);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.002, 0.006, 6, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }));
    this.mesh.add(band);
    scene.add(this.mesh);
  }

  setColor(c: string): void { this.colour = c; this.applySkin(); }
  setSkin(s: BallSkin): void { this.skin = s; this.applySkin(); }

  private applySkin(): void {
    this.skinTex?.dispose();
    this.skinTex = skinTexture(this.skin, this.colour);
    this.mat.map = this.skinTex;
    this.mat.color.set(this.skinTex ? '#ffffff' : this.colour);
    this.mat.needsUpdate = true;
  }

  get position(): THREE.Vector3 { return this.mesh.position; }

  speed(): number {
    if (!this.live) return 0;
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  /** Physics off, mesh placed in the player's hand (world position and rotation). */
  hold(pos: THREE.Vector3, q?: THREE.Quaternion): void {
    if (this.live) { this.body.setEnabled(false); this.live = false; }
    this.inGutter = false; this.inPit = false;
    this.mesh.position.copy(pos);
    if (q) this.mesh.quaternion.copy(q);
    this.currP.copy(pos); this.prevP.copy(pos);
    this.currQ.copy(this.mesh.quaternion); this.prevQ.copy(this.mesh.quaternion);
  }

  /** Release squash-and-stretch (plays in render()). */
  squash(): void { this.squashT = 0.3; }

  /** Start rolling with the throw's speed, direction and spin. */
  launch(t: Throw): void {
    const r = TUNING.ballRadius;
    const x = THREE.MathUtils.clamp(t.aimX * this.spec.aimHalfWidth, -this.spec.halfW + r, this.spec.halfW - r);
    const a = THREE.MathUtils.degToRad(t.angleDeg);
    const vx = Math.sin(a) * t.speed, vz = -Math.cos(a) * t.speed;
    this.body.setEnabled(true);
    this.body.setTranslation({ x, y: r + 0.004, z: -0.25 }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: vx, y: 0, z: vz }, true);
    // starts mostly skidding: only 30 % of the rolling angular velocity
    this.body.setAngvel({ x: (vz / r) * 0.3, y: 0, z: (-vx / r) * 0.3 }, true);
    this.body.wakeUp();
    this.spin = t.spin;
    this.releaseSpin = t.spin;
    this.live = true;
    this.inGutter = false;
    this.inPit = false;
    this.currP.set(x, r, -0.25); this.prevP.copy(this.currP);
  }

  /**
   * Hook force, applied every physics step. On the oil the ball skids straight; on the dry back end
   * friction lets the side spin "bite": a lateral impulse proportional to spin × dryness, while the
   * spin bleeds off into that sideways motion.
   */
  physicsStep(dt: number): void {
    if (!this.live) return;
    const S = this.spec;
    const p = this.body.translation();
    const r = TUNING.ballRadius;
    const onLane = Math.abs(p.x) < S.halfW && p.y > r - 0.02 && p.y < r + 0.05 && p.z > S.deckEndZ;
    if (onLane && !this.inGutter) {
      const dry = Lane.dryness(p.z);
      const fx = -TUNING.hookGain * this.spin * TUNING.ballMass * G * dry;
      this.body.applyImpulse({ x: fx * dt, y: 0, z: 0 }, true);
      this.spin -= this.spin * TUNING.spinDecay * dry * dt;
    }
    if (!this.inGutter && Math.abs(p.x) > S.halfW - 0.01 && p.y < r - 0.03 && p.z > S.deckEndZ) {
      this.inGutter = true;
      this.spin = 0;
    }
    if (!this.inPit && p.z < S.deckEndZ - 0.1 && p.y < -0.1) this.inPit = true;
    // keep a ball in the gutter running straight instead of climbing back out
    if (this.inGutter) {
      const v = this.body.linvel();
      this.body.setLinvel({ x: v.x * 0.9, y: v.y, z: v.z }, true);
    }
  }

  /** Call after every physics step. */
  snapshot(): void {
    if (!this.live) return;
    const p = this.body.translation(), q = this.body.rotation();
    this.prevP.copy(this.currP); this.prevQ.copy(this.currQ);
    this.currP.set(p.x, p.y, p.z); this.currQ.set(q.x, q.y, q.z, q.w);
  }

  render(alpha: number, dt: number): void {
    if (this.live) {
      this.mesh.position.lerpVectors(this.prevP, this.currP, alpha);
      this.mesh.quaternion.slerpQuaternions(this.prevQ, this.currQ, alpha);
    }
    if (this.squashT > 0) {
      this.squashT = Math.max(0, this.squashT - dt);
      const k = Math.sin((1 - this.squashT / 0.3) * Math.PI) * 0.22;
      this.mesh.scale.set(1 + k * 0.6, 1 - k, 1 + k * 0.6);
    } else this.mesh.scale.set(1, 1, 1);
  }

  dispose(): void {
    this.world.removeRigidBody(this.body);
    this.skinTex?.dispose();
    this.mesh.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); });
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}

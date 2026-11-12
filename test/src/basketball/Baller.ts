import * as THREE from 'three';
import { buildBuddy, BUDDY_DIMS, type BuddyRig } from '../buddy/BuddyBuilder';
import { BuddyAnimator } from '../buddy/BuddyAnimator';
import type { BuddyConfig } from '../buddy/BuddyConfig';
import { toon } from '../render/Toon';

export type JerseyStyle = 'home' | 'stripes' | 'retro' | 'neon';

/** Jersey texture: team colour, style trim and the number front and back (u = 0 is the front of a capsule). */
function jerseyTexture(style: JerseyStyle, team: string, num: number): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const W = 256, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const dark = style === 'neon';
  g.fillStyle = dark ? '#15172a' : team; g.fillRect(0, 0, W, H);
  if (style === 'stripes') { g.fillStyle = 'rgba(255,255,255,0.35)'; for (let x = 4; x < W; x += 16) g.fillRect(x, 0, 3, H); }
  if (style === 'retro') { g.fillStyle = '#f4f1ec'; g.fillRect(0, 0, W, H * 0.45); g.fillStyle = team; g.fillRect(0, H * 0.45, W, 8); }
  if (style === 'home') { g.fillStyle = '#ffffff'; g.fillRect(W * 0.22, 0, 10, H); g.fillRect(W * 0.72, 0, 10, H); }
  if (dark) { g.strokeStyle = team; g.lineWidth = 5; for (const y of [10, H - 10]) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } }
  g.font = 'bold 58px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = style === 'retro' ? team : dark ? team : '#ffffff';
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 4;
  for (const x of [0, W, W / 2]) { g.strokeText(String(num), x, H * 0.55); g.fillText(String(num), x, H * 0.55); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * One basketball player on screen: a Buddy with a team jersey, its animator, a position and facing on
 * the court, and a jump arc for shots and blocks. The ball is drawn by the scene at `ballAnchor` (held)
 * or near `dribbleHand`.
 */
export class Baller {
  readonly rig: BuddyRig;
  readonly anim: BuddyAnimator;
  readonly pos = new THREE.Vector3();
  facing = Math.PI;
  private jumpT = -1;
  private jumpDur = 0.5;
  private jumpH = 0.35;
  private readonly jersey: THREE.Mesh;
  private readonly jerseyTex: THREE.Texture | null;
  private readonly jerseyMat: THREE.MeshToonMaterial;
  private readonly jerseyGeo: THREE.BufferGeometry;
  private readonly ring: THREE.Mesh;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(readonly scene: THREE.Scene, buddy: BuddyConfig, opts: { jersey: JerseyStyle; team: string; number: number; left?: boolean }) {
    this.rig = buildBuddy(buddy);
    this.anim = new BuddyAnimator(this.rig);
    this.anim.mirror = !!opts.left;
    const D = BUDDY_DIMS;
    this.jerseyGeo = new THREE.CapsuleGeometry(D.torsoR * 1.06, D.torsoH - D.torsoR * 2 + 0.1, 4, 16);
    this.jerseyTex = jerseyTexture(opts.jersey, opts.team, opts.number);
    this.jerseyMat = toon(this.jerseyTex ? '#ffffff' : opts.team, this.jerseyTex ? { map: this.jerseyTex, emissive: opts.jersey === 'neon' ? '#141020' : '#000000' } : {});
    this.jersey = new THREE.Mesh(this.jerseyGeo, this.jerseyMat);
    this.jersey.position.y = D.torsoH / 2 + 0.01;
    this.jersey.scale.set(1.1, 1, 0.86);
    this.jersey.castShadow = true;
    this.rig.joints.spine.add(this.jersey);
    // ring under the feet: who you control / who you pass to
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.015;
    this.rig.root.add(this.ring);
    scene.add(this.rig.root);
  }

  /** Ring under the Buddy: a colour, or null to hide. */
  setRing(color: string | null, pulse = 0): void {
    const m = this.ring.material as THREE.MeshBasicMaterial;
    if (!color) { m.opacity = 0; return; }
    m.color.set(color);
    m.opacity = 0.75 + 0.25 * pulse;
  }

  /** Turn toward a world point, at most `rate` rad/s (Infinity = snap). */
  turnToward(x: number, z: number, dt: number, rate = 10): void {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    let d = want - this.facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const max = rate * dt;
    this.facing += Math.max(-max, Math.min(max, d));
  }

  /** Start a jump that reaches `height` after `apex` seconds. */
  jump(apex: number, height: number): void { this.jumpT = 0; this.jumpDur = apex * 2; this.jumpH = height; }
  get airborne(): boolean { return this.jumpT >= 0; }
  /** Seconds since the jump started (−1 when on the ground). */
  get jumpTime(): number { return this.jumpT; }
  get jumpY(): number {
    if (this.jumpT < 0) return 0;
    const k = this.jumpT / this.jumpDur;
    return 4 * this.jumpH * k * (1 - k);
  }

  /** World point between the hands, a little in front: where a held ball sits. */
  ballAnchor(out: THREE.Vector3, forward = 0.16): THREE.Vector3 {
    this.rig.root.updateMatrixWorld(true);
    this.rig.joints.handL.getWorldPosition(this.tmpA);
    this.rig.joints.handR.getWorldPosition(this.tmpB);
    out.addVectors(this.tmpA, this.tmpB).multiplyScalar(0.5);
    out.x += Math.sin(this.facing) * forward; out.z += Math.cos(this.facing) * forward;
    return out;
  }

  /** World position of a hand (the dribbling one: 1 = right, −1 = left; mirrored for left-handers). */
  hand(side: 1 | -1, out: THREE.Vector3): THREE.Vector3 {
    this.rig.root.updateMatrixWorld(true);
    const right = (side > 0) !== this.anim.mirror;
    (right ? this.rig.joints.handR : this.rig.joints.handL).getWorldPosition(out);
    return out;
  }

  update(dt: number): void {
    if (this.jumpT >= 0) { this.jumpT += dt; if (this.jumpT >= this.jumpDur) this.jumpT = -1; }
    this.rig.root.position.set(this.pos.x, this.jumpY, this.pos.z);
    this.rig.root.rotation.y = this.facing;
    this.anim.update(dt);
  }

  dispose(): void {
    this.jerseyGeo.dispose(); this.jerseyMat.dispose(); this.jerseyTex?.dispose();
    this.ring.geometry.dispose(); (this.ring.material as THREE.Material).dispose();
    this.rig.dispose();
  }
}

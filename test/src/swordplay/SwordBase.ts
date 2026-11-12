import * as THREE from 'three';
import type { MatchPlayer, SceneContext, SportScene } from '../sports/types';
import type { QualityLevel } from '../core/Quality';
import { QUALITY } from '../core/Quality';
import type { InputBackend } from '../input/InputBackend';
import type { MouseBackend } from '../input/MouseBackend';
import type { SwingDetector } from '../input/SwingDetector';
import type { InputSample, Quat } from '../types';
import { buildBuddy, type BuddyRig } from '../buddy/BuddyBuilder';
import { BuddyAnimator, armTowards } from '../buddy/BuddyAnimator';
import type { BuddyConfig } from '../buddy/BuddyConfig';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import { Effects } from '../game/Effects';
import { Rng } from '../tabletennis/BallPhysics';
import { t } from '../i18n';
import { BladeTracker, type BladeSample } from './BladeTracker';
import { SlashDetector, type DetectorEvent, type GuardState, type GuardZone, type LiveSlash, type Slash } from './SlashDetector';
import { SW_TUNING } from './swordTuning';
import { BladeMesh, BladeTrailRibbon, dressBuddy, type BladeSkin, type BladeTrail, type Outfit } from './swordLooks';
import { SwordHud } from './swordHud';
import { clamp, norm, v3, type V3 } from './swMath';

/* ---------------- blade poses (P frame: x right, y up, z forward) ---------------- */

export interface BladePose { hilt: V3; dir: V3 }

export const READY_POSE: BladePose = { hilt: v3(0.2, 1.05, 0.38), dir: norm(v3(-0.15, 0.75, 0.65)) };

/** Where a scripted fighter holds the blade for each guard (its own P frame). */
export const GUARD_POSE: Record<GuardZone, BladePose> = {
  high: { hilt: v3(0.3, 1.55, 0.32), dir: norm(v3(-1, 0.06, 0.12)) },
  low: { hilt: v3(0.22, 0.92, 0.38), dir: norm(v3(-0.35, -0.55, 0.75)) },
  mid: { hilt: v3(0.08, 1.1, 0.38), dir: norm(v3(0, 0.8, 0.6)) },
  left: { hilt: v3(-0.22, 1.08, 0.36), dir: norm(v3(0.05, 1, 0.15)) },
  right: { hilt: v3(0.34, 1.08, 0.36), dir: norm(v3(-0.05, 1, 0.15)) }
};

const TIP_CENTRE = v3(0.08, 1.3, 1.0);

/** A scripted slash moving (dx, dy) (its own view): k = 0 wound up at the start, 1 at the end. */
export function slashPose(dx: number, dy: number, k: number, hilt = READY_POSE.hilt): BladePose {
  const L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  const s = -0.55 + 1.1 * clamp(k, 0, 1);
  const tip = v3(TIP_CENTRE.x + ux * s, TIP_CENTRE.y + uy * s, TIP_CENTRE.z);
  return { hilt, dir: norm(v3(tip.x - hilt.x, tip.y - hilt.y, tip.z - hilt.z)) };
}

/** A scripted thrust: k = 0 drawn back, 1 fully out. */
export function thrustPose(k: number): BladePose {
  const z = 0.15 + 0.6 * clamp(k, 0, 1);
  return { hilt: v3(0.1, 1.15, z), dir: norm(v3(-0.05, 0.08, 1)) };
}

export const lerpPose = (a: BladePose, b: BladePose, k: number): BladePose => ({
  hilt: v3(a.hilt.x + (b.hilt.x - a.hilt.x) * k, a.hilt.y + (b.hilt.y - a.hilt.y) * k, a.hilt.z + (b.hilt.z - a.hilt.z) * k),
  dir: norm(v3(a.dir.x + (b.dir.x - a.dir.x) * k, a.dir.y + (b.dir.y - a.dir.y) * k, a.dir.z + (b.dir.z - a.dir.z) * k))
});

/* ---------------- a fighter: Buddy + blade + arm IK ---------------- */

/**
 * A Buddy holding a practice sword. `pose` (P frame) is where the blade is: the player's comes from the
 * BladeTracker, an AI's from scripted poses. The sword arm is aimed at the hilt with IK every frame; the blade
 * is drawn from the hand along the pose's direction, and that drawn blade is what hit tests use.
 *
 * Handedness: the rig's authored arm (shoulderR) sits on the Buddy's left, so right-handers are mirrored
 * (mirror = true) and hold the sword with the joint named shoulderL, which is their real right arm.
 */
export class Fighter {
  readonly rig: BuddyRig;
  readonly anim: BuddyAnimator;
  readonly blade: BladeMesh;
  readonly trail: BladeTrailRibbon;
  readonly pos = new THREE.Vector3();
  /** Facing as Object3D rotation.y (the rig faces +z at 0). */
  yaw = 0;
  pose: BladePose = { hilt: { ...READY_POSE.hilt }, dir: { ...READY_POSE.dir } };
  /** Drawn blade in world space, this frame and last physics step (for swept hit tests). */
  readonly hiltW = new THREE.Vector3();
  readonly tipW = new THREE.Vector3();
  readonly prevHiltW = new THREE.Vector3();
  readonly prevTipW = new THREE.Vector3();
  glow = 0;
  private readonly disposables: Array<{ dispose(): void }>;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private hasPrev = false;
  private speedW = 0;

  constructor(readonly scene: THREE.Scene, buddy: BuddyConfig, readonly color: string, readonly handed: 'right' | 'left',
    skin: BladeSkin, trail: BladeTrail, outfit: Outfit) {
    this.rig = buildBuddy(buddy);
    this.anim = new BuddyAnimator(this.rig);
    this.anim.mirror = handed === 'right';
    this.disposables = dressBuddy(this.rig, outfit, color);
    this.blade = new BladeMesh(skin, color, SW_TUNING.bladeLen);
    this.trail = new BladeTrailRibbon(scene, color, trail);
    scene.add(this.rig.root, this.blade.group);
    const J = this.rig.joints;
    const shoulder = this.anim.mirror ? J.shoulderL : J.shoulderR;
    // arm IK: point the sword arm at the hilt (in the shoulder's parent space)
    this.anim.setOverride(this.anim.mirror ? 'shoulderL' : 'shoulderR', () => {
      const target = this.toWorld(v3(this.pose.hilt.x + this.pose.dir.x * 0.08, this.pose.hilt.y + this.pose.dir.y * 0.08, this.pose.hilt.z + this.pose.dir.z * 0.08), this.tmp);
      const parent = shoulder.parent!;
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(target);
      target.sub(shoulder.position);
      if (target.lengthSq() < 1e-6) return null;
      target.normalize();
      const a = armTowards(target.x, target.y, target.z);
      return { rx: a.rx, ry: 0, rz: a.rz };
    });
    this.anim.play('swReady', { blend: 0 });
  }

  /** P frame (relative to this fighter) → world. Buddy local = (−x, y, z). */
  toWorld(p: V3, out: THREE.Vector3): THREE.Vector3 {
    this.rig.root.updateWorldMatrix(true, false);
    return this.rig.root.localToWorld(out.set(-p.x, p.y, p.z));
  }
  /** A P-frame direction → world. */
  dirToWorld(d: V3, out: THREE.Vector3): THREE.Vector3 {
    return out.set(-d.x, d.y, d.z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
  }

  /** Sign to pass for `ax` / `side` params of the sword clips (they are authored for the mirrored rig). */
  side(): number { return this.anim.mirror ? 1 : -1; }

  play(name: string, params: Record<string, number> = {}, blend = 0.12): void {
    const p = { ...params };
    if ('ax' in p) p.ax *= this.side();
    if ('side' in p) p.side *= this.side();
    this.anim.play(name, { blend, params: p, restart: true });
  }

  /** Remember where the blade was for the next swept hit test (call once per physics step, before moving it). */
  stepBlade(): void {
    this.computeBlade();
    if (!this.hasPrev) { this.prevHiltW.copy(this.hiltW); this.prevTipW.copy(this.tipW); this.hasPrev = true; }
  }
  /** After hit tests: this step's blade becomes "previous". */
  commitBlade(dt: number): void {
    this.speedW = dt > 0 ? this.tipW.distanceTo(this.prevTipW) / dt : 0;
    this.prevHiltW.copy(this.hiltW); this.prevTipW.copy(this.tipW);
  }
  get bladeSpeed(): number { return this.speedW; }

  /** The drawn blade from the hand along the pose's direction. */
  private computeBlade(): void {
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.root.updateMatrixWorld(true);
    const hand = this.anim.mirror ? this.rig.joints.handL : this.rig.joints.handR;
    hand.getWorldPosition(this.hiltW);
    this.dirToWorld(this.pose.dir, this.tmpDir);
    this.tipW.copy(this.hiltW).addScaledVector(this.tmpDir, SW_TUNING.bladeLen);
  }

  update(dt: number): void {
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.anim.update(dt);
    this.computeBlade();
    this.blade.place(this.hiltW, this.tmpDir, this.glow);
    this.trail.push(this.hiltW, this.tipW, this.speedW, dt);
    this.glow = Math.max(0, this.glow - dt * 3);
  }

  set visible(v: boolean) { this.rig.root.visible = v; this.blade.group.visible = v; }

  /** Re-place the blade without animating (replays set the joints directly). */
  redraw(): void {
    this.computeBlade();
    this.blade.place(this.hiltW, this.tmpDir, this.glow);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.blade.dispose(); this.trail.dispose(); this.rig.dispose();
  }
}

/* ---------------- player input ---------------- */

export interface SwordEvents {
  slash(s: Slash): void;
  ignored?(s: Slash, reason: string): void;
  live?(l: LiveSlash): void;
  guard?(g: GuardState | null): void;
  /** side: +1 = to the player's right. */
  dodge?(side: number): void;
  recenter?(): void;
}

/**
 * One player's sword controls.
 *  Motion (phone / Joy-Con): SwingDetector in 'blade' mode hands every sample straight to the BladeTracker
 *  and SlashDetector. Guard = hold the blade still in a guard pose. Dodge = a quick wrist twist or A.
 *  Recenter = B, R, or a double tap of the phone's HOLD button.
 *  Mouse: the tip follows the cursor (speed-limited) — move fast to slash; right button / Space = guard
 *  (zone from where the cursor is); left click = thrust; A / D = dodge.
 *
 * LATENCY (sample → screen):
 *  [1] backend sample callback → SwingDetector.feed → onBladeSample: synchronous, no buffering.
 *  [2] BladeTracker.feed: no smoothing; ≤ 1 frame of gyro prediction (SW_TUNING.predictMs).
 *  [3] SlashDetector: a slash ends after `endSamples` slow samples (2 × 8.3 ms at 120 Hz).
 *  [4] events go to the scene in the same callback; the next physics step / frame uses them.
 *  [5] render: the next animation frame (≤ 16.7 ms). The mouse path is read once per physics step (8.3 ms).
 */
export class SwordInput {
  readonly tracker: BladeTracker;
  readonly detector: SlashDetector;
  enabled = true;
  /** Last sample (P frame), for the debug overlay. */
  last: BladeSample | null = null;
  private attached = false;
  private prevB = false;
  private prevA = false;
  private prevTrig = false;
  private lastTap = -1e9;
  private prevLeft = false;
  private dodgeT = 0;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.attached || e.repeat) return;
    if (e.code === 'KeyR') { this.tracker.recenter(); this.ev.recenter?.(); }
    else if (this.isMouse && (e.code === 'KeyA' || e.code === 'KeyD')) this.dodge(e.code === 'KeyD' ? 1 : -1);
  };

  constructor(
    private readonly swing: SwingDetector,
    private readonly backend: () => InputBackend | null,
    handed: 'right' | 'left',
    private readonly ev: SwordEvents
  ) {
    this.tracker = new BladeTracker(handed);
    this.detector = new SlashDetector(handed);
    this.detector.sensitivity = swing.prefs.sensitivity ?? 1;
  }

  get isMouse(): boolean { return this.backend()?.kind === 'mouse'; }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.swing.mode = 'blade';
    this.swing.cancel();
    this.swing.enabled = true;
    this.swing.onBladeSample = (s, fwd) => this.sample(s, fwd);
    addEventListener('keydown', this.onKey);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.swing.onBladeSample = null;
    this.swing.enabled = false;
    this.swing.mode = 'throw';
    removeEventListener('keydown', this.onKey);
  }

  private dodge(side: number): void {
    if (!this.enabled || this.dodgeT > 0) return;
    this.dodgeT = SW_TUNING.dodgeCooldown;
    this.ev.dodge?.(side);
  }

  /** [1] A motion sample, straight from the backend callback. */
  private sample(s: InputSample, fwd: Quat): void {
    if (this.isMouse) return;
    const b = this.tracker.feed(s, fwd);                    // [2]
    this.last = b;
    if (s.buttons.b && !this.prevB) { this.tracker.recenter(); this.ev.recenter?.(); }
    if (s.buttons.trigger && !this.prevTrig) {
      if (s.t - this.lastTap < 350) { this.tracker.recenter(); this.ev.recenter?.(); this.lastTap = -1e9; } else this.lastTap = s.t;
    }
    if (s.buttons.a && !this.prevA) this.dodge(this.tracker.handed === 'left' ? -1 : 1);
    this.prevB = s.buttons.b; this.prevA = s.buttons.a; this.prevTrig = s.buttons.trigger;
    // a quick wrist twist while not slashing is a dodge (the roll sign picks the side)
    if (!this.detector.live && Math.abs(b.roll) > SW_TUNING.dodgeRollRate) this.dodge(b.roll > 0 ? -1 : 1);
    this.handle(this.detector.feed(b));                      // [3] → [4]
  }

  /** Every physics step: timers, and the whole mouse path. */
  step(dt: number): void {
    this.dodgeT = Math.max(0, this.dodgeT - dt);
    if (!this.isMouse) return;
    const p = (this.backend() as MouseBackend | null)?.pointer;
    if (!p) return;
    const nx = (p.x / innerWidth) * 2 - 1, ny = -((p.y / innerHeight) * 2 - 1);
    if (p.left && !this.prevLeft) this.tracker.mouseThrust();
    this.prevLeft = p.left;
    this.detector.forceGuard = p.right;
    this.detector.forceZone = p.right ? (ny > 0.35 ? 'high' : ny < -0.35 ? 'low' : nx < -0.3 ? 'left' : nx > 0.3 ? 'right' : 'mid') : null;
    const b = this.tracker.updateMouse(nx, ny, performance.now(), dt);
    this.last = b;
    this.handle(this.detector.feed(b));
  }

  private handle(events: DetectorEvent[]): void {
    if (this.detector.live) this.ev.live?.(this.detector.live);
    if (!this.enabled) return;
    for (const e of events) {
      if (e.kind === 'slash') this.ev.slash(e.slash);
      else if (e.kind === 'ignored') this.ev.ignored?.(e.slash, e.reason);
      else this.ev.guard?.(e.guard);
    }
  }

  /** The blade pose for a Fighter (P frame). */
  pose(): BladePose { return { hilt: { ...this.tracker.anchor }, dir: { ...this.tracker.dir } }; }

  reset(): void { this.detector.reset(); this.tracker.reset(); }
}

/* ---------------- feedback ---------------- */

const STAR_N = 48;

/** Pooled cartoon "puff of stars" (no blood, ever): little flat stars that burst out, spin and fade. */
export class StarPuffs {
  private readonly stars: Array<{ m: THREE.Mesh; v: THREE.Vector3; life: number; spin: number }> = [];
  private readonly geo: THREE.ShapeGeometry;
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  /** Max stars alive (quality). */
  cap = STAR_N;
  calm = false;

  constructor(private readonly scene: THREE.Scene) {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.025 : 0.06, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    this.geo = new THREE.ShapeGeometry(s);
    for (const c of ['#ffd23a', '#ffffff', '#ff9fd0', '#9fe3ff']) this.mats.push(new THREE.MeshBasicMaterial({ color: c, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    for (let i = 0; i < STAR_N; i++) {
      const m = new THREE.Mesh(this.geo, this.mats[i % this.mats.length].clone());
      m.visible = false;
      scene.add(m);
      this.stars.push({ m, v: new THREE.Vector3(), life: 0, spin: 0 });
    }
  }

  burst(at: THREE.Vector3, n = 10, power = 1, rng: () => number = Math.random): void {
    if (this.calm) n = Math.ceil(n * 0.4);
    let alive = this.stars.filter(s => s.life > 0).length;
    for (const s of this.stars) {
      if (n <= 0 || alive >= this.cap) break;
      if (s.life > 0) continue;
      const a = rng() * Math.PI * 2, e = (rng() - 0.3) * 1.4;
      s.v.set(Math.cos(a) * Math.cos(e), Math.sin(e) + 0.6, Math.sin(a) * Math.cos(e)).multiplyScalar((1.2 + rng() * 1.8) * power);
      s.m.position.copy(at);
      s.m.scale.setScalar(0.6 + rng() * 0.8);
      s.m.visible = true;
      s.life = 0.55 + rng() * 0.3;
      s.spin = (rng() - 0.5) * 14;
      n--; alive++;
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    for (const s of this.stars) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.v.y -= 3 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.quaternion.copy(camera.quaternion);
      s.m.rotateZ(s.spin * s.life);
      (s.m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, s.life * 3);
      if (s.life <= 0) s.m.visible = false;
    }
  }

  dispose(): void {
    for (const s of this.stars) { (s.m.material as THREE.Material).dispose(); s.m.removeFromParent(); }
    this.geo.dispose(); this.mats.forEach(m => m.dispose());
  }
}

/** A bright line along a slash that flashes for a moment. */
export class SlashFlash {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private tLeft = 0;
  constructor(scene: THREE.Scene) {
    const g = new THREE.PlaneGeometry(1, 0.035);
    this.mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  /** From a to b (world), facing the camera. */
  show(a: THREE.Vector3, b: THREE.Vector3, camera: THREE.Camera, color = '#ffffff'): void {
    const L = a.distanceTo(b);
    if (L < 0.05) return;
    this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    this.mesh.quaternion.copy(camera.quaternion);
    // turn in the camera plane so the strip runs from a to b on screen
    const sa = a.clone().project(camera), sb = b.clone().project(camera);
    this.mesh.rotateZ(Math.atan2(sb.y - sa.y, (sb.x - sa.x) * ((camera as THREE.PerspectiveCamera).aspect ?? 1)));
    this.mesh.scale.set(L * 1.3, 1, 1);
    this.mat.color.set(color);
    this.mesh.visible = true;
    this.tLeft = 0.16;
  }
  update(dt: number): void {
    if (this.tLeft <= 0) return;
    this.tLeft -= dt;
    this.mat.opacity = Math.max(0, this.tLeft / 0.16);
    this.mesh.scale.y = 1 + (0.16 - this.tLeft) * 10;
    if (this.tLeft <= 0) this.mesh.visible = false;
  }
  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.removeFromParent(); }
}

/** Trail length (frames) and star cap per quality level. */
const SW_QUALITY: Record<QualityLevel, { trail: number; stars: number; smear: boolean }> = {
  low: { trail: 10, stars: 16, smear: false },
  med: { trail: 18, stars: 32, smear: true },
  high: { trail: 28, stars: 48, smear: true }
};

/* ---------------- shared scene ---------------- */

export interface SceneLook {
  sky: string; fog: string; fogNear: number; fogFar: number; hemiSky: string; hemiGround: string; hemi: number;
  sun: string; sunI: number; sunDir: [number, number, number];
}

/**
 * Shared swordplay scene: lights (one shadow-casting sun), fighters, the player's sword input, hit-stop,
 * screen shake, rumble, star puffs, the slash flash, slow motion, the camera rig and the F3 overlay
 * (blade orientation, tip speed, the last slash and its tip path, guard, plus the mode's lines such as the
 * AI state). Modes add their arena, rules and flow.
 */
export abstract class SwordBase implements SportScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.05, 300);
  protected readonly hud: SwordHud;
  protected readonly effects: Effects;
  protected readonly stars: StarPuffs;
  protected readonly flash: SlashFlash;
  protected readonly sun: THREE.DirectionalLight;
  protected readonly seed = Math.floor(Math.random() * 1e9);
  protected readonly rng: Rng;
  protected paused = false;
  protected calm = false;
  /** Match clock (seconds of physics time). */
  protected time = 0;
  protected readonly camPos = new THREE.Vector3(0, 1.7, -2.4);
  protected readonly camLook = new THREE.Vector3(0, 1.2, 2);
  protected readonly wantPos = new THREE.Vector3(0, 1.7, -2.4);
  protected readonly wantLook = new THREE.Vector3(0, 1.2, 2);
  protected camRate = 6;
  protected fov = 55;
  protected wantFov = 55;
  protected readonly disposables: Array<{ dispose(): void }> = [];
  protected lastSlash: Slash | null = null;
  protected inputs: SwordInput[] = [];
  private scale = 1;
  private slowT = 0;
  private stopT = 0;
  private shakeA = 0;
  private readonly shakeV = new THREE.Vector3();
  private readonly sunOffset = new THREE.Vector3(6, 14, 5);
  private quality: QualityLevel = 'high';

  constructor(protected readonly ctx: SceneContext, look: SceneLook) {
    this.rng = new Rng(this.seed);
    const s = this.scene;
    s.background = new THREE.Color(look.sky);
    s.fog = new THREE.Fog(look.fog, look.fogNear, look.fogFar);
    s.add(new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemi));
    this.sun = new THREE.DirectionalLight(look.sun, look.sunI);
    this.sun.position.set(...look.sunDir);
    Object.assign(this.sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 60 });
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);
    this.hud = new SwordHud(ctx.ui);
    this.effects = new Effects(s, ctx.ui);
    this.stars = new StarPuffs(s);
    this.flash = new SlashFlash(s);
  }

  get timeScale(): number { return this.paused || this.stopT > 0 ? 0 : this.scale; }

  protected geo<G extends THREE.BufferGeometry>(g: G): G { this.disposables.push(g); return g; }
  protected mat<M extends THREE.Material>(m: M): M { this.disposables.push(m); return m; }

  /** The cosmetics picked in mode setup. */
  protected cosmetic<T extends string>(cat: string, fallback: T): T {
    return ((this.ctx.setup.cosmetics?.[cat] as T | undefined) ?? fallback);
  }

  /** Make a fighter for match player `i` (or `player`, e.g. an AI) with the picked blade, trail and outfit. */
  protected makeFighter(i: number, outfitOverride?: Outfit, handed: 'right' | 'left' = i === 0 ? this.ctx.handed() : 'right', player?: MatchPlayer): Fighter {
    const p = player ?? this.ctx.setup.players[i] ?? this.ctx.setup.players[0];
    const f = new Fighter(this.scene, p.buddy, p.color, handed,
      this.cosmetic<BladeSkin>('blade', 'wood'), this.cosmetic<BladeTrail>('bladeTrail', 'classic'), outfitOverride ?? this.cosmetic<Outfit>('outfit', 'none'));
    this.applyQualityTo(f);
    return f;
  }

  /** The player's sword input (player 2 uses the second controller). */
  protected makeInput(ev: SwordEvents, second = false): SwordInput {
    const src = second && this.ctx.second ? this.ctx.second : { swing: this.ctx.swing, backend: this.ctx.backend };
    const inp = new SwordInput(src.swing, src.backend, second ? 'right' : this.ctx.handed(), ev);
    this.inputs.push(inp);
    return inp;
  }

  /* ---------------- feedback ---------------- */

  /** Freeze the action for 30–60 ms (by power) so a hit lands with weight. */
  protected hitStop(power: number): void {
    const T = SW_TUNING;
    this.stopT = Math.max(this.stopT, (T.hitStopMin + (T.hitStopMax - T.hitStopMin) * clamp(power, 0, 1)) / 1000);
  }

  protected shake(power: number): void { if (!this.calm) this.shakeA = Math.max(this.shakeA, SW_TUNING.shake * clamp(power, 0.2, 1.2)); }

  protected rumble(power: number, ms = 60, second = false): void {
    const b = second ? this.ctx.second?.backend() : this.ctx.backend();
    b?.rumble(clamp(power, 0.1, 1), ms);
  }

  /** The full "it hit" bundle: stars, hit-stop, shake, rumble, a tok. */
  protected impact(at: THREE.Vector3, power: number, stars = 10, second = false): void {
    this.stars.burst(at, stars, 0.6 + power * 0.6, () => this.rng.next());
    this.hitStop(power);
    this.shake(power);
    this.rumble(0.4 + power * 0.6, 50 + power * 60, second);
  }

  /** Slow motion at `scale` for `seconds` of real time (skipped with reduced motion). */
  protected slowMo(seconds = 0.5, scale = 0.35): void {
    if (this.calm) return;
    this.scale = scale;
    this.slowT = seconds;
  }

  /** World → screen pixels (for HUD pop-ups and telegraphs). */
  protected toScreen(p: THREE.Vector3): { x: number; y: number; behind: boolean } {
    const v = p.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, behind: v.z > 1 };
  }

  /* ---------------- loop ---------------- */

  fixedStep(dt: number): void {
    if (this.paused) return;
    this.time += dt;
    for (const i of this.inputs) i.step(dt);
    this.stepMode(dt);
  }

  protected abstract stepMode(dt: number): void;
  protected abstract frameMode(dt: number, realDt: number): void;

  frame(_alpha: number, realDt: number): void {
    if (this.stopT > 0) this.stopT -= realDt;
    if (this.slowT > 0 && !this.paused) { this.slowT -= realDt; if (this.slowT <= 0) this.scale = 1; }
    const dt = this.paused || this.stopT > 0 ? 0 : realDt * this.scale;
    this.frameMode(dt, this.paused ? 0 : realDt);
    // camera with a little shake
    const k = 1 - Math.exp(-realDt * this.camRate);
    this.camPos.lerp(this.wantPos, k);
    this.camLook.lerp(this.wantLook, k);
    this.fov += (this.wantFov - this.fov) * k;
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
    this.shakeA *= Math.exp(-realDt * 14);
    if (this.shakeA > 0.0005 && !this.calm) this.shakeV.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(this.shakeA * 2);
    else this.shakeV.set(0, 0, 0);
    this.camera.position.copy(this.camPos).add(this.shakeV);
    this.camera.lookAt(this.camLook);
    this.sun.target.position.copy(this.camLook);
    this.sun.position.copy(this.camLook).add(this.sunOffset);
    this.stars.update(dt, this.camera);
    this.flash.update(realDt);
    this.effects.update(dt);
    this.hud.update(this.paused ? 0 : realDt);
    if (this.ctx.debug.visible) this.drawDebug();
  }

  protected setSunOffset(x: number, y: number, z: number): void { this.sunOffset.set(x, y, z); }

  /* ---------------- F3 ---------------- */

  protected debugLines(): string[] { return []; }

  private drawDebug(): void {
    const inp = this.inputs[0], b = inp?.last, d = inp?.detector, s = this.lastSlash;
    const lines = [
      `blade      yaw ${inp ? inp.tracker.yawDeg.toFixed(0) : '–'}° · pitch ${inp ? inp.tracker.pitchDeg.toFixed(0) : '–'}° · roll ${b ? b.roll.toFixed(1) : '–'} rad/s · ${inp?.isMouse ? 'mouse' : 'motion'}`,
      `tip        ${d ? d.tipSpeed.toFixed(1) : '–'} m/s (start ${(SW_TUNING.startSpeed / (d?.sensitivity ?? 1)).toFixed(1)} / end ${(SW_TUNING.endSpeed / (d?.sensitivity ?? 1)).toFixed(1)}) · fwd accel ${b ? b.accelFwd.toFixed(1) : '–'}`,
      `live       ${d?.live ? `${d.live.dir} ${d.live.angle.toFixed(0)}° · ${d.live.speed.toFixed(1)} m/s · ${(d.live.straightness * 100).toFixed(0)}%` : '–'}`,
      `last slash ${s ? `${s.kind} ${s.dir} ${s.angle.toFixed(0)}° · ${s.speed.toFixed(1)} m/s · power ${(s.power * 100).toFixed(0)}% · straight ${(s.straightness * 100).toFixed(0)}% · ${s.duration.toFixed(0)} ms` : '–'}`,
      `guard      ${d?.guard ? `${d.guard.zone} (since ${(d.guard.since / 1000).toFixed(2)} s)` : '–'}`,
      ...this.debugLines()
    ];
    this.ctx.debug.text(lines.join('\n'));
    this.ctx.debug.viz((g, W, H) => this.viz(g, W, H));
  }

  /** The last slash's tip path (screen plane), start → end arrow, with the 8 direction spokes. */
  private viz(g: CanvasRenderingContext2D, W: number, H: number): void {
    g.fillStyle = '#16233a'; g.fillRect(0, 0, W, H);
    const s = this.lastSlash, cx = W / 2, cy = H / 2, k = Math.min(W, H) * 0.6;
    g.strokeStyle = '#2a3a55'; g.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i * 45 + 22.5) * Math.PI / 180;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * W, cy - Math.sin(a) * W); g.stroke();
    }
    g.fillStyle = '#dff6ff'; g.font = '11px ui-monospace, monospace';
    if (!s || s.path.length < 2) { g.fillText(t('sw.debug.noSlash'), 8, 16); return; }
    const p0 = s.path[0], p1 = s.path[s.path.length - 1];
    const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
    g.strokeStyle = '#3ff2ff'; g.lineWidth = 3; g.beginPath();
    s.path.forEach((p, i) => { const x = cx + (p.x - mx) * k, y = cy - (p.y - my) * k; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    g.strokeStyle = '#ffd23a'; g.lineWidth = 2; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(cx + (p0.x - mx) * k, cy - (p0.y - my) * k); g.lineTo(cx + (p1.x - mx) * k, cy - (p1.y - my) * k); g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#3bb37a'; g.beginPath(); g.arc(cx + (p0.x - mx) * k, cy - (p0.y - my) * k, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff5a5f'; g.beginPath(); g.arc(cx + (p1.x - mx) * k, cy - (p1.y - my) * k, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#dff6ff';
    g.fillText(`${s.kind} ${s.dir} ${s.angle.toFixed(0)}° · straight ${(s.straightness * 100).toFixed(0)}%`, 8, H - 8);
  }

  /* ---------------- lifecycle ---------------- */

  abstract start(): void;
  abstract restart(): void;

  setPaused(p: boolean): void {
    this.paused = p;
    for (const i of this.inputs) { i.enabled = !p; if (p) i.reset(); }
    if (p) { sfx.stopLoops(); Crowd.stopRally(); }
  }

  private applyQualityTo(f: Fighter): void {
    const q = SW_QUALITY[this.quality];
    f.trail.length = q.trail;
    f.trail.smearOn = q.smear;
  }

  /** Every fighter in the scene (for quality changes). */
  protected abstract fighters(): Fighter[];

  setQuality(q: QualityLevel): void {
    this.quality = q;
    const prof = QUALITY[q];
    this.sun.castShadow = prof.shadows;
    if (this.sun.shadow.mapSize.x !== prof.shadowMap) {
      this.sun.shadow.mapSize.set(prof.shadowMap, prof.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.stars.cap = SW_QUALITY[q].stars;
    for (const f of this.fighters()) this.applyQualityTo(f);
  }

  refreshSettings(): void {
    this.calm = this.ctx.reducedMotion();
    this.hud.calm = this.calm;
    this.effects.calm = this.calm;
    this.stars.calm = this.calm;
    for (const i of this.inputs) i.detector.sensitivity = this.ctx.swing.prefs.sensitivity ?? 1;
    this.hud.relabel();
  }

  onTuning(): void { /* SW_TUNING is read live */ }

  resize(w: number, h: number): void { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  dispose(): void {
    for (const i of this.inputs) i.detach();
    sfx.stopLoops();
    Crowd.stopRally();
    this.ctx.debug.viz(null);
    this.hud.dispose();
    this.effects.dispose();
    this.stars.dispose();
    this.flash.dispose();
    for (const f of this.fighters()) f.dispose();
    for (const d of this.disposables) d.dispose();
    this.sun.shadow.map?.dispose();
  }
}

import * as THREE from 'three';
import type { SceneContext, SportScene } from '../sports/types';
import type { QualityLevel } from '../core/Quality';
import { QUALITY } from '../core/Quality';
import type { InputBackend } from '../input/InputBackend';
import type { MouseBackend } from '../input/MouseBackend';
import type { SwingDetector } from '../input/SwingDetector';
import { buildBuddy, type BuddyRig } from '../buddy/BuddyBuilder';
import { BuddyAnimator } from '../buddy/BuddyAnimator';
import type { BuddyConfig } from '../buddy/BuddyConfig';
import { addOutline, toon } from '../render/Toon';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import { Effects } from '../game/Effects';
import { Rng } from '../tabletennis/BallPhysics';
import { DISC, DISC_TYPES, type DiscType } from './frisbeeTuning';
import { Disc, STEP, Wind, qApply, type DiscEvent, type Ground, type Launch, type V3 } from './DiscPhysics';
import { mapFlick, mapSling, slingPower, type ThrowParams } from './ThrowMapper';
import { FBHud } from './frisbeeHud';

export type DiscSkin = 'classic' | 'ocean' | 'sunset' | 'neon' | 'galaxy' | 'gold';
export type TrailStyle = 'classic' | 'sparkle' | 'rainbow';

const D2R = Math.PI / 180;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/* ---------------- disc look ---------------- */

const SKINS: Record<DiscSkin, { base: string; rings: string[]; star?: boolean; dark?: boolean }> = {
  classic: { base: '#ff8a3c', rings: ['#ffffff', '#ffd84a'] },
  ocean: { base: '#1fb5a8', rings: ['#e6fbff', '#2f8fd8', '#ffffff'] },
  sunset: { base: '#ff5fa2', rings: ['#ffd84a', '#ff8a3c', '#7a5cff'] },
  neon: { base: '#15172a', rings: ['#3cff9a', '#ff3cf0', '#3cc8f0'], dark: true },
  galaxy: { base: '#241a4a', rings: ['#7a5cff', '#3cc8f0'], star: true, dark: true },
  gold: { base: '#e8b923', rings: ['#fff3c4', '#a87400'] }
};

function discTexture(skin: DiscSkin, rim: string | null): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const S = 256, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  const k = SKINS[skin] ?? SKINS.classic;
  g.fillStyle = k.base; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.fill();
  k.rings.forEach((col, i) => {
    g.strokeStyle = col; g.lineWidth = 9 - i * 2;
    g.beginPath(); g.arc(S / 2, S / 2, S * (0.42 - i * 0.11), 0, Math.PI * 2); g.stroke();
  });
  if (k.star) {
    const r = new Rng(7);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 70; i++) { g.globalAlpha = 0.3 + r.next() * 0.7; g.fillRect(r.next() * S, r.next() * S, 2, 2); }
    g.globalAlpha = 1;
  }
  // a swoosh so you can see it spin
  g.strokeStyle = k.dark ? '#ffffff' : '#1d2a3a'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.24, -0.4, 1.2); g.stroke();
  if (rim) { g.strokeStyle = rim; g.lineWidth = 14; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 7, 0, Math.PI * 2); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TRAIL_N = 90;

/** The disc mesh (rim + painted top), its blob shadow and the flight trail. */
export class DiscMesh {
  readonly group = new THREE.Group();
  readonly body: THREE.Group;
  private readonly shadow: THREE.Mesh;
  private readonly trail: THREE.Mesh;
  private readonly sparks: THREE.Points;
  private readonly trailPos: Float32Array;
  private readonly trailCol: Float32Array;
  private readonly sparkPos: Float32Array;
  private readonly pts: Array<{ p: THREE.Vector3; c: THREE.Color }> = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly tmpQ = new THREE.Quaternion();
  private readonly spinQ = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private wobblePhase = 0;
  private hue = 0;
  style: TrailStyle;

  constructor(scene: THREE.Scene, skin: DiscSkin, style: TrailStyle, rim: string | null = null) {
    this.style = style;
    const tex = discTexture(skin, rim);
    const R = DISC.radius;
    const rimGeo = new THREE.CylinderGeometry(R, R * 0.96, 0.028, 32, 1, true);
    const topGeo = new THREE.CircleGeometry(R * 0.99, 32);
    topGeo.rotateX(-Math.PI / 2); topGeo.translate(0, 0.014, 0);
    const botGeo = new THREE.CircleGeometry(R * 0.95, 32);
    botGeo.rotateX(Math.PI / 2); botGeo.translate(0, -0.012, 0);
    const k = SKINS[skin] ?? SKINS.classic;
    const rimMat = toon(rim ?? k.base), topMat = toon(tex ? '#ffffff' : k.base, tex ? { map: tex } : {}), botMat = toon(k.base);
    this.disposables.push(rimGeo, topGeo, botGeo, rimMat, topMat, botMat);
    if (tex) this.disposables.push(tex);
    this.body = new THREE.Group();
    const rimM = new THREE.Mesh(rimGeo, rimMat); rimM.castShadow = true;
    addOutline(rimM, 0.08);
    const topM = new THREE.Mesh(topGeo, topMat); topM.castShadow = true;
    const botM = new THREE.Mesh(botGeo, botMat);
    this.body.add(rimM, topM, botM);
    this.body.scale.setScalar(1.25);          // a little bigger than life so it reads at 40 m
    this.group.add(this.body);
    // blob shadow: important for depth
    const sg = new THREE.CircleGeometry(R * 1.3, 24); sg.rotateX(-Math.PI / 2);
    const sm = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.45, depthWrite: false });
    this.disposables.push(sg, sm);
    this.shadow = new THREE.Mesh(sg, sm); this.shadow.renderOrder = 1;
    scene.add(this.shadow);
    // ribbon trail
    const tg = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL_N * 2 * 3);
    this.trailCol = new Float32Array(TRAIL_N * 2 * 4);
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 4));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    tg.setIndex(idx);
    const tm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.trail = new THREE.Mesh(tg, tm); this.trail.frustumCulled = false;
    const pg = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(TRAIL_N * 3).fill(-99);
    pg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    const pm = new THREE.PointsMaterial({ color: '#fff6c4', size: 0.14, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sparks = new THREE.Points(pg, pm); this.sparks.frustumCulled = false;
    this.disposables.push(tg, tm, pg, pm);
    scene.add(this.group, this.trail, this.sparks);
  }

  clearTrail(): void { this.pts.length = 0; this.writeTrail(); }

  /** Place it from the physics (or `held` at a hand), and grow the trail while it flies. */
  update(disc: Disc | null, ground: Ground, dt: number, held: THREE.Vector3 | null, heldYaw = 0): void {
    if (held || !disc) {
      this.group.visible = !!held;
      if (held) { this.group.position.copy(held); this.body.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5).premultiply(this.tmpQ.setFromAxisAngle(this.up, heldYaw)); }
      this.shadow.visible = !!held;
      if (held) this.placeShadow(held.x, held.y, held.z, ground);
      return;
    }
    this.group.visible = true;
    this.group.position.set(disc.pos.x, disc.pos.y, disc.pos.z);
    const q = disc.q;
    this.tmpQ.set(q.x, q.y, q.z, q.w);
    this.spinQ.setFromAxisAngle(this.up, disc.spinAngle);
    // a dirty release wobbles: a fast small nutation of the plane
    this.wobblePhase += dt * 26;
    const w = disc.flying ? disc.wobble * 0.32 : 0;
    const wob = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(this.wobblePhase) * w, 0, Math.cos(this.wobblePhase) * w));
    this.body.quaternion.copy(this.tmpQ).multiply(wob).multiply(this.spinQ);
    this.placeShadow(disc.pos.x, disc.pos.y, disc.pos.z, ground);
    // trail: colour by stability (fast spin and no wobble = cool cyan, unstable = warm orange)
    if (disc.flying) {
      const stab = clamp(Math.abs(disc.spin) / 50, 0, 1) * (1 - disc.wobble);
      const c = new THREE.Color();
      if (this.style === 'rainbow') { this.hue = (this.hue + dt * 0.6) % 1; c.setHSL(this.hue, 0.9, 0.6); }
      else c.setHSL(0.05 + 0.45 * stab, 0.9, 0.6);
      this.pts.unshift({ p: new THREE.Vector3(disc.pos.x, disc.pos.y, disc.pos.z), c });
      if (this.pts.length > TRAIL_N) this.pts.pop();
    } else if (this.pts.length) this.pts.pop();
    this.writeTrail();
  }

  private placeShadow(x: number, y: number, z: number, ground: Ground): void {
    const gh = ground.height(x, z);
    const hgt = Math.max(0, y - gh);
    this.shadow.visible = ground.surface(x, z) !== 'water' || hgt > 0.05;
    this.shadow.position.set(x, gh + 0.03, z);
    this.shadow.scale.setScalar(1 + hgt * 0.06);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.1, 0.5 - hgt * 0.02);
  }

  private writeTrail(): void {
    const n = this.pts.length;
    const sparkle = this.style === 'sparkle';
    for (let i = 0; i < TRAIL_N; i++) {
      const p = this.pts[Math.min(i, Math.max(0, n - 1))];
      const k = n ? 1 - i / TRAIL_N : 0;
      const w = 0.12 * k + 0.01;
      const x = p ? p.p.x : 0, y = p ? p.p.y : -99, z = p ? p.p.z : 0;
      this.trailPos.set([x, y + w, z, x, y - w, z], i * 6);
      const a = i < n && !sparkle ? k * 0.6 : 0;
      const c = p?.c;
      this.trailCol.set([c?.r ?? 0, c?.g ?? 0, c?.b ?? 0, a, c?.r ?? 0, c?.g ?? 0, c?.b ?? 0, a], i * 8);
      if (sparkle && i < n && i % 2 === 0) this.sparkPos.set([x + Math.sin(i * 12.9) * 0.15, y + Math.cos(i * 7.1) * 0.15, z], i * 3);
      else this.sparkPos.set([0, -99, 0], i * 3);
    }
    (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.trail.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent(); this.shadow.removeFromParent(); this.trail.removeFromParent(); this.sparks.removeFromParent();
  }
}

/* ---------------- the thrower ---------------- */

/** A Buddy on the field: position, facing (radians, 0 = facing −z, + turns toward +x) and its animator. */
export class FBPlayer {
  readonly rig: BuddyRig;
  readonly anim: BuddyAnimator;
  readonly pos = new THREE.Vector3();
  facing = 0;
  constructor(readonly scene: THREE.Scene, buddy: BuddyConfig, left: boolean) {
    this.rig = buildBuddy(buddy);
    this.anim = new BuddyAnimator(this.rig);
    this.anim.mirror = left;
    this.anim.play('fbReady', { blend: 0 });
    scene.add(this.rig.root);
  }
  /** World position of the throwing hand (right, mirrored for left-handers). */
  hand(out: THREE.Vector3): THREE.Vector3 {
    this.rig.root.updateMatrixWorld(true);
    (this.anim.mirror ? this.rig.joints.handL : this.rig.joints.handR).getWorldPosition(out);
    return out;
  }
  set visible(v: boolean) { this.rig.root.visible = v; }
  update(dt: number, groundY = 0): void {
    this.rig.root.position.set(this.pos.x, groundY, this.pos.z);
    // the rig faces +z; our facing 0 looks down −z
    this.rig.root.rotation.y = Math.PI - this.facing;
    this.anim.update(dt);
  }
  dispose(): void { this.rig.root.removeFromParent(); this.rig.dispose(); }
}

/* ---------------- throw input ---------------- */

export interface ThrowHooks {
  /** Trigger / mouse button down (true) or let go without a throw (false). */
  grip(held: boolean): void;
  release(p: ThrowParams): void;
}

/**
 * One player's throw input. Motion (phone / Joy-Con): SwingDetector in 'disc' mode, mapped with
 * ThrowMapper.mapFlick at the flick peak (no smoothing). Mouse: a slingshot — press, pull back, let go;
 * bank with A/D and nose with W/S (or the wheel) on the two sliders.
 */
export class ThrowControl {
  ready = false;
  disc: DiscType = DISC_TYPES.dog;
  bank = 0;
  nose = 8;
  /** Mouse pull (screen px), for the HUD. */
  pull: { a: { x: number; y: number }; b: { x: number; y: number }; power: number } | null = null;
  private attached = false;
  private mouseDown = false;
  private readonly rng: Rng;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.attached || !this.isMouse) return;
    if (e.code === 'KeyA') this.bank = clamp(this.bank - 2.5, -35, 35);
    else if (e.code === 'KeyD') this.bank = clamp(this.bank + 2.5, -35, 35);
    else if (e.code === 'KeyW') this.nose = clamp(this.nose + 1, -5, 25);
    else if (e.code === 'KeyS') this.nose = clamp(this.nose - 1, -5, 25);
  };
  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.attached || !this.isMouse) return;
    this.nose = clamp(this.nose - Math.sign(e.deltaY), -5, 25);
  };

  constructor(
    private readonly swing: SwingDetector,
    private readonly backend: () => InputBackend | null,
    private readonly handed: () => 'right' | 'left',
    private readonly hooks: ThrowHooks,
    seed: number
  ) { this.rng = new Rng(seed); }

  get isMouse(): boolean { return this.backend()?.kind === 'mouse'; }
  get gripping(): boolean { return this.isMouse ? this.mouseDown : this.gripHeld; }
  private gripHeld = false;

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const sw = this.swing;
    sw.mode = 'disc';
    sw.cancel();
    sw.enabled = true;
    sw.onDiscGrip = held => {
      if (this.isMouse) return;
      // remember a grip taken early (e.g. while the dog runs back) so the flick still counts once ready
      this.gripHeld = held;
      if (this.ready || !held) this.hooks.grip(held);
    };
    sw.onDiscFlick = f => {
      if (this.isMouse || !this.ready || !this.gripHeld) return;
      this.gripHeld = false;
      this.hooks.release(mapFlick(f, { handed: this.handed(), disc: this.disc, rng: this.rng }));
    };
    addEventListener('keydown', this.onKey);
    addEventListener('wheel', this.onWheel, { passive: true });
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    const sw = this.swing;
    sw.onDiscGrip = null; sw.onDiscFlick = null;
    sw.enabled = false;
    sw.mode = 'throw';
    this.mouseDown = false; this.pull = null; this.gripHeld = false;
    removeEventListener('keydown', this.onKey);
    removeEventListener('wheel', this.onWheel);
  }

  cancel(): void {
    if (this.mouseDown || this.gripHeld) this.hooks.grip(false);
    this.mouseDown = false; this.pull = null; this.gripHeld = false;
    this.swing.cancel();
  }

  /** Every frame: the mouse slingshot. */
  tick(): void {
    if (!this.attached || !this.isMouse) { this.pull = null; return; }
    const p = (this.backend() as MouseBackend | null)?.pointer;
    if (!p) return;
    if (p.left && !this.mouseDown && this.ready) {
      this.mouseDown = true;
      this.pull = { a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y }, power: 0 };
      this.hooks.grip(true);
    } else if (p.left && this.mouseDown && this.pull) {
      this.pull.b = { x: p.x, y: p.y };
      this.pull.power = slingPower({ dx: p.x - this.pull.a.x, dy: p.y - this.pull.a.y, bankDeg: this.bank, noseDeg: this.nose });
    } else if (!p.left && this.mouseDown) {
      this.mouseDown = false;
      const pull = this.pull;
      this.pull = null;
      const thr = pull && this.ready ? mapSling({ dx: pull.b.x - pull.a.x, dy: pull.b.y - pull.a.y, bankDeg: this.bank, noseDeg: this.nose }, { handed: this.handed(), disc: this.disc, rng: this.rng }) : null;
      if (thr) this.hooks.release(thr); else this.hooks.grip(false);
    }
  }
}

/* ---------------- shared scene ---------------- */

export type FBCam = 'aim' | 'follow' | 'side' | 'lie' | 'flyover' | 'basket' | 'overview' | 'dog';

/**
 * Shared frisbee scene: the disc in DiscPhysics at 1/240 s (two steps per host step), its mesh, trail and
 * shadow, wind with gusts, the throwing Buddy and its throw input, a camera rig, whoosh and wind sounds,
 * slow motion and the F3 overlay (disc speed, spin, angle of attack, wind, last throw). The modes add
 * their field, rules and flow on top.
 */
export abstract class FBBase implements SportScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
  protected readonly hud: FBHud;
  protected readonly effects: Effects;
  protected readonly sun: THREE.DirectionalLight;
  protected readonly seed = Math.floor(Math.random() * 1e9);
  protected readonly rng: Rng;
  protected disc: Disc;
  protected discMesh!: DiscMesh;
  protected wind: Wind = Wind.calm();
  protected abstract ground: Ground;
  protected paused = false;
  protected lastThrow: ThrowParams | null = null;
  protected lastLaunch: Launch | null = null;
  /** Throws so far (seeds each flight). */
  protected throwCount = 0;
  protected readonly camPos = new THREE.Vector3(0, 3, 6);
  protected readonly camLook = new THREE.Vector3(0, 1, -10);
  protected readonly wantPos = new THREE.Vector3(0, 3, 6);
  protected readonly wantLook = new THREE.Vector3(0, 1, -10);
  protected camRate = 4;
  protected cam: FBCam = 'aim';
  private scale = 1;
  private slowT = 0;
  private readonly shadowFocus = new THREE.Vector3();
  protected readonly disposables: Array<{ dispose(): void }> = [];
  protected calm = false;

  constructor(protected readonly ctx: SceneContext, look: { sky: string; fog: string; fogNear: number; fogFar: number; hemiSky: string; hemiGround: string; hemi: number; sun: string; sunI: number; sunDir: [number, number, number] }) {
    this.rng = new Rng(this.seed);
    this.disc = new Disc(DISC_TYPES.dog, this.seed);
    const s = this.scene;
    s.background = new THREE.Color(look.sky);
    s.fog = new THREE.Fog(look.fog, look.fogNear, look.fogFar);
    s.add(new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemi));
    this.sun = new THREE.DirectionalLight(look.sun, look.sunI);
    this.sun.position.set(...look.sunDir);
    Object.assign(this.sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 120 });
    this.sun.shadow.bias = -0.0006;
    s.add(this.sun, this.sun.target);
    this.hud = new FBHud(ctx.ui);
    this.effects = new Effects(s, ctx.ui);
  }

  get timeScale(): number { return this.paused ? 0 : this.scale; }

  protected geo<G extends THREE.BufferGeometry>(g: G): G { this.disposables.push(g); return g; }
  protected mat<M extends THREE.Material>(m: M): M { this.disposables.push(m); return m; }

  /** A toon box/cylinder etc. added to the scene. */
  protected prop(geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, outline = 0.04): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(geo), this.mat(toon(color)));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    if (outline) addOutline(m, outline);
    this.scene.add(m);
    return m;
  }

  /* ---------------- throwing ---------------- */

  /**
   * Launch the disc from `from`; `heading` (degrees, 0 = −z, + = right) is the way the thrower faces, the
   * throw's own direction adds to it.
   */
  protected throwDisc(p: ThrowParams, from: V3, heading: number, type: DiscType): Launch {
    const l: Launch = {
      pos: { ...from }, speed: p.speed, yawDeg: heading + p.yawDeg, loftDeg: p.loftDeg, noseDeg: p.noseDeg,
      bankDeg: p.bankDeg, spin: p.spin, wobble: p.wobble
    };
    this.throwCount += 1;
    this.disc = new Disc(type, this.flightSeed());
    this.disc.launch(l);
    this.lastThrow = p;
    this.lastLaunch = l;
    this.discMesh.clearTrail();
    sfx.thwip(p.speed / 25);
    this.ctx.onThrown();
    return l;
  }

  /** Seed of the current flight: the prediction must use the same one. */
  protected flightSeed(): number { return (this.seed + this.throwCount * 7919) >>> 0; }

  /** Slow motion at 0.4× for `seconds` of real time. */
  protected slowMo(seconds = 0.6): void {
    if (this.ctx.reducedMotion()) return;
    this.scale = 0.4;
    this.slowT = seconds;
  }

  /* ---------------- physics ---------------- */

  fixedStep(dt: number): void {
    if (this.paused) return;
    const n = Math.max(1, Math.round(dt / STEP));
    for (let i = 0; i < n; i++) {
      if (this.discInPlay()) {
        const ev = this.disc.step(STEP, this.wind, this.ground);
        for (const e of ev) this.discEvent(e);
      }
      this.stepExtra(STEP);
    }
  }

  /** Is the disc flying / sliding under physics (not held or carried)? */
  protected discInPlay(): boolean { return this.disc.phase !== 'held' && !this.disc.stopped; }

  private discEvent(e: DiscEvent): void {
    switch (e.kind) {
      case 'land': case 'bounce': sfx.discLand(e.speed, e.surface === 'sand'); break;
      case 'obstacle': sfx.treeHit(); break;
      case 'water': sfx.splash(); break;
      default: break;
    }
    this.onDiscEvent(e);
  }

  protected abstract onDiscEvent(e: DiscEvent): void;
  protected stepExtra(_dt: number): void { /* the dog */ }

  /* ---------------- frame ---------------- */

  frame(_alpha: number, realDt: number): void {
    if (this.slowT > 0 && !this.paused) { this.slowT -= realDt; if (this.slowT <= 0) this.scale = 1; }
    const dt = this.paused ? 0 : realDt * this.scale;
    this.frameMode(dt, this.paused ? 0 : realDt);
    // camera
    const k = 1 - Math.exp(-realDt * (this.calm ? Math.min(this.camRate, 2.5) : this.camRate));
    this.camPos.lerp(this.wantPos, k);
    this.camLook.lerp(this.wantLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // the shadow camera follows what we look at
    this.shadowFocus.copy(this.camLook);
    this.sun.target.position.copy(this.shadowFocus);
    this.sun.position.copy(this.shadowFocus).add(this.sunOffset);
    // sounds
    if (this.disc.flying && !this.paused) {
      const d = this.camera.position.distanceTo(new THREE.Vector3(this.disc.pos.x, this.disc.pos.y, this.disc.pos.z));
      sfx.setWhoosh(this.disc.speed, clamp(1.4 - d / 30, 0.15, 1));
    } else sfx.setWhoosh(0);
    this.hud.update(this.paused ? 0 : realDt);
    this.effects.update(dt);
    if (this.ctx.debug.visible) this.drawDebug();
  }

  private sunOffset = new THREE.Vector3(20, 40, 14);
  protected setSunOffset(x: number, y: number, z: number): void { this.sunOffset.set(x, y, z); }

  protected abstract frameMode(dt: number, realDt: number): void;

  /** Wind in the HUD relative to the camera heading, and the ambience level. */
  protected showWind(): void {
    const sp = this.wind.speed;
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
    const camYaw = Math.atan2(fwd.x, -fwd.z);
    const windYaw = Math.atan2(this.wind.base.x, -this.wind.base.z);
    this.hud.wind(sp > 0.2 ? (windYaw - camYaw) / D2R : null, sp);
    sfx.setWind(clamp(0.15 + sp / 10, 0, 1));
  }

  /* ---------------- F3 ---------------- */

  protected debugLines(): string[] { return []; }

  private drawDebug(): void {
    const d = this.disc, a = d.aero, w = this.wind.at(d.t), p = this.lastThrow;
    const lines = [
      `disc       ${d.phase} · ${d.speed.toFixed(1)} m/s · spin ${d.spin.toFixed(0)} rad/s · wobble ${d.wobble.toFixed(2)} · tilt ${(d.tilt / D2R).toFixed(0)}°`,
      `aero       AoA ${a.alphaDeg.toFixed(1)}° · CL ${a.cl.toFixed(2)} · CD ${a.cd.toFixed(2)} · CM ${a.cm.toFixed(3)} · air ${a.air.toFixed(1)} m/s`,
      `wind       ${Math.hypot(w.x, w.z).toFixed(1)} m/s (base ${this.wind.speed.toFixed(1)}, gust ${this.wind.gust.toFixed(2)})`,
      `last throw ${p ? `${p.source} ${p.forehand ? 'forehand' : 'backhand'} · ${p.speed.toFixed(1)} m/s · dir ${p.yawDeg.toFixed(1)}° · loft ${p.loftDeg.toFixed(1)}° · nose ${p.noseDeg.toFixed(1)}° · bank ${p.bankDeg.toFixed(1)}° · spin ${p.spin.toFixed(0)} · quality ${(p.quality * 100).toFixed(0)}%` : '–'}`,
      ...this.debugLines()
    ];
    this.ctx.debug.text(lines.join('\n'));
    this.ctx.debug.viz((g, W, H) => this.viz(g, W, H));
  }

  /** The last throw: top view (direction and bank), side view (loft and nose), spin and quality bars. */
  private viz(g: CanvasRenderingContext2D, W: number, H: number): void {
    g.fillStyle = '#16233a'; g.fillRect(0, 0, W, H);
    const p = this.lastThrow;
    g.fillStyle = '#dff6ff'; g.font = '11px ui-monospace, monospace';
    if (!p) { g.fillText('no throw yet', 8, 16); return; }
    const cx = W * 0.22, cy = H * 0.55, r = Math.min(W * 0.18, H * 0.38);
    // top view: forward is up
    g.strokeStyle = '#3a4a66'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    const a = p.yawDeg * D2R;
    g.strokeStyle = '#3ff2ff'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r); g.stroke();
    g.fillText(`dir ${p.yawDeg.toFixed(0)}°`, cx - r, cy + r + 12);
    // bank: a disc seen from behind
    const bx = W * 0.5, by = H * 0.35, b = p.bankDeg * D2R;
    g.strokeStyle = '#ff8a3c'; g.lineWidth = 4; g.beginPath(); g.moveTo(bx - Math.cos(b) * 26, by - Math.sin(b) * 26); g.lineTo(bx + Math.cos(b) * 26, by + Math.sin(b) * 26); g.stroke();
    g.fillText(`bank ${p.bankDeg.toFixed(0)}°`, bx - 26, by + 26);
    // side view: loft (velocity) and nose (disc)
    const sx = W * 0.5, sy = H * 0.85, lo = p.loftDeg * D2R, no = (p.loftDeg + p.noseDeg) * D2R;
    g.strokeStyle = '#3ff2ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(sx - 20, sy); g.lineTo(sx - 20 + Math.cos(lo) * 40, sy - Math.sin(lo) * 40); g.stroke();
    g.strokeStyle = '#ffd84a'; g.lineWidth = 3; g.beginPath(); g.moveTo(sx - 20 - Math.cos(no) * 12, sy + Math.sin(no) * 12); g.lineTo(sx - 20 + Math.cos(no) * 12, sy - Math.sin(no) * 12); g.stroke();
    g.fillText(`loft ${p.loftDeg.toFixed(0)}° nose ${p.noseDeg.toFixed(0)}°`, sx + 26, sy - 4);
    // bars
    const bar = (y: number, k: number, col: string, label: string) => {
      g.fillStyle = '#2a3a55'; g.fillRect(W * 0.72, y, W * 0.24, 9);
      g.fillStyle = col; g.fillRect(W * 0.72, y, W * 0.24 * clamp(k, 0, 1), 9);
      g.fillStyle = '#dff6ff'; g.fillText(label, W * 0.72, y - 3);
    };
    bar(22, Math.abs(p.spin) / 60, '#3bb37a', `spin ${Math.abs(p.spin).toFixed(0)} rad/s`);
    bar(52, p.quality, '#ffd84a', `quality ${(p.quality * 100).toFixed(0)}%`);
    bar(82, p.speed / 32, '#ff5a5f', `speed ${p.speed.toFixed(1)} m/s`);
  }

  /* ---------------- lifecycle ---------------- */

  abstract start(): void;
  abstract restart(): void;

  setPaused(p: boolean): void {
    this.paused = p;
    if (p) { sfx.stopLoops(); Crowd.stopRally(); }
  }

  setQuality(q: QualityLevel): void {
    const prof = QUALITY[q];
    this.sun.castShadow = prof.shadows;
    if (this.sun.shadow.mapSize.x !== prof.shadowMap) {
      this.sun.shadow.mapSize.set(prof.shadowMap, prof.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  refreshSettings(): void {
    this.calm = this.ctx.reducedMotion();
    this.hud.calm = this.calm;
    this.effects.calm = this.calm;
    this.hud.relabel();
  }

  onTuning(): void { /* FB_TUNING is read live */ }

  resize(w: number, h: number): void { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  dispose(): void {
    sfx.stopLoops();
    this.ctx.debug.viz(null);
    this.hud.dispose();
    this.effects.dispose();
    this.discMesh?.dispose();
    for (const d of this.disposables) d.dispose();
    this.sun.shadow.map?.dispose();
  }
}

/** Unit vector of a heading in degrees (0 = −z, + = right). */
export const headingDir = (deg: number): V3 => ({ x: Math.sin(deg * D2R), y: 0, z: -Math.cos(deg * D2R) });

/** The disc's flight-normal in world space (handy for camera effects). */
export const discNormal = (d: Disc): V3 => qApply(d.q, { x: 0, y: 1, z: 0 });


import * as THREE from 'three';
import { toon } from '../render/Toon';
import type { InputBackend } from '../input/InputBackend';
import type { SwingDetector } from '../input/SwingDetector';
import type { MouseBackend } from '../input/MouseBackend';
import type { PaddleSwing } from '../types';
import { TABLE_HALF_LENGTH, TABLE_HALF_WIDTH, v3, type V3 } from './BallPhysics';
import type { Engine, HitInfo, Prediction } from './Engine';
import type { Side } from './Rules';
import { intentFromSwing, type Grade, type ShotType, type SwingInput } from './Shot';
import { PADDLE_RADIUS, TABLE, TT_TUNING } from './ttTuning';

/* ---------------- paddle mesh ---------------- */

export type PaddleSkin = 'classic' | 'ocean' | 'sunset' | 'carbon' | 'gold' | 'galaxy';

const SKINS: Record<PaddleSkin, { fore: string; back: string; pattern?: 'stripes' | 'stars' }> = {
  classic: { fore: '#d8263a', back: '#1c1c22' },
  ocean: { fore: '#1fb5a8', back: '#2b4fd8' },
  sunset: { fore: '#ff8a3c', back: '#ff4f9a' },
  carbon: { fore: '#3a3d46', back: '#16171b', pattern: 'stripes' },
  gold: { fore: '#f2c230', back: '#1c1c22' },
  galaxy: { fore: '#6b3cff', back: '#20123f', pattern: 'stars' }
};

function faceTexture(color: string, pattern?: 'stripes' | 'stars'): THREE.CanvasTexture | null {
  if (!pattern || typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = color; g.fillRect(0, 0, 64, 64);
  if (pattern === 'stripes') { g.fillStyle = 'rgba(255,255,255,.14)'; for (let i = -64; i < 64; i += 10) { g.save(); g.translate(i, 0); g.rotate(0.7); g.fillRect(0, -10, 4, 120); g.restore(); } }
  else { g.fillStyle = '#fff6c8'; for (let i = 0; i < 18; i++) { g.beginPath(); g.arc((i * 37) % 64, (i * 23) % 64, i % 3 ? 1 : 2, 0, Math.PI * 2); g.fill(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Toon paddle: a round blade with a coloured rubber on each face and a handle in the player's colour.
 * Local frame: the forehand face points along +z, the handle hangs along −y.
 */
export class PaddleView {
  readonly group = new THREE.Group();
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly tex: THREE.Texture[] = [];
  private readonly fore: THREE.Mesh;
  private readonly back: THREE.Mesh;
  private readonly flashMesh: THREE.Mesh;
  private flashT = 0;
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 0, 1);

  constructor(color: string, skin: PaddleSkin = 'classic') {
    const blade = new THREE.CylinderGeometry(PADDLE_RADIUS, PADDLE_RADIUS, 0.012, 28);
    blade.rotateX(Math.PI / 2);
    const rubber = new THREE.CircleGeometry(PADDLE_RADIUS * 0.97, 28);
    const handle = new THREE.BoxGeometry(0.03, 0.1, 0.024);
    const ring = new THREE.RingGeometry(PADDLE_RADIUS * 0.6, PADDLE_RADIUS * 1.25, 28);
    this.geos.push(blade, rubber, handle, ring);
    const wood = toon('#e8c48a'); this.mats.push(wood);
    this.group.add(new THREE.Mesh(blade, wood));
    this.fore = new THREE.Mesh(rubber, wood); this.fore.position.z = 0.0065;
    this.back = new THREE.Mesh(rubber, wood); this.back.position.z = -0.0065; this.back.rotation.y = Math.PI;
    const hMat = toon(color); this.mats.push(hMat);
    const h = new THREE.Mesh(handle, hMat); h.position.y = -PADDLE_RADIUS - 0.045;
    const fMat = new THREE.MeshBasicMaterial({ color: '#fff7c0', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.mats.push(fMat);
    this.flashMesh = new THREE.Mesh(ring, fMat);
    this.group.add(this.fore, this.back, h, this.flashMesh);
    for (const m of this.group.children) m.castShadow = true;
    this.setSkin(skin);
  }

  setSkin(skin: PaddleSkin): void {
    const s = SKINS[skin] ?? SKINS.classic;
    for (const [mesh, col] of [[this.fore, s.fore], [this.back, s.back]] as const) {
      const map = faceTexture(col, s.pattern);
      if (map) this.tex.push(map);
      const m = toon(map ? '#ffffff' : col, map ? { map } : {});
      this.mats.push(m);
      mesh.material = m;
    }
  }

  /** Place the paddle with its forehand face along `normal`, handle pointing roughly down. */
  setPose(pos: THREE.Vector3 | V3, normal: V3, roll = 0): void {
    this.group.position.set(pos.x, pos.y, pos.z);
    this.q.setFromUnitVectors(this.up, new THREE.Vector3(normal.x, normal.y, normal.z).normalize());
    this.group.quaternion.copy(this.q);
    if (roll) this.group.rotateZ(roll);
  }

  /** Small contact flash (bigger = harder hit). */
  flash(strength = 1): void { this.flashT = 0.12 + 0.1 * Math.min(1, strength); }

  update(dt: number): void {
    const m = this.flashMesh.material as THREE.MeshBasicMaterial;
    if (this.flashT > 0) { this.flashT -= dt; m.opacity = Math.max(0, this.flashT * 5); this.flashMesh.scale.setScalar(1 + (0.2 - this.flashT) * 3); }
    else m.opacity = 0;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.tex) t.dispose();
    this.group.removeFromParent();
  }
}

/* ---------------- human player ---------------- */

export interface StrikerHooks {
  /** A swing started an animation: which one, and how far into it (s) to line the peak up with contact. */
  swingAnim(kind: 'ttForehand' | 'ttBackhand' | 'ttSmash' | 'ttLunge', startAt: number): void;
  toss(): void;
  /** EARLY / LATE / PERFECT text at the contact (or a miss). */
  grade(g: Grade | 'miss', at: V3): void;
  hit(h: HitInfo): void;
}

export interface ContactDebug { grade: Grade | 'miss'; timingMs: number; edge: number; normal: V3; spin: number; type: ShotType; power: number }

const HOME_Y = TABLE.height + 0.22;

/**
 * Assisted paddle for one human player.
 *
 * Motion controllers (no position): the paddle slides to the predicted contact point by itself; the
 * swing decides TIMING (peak vs. ball arrival), POWER, DIRECTION (face yaw), LOFT (face pitch) and
 * SPIN (brushing up/down, wrist roll). An early swing waits for the ball and hits with an "early"
 * contact; a late one hits right away; outside the window it misses.
 *
 * Mouse: the pointer moves the paddle freely on a plane behind the table (speed-capped), the height
 * follows the ball. Flicking the mouse up (toward the net) is the swing; hold the left button for
 * topspin, the right button for backspin. Contact needs the paddle within reach of the ball, and
 * how far off-centre it is decides the contact quality.
 */
export class HumanStriker {
  readonly paddle: V3;
  /** Face normal for drawing. */
  readonly normal: V3;
  /** Gameplay prediction for the ball coming at this player. */
  pred: Prediction | null = null;
  last: ContactDebug | null = null;
  private seen = -1;
  private struck = false;
  private whiffed = false;
  private pending: { at: number; timing: number; sw: PaddleSwing } | null = null;
  private prevMouse: V3 | null = null;
  private mouseVel = v3();
  private prevBallRel = 0;
  private readonly sign: 1 | -1;

  /** Real time (performance.now) and engine time of the last physics step, to place swings on the engine clock. */
  clock = { real: 0, engine: 0 };

  constructor(
    readonly side: Side,
    private readonly engine: Engine,
    private readonly input: { backend: () => InputBackend | null; swing: SwingDetector },
    private readonly handed: () => 'right' | 'left',
    private readonly hooks: StrikerHooks
  ) {
    this.sign = side === 0 ? 1 : -1;
    this.paddle = v3(0, HOME_Y, this.sign * (TABLE_HALF_LENGTH + 0.3));
    this.normal = v3(0, 0, -this.sign);
  }

  get isMouse(): boolean { return this.input.backend()?.kind === 'mouse'; }

  start(): void {
    const sw = this.input.swing;
    sw.mode = 'paddle';
    sw.cancel();
    sw.enabled = true;
    sw.onPaddleSwing = s => this.onSwing(s);
    sw.onToss = () => { if (this.engine.phase === 'hold' && this.engine.server === this.side) { this.engine.toss(); this.hooks.toss(); } };
  }

  stop(): void {
    const sw = this.input.swing;
    sw.onPaddleSwing = null; sw.onToss = null; sw.enabled = false; sw.mode = 'throw';
  }

  setEnabled(on: boolean): void { this.input.swing.enabled = on; if (!on) this.input.swing.cancel(); }

  /** Engine time of a swing peak measured on the performance.now() clock. */
  private engineTimeOf(realMs: number): number { return this.clock.engine + (realMs - this.clock.real) / 1000; }

  private onSwing(sw: PaddleSwing): void {
    const e = this.engine;
    if (this.isMouse) return;                      // the mouse swings through the paddle plane instead
    if (e.phase === 'toss' && e.server === this.side) {
      const info = e.serve(sw.direction, sw.power, sw.brush * TT_TUNING.topspinMax * 0.6, sw.roll * TT_TUNING.sidespinMax * 0.6);
      if (info) { this.hooks.swingAnim('ttForehand', 0.16); this.afterHit(info, sw.power); }
      return;
    }
    const p = this.pred;
    if (!p || this.struck || e.heading !== this.side) return;
    const ts = this.engineTimeOf(sw.t);
    const err = (ts - p.t) * 1000;
    const W = TT_TUNING.timingWindowMs;
    if (err < -W) { this.hooks.grade('early', p.pos); return; }   // far too early: nothing happens, swing again
    if (err > W) return;                                          // far too late: the miss timer handles it
    this.struck = true;
    const kind = this.animFor(sw, p);
    this.hooks.swingAnim(kind, Math.max(0, 0.18 - (p.t - ts)));
    if (err <= 0) this.pending = { at: p.t, timing: err, sw };
    else this.hitNow(sw, err);
  }

  private animFor(sw: PaddleSwing, p: Prediction): 'ttForehand' | 'ttBackhand' | 'ttSmash' | 'ttLunge' {
    const high = p.pos.y - TABLE.height > TT_TUNING.smashHeight && sw.power >= TT_TUNING.smashPower;
    if (high) return 'ttSmash';
    if (Math.abs(p.pos.x - this.paddle.x) > 0.45 || Math.abs(p.pos.z) < TABLE_HALF_LENGTH - 0.25) return 'ttLunge';
    return sw.forehand ? 'ttForehand' : 'ttBackhand';
  }

  private hitNow(sw: PaddleSwing, timing: number): void {
    const s: SwingInput = { power: sw.power, direction: sw.direction, loft: sw.loft, topspin: sw.brush, sidespin: sw.roll };
    this.strike(s, timing);
  }

  private strike(s: SwingInput, timing: number): void {
    const e = this.engine;
    const { intent, type } = intentFromSwing(s, e.ball.pos, this.side);
    const info = e.strike(this.side, intent, timing, type, s.power, 2);
    if (info) this.afterHit(info, s.power);
  }

  private afterHit(info: HitInfo, power: number): void {
    const b = this.engine.ball;
    const n = Math.hypot(b.spin.x, b.spin.y, b.spin.z);
    this.last = { grade: info.grade, timingMs: info.timingMs, edge: info.edge, normal: { ...this.normal }, spin: n * 60 / (2 * Math.PI), type: info.type, power };
    this.hooks.grade(info.grade, info.pos);
    this.hooks.hit(info);
  }

  /** Call every engine step (240 Hz), before engine.step(). */
  tick(dt: number): void {
    const e = this.engine;
    // between rallies, forget the last shot: every rally (and every ball-machine ball) starts its count again
    if (e.phase !== 'live') { this.seen = -1; this.struck = false; this.whiffed = false; }
    const incoming = e.heading === this.side;
    if (incoming && this.seen !== e.rallyLength) {
      this.seen = e.rallyLength;
      this.pred = e.predict(this.side);
      this.struck = false; this.whiffed = false; this.pending = null;
    }
    if (!incoming) { this.pred = null; this.pending = null; }

    if (this.pending && e.time + 1e-9 >= this.pending.at) {
      const pnd = this.pending; this.pending = null;
      this.hitNow(pnd.sw, pnd.timing);
    }
    const p = this.pred;
    if (p && !this.struck && !this.whiffed && e.time > p.t + TT_TUNING.timingWindowMs / 1000) {
      this.whiffed = true;
      this.hooks.grade('miss', p.pos);
    }

    if (this.isMouse) this.tickMouse(dt);
    else this.tickAssisted(dt);
  }

  /** Motion controllers: slide toward the predicted contact (or the ready spot), face from the controller. */
  private tickAssisted(dt: number): void {
    const p = this.pred;
    const hold = this.engine.phase !== 'live' && this.engine.server === this.side;
    const target = p && !this.struck
      ? p.pos
      : hold ? { x: this.engine.hold.x + 0.12 * this.sign, y: this.engine.hold.y, z: this.engine.hold.z + 0.1 * this.sign }
        : { x: this.paddle.x * 0.6, y: HOME_Y, z: this.sign * (TABLE_HALF_LENGTH + 0.3) };
    const k = 1 - Math.exp(-dt * TT_TUNING.paddleSlide);
    this.paddle.x += (target.x - this.paddle.x) * k;
    this.paddle.y += (target.y - this.paddle.y) * k;
    this.paddle.z += (target.z + this.sign * 0.03 - this.paddle.z) * k;
    const f = this.input.swing.face;
    const yaw = (f.yaw * Math.PI) / 180, pitch = (f.pitch * Math.PI) / 180;
    // face looks toward the opponent, turned by the controller's yaw and opened by its pitch
    this.normal.x = -Math.sin(yaw) * this.sign;
    this.normal.y = Math.sin(pitch) * 0.8;
    this.normal.z = -Math.cos(yaw) * this.sign;
  }

  /** Mouse: free paddle on a plane, contact by sweeping through the ball. */
  private tickMouse(dt: number): void {
    const e = this.engine, T = TT_TUNING;
    const m = (this.input.backend() as MouseBackend | null)?.pointer;
    if (!m) return;
    const nx = (m.x / Math.max(1, innerWidth) - 0.5) * 2, ny = m.y / Math.max(1, innerHeight);
    const right = this.sign;
    const want = v3(
      nx * (TABLE_HALF_WIDTH + 0.25) * right,
      this.pred ? Math.max(TABLE.height + 0.05, this.pred.pos.y) : HOME_Y,
      this.sign * (TABLE_HALF_LENGTH - 0.15 + ny * 0.85)
    );
    const prev = this.prevMouse ?? want;
    // speed-capped motion so the mouse can't teleport the paddle into a 40 m/s smash
    const max = T.mouseMaxSpeed * dt;
    const dx = want.x - prev.x, dz = want.z - prev.z, d = Math.hypot(dx, dz);
    const s = d > max ? max / d : 1;
    const next = v3(prev.x + dx * s, prev.y + (want.y - prev.y) * Math.min(1, dt * 14), prev.z + dz * s);
    this.mouseVel = v3((next.x - prev.x) / dt, (next.y - prev.y) / dt, (next.z - prev.z) / dt);
    this.prevMouse = next;
    this.paddle.x = next.x; this.paddle.y = next.y; this.paddle.z = next.z;
    const fwd = -this.mouseVel.z * this.sign;               // speed toward the net
    const top = m.left ? 0.8 : m.right ? -0.7 : 0.1;
    this.normal.x = this.mouseVel.x / (T.mouseMaxSpeed * 4);
    this.normal.y = top * -0.25;
    this.normal.z = -this.sign;

    // serve: after the toss, a flick toward the net hits it
    if (e.phase === 'toss' && e.server === this.side) {
      if (fwd > T.mouseSwingSpeed) {
        const info = e.serve((this.mouseVel.x / T.mouseMaxSpeed) * right, Math.min(1, fwd / T.mouseMaxSpeed) + 0.2, top * T.topspinMax * 0.5, 0);
        if (info) { this.hooks.swingAnim('ttForehand', 0.16); this.afterHit(info, fwd / T.mouseMaxSpeed); }
      }
      return;
    }
    // only after the bounce on this half: sweeping through it before would be a volley (a fault)
    if (e.phase !== 'live' || this.struck || e.toPlay !== this.side) { this.prevBallRel = 0; return; }
    const b = e.ball.pos;
    const rel = (b.z - this.paddle.z) * this.sign;           // > 0: ball still in front of the paddle
    const crossed = this.prevBallRel > 0 && rel <= 0.03;
    this.prevBallRel = rel;
    const lateral = b.x - this.paddle.x;
    if (!crossed || fwd < T.mouseSwingSpeed || Math.abs(lateral) > T.mouseReach || Math.abs(b.y - this.paddle.y) > 0.3) return;
    this.struck = true;
    const power = Math.min(1.1, fwd / T.mouseMaxSpeed * 1.25);
    const sw: SwingInput = {
      power,
      direction: Math.max(-1.2, Math.min(1.2, (this.mouseVel.x / (T.mouseMaxSpeed * 0.5)) * right + (lateral / T.mouseReach) * 0.25 * right)),
      loft: b.y - TABLE.height < 0.12 ? 0.3 : 0.12,
      topspin: top,
      sidespin: 0
    };
    // off-centre contact plays like a mistimed swing: same edge model
    const timing = (lateral / T.mouseReach) * T.timingWindowMs * 0.85 * right;
    const p = this.pred;
    // the ball on the paddle-hand side is a forehand
    const hand = this.handed() === 'left' ? -1 : 1;
    const anim = p && Math.abs(lateral) > 0.1 ? 'ttLunge' : lateral * right * hand >= 0 ? 'ttForehand' : 'ttBackhand';
    this.hooks.swingAnim(anim, 0.18);
    this.strike(sw, timing);
  }
}

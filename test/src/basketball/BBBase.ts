import * as THREE from 'three';
import type { SceneContext, SportScene } from '../sports/types';
import type { QualityLevel } from '../core/Quality';
import { bus } from '../core/events';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import { Music } from '../audio/Music';
import { Effects } from '../game/Effects';
import { Rng } from '../tabletennis/BallPhysics';
import { BB_TUNING, BALL, RELEASE_HEIGHT, type ShotAssist } from './bbTuning';
import { HoopWorld, type BBBall, type BBContact } from './BallPhysics';
import { CourtScene, type BallSkin, type CourtLook } from './CourtScene';
import type { NetStyle } from './Net';
import { BBHud } from './bbHud';
import { applyError, HOOP_CENTER, predictOutcome, solveIdealShot, type AppliedShot, type IdealShot, type Outcome, type ShotInput, type V3 } from './ShotSolver';
import type { ShotGrade } from './ShotSolver';

export { RELEASE_HEIGHT };

export interface ShotRecordDebug {
  ideal: V3[];
  actual: V3[];
  powerErr: number;
  dirErrDeg: number;
  timingMs: number;
  outcome: Outcome;
  grade: ShotGrade;
}

export interface LaunchedShot {
  ball: BBBall;
  ideal: IdealShot;
  applied: AppliedShot;
  /** What the pure solver expects (Rapier decides for real). */
  predicted: Outcome;
  from: V3;
}

/**
 * Shared basketball scene: the Rapier world at 1/120 s, the court, HUD and effects, contact sounds and bus
 * events (rim, glass, floor, swish, basket), shooting through the ShotSolver, On Fire, slow motion, and the
 * F3 overlay (ball speed, the last shot's ideal vs actual arc and errors, make %).
 * The 3-Point Contest and Pickup build their flow on top.
 */
export abstract class BBBase implements SportScene {
  readonly court: CourtScene;
  readonly world: HoopWorld;
  protected readonly hud: BBHud;
  protected readonly effects: Effects;
  protected paused = false;
  protected readonly seed = Math.floor(Math.random() * 1e9);
  protected readonly rng: Rng;
  protected onFire = false;
  protected makes = 0;
  protected attempts = 0;
  protected lastShot: ShotRecordDebug | null = null;
  private slowT = 0;
  private slowCam: 'shoot' | 'pickup' = 'shoot';
  private scale = 1;
  private readonly ballPos: V3[] = [];
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(protected readonly ctx: SceneContext, ballCount: number) {
    const c = ctx.setup.cosmetics ?? {};
    this.rng = new Rng(this.seed);
    this.court = new CourtScene((c.court as CourtLook) || 'gym', (c.net as NetStyle) || 'white', (c.hoopball as BallSkin) || 'classic', ballCount, ctx.quality());
    this.world = new HoopWorld(ballCount);
    this.hud = new BBHud(ctx.ui);
    this.effects = new Effects(this.court.scene, ctx.ui);
  }

  get scene(): THREE.Scene { return this.court.scene; }
  get camera(): THREE.Camera { return this.court.camera; }
  get timeScale(): number { return this.paused ? 0 : this.scale; }
  protected get assist(): ShotAssist { return this.ctx.shotAssist(); }

  /* ---------------- shooting ---------------- */

  /** Where a shooter at (x, z) facing the hoop releases the ball at the top of the jump. */
  releasePoint(x: number, z: number): V3 {
    const dx = HOOP_CENTER.x - x, dz = HOOP_CENTER.z - z, d = Math.hypot(dx, dz) || 1;
    return { x: x + dx / d * 0.22, y: RELEASE_HEIGHT + BB_TUNING.jumpHeight, z: z + dz / d * 0.22 };
  }

  /**
   * Launch a shot: the ideal arc from `from`, perturbed by the input (shrunk by assist; AI passes assist 0
   * with its own errors), plus random `extraSd` from defenders and distance.
   */
  protected launch(from: V3, input: ShotInput, assist: ShotAssist, extraSd: number, tag: unknown, grade: ShotGrade): LaunchedShot | null {
    const ball = this.world.freeBall();
    if (!ball) return null;
    const ideal = solveIdealShot(from);
    const applied = applyError(ideal, input, assist, extraSd, this.rng);
    const pr = predictOutcome(from, applied.vel, HOOP_CENTER, 1 / 120, 4, true);
    const idealPath = predictOutcome(from, ideal.vel, HOOP_CENTER, 1 / 120, 4, true).path ?? [];
    ball.launch(from, applied.vel, applied.spin, this.world.time);
    ball.tag = tag;
    this.lastShot = { ideal: idealPath, actual: pr.path ?? [], powerErr: applied.powerErr, dirErrDeg: applied.dirErrDeg, timingMs: input.timingMs, outcome: pr.outcome, grade };
    this.attempts += 1;
    this.court.followTrail(ball.index);
    sfx.release();
    return { ball, ideal, applied, predicted: pr.outcome, from };
  }

  /** Show the dotted ideal arc from a release point (null hides it). */
  protected previewArc(from: V3 | null): void {
    if (!from) { this.court.showArc(null); return; }
    const ideal = solveIdealShot(from);
    this.court.showArc(predictOutcome(from, ideal.vel, HOOP_CENTER, 1 / 120, 3, true).path ?? null);
  }

  /** The release label over the shooter. */
  protected showGrade(g: ShotGrade, at: V3): void {
    const s = this.court.toScreen({ x: at.x, y: at.y + 0.5, z: at.z });
    this.hud.grade(t(`bb.grade.${g}`), g, s.x, s.y);
  }

  protected setFire(on: boolean): void {
    if (on === this.onFire) return;
    this.onFire = on;
    this.court.setOnFire(on);
    this.hud.setFire(on);
    Music.setLayer(on);
    if (on) { this.hud.call(t('bb.onFireCall'), 'fire', 1.4); Crowd.cheer(0.7); }
  }

  /** Slow motion close-up at the rim (0.4×, 0.5 s real time). */
  protected slowMo(returnTo: 'shoot' | 'pickup'): void {
    if (this.ctx.reducedMotion()) return;
    this.slowT = 0.5;
    this.slowCam = returnTo;
    this.scale = 0.4;
    this.court.setCamera('hoopCam');
  }

  /* ---------------- physics ---------------- */

  fixedStep(dt: number): void {
    if (this.paused) return;
    this.beforeStep(dt);
    const { contacts, baskets } = this.world.step(dt);
    for (const c of contacts) this.contact(c);
    for (const b of baskets) {
      const swish = !b.touchedRim && !b.touchedBoard;
      if (swish) { sfx.swish(); this.court.hoop.net.kick(1); } else { sfx.swish(); this.court.hoop.net.kick(0.4); }
      this.makes += 1;
      this.onBasket(b, swish);
    }
    this.afterStep(dt);
  }

  private contact(c: BBContact): void {
    switch (c.kind) {
      case 'rim':
        if (c.speed > 0.4) { sfx.rimClank(c.speed); this.court.hoop.shake(c.speed); bus.emit('rimHit', { speed: c.speed }); }
        break;
      case 'board':
        if (c.speed > 0.4) { sfx.boardThud(c.speed); bus.emit('backboardHit', { speed: c.speed }); }
        break;
      case 'floor':
        if (c.speed > 0.6) sfx.bounce(c.speed);
        break;
      default:
        if (c.speed > 0.8) sfx.bounce(c.speed * 0.6);
    }
    this.onContact(c);
  }

  /** Hooks for the modes. */
  protected beforeStep(_dt: number): void { /* optional */ }
  protected afterStep(_dt: number): void { /* optional */ }
  protected onContact(_c: BBContact): void { /* optional */ }
  protected abstract onBasket(ball: BBBall, swish: boolean): void;
  protected debugLines(): string[] { return []; }

  /* ---------------- rendering ---------------- */

  /** Draw the live balls (interpolated) and let the mode place held ones. */
  protected renderBalls(alpha: number): void {
    this.ballPos.length = 0;
    for (const b of this.world.balls) {
      if (b.live) {
        this.tmpV.set(b.prev.x + (b.cur.x - b.prev.x) * alpha, b.prev.y + (b.cur.y - b.prev.y) * alpha, b.prev.z + (b.cur.z - b.prev.z) * alpha);
        this.tmpQ.slerpQuaternions(b.prevQ, b.curQ, alpha);
        this.court.setBall(b.index, this.tmpV, this.tmpQ);
        this.ballPos.push({ x: this.tmpV.x, y: this.tmpV.y, z: this.tmpV.z });
      }
    }
  }

  /** Extra ball positions that should push the net (e.g. a held ball near the rim). */
  protected netBalls(): V3[] { return this.ballPos; }

  frame(alpha: number, realDt: number): void {
    const dt = this.paused ? 0 : realDt * this.scale;
    if (this.slowT > 0 && !this.paused) {
      this.slowT -= realDt;
      if (this.slowT <= 0) { this.scale = 1; this.court.setCamera(this.slowCam); }
    }
    this.renderBalls(alpha);
    this.frameMode(alpha, dt, this.paused ? 0 : realDt);
    this.court.update(dt, this.netBalls());
    this.hud.update(this.paused ? 0 : realDt);
    this.effects.update(dt);
    if (this.ctx.debug.visible) this.drawDebug();
  }

  /** The mode's per-frame work. `dt` is scaled by slow motion, `realDt` is not. */
  protected abstract frameMode(alpha: number, dt: number, realDt: number): void;

  /* ---------------- F3 ---------------- */

  private drawDebug(): void {
    const live = this.world.balls.find(b => b.live);
    const s = this.lastShot;
    const pct = this.attempts ? Math.round(100 * this.makes / this.attempts) : 0;
    const lines = [
      `ball       ${live ? `${live.speed.toFixed(2)} m/s  (${(live.speed * 3.6).toFixed(1)} km/h)` : '–'}`,
      `last shot  ${s ? `power ${(s.powerErr * 100).toFixed(1)} % · dir ${s.dirErrDeg.toFixed(1)}° · timing ${s.timingMs.toFixed(0)} ms · ${s.grade} → ${s.outcome}` : '–'}`,
      `make %     ${this.makes}/${this.attempts} (${pct} %) · assist ${['off', 'low', 'high', 'very high'][this.assist]}`,
      ...this.debugLines()
    ];
    this.ctx.debug.text(lines.join('\n'));
    this.ctx.debug.viz((g, w, h) => this.viz(g, w, h));
  }

  /** Side view of the last shot: ideal arc (cyan) vs the actual launch (orange), hoop and backboard. */
  private viz(g: CanvasRenderingContext2D, w: number, h: number): void {
    const s = this.lastShot;
    g.fillStyle = '#16233a'; g.fillRect(0, 0, w, h);
    if (!s || !s.ideal.length) { g.fillStyle = '#dff6ff'; g.font = '11px ui-monospace, monospace'; g.fillText('no shot yet', 8, 16); return; }
    const o = s.ideal[0];
    const along = (p: V3) => Math.hypot(p.x - o.x, p.z - o.z);
    const total = Math.max(1, along(HOOP_CENTER) + 1);
    const sx = (d: number) => 8 + d / total * (w - 16);
    const sy = (y: number) => h - 8 - y / 4.4 * (h - 16);
    g.strokeStyle = '#ff5a1f'; g.lineWidth = 3;
    const hx = sx(along(HOOP_CENTER));
    g.beginPath(); g.moveTo(hx - 0.23 / total * (w - 16), sy(HOOP_CENTER.y)); g.lineTo(hx + 0.23 / total * (w - 16), sy(HOOP_CENTER.y)); g.stroke();
    g.strokeStyle = '#e8eef5'; g.beginPath(); g.moveTo(hx + 0.38 / total * (w - 16), sy(2.9)); g.lineTo(hx + 0.38 / total * (w - 16), sy(3.97)); g.stroke();
    const path = (pts: V3[], col: string) => {
      g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath();
      pts.forEach((p, i) => { const X = sx(along(p)), Y = sy(p.y); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      g.stroke();
    };
    path(s.ideal, '#3ff2ff');
    path(s.actual, '#ff8a3c');
    g.fillStyle = '#dff6ff'; g.font = '11px ui-monospace, monospace';
    g.fillText(`ideal / actual · ${s.outcome}`, 8, 14);
    g.fillText(`ball r ${BALL.radius} m`, w - 92, 14);
  }

  /* ---------------- lifecycle ---------------- */

  abstract start(): void;
  abstract restart(): void;

  setPaused(p: boolean): void {
    this.paused = p;
    if (p) { Crowd.stopRally(); sfx.stopLoops(); }
  }

  setQuality(q: QualityLevel): void { this.court.setQuality(q); }

  refreshSettings(): void {
    const calm = this.ctx.reducedMotion();
    this.court.calm = calm; this.hud.calm = calm; this.effects.calm = calm;
    this.hud.relabel();
  }

  onTuning(): void { this.world.applyTuning(); }

  resize(w: number, h: number): void { this.court.resize(w, h); }

  dispose(): void {
    this.ctx.debug.viz(null);
    Music.setLayer(false);
    Crowd.stopRally();
    this.hud.dispose();
    this.effects.dispose();
    this.court.dispose();
    this.world.dispose();
  }
}

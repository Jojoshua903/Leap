import * as THREE from 'three';
import type { MatchPlayer, SceneContext, SportScene } from '../sports/types';
import type { QualityLevel } from '../core/Quality';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import { Music } from '../audio/Music';
import { buildBuddy, BUDDY_DIMS, type BuddyRig } from '../buddy/BuddyBuilder';
import { BuddyAnimator, TT_CONTACT_AT } from '../buddy/BuddyAnimator';
import { Effects } from '../game/Effects';
import { TABLE_HALF_LENGTH, TABLE_HALF_WIDTH, v3, type Contact, type V3 } from './BallPhysics';
import { Engine, type HitInfo } from './Engine';
import { AIPlayer, getLevel } from './AI';
import { HumanStriker, PaddleView, type PaddleSkin } from './Paddle';
import { TableScene, type HallTheme, type TableLook } from './TableScene';
import { TTHud } from './ttHud';
import { ReplayPlayer, ReplayRecorder } from './Replay';
import type { BestOf, RulesOutcome, Side } from './Rules';
import type { Grade } from './Shot';
import { TABLE, TT_TUNING } from './ttTuning';

export type Control = { kind: 'human'; input: 1 | 2 } | { kind: 'ai'; level: number };

export interface TTPlayer {
  side: Side;
  info: MatchPlayer;
  control: Control;
  rig: BuddyRig;
  anim: BuddyAnimator;
  view: PaddleView;
  human: HumanStriker | null;
  ai: AIPlayer | null;
  body: THREE.Vector3;
  /** 0..1 how much the paddle is drawn at the gameplay position (vs. in the hand). */
  near: number;
  lastHitT: number;
  /** Engine time of the AI's planned contact we already started a swing for. */
  aiSwingFor: number;
}

export type ScenePhase = 'intro' | 'play' | 'between' | 'replay' | 'done';

const INTRO_TIME = 2.2;
const SUBSTEPS = 2;                 // the host steps at 120 Hz; the ball runs at 240 Hz
const RALLY_FLASH = 10;

/**
 * Shared table-tennis scene: the engine at 240 Hz, players (human, AI), Buddies and paddles,
 * sounds and juice for every contact, rally counter and music layer, the replay recorder, the F3
 * readout and the walk-in intro. Match Play and Return Challenge add their own flow on top.
 */
export abstract class TTBaseScene implements SportScene {
  readonly table: TableScene;
  engine!: Engine;
  protected readonly players: TTPlayer[] = [];
  protected readonly hud: TTHud;
  protected readonly effects: Effects;
  protected readonly recorder = new ReplayRecorder();
  protected replay: ReplayPlayer | null = null;
  protected paused = false;
  protected phase: ScenePhase = 'intro';
  protected phaseT = 0;
  protected seed = Math.floor(Math.random() * 1e9);
  protected lastHit: HitInfo | null = null;
  private rallyFlashAt = RALLY_FLASH;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(protected readonly ctx: SceneContext) {
    const c = ctx.setup.cosmetics ?? {};
    this.table = new TableScene((c.table as TableLook) || 'blue', (c.hall as HallTheme) || 'island', ctx.quality());
    this.hud = new TTHud(ctx.ui);
    this.effects = new Effects(this.table.scene, ctx.ui);
  }

  get scene(): THREE.Scene { return this.table.scene; }
  get camera(): THREE.Camera { return this.table.camera; }
  get timeScale(): number { return this.paused ? 0 : 1; }

  /* ---------------- setup ---------------- */

  protected createEngine(bestOf: BestOf, firstServer: Side): void {
    this.engine = new Engine(bestOf, firstServer, this.seed, (ev, payload) => this.onRulesEvent(ev, payload));
    this.engine.listeners.push({
      contact: c => this.onContact(c),
      hit: h => this.onHitBase(h),
      outcome: o => this.onOutcome(o)
    });
    for (const p of this.players) this.bindControl(p);
  }

  /** Hook for rules events (Match Play forwards them to the bus). */
  protected onRulesEvent(_ev: string, _payload: unknown): void { /* optional */ }

  protected addPlayer(side: Side, info: MatchPlayer, control: Control, paddleSkin: PaddleSkin): TTPlayer {
    const rig = buildBuddy(info.buddy);
    rig.root.rotation.y = side === 0 ? Math.PI : 0;
    this.table.scene.add(rig.root);
    const anim = new BuddyAnimator(rig);
    const view = new PaddleView(info.color, paddleSkin);
    this.table.scene.add(view.group);
    const sign = side === 0 ? 1 : -1;
    const body = new THREE.Vector3(sign * 2.6, 0, sign * (TABLE_HALF_LENGTH + 0.7));
    rig.root.position.copy(body);
    const p: TTPlayer = { side, info, control, rig, anim, view, human: null, ai: null, body, near: 0, lastHitT: -9, aiSwingFor: -1 };
    this.players.push(p);
    return p;
  }

  private bindControl(p: TTPlayer): void {
    p.human?.stop();
    p.human = null; p.ai = null;
    if (p.control.kind === 'ai') { p.ai = new AIPlayer(p.side, getLevel(p.control.level), this.seed + 101 * (p.side + 1)); return; }
    const input = p.control.input === 1 || !this.ctx.second
      ? { backend: this.ctx.backend, swing: this.ctx.swing }
      : { backend: this.ctx.second.backend, swing: this.ctx.second.swing };
    p.human = new HumanStriker(p.side, this.engine, input, p.control.input === 1 ? this.ctx.handed : () => 'right', {
      swingAnim: (kind, startAt) => p.anim.play(kind, { blend: 0.05, restart: true, startAt }),
      toss: () => p.anim.play('ttServe', { blend: 0.1, restart: true }),
      grade: (g, at) => this.showGrade(g, at),
      hit: () => undefined
    });
  }

  protected humans(): HumanStriker[] { return this.players.map(p => p.human).filter((h): h is HumanStriker => !!h); }

  /* ---------------- lifecycle ---------------- */

  start(): void {
    this.hud.setPlayers(this.players.map(p => ({ name: p.info.name, color: p.info.color })));
    this.table.setCamera('intro', true);
    this.phase = 'intro';
    this.phaseT = 0;
    for (const p of this.players) p.anim.play('idle');
    Crowd.setRally(0);
  }

  /** Called when the walk-in intro ends. */
  protected abstract introDone(): void;
  /** A rally ended. */
  protected abstract onOutcome(o: RulesOutcome): void;
  /** The replay finished or was skipped. */
  protected replayDone(): void { /* optional */ }
  /** Extra debug lines. */
  protected debugLines(): string[] { return []; }

  protected beginPlay(): void {
    this.phase = 'play';
    this.table.setCamera('play');
    for (const h of this.humans()) h.start();
    for (const p of this.players) p.anim.play('ttReady', { blend: 0.3 });
  }

  /** Next rally: back to ready, counters reset. */
  protected nextRally(): void {
    this.engine.startRally();
    this.recorder.reset();
    this.rallyFlashAt = RALLY_FLASH;
    this.hud.rally(0);
    Music.setLayer(false);
    Crowd.setRally(0);
    this.table.clearTrail();
    for (const p of this.players) if (p.anim.current !== 'ttReady') p.anim.play('ttReady', { blend: 0.3 });
    this.phase = 'play';
  }

  protected startReplay(onDone?: () => void): boolean {
    const frames = this.recorder.take();
    if (frames.length < 10 || this.ctx.reducedMotion()) return false;
    this.replay = new ReplayPlayer(frames, 0.5);
    this.phase = 'replay';
    this.table.setCamera('side', true);
    this.hud.replay(true);
    for (const h of this.humans()) h.stop();
    // any button skips (the trigger is the toss button, so reuse it)
    this.ctx.swing.mode = 'paddle';
    this.ctx.swing.enabled = true;
    this.ctx.swing.onToss = () => this.replay?.skip();
    this.replayCb = onDone ?? null;
    return true;
  }
  private replayCb: (() => void) | null = null;

  onKey(e: KeyboardEvent): boolean {
    if (this.phase === 'replay' && this.replay && e.key !== 'Escape') { this.replay.skip(); return true; }
    return false;
  }

  restart(): void {
    this.replay = null;
    this.hud.replay(false);
    this.effects.clearTrail();
    this.restartMatch();
  }
  protected abstract restartMatch(): void;

  setPaused(p: boolean): void {
    this.paused = p;
    for (const h of this.humans()) h.setEnabled(!p);
    if (p) { Crowd.stopRally(); sfx.stopLoops(); }
  }

  setQuality(q: QualityLevel): void { this.table.setQuality(q); }

  refreshSettings(): void {
    const calm = this.ctx.reducedMotion();
    this.table.calm = calm; this.hud.calm = calm; this.effects.calm = calm;
    this.hud.relabel();
    for (const p of this.players) p.anim.mirror = this.handOf(p) === 'right';
  }

  private handOf(p: TTPlayer): 'right' | 'left' {
    return p.control.kind === 'human' && p.control.input === 1 ? this.ctx.handed() : 'right';
  }

  resize(w: number, h: number): void { this.table.resize(w, h); }

  dispose(): void {
    for (const h of this.humans()) h.stop();
    this.ctx.swing.onToss = null;
    this.ctx.swing.mode = 'throw';
    this.ctx.debug.viz(null);
    Music.setLayer(false);
    Crowd.stopRally();
    for (const p of this.players) { p.rig.dispose(); p.view.dispose(); }
    this.hud.dispose();
    this.effects.dispose();
    this.table.dispose();
  }

  /* ---------------- physics ---------------- */

  fixedStep(dt: number): void {
    if (this.paused || this.phase === 'intro' || this.phase === 'replay' || this.phase === 'done') return;
    const sub = dt / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i++) {
      for (const p of this.players) {
        p.human?.tick(sub);
        p.ai?.tick(this.engine, sub);
      }
      this.engine.step(sub);
      this.beforeRecord();
      this.recorder.push(this.engine.time, this.engine.ball.pos, this.paddlePositions(), this.paddleNormals());
    }
    const clock = { real: performance.now(), engine: this.engine.time };
    for (const h of this.humans()) h.clock = clock;
  }

  /** Subclass hook after every engine step (e.g. the ball machine). */
  protected beforeRecord(): void { /* optional */ }

  private paddleOf(p: TTPlayer | undefined): V3 {
    if (!p) return v3(0, TABLE.height + 0.2, -(TABLE_HALF_LENGTH + 0.4));
    if (p.human) return p.human.paddle;
    const ai = p.ai!;
    const plan = ai.plan;
    return plan ? { x: ai.paddle.x, y: plan.pos.y, z: plan.pos.z } : ai.paddle;
  }
  private normalOf(p: TTPlayer | undefined, side: Side): V3 {
    if (p?.human) return p.human.normal;
    return v3(0, 0.15, side === 0 ? -1 : 1);
  }
  private paddlePositions(): [V3, V3] { return [this.paddleOf(this.bySide(0)), this.paddleOf(this.bySide(1))]; }
  private paddleNormals(): [V3, V3] { return [this.normalOf(this.bySide(0), 0), this.normalOf(this.bySide(1), 1)]; }
  protected bySide(s: Side): TTPlayer | undefined { return this.players.find(p => p.side === s); }

  /* ---------------- contacts and hits ---------------- */

  protected onContact(c: Contact): void {
    switch (c.kind) {
      case 'table': sfx.tableTick(c.speed); this.table.dust(c.pos, c.speed / 8); break;
      case 'net': sfx.netThud(); break;
      case 'netCord': sfx.netCord(); Crowd.ooh(); break;
      case 'floor': if (c.speed > 0.6) sfx.floorTick(); break;
      default: break;
    }
  }

  private onHitBase(h: HitInfo): void {
    this.lastHit = h;
    const p = this.bySide(h.side);
    if (p) {
      p.lastHitT = this.engine.time;
      p.view.flash(h.power);
      if (p.human) {
        const b = p.control.kind === 'human' && p.control.input === 2 ? this.ctx.second?.backend() : this.ctx.backend();
        b?.rumble(0.25 + 0.6 * Math.min(1, h.power), 60 + 50 * h.power);
      }
    }
    if (h.type === 'smash') { sfx.smash(); this.table.shake(TT_TUNING.shakeSmash); this.table.excite(0.7); }
    else sfx.paddleHit(h.power, h.edge);
    const n = this.engine.rallyLength;
    this.hud.rally(n);
    Crowd.setRally(Math.min(1, n / 20));
    if (n >= this.rallyFlashAt) {
      this.rallyFlashAt += 5;
      this.hud.call(t('tt.rally', { n }), 'rally', 1.1);
      Crowd.cheer(0.45);
      Music.setLayer(true);
      this.table.excite(0.6 + Math.min(0.4, (n - 10) / 20));
    }
    this.onHit(h);
  }

  /** Subclass hook after the shared hit handling. */
  protected onHit(_h: HitInfo): void { /* optional */ }

  private showGrade(g: Grade | 'miss', at: V3): void {
    const text = g === 'miss' ? t('tt.grade.miss') : t(`tt.grade.${g}`);
    if (g === 'miss') sfx.whoosh();
    this.tmp.set(at.x, at.y + 0.12, at.z).project(this.table.camera);
    this.hud.grade(text, g, (this.tmp.x + 1) / 2 * innerWidth, (1 - this.tmp.y) / 2 * innerHeight);
  }

  /* ---------------- rendering ---------------- */

  frame(_alpha: number, realDt: number): void {
    const dt = this.paused ? 0 : realDt;
    this.phaseT += dt;
    if (this.phase === 'intro') {
      const k = Math.min(1, this.phaseT / INTRO_TIME);
      this.walkIn(k);
      if (this.phaseT >= INTRO_TIME) this.introDone();
    }

    let ball: V3 = this.engine.ball.pos;
    let paddles = this.paddlePositions(), normals = this.paddleNormals();
    if (this.phase === 'replay' && this.replay) {
      const f = this.replay.update(dt);
      if (!f) {
        this.replay = null;
        this.hud.replay(false);
        this.ctx.swing.onToss = null;
        const cb = this.replayCb; this.replayCb = null;
        if (cb) cb(); else this.replayDone();
      } else { ball = f.ball; paddles = f.paddles; normals = f.normals; }
    }

    const showBall = this.phase !== 'intro';
    this.table.setBall(ball, this.phase === 'replay' ? 0 : this.engine.ball.rpm, showBall);

    for (const p of this.players) {
      this.placePlayer(p, p.side === 0 ? paddles[0] : paddles[1], p.side === 0 ? normals[0] : normals[1], dt);
    }
    this.table.update(dt);
    this.hud.update(realDt);
    this.effects.update(dt);
    if (this.ctx.debug.visible) this.drawDebug();
  }

  private walkIn(k: number): void {
    const e = k * k * (3 - 2 * k);
    for (const p of this.players) {
      const sign = p.side === 0 ? 1 : -1;
      const home = this.homeFor(p);
      p.body.set(THREE.MathUtils.lerp(sign * 2.6, home.x, e), 0, home.z);
      p.rig.root.position.copy(p.body);
      p.rig.root.rotation.y = (p.side === 0 ? Math.PI : 0) + (1 - e) * (sign * Math.PI / 2);
      if (k < 0.95) p.anim.play('watch', { blend: 0.2 });
      p.anim.update(1 / 60);
      p.anim.setParam('swing', 0);
    }
  }

  private homeFor(p: TTPlayer): THREE.Vector3 {
    const sign = p.side === 0 ? 1 : -1;
    return this.tmp2.set(-this.handOffset(p) * 0.6, 0, sign * (TABLE_HALF_LENGTH + 0.65));
  }

  /** World x offset from the body to the paddle hand. */
  private handOffset(p: TTPlayer): number {
    const right = p.side === 0 ? 1 : -1;            // the player's right in world x
    return (this.handOf(p) === 'right' ? 1 : -1) * right * (BUDDY_DIMS.shoulderX + 0.12);
  }

  /** Body follows the paddle; the paddle is drawn in the hand, snapping to the gameplay spot around contact. */
  private placePlayer(p: TTPlayer, paddle: V3, normal: V3, dt: number): void {
    const sign = p.side === 0 ? 1 : -1;
    if (this.phase !== 'intro') {
      const want = this.tmp.set(
        THREE.MathUtils.clamp(paddle.x - this.handOffset(p), -TABLE_HALF_WIDTH - 1.1, TABLE_HALF_WIDTH + 1.1),
        0,
        Math.max(TABLE_HALF_LENGTH + 0.35, Math.abs(paddle.z) + 0.38) * sign
      );
      p.body.lerp(want, 1 - Math.exp(-dt * 10));
      p.rig.root.position.copy(p.body);
      p.rig.root.rotation.y = p.side === 0 ? Math.PI : 0;
      this.aiSwing(p);
    }
    p.anim.update(dt);
    p.rig.root.updateMatrixWorld(true);
    const hand = p.anim.mirror ? p.rig.joints.handL : p.rig.joints.handR;
    hand.getWorldPosition(this.tmp2);
    // near contact (or in the replay) the paddle sits exactly where the physics hits the ball
    const e = this.engine;
    const pred = p.human?.pred ?? p.ai?.plan ?? null;
    const soon = pred ? pred.t - e.time : 9;
    const nearNow = this.phase === 'replay' || (soon > -0.05 && soon < 0.22) || e.time - p.lastHitT < 0.12 || (e.phase !== 'live' && e.server === p.side);
    p.near += ((nearNow ? 1 : 0.25) - p.near) * Math.min(1, dt * 16);
    this.tmp2.lerp(this.tmp.set(paddle.x, paddle.y, paddle.z), p.near);
    p.view.setPose(this.tmp2, normal);
    p.view.update(dt);
    // the server's ball sits in the free hand while holding
    if (e.phase === 'hold' && e.server === p.side && this.phase !== 'replay') {
      const free = p.anim.mirror ? p.rig.joints.handR : p.rig.joints.handL;
      free.getWorldPosition(this.tmp);
      e.hold = { x: this.tmp.x, y: Math.max(TABLE.height + 0.1, this.tmp.y + 0.03), z: this.tmp.z };
    }
  }

  /** Start the AI's swing animation so its peak lines up with the planned contact. */
  private aiSwing(p: TTPlayer): void {
    const ai = p.ai, plan = ai?.plan;
    if (!ai || !plan || p.aiSwingFor === plan.t) return;
    const until = plan.t - this.engine.time;
    if (until > TT_CONTACT_AT) return;
    p.aiSwingFor = plan.t;
    const high = plan.pos.y - TABLE.height > TT_TUNING.smashHeight;
    const wide = Math.abs(plan.pos.x - ai.paddle.x) > 0.4;
    // the AI faces +z, so a ball on its right (world −x) is a forehand
    const kind = high ? 'ttSmash' : wide ? 'ttLunge' : plan.pos.x - p.body.x < 0 ? 'ttForehand' : 'ttBackhand';
    p.anim.play(kind, { blend: 0.05, restart: true, startAt: Math.max(0, TT_CONTACT_AT - until) });
  }

  /* ---------------- F3 ---------------- */

  private drawDebug(): void {
    const e = this.engine, b = e.ball;
    const human = this.players.find(p => p.human)?.human ?? null;
    const ai = this.players.find(p => p.ai)?.ai ?? null;
    const last = human?.last;
    const landing = this.lastHit?.landing ?? null;
    const lines = [
      `ball       ${(b.speed * 3.6).toFixed(1)} km/h  (${b.speed.toFixed(2)} m/s)`,
      `spin       ${Math.round(b.rpm)} rpm`,
      `contact    ${last ? `${last.grade} ${last.timingMs >= 0 ? '+' : ''}${last.timingMs.toFixed(0)} ms · edge ${(last.edge * 100).toFixed(0)}% · ${last.type}` : '–'}`,
      `AI         ${ai ? t(ai.level.nameKey) : '–'}${ai?.plan ? ` · hits at (${ai.plan.pos.x.toFixed(2)}, ${ai.plan.pos.z.toFixed(2)})` : ''}`,
      `landing    ${landing ? `(${landing.x.toFixed(2)}, ${landing.z.toFixed(2)})` : '–'}`,
      `rally      ${e.rallyLength} · phase ${e.phase}`,
      ...this.debugLines()
    ];
    this.ctx.debug.text(lines.join('\n'));
    this.ctx.debug.viz((g, w, h) => this.viz(g, w, h, landing, ai?.plan?.bounce ?? null));
  }

  /** Left: top-down table with the ball, the AI's predicted bounce and the last planned landing. Right: the last contact on the paddle face. */
  private viz(g: CanvasRenderingContext2D, w: number, h: number, landing: { x: number; z: number } | null, aiBounce: V3 | null): void {
    const tw = w * 0.42, th = h - 20, ox = 10, oy = 10;
    const sx = (x: number) => ox + (x / TABLE.width + 0.5) * tw;
    const sz = (z: number) => oy + (z / TABLE.length + 0.5) * th;
    g.fillStyle = '#1f5fb8'; g.fillRect(ox, oy, tw, th);
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(ox, oy, tw, th);
    g.beginPath(); g.moveTo(ox, sz(0)); g.lineTo(ox + tw, sz(0)); g.stroke();
    const b = this.engine.ball.pos;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx(b.x), sz(b.z), 3, 0, Math.PI * 2); g.fill();
    if (landing) { g.strokeStyle = '#ffd23a'; g.beginPath(); g.arc(sx(landing.x), sz(landing.z), 5, 0, Math.PI * 2); g.stroke(); }
    if (aiBounce) { g.strokeStyle = '#ff5a5f'; g.beginPath(); g.moveTo(sx(aiBounce.x) - 4, sz(aiBounce.z) - 4); g.lineTo(sx(aiBounce.x) + 4, sz(aiBounce.z) + 4); g.moveTo(sx(aiBounce.x) + 4, sz(aiBounce.z) - 4); g.lineTo(sx(aiBounce.x) - 4, sz(aiBounce.z) + 4); g.stroke(); }

    const last = this.players.find(p => p.human)?.human?.last;
    const cx = w * 0.74, cy = h / 2, r = Math.min(w * 0.2, h * 0.38);
    g.fillStyle = '#d8263a'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#fff'; g.beginPath(); g.arc(cx, cy, r * 0.35, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#dff6ff'; g.font = '11px ui-monospace, monospace';
    if (!last) { g.fillText('no contact yet', cx - r, cy + r + 12); return; }
    const dir = last.timingMs < 0 ? -1 : 1;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(cx + dir * last.edge * r, cy, 5, 0, Math.PI * 2); g.fill();
    // face angle (top view of the normal) and spin
    const n = last.normal;
    g.strokeStyle = '#3ff2ff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + n.x * r * 0.9, cy - n.y * r * 0.9); g.stroke();
    g.fillStyle = '#dff6ff';
    g.fillText(`${last.grade} · ${Math.round(last.spin)} rpm`, cx - r, h - 4);
  }
}

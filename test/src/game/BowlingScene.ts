import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../tuning';
import type { Throw } from '../types';
import type { SwingPhase } from '../input/SwingDetector';
import type { MatchPlayer, MatchSummary, PlayerResult, SceneContext, SceneFactory, SportScene } from '../sports/types';
import type { QualityLevel } from '../core/Quality';
import { QUALITY } from '../core/Quality';
import { bus, type RollEvent } from '../core/events';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import { buildBuddy, type BuddyRig } from '../buddy/BuddyBuilder';
import { BuddyAnimator } from '../buddy/BuddyAnimator';
import { laneSpec, type LaneSpec } from './dims';
import { Lane, type LaneLook } from './Lane';
import { PinSet } from './Pins';
import { Ball, type BallSkin } from './Ball';
import { CameraRig } from './Camera';
import { Effects, type TrailStyle } from './Effects';
import { cumulativeScores, nextRoll, totalScore } from './Scoring';
import { bonusFor, hundredCumulative, hundredNext, hundredTotal } from '../sports/scoringHundred';
import { Hud } from '../ui/Hud';
import { Scoreboard, type ScoreKind } from '../ui/Scoreboard';

/** INTRO → IDLE → AIMING → SWING → RELEASE → ROLLING → SETTLE → SCORE, then the next ball (or DONE). */
type Phase = 'INTRO' | 'IDLE' | 'AIMING' | 'SWING' | 'RELEASE' | 'ROLLING' | 'SETTLE' | 'SCORE' | 'DONE';

const RELEASE_DELAY = 0.12;     // s between "let go" and the ball leaving the hand (squash + follow-through start)
const INTRO_TIME = 1.4;
const BUDDY_Z = 0.25;           // where the bowler stands, just behind the foul line
const HOOK_STRIKE = 0.5;        // share of maxSpin that counts as a "big hook" for Hook Master

let rapierReady: Promise<void> | null = null;
/** Rapier's WASM only needs to load once per page. */
export const ensureRapier = (): Promise<void> => (rapierReady ??= RAPIER.init());

/* ---------------- rules ---------------- */

interface NextBall { done: boolean; frame: number; ball: number; resetPins: boolean }
interface Rules {
  kind: ScoreKind;
  next(rolls: readonly number[]): NextBall;
  total(rolls: readonly number[]): number;
  /** cumulative score after each frame, for the summary history */
  perFrame(rolls: readonly number[]): number[];
}

function rulesFor(mode: string, frames: number, practice: boolean): Rules {
  if (practice) {
    // Practice: a fresh rack every ball, never ends, no score.
    return { kind: mode === 'hundred' ? 'pinTotal' : 'tenpin', next: r => ({ done: false, frame: 0, ball: r.length + 1, resetPins: true }), total: () => 0, perFrame: () => [] };
  }
  if (mode === 'hundred') {
    return { kind: 'pinTotal', next: r => hundredNext(r, frames), total: r => hundredTotal(r, frames), perFrame: r => hundredCumulative(r, frames) };
  }
  return {
    kind: 'tenpin',
    next: r => nextRoll(r, frames),
    total: r => totalScore(r, frames),
    perFrame: r => { let last = 0; return cumulativeScores(r, frames).map(v => (last = v ?? last)); }
  };
}

/* ---------------- players ---------------- */

interface Bowler {
  p: MatchPlayer;
  rolls: number[];
  stats: { strikes: number; spares: number; gutters: number; pins: number; bestStrikeStreak: number; hookStrikes: number };
  streak: number;
  rig: BuddyRig;
  anim: BuddyAnimator;
  home: THREE.Vector3;
  reactT: number;
}

const freshStats = (): Bowler['stats'] => ({ strikes: 0, spares: 0, gutters: 0, pins: 0, bestStrikeStreak: 0, hookStrikes: 0 });

export class BowlingScene implements SportScene {
  readonly scene = new THREE.Scene();
  private readonly spec: LaneSpec;
  private readonly world: RAPIER.World;
  private readonly events: RAPIER.EventQueue;
  private readonly lane: Lane;
  private readonly pins: PinSet;
  private readonly ball: Ball;
  private readonly rig: CameraRig;
  private readonly effects: Effects;
  private readonly hud: Hud;
  private readonly scoreboard: Scoreboard;
  private readonly aimArrow: THREE.Mesh;
  private readonly sun: THREE.DirectionalLight;
  private readonly rules: Rules;
  private readonly frames: number;
  private readonly practice: boolean;
  private readonly bowlers: Bowler[] = [];

  private phase: Phase = 'INTRO';
  private cur = 0;
  private scale = 1;
  private paused = false;
  private phaseT = 0;
  private rollT = 0;
  private stillT = 0;
  private slowT = 0;
  private slowDone = false;
  private impactT = -1;
  private standingBefore = 10;
  private frameAtThrow = 0;
  private pending: Throw | null = null;
  private lastKnock = 0;
  private firstTurnShown = false;
  private finishT = -1;
  private aimSmooth = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(private readonly ctx: SceneContext) {
    const { setup } = ctx;
    this.practice = setup.practice;
    this.frames = Number(setup.options.frames ?? 10) === 5 ? 5 : 10;
    this.spec = laneSpec(setup.mode === 'hundred' ? 'hundred' : 'standard');
    this.rules = rulesFor(setup.mode, this.frames, this.practice);
    const q = QUALITY[ctx.quality()];

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 120;
    this.events = new RAPIER.EventQueue(true);

    this.lane = new Lane(this.scene, this.world, this.spec, (setup.laneLook as LaneLook) || 'classic', !q.neighbourLanes);
    const look = this.lane.look;
    this.scene.background = new THREE.Color(look.sky);
    this.scene.fog = new THREE.Fog(look.fog, look.fogNear + (this.spec.kind === 'hundred' ? 4 : 0), look.fogFar + (this.spec.kind === 'hundred' ? 8 : 0));

    this.scene.add(new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemi));
    this.sun = new THREE.DirectionalLight(look.sun, look.sunI);
    this.sun.position.set(1.2, 7, 1);
    this.sun.target.position.set(0, 0, -9);
    Object.assign(this.sun.shadow.camera, { left: -this.spec.kickbackX - 1, right: this.spec.kickbackX + 1, top: 13, bottom: -13, near: 0.5, far: 30 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);
    const deckLight = new THREE.PointLight(look.deck, 6, 7 + (this.spec.kind === 'hundred' ? 3 : 0), 1.6);
    deckLight.position.set(0, 2.2, this.spec.headZ + 0.2);
    this.scene.add(deckLight);

    this.pins = new PinSet(this.scene, this.world, this.spec);
    this.ball = new Ball(this.scene, this.world, this.spec);
    this.ball.setSkin((setup.ballSkin as BallSkin) || 'solid');
    this.rig = new CameraRig(this.spec);
    this.effects = new Effects(this.scene, ctx.ui);
    this.effects.setTrailStyle((setup.trail as TrailStyle) || 'classic');
    this.hud = new Hud(ctx.ui);
    this.scoreboard = new Scoreboard(ctx.ui, this.rules.kind, this.frames);

    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.5); arrowShape.lineTo(0.07, 0.3); arrowShape.lineTo(0.025, 0.3); arrowShape.lineTo(0.025, 0);
    arrowShape.lineTo(-0.025, 0); arrowShape.lineTo(-0.025, 0.3); arrowShape.lineTo(-0.07, 0.3); arrowShape.closePath();
    this.aimArrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: '#3ff2ff', transparent: true, opacity: 0.85, depthWrite: false }));
    this.aimArrow.rotation.x = -Math.PI / 2;
    this.aimArrow.position.set(0, 0.006, -0.35);
    this.aimArrow.visible = false;
    this.scene.add(this.aimArrow);

    const players = this.practice ? setup.players.slice(0, 1) : setup.players;
    players.forEach((p, i) => {
      const rig = buildBuddy(p.buddy);
      rig.root.rotation.y = Math.PI;                       // face down the lane
      const n = players.length;
      const home = new THREE.Vector3((i - (n - 1) / 2) * 0.9, 0, this.spec.approachLen + 0.9);
      rig.root.position.copy(home);
      this.scene.add(rig.root);
      const anim = new BuddyAnimator(rig);
      this.bowlers.push({ p, rolls: [], stats: freshStats(), streak: 0, rig, anim, home, reactT: 0 });
    });

    this.setQuality(ctx.quality());
    this.refreshSettings();
  }

  get camera(): THREE.Camera { return this.rig.camera; }
  get timeScale(): number { return this.paused ? 0 : this.scale; }
  private get bowler(): Bowler { return this.bowlers[this.cur]; }
  private get holding(): boolean { return this.phase === 'IDLE' || this.phase === 'AIMING' || this.phase === 'SWING' || this.phase === 'RELEASE'; }

  /* ---------------- lifecycle ---------------- */

  start(): void {
    const { swing } = this.ctx;
    swing.onThrow = th => this.onThrow(th);
    swing.onPhase = p => this.onSwingPhase(p);
    swing.enabled = false;
    this.hud.show();
    this.rig.setMode('intro', true);
    this.phase = 'INTRO';
    this.phaseT = 0;
    this.scoreboard.render(this.rows(), 0);
  }

  restart(): void {
    for (const b of this.bowlers) { b.rolls = []; b.stats = freshStats(); b.streak = 0; b.anim.play('idle'); }
    this.cur = 0;
    this.finishT = -1;
    this.slowT = 0; this.scale = 1;
    this.effects.clearTrail();
    this.scoreboard.hideAll();
    this.pins.rack();
    this.beginTurn();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    const { swing } = this.ctx;
    if (p) { swing.cancel(); swing.enabled = false; sfx.stopLoops(); }
    else if (this.phase === 'IDLE' || this.phase === 'AIMING' || this.phase === 'SWING') { swing.cancel(); swing.enabled = true; this.setPhase('IDLE'); }
  }

  setQuality(level: QualityLevel): void {
    const q = QUALITY[level];
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowMap) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // The 10-pin rack is cheap; only the 100-pin wall drops geometry detail.
    if (this.spec.kind === 'hundred') this.pins.setDetail(q.pinDetail, q.pinOutlines);
  }

  refreshSettings(): void {
    this.lane.setBumpers(this.ctx.gutterAssist());
    const calm = this.ctx.reducedMotion();
    this.effects.calm = calm;
    this.rig.calm = calm;
    const left = this.ctx.handed() === 'left';
    for (const b of this.bowlers) b.anim.mirror = left;
    this.hud.relabel();
    this.scoreboard.render(this.rows(), this.cur);
  }

  onTuning(key: string): void { if (key === 'oilFriction' || key === 'dryFriction') this.lane.syncTuning(); }
  toggleScores(): void { if (!this.practice) this.scoreboard.toggle(); }

  resize(w: number, h: number): void { this.rig.resize(w, h); }

  dispose(): void {
    const { swing } = this.ctx;
    swing.onThrow = null; swing.onPhase = null; swing.enabled = false;
    sfx.stopLoops();
    for (const b of this.bowlers) b.rig.dispose();
    this.effects.dispose();
    this.hud.dispose();
    this.scoreboard.dispose();
    this.pins.dispose();
    this.ball.dispose();
    this.lane.dispose();
    this.aimArrow.geometry.dispose();
    (this.aimArrow.material as THREE.Material).dispose();
    this.sun.shadow.map?.dispose();
    this.events.free();
    this.world.free();
  }

  /* ---------------- turn flow ---------------- */

  private rows() {
    return this.bowlers.map(b => ({ name: b.p.name, color: b.p.color, rolls: b.rolls, handicap: this.practice ? 0 : b.p.handicap }));
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
    const key = p === 'IDLE' ? 'hud.idle' : p === 'AIMING' ? 'hud.aiming' : p === 'SWING' ? 'hud.swing' : '';
    this.hud.setPhase(key ? t(key) : '');
  }

  private beginTurn(): void {
    const { swing } = this.ctx;
    const b = this.bowler;
    const nr = this.rules.next(b.rolls);
    if (nr.resetPins) this.pins.rack(); else this.pins.settleStanding();
    this.standingBefore = this.pins.standingCount();
    this.frameAtThrow = nr.frame;
    this.ball.setColor(b.p.color);
    this.effects.setTrailColor(b.p.color);
    this.effects.clearTrail();
    this.pending = null;
    this.impactT = -1;
    this.slowDone = false;
    this.scale = 1;
    // Everyone else waits by the seats; the bowler steps up to the approach.
    this.bowlers.forEach((o, i) => {
      if (i === this.cur) return;
      o.rig.root.position.copy(o.home);
      if (o.reactT <= 0) o.anim.play('idle');
    });
    this.aimSmooth = swing.aimX;
    this.placeBowler(swing.aimX, true);
    b.anim.play('hold', { blend: 0.25 });
    swing.cancel();
    swing.enabled = !this.paused;
    this.rig.setMode('aim');
    this.hud.setTurn(b.p.name, b.p.color, nr.frame, nr.ball, this.practice);
    this.scoreboard.render(this.rows(), this.cur);
    this.setPhase('IDLE');
    if (!this.firstTurnShown) { this.firstTurnShown = true; this.ctx.onFirstTurn(); }
  }

  private placeBowler(aimX: number, snap: boolean): void {
    const b = this.bowler;
    const handSide = this.ctx.handed() === 'left' ? -1 : 1;
    // With the Buddy turned to face -z, its right hand sits at -x; shift so the ball lines up with the aim.
    const x = THREE.MathUtils.clamp(aimX * this.spec.aimHalfWidth, -this.spec.halfW, this.spec.halfW) + 0.215 * handSide;
    if (snap) b.rig.root.position.set(x, 0, BUDDY_Z);
    else b.rig.root.position.x += (x - b.rig.root.position.x) * 0.25;
  }

  /** SwingDetector phase changes drive AIMING / SWING. */
  private onSwingPhase(p: SwingPhase): void {
    if (this.phase !== 'IDLE' && this.phase !== 'AIMING' && this.phase !== 'SWING') return;
    if (p === 'aiming') { this.setPhase('AIMING'); this.bowler.anim.play('aim', { blend: 0.15 }); }
    else if (p === 'backswing' || p === 'forward') { if (this.phase !== 'SWING') this.setPhase('SWING'); }
  }

  private onThrow(th: Throw): void {
    if (this.phase !== 'IDLE' && this.phase !== 'AIMING' && this.phase !== 'SWING') return;
    const { swing } = this.ctx;
    swing.enabled = false;
    this.pending = th;
    this.ball.squash();
    sfx.release();
    this.ctx.backend()?.rumble(0.35, 90);
    this.hud.showPower(th, this.practice);
    if (th.weak) this.hud.hint(t('hud.weak'), 4500);
    this.bowler.anim.play('throw', { blend: 0.06 });
    bus.emit('throwStart', { practice: this.practice });
    this.ctx.onThrown();
    this.setPhase('RELEASE');
  }

  /* ---------------- fixed-rate physics ---------------- */

  fixedStep(dt: number): void {
    if (this.paused) return;
    if (this.phase === 'RELEASE') {
      this.phaseT += dt;
      if (this.phaseT >= RELEASE_DELAY && this.pending) {
        this.ball.launch(this.pending);
        this.rollT = 0;
        this.rig.setMode('follow');
        this.setPhase('ROLLING');
      }
    }
    this.ball.physicsStep(dt);
    this.world.step(this.events);
    this.events.drainCollisionEvents((h1, h2, started) => { if (started) this.collision(h1, h2); });
    this.ball.snapshot();
    this.pins.snapshot();
    this.postPhysics(dt);
  }

  private postPhysics(dt: number): void {
    const S = this.spec;
    if (this.phase === 'ROLLING' || this.phase === 'SETTLE') this.rollT += dt;

    if (this.phase === 'ROLLING') {
      const p = this.ball.body.translation();
      const stopped = this.rollT > 1 && this.ball.speed() < 0.08;
      if (p.z < S.headZ + S.cam.follow.stopBeforeHead - 0.8 || this.ball.inPit || stopped) {
        this.rig.setMode('deck', true);          // hard cut to the pin-deck view
        this.stillT = 0;
        this.setPhase('SETTLE');
      }
    } else if (this.phase === 'SETTLE') {
      this.phaseT += dt;
      const p = this.ball.body.translation();
      const ballDone = this.ball.inPit || p.z < S.deckEndZ || this.ball.speed() < TUNING.settleSpeed * 3;
      if (ballDone && this.pins.maxSpeed() < TUNING.settleSpeed) this.stillT += dt; else this.stillT = 0;
      // early strike detection for the slow-motion: nearly everything tipping right after impact
      const full = this.standingBefore === this.pins.count;
      if (!this.slowDone && full && this.impactT >= 0 && this.rollT - this.impactT > 0.18 && this.pins.tippingCount() >= Math.ceil(this.pins.count * 0.9)) {
        this.slowDone = true;
        this.slowT = this.ctx.reducedMotion() ? 0 : TUNING.slowMoTime;
      }
      const settle = this.spec.kind === 'hundred' ? TUNING.settleTime * 0.8 : TUNING.settleTime;
      const timeout = this.spec.kind === 'hundred' ? TUNING.frameTimeout + 2 : TUNING.frameTimeout;
      if (this.stillT >= settle || this.rollT >= timeout) this.score();
    } else if (this.phase === 'SCORE') {
      this.phaseT += dt;
      if (this.phaseT >= this.scorePause()) this.advance();
    }
  }

  private scorePause(): number { return this.spec.kind === 'hundred' ? 2.4 : 2.0; }

  private collision(h1: number, h2: number): void {
    const ballHandle = this.ball.collider.handle;
    const p1 = this.pins.indexOf(h1), p2 = this.pins.indexOf(h2);
    if ((h1 === ballHandle && p2 >= 0) || (h2 === ballHandle && p1 >= 0)) {
      const v = this.ball.speed();
      this.pins.wobble(p1 >= 0 ? p1 : p2);
      if (this.impactT < 0) {
        this.impactT = this.rollT;
        this.rig.shake(v * TUNING.shakeGain * (this.spec.kind === 'hundred' ? 1.4 : 1));
        this.rig.zoomPunch(Math.min(1, v / 8));
        sfx.crash(v / 10, this.spec.kind === 'hundred');
        this.ctx.backend()?.rumble(Math.min(1, 0.3 + v / 10), 180);
        bus.emit('impact', { speed: v });
      } else sfx.knock(0.6);
    } else if (p1 >= 0 && p2 >= 0 && p1 !== p2) {
      const now = performance.now();
      // The 100-pin wall produces hundreds of contacts; rate-limit the knocks harder there.
      if (now - this.lastKnock > (this.pins.count > 10 ? 25 : 35)) { this.lastKnock = now; sfx.knock(0.8); this.pins.wobble(p1); this.pins.wobble(p2); }
    }
  }

  /* ---------------- scoring ---------------- */

  private score(): void {
    const b = this.bowler;
    const standingNow = this.pins.standingCount();
    const knocked = Math.max(0, Math.min(this.standingBefore, this.standingBefore - standingNow));
    const fullRack = this.standingBefore === this.pins.count;
    const strike = fullRack && standingNow === 0;
    const spare = !fullRack && standingNow === 0 && knocked > 0;
    const gutter = this.ball.inGutter;
    if (!this.practice) b.rolls.push(knocked);
    else b.rolls.push(0);                                   // practice counts balls only

    const st = b.stats;
    if (!this.practice) {
      st.pins += knocked;
      if (strike) { st.strikes++; b.streak++; st.bestStrikeStreak = Math.max(st.bestStrikeStreak, b.streak); }
      else b.streak = 0;
      if (spare) st.spares++;
      if (gutter) st.gutters++;
      if (strike && Math.abs(this.ball.releaseSpin) >= TUNING.maxSpin * HOOK_STRIKE) st.hookStrikes++;
    }

    const ev: RollEvent = {
      sport: 'bowling', mode: this.ctx.setup.mode, player: this.cur, profileId: b.p.profileId,
      pins: knocked, strike, spare, gutter, practice: this.practice
    };
    bus.emit('roll', ev);

    const deck = this.pins.centre();
    const others = this.bowlers.filter((_, i) => i !== this.cur);
    const pinWord = knocked === 1 ? t('fx.pin') : t('fx.pins');
    if (strike) {
      this.effects.bigText(t('fx.strike'), '', 'strike');
      this.effects.confetti(deck, this.pins.count > 10 ? 480 : 320, 1.2);
      this.effects.flash('#fff6c8', 0.8);
      sfx.strike();
      Crowd.cheer(1);
      this.ctx.backend()?.rumble(0.8, 300);
      b.anim.play('strike', { blend: 0.15 });
      for (const o of others) { o.anim.play('clap'); o.reactT = 2; }
      bus.emit('strike', ev);
    } else if (spare) {
      this.effects.bigText(t('fx.spare'), '', 'spare');
      this.effects.confetti(deck, 180, 0.9);
      this.effects.flash('#c8f6ff', 0.55);
      sfx.spare();
      Crowd.cheer(0.55);
      b.anim.play('spare', { blend: 0.15 });
      for (const o of others) { o.anim.play('clap'); o.reactT = 1.6; }
      bus.emit('spare', ev);
    } else if (knocked === 0) {
      this.effects.bigText(gutter ? t('fx.gutter') : t('fx.miss'), t('fx.next'), 'miss');
      sfx.gutterSad();
      Crowd.aww();
      b.anim.play(gutter ? 'gutterShrug' : 'shocked', { blend: 0.15 });
      if (gutter) bus.emit('gutter', ev);
    } else {
      // 100-Pin bonus callouts at 50+ and 80+ in a single ball
      const bonus = this.spec.kind === 'hundred' ? bonusFor(knocked) : null;
      if (bonus) {
        this.effects.bigText(t(bonus), `${knocked} ${pinWord}`, 'bonus');
        this.effects.confetti(deck, 260, 1);
        sfx.bonus();
        Crowd.cheer(knocked >= 80 ? 0.9 : 0.6);
        b.anim.play('spare', { blend: 0.15 });
      } else {
        this.effects.bigText(String(knocked), pinWord, 'normal');
        // So close: one pin left standing from a full ten-pin rack
        b.anim.play(fullRack && standingNow === 1 && this.pins.count === 10 ? 'shocked' : 'watch', { blend: 0.2 });
      }
    }
    this.pins.removeDown();
    this.scoreboard.render(this.rows(), this.cur);
    if (!this.practice) this.scoreboard.showFor(this.scorePause() * 1000);
    this.setPhase('SCORE');
  }

  private advance(): void {
    const nr = this.rules.next(this.bowler.rolls);
    if (nr.done || nr.frame !== this.frameAtThrow) {
      // frame finished: next player still bowling, or game over
      const n = this.bowlers.length;
      let next = -1;
      for (let k = 1; k <= n; k++) {
        const idx = (this.cur + k) % n;
        if (!this.rules.next(this.bowlers[idx].rolls).done) { next = idx; break; }
      }
      if (next < 0) { this.finish(); return; }
      if (next !== this.cur) {
        this.bowler.rig.root.position.copy(this.bowler.home);
        this.bowler.anim.play('idle');
      }
      this.cur = next;
      if (n > 1) this.hud.hint(t('hud.turn', { name: this.bowler.p.name }), 2200);
    }
    this.beginTurn();
  }

  private finish(): void {
    this.setPhase('DONE');
    this.ctx.swing.enabled = false;
    this.rig.setMode('intro');
    this.finishT = 1.2;
  }

  private summary(): MatchSummary {
    const players: PlayerResult[] = this.bowlers.map(b => {
      const score = this.rules.total(b.rolls);
      const handicap = b.p.handicap;
      return {
        name: b.p.name, color: b.p.color, profileId: b.p.profileId, buddy: b.p.buddy,
        score, handicap, total: score + handicap, rolls: [...b.rolls], stats: { ...b.stats }
      };
    });
    let winner = 0;
    players.forEach((p, i) => { if (p.total > players[winner].total) winner = i; });
    const per = this.bowlers.map(b => this.rules.perFrame(b.rolls));
    const history: number[][] = [];
    for (let f = 0; f < this.frames; f++) history.push(per.map(row => row[Math.min(f, row.length - 1)] ?? 0));
    return { sport: 'bowling', mode: this.ctx.setup.mode, practice: this.practice, frames: this.frames, players, winner, history };
  }

  /* ---------------- render-rate update ---------------- */

  frame(alpha: number, realDt: number): void {
    const { swing } = this.ctx;
    const dt = this.paused ? 0 : realDt;

    if (this.phase === 'INTRO') {
      this.phaseT += dt;
      if (this.phaseT >= INTRO_TIME) this.beginTurn();
    }
    if (this.finishT > 0) {
      this.finishT -= dt;
      if (this.finishT <= 0) this.ctx.onFinished(this.summary());
    }
    if (this.slowT > 0) {
      this.slowT -= dt;
      this.scale = this.slowT > 0 ? TUNING.slowMoScale : 1;
    }

    this.ball.mesh.visible = this.phase !== 'INTRO';
    this.ball.render(alpha, dt);
    this.pins.render(alpha, dt);

    // Buddies: reactions time out back to idle for the people waiting.
    this.bowlers.forEach((b, i) => {
      if (b.reactT > 0) { b.reactT -= dt; if (b.reactT <= 0 && i !== this.cur) b.anim.play('idle'); }
      b.anim.update(dt);
    });

    const aimX = swing.aimX;
    const b = this.bowler;
    if (this.holding && b) {
      this.aimSmooth += (aimX - this.aimSmooth) * Math.min(1, dt * 12);
      if (this.phase !== 'RELEASE') this.placeBowler(this.aimSmooth, false);
      // pendulum arm driven by the controller: positive = ball behind the player
      const angle = this.phase === 'IDLE' ? 0 : THREE.MathUtils.clamp(-swing.pitchRad, -1.4, 1.6);
      b.anim.setParam('swing', angle);
      b.rig.root.updateMatrixWorld(true);
      const hand = this.ctx.handed() === 'left' ? b.rig.joints.handL : b.rig.joints.handR;
      hand.getWorldPosition(this.tmp);
      hand.getWorldQuaternion(this.tmpQ);
      this.tmp.y = Math.max(TUNING.ballRadius, this.tmp.y - 0.06);
      if (this.phase !== 'RELEASE' || !this.ball.live) this.ball.hold(this.tmp, this.tmpQ);
    }
    this.aimArrow.visible = this.holding && this.phase !== 'RELEASE';
    this.aimArrow.position.x = THREE.MathUtils.clamp(aimX * this.spec.aimHalfWidth, -this.spec.halfW, this.spec.halfW);

    const rolling = this.phase === 'ROLLING' || this.phase === 'SETTLE';
    const p = this.ball.position;
    const onLane = rolling && this.ball.live && p.y > -0.05 && p.z > this.spec.deckEndZ && !this.ball.inGutter;
    if (!this.paused) {
      sfx.setRoll(onLane ? this.ball.speed() : 0);
      sfx.setGutter(rolling && this.ball.inGutter && p.z > this.spec.deckEndZ, this.ball.speed());
    }
    this.effects.trailPush(rolling && this.ball.live && p.z > this.spec.deckEndZ ? p : null, dt);
    this.rig.update(realDt, p, this.aimSmooth);
    this.hud.update(realDt);
    this.scoreboard.update(realDt);
    this.effects.update(dt);
  }
}

export const createBowlingScene: SceneFactory = async ctx => {
  await ensureRapier();
  return new BowlingScene(ctx);
};

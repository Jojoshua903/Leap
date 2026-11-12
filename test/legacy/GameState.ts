import * as THREE from 'three';
import type { PlayerInfo, Throw } from '../types';
import { TUNING } from '../tuning';
import type { Ball } from './Ball';
import type { Pins } from './Pins';
import type { CameraRig } from './Camera';
import type { Effects } from './Effects';
import type { Sfx } from '../audio/Sfx';
import type { Hud } from '../ui/Hud';
import type { Scoreboard, ScoreRow } from '../ui/Scoreboard';
import type { SwingDetector, SwingPhase } from '../input/SwingDetector';
import type { InputBackend } from '../input/InputBackend';
import { nextRoll } from './Scoring';
import { DECK_END_Z, HEAD_PIN_Z, HALF_W } from './dims';

/** IDLE → AIMING → SWING → RELEASE → ROLLING → SETTLE → SCORE, then the next ball (or DONE). */
export type Phase = 'IDLE' | 'AIMING' | 'SWING' | 'RELEASE' | 'ROLLING' | 'SETTLE' | 'SCORE' | 'DONE';

export interface GameDeps {
  ball: Ball;
  pins: Pins;
  camera: CameraRig;
  effects: Effects;
  sfx: Sfx;
  hud: Hud;
  scoreboard: Scoreboard;
  swing: SwingDetector;
  backend: () => InputBackend | null;
  aimArrow: THREE.Object3D;
}

const PHASE_TEXT: Partial<Record<Phase, string>> = {
  IDLE: 'Hold the trigger to pick up the ball',
  AIMING: 'Aim, then swing back…',
  SWING: '…and forward. Let go!'
};

const RELEASE_DELAY = 0.12;     // s between "let go" and the ball leaving the hand (squash plays here)
const SCORE_PAUSE = 2.0;        // s the result stays up before the next ball
const ARM = 0.7;                // m, shoulder to ball centre

export class GameState {
  phase: Phase = 'IDLE';
  players: ScoreRow[] = [];
  cur = 0;
  /** Physics time scale; < 1 during the strike slow-motion. */
  timeScale = 1;
  onGameOver: ((rows: ScoreRow[]) => void) | null = null;
  onFirstThrow: (() => void) | null = null;

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
  private readonly hand = new THREE.Vector3();
  private bob = 0;

  constructor(private readonly d: GameDeps) {}

  get player(): ScoreRow { return this.players[this.cur]; }
  get playing(): boolean { return this.players.length > 0 && this.phase !== 'DONE'; }

  start(players: PlayerInfo[]): void {
    this.players = players.map(p => ({ name: p.name, color: p.color, rolls: [] }));
    this.cur = 0;
    this.d.scoreboard.render(this.players, this.cur);
    this.beginTurn();
  }

  stop(): void {
    this.players = [];
    this.phase = 'DONE';
    this.d.swing.enabled = false;
    this.d.sfx.setRoll(0);
    this.d.sfx.setGutter(false);
    this.timeScale = 1;
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
    this.d.hud.setPhase(PHASE_TEXT[p] ?? '');
  }

  private beginTurn(): void {
    const { ball, pins, camera, effects, swing, hud } = this.d;
    const nr = nextRoll(this.player.rolls);
    if (nr.resetPins) pins.rack(); else pins.settleStanding();
    this.standingBefore = pins.standingCount();
    this.frameAtThrow = nr.frame;
    ball.setColor(this.player.color);
    effects.setTrailColor(this.player.color);
    effects.clearTrail();
    this.pending = null;
    this.impactT = -1;
    this.slowDone = false;
    this.timeScale = 1;
    swing.cancel();
    swing.enabled = true;
    camera.setMode('aim');
    hud.setTurn(this.player.name, this.player.color, nr.frame, nr.ball);
    this.d.scoreboard.render(this.players, this.cur);
    this.setPhase('IDLE');
  }

  /** SwingDetector phase changes drive AIMING / SWING. */
  onSwingPhase(p: SwingPhase): void {
    if (this.phase !== 'IDLE' && this.phase !== 'AIMING' && this.phase !== 'SWING') return;
    if (p === 'aiming') this.setPhase('AIMING');
    else if (p === 'backswing' || p === 'forward') { if (this.phase !== 'SWING') this.setPhase('SWING'); }
  }

  onThrow(t: Throw): void {
    if (this.phase !== 'IDLE' && this.phase !== 'AIMING' && this.phase !== 'SWING') return;
    const { swing, ball, sfx, hud } = this.d;
    swing.enabled = false;
    this.pending = t;
    ball.squash();
    sfx.release();
    this.d.backend()?.rumble(0.35, 90);
    hud.showPower(t);
    if (t.weak) hud.hint('Swing your arm back and then forward, and let go during the forward swing.', 4500);
    this.onFirstThrow?.();
    this.setPhase('RELEASE');
  }

  /** Fixed-rate logic, called before each world.step(). */
  prePhysics(dt: number): void {
    const { ball, camera } = this.d;
    if (this.phase === 'RELEASE') {
      this.phaseT += dt;
      if (this.phaseT >= RELEASE_DELAY && this.pending) {
        ball.launch(this.pending);
        this.rollT = 0;
        camera.setMode('follow');
        this.setPhase('ROLLING');
      }
    }
    ball.physicsStep(dt);
  }

  /** Fixed-rate logic, called after each world.step(). */
  postPhysics(dt: number): void {
    const { ball, pins, camera } = this.d;
    if (this.phase === 'ROLLING' || this.phase === 'SETTLE') this.rollT += dt;

    if (this.phase === 'ROLLING') {
      const p = ball.body.translation();
      const stopped = this.rollT > 1 && ball.speed() < 0.08;
      if (p.z < HEAD_PIN_Z + 2.4 || ball.inPit || stopped) {
        camera.setMode('deck', true);          // hard cut to the pin-deck view
        this.stillT = 0;
        this.setPhase('SETTLE');
      }
    } else if (this.phase === 'SETTLE') {
      this.phaseT += dt;
      const p = ball.body.translation();
      const ballDone = ball.inPit || p.z < DECK_END_Z || ball.speed() < TUNING.settleSpeed * 3;
      if (ballDone && pins.maxSpeed() < TUNING.settleSpeed) this.stillT += dt; else this.stillT = 0;
      // early strike detection for the slow-motion: nearly everything tipping right after impact
      if (!this.slowDone && this.impactT >= 0 && this.rollT - this.impactT > 0.18 && this.standingBefore === 10 && pins.tippingCount() >= 9) {
        this.slowDone = true;
        this.slowT = TUNING.slowMoTime;
      }
      if (this.stillT >= TUNING.settleTime || this.rollT >= TUNING.frameTimeout) this.score();
    } else if (this.phase === 'SCORE') {
      this.phaseT += dt;
      if (this.phaseT >= SCORE_PAUSE) this.advance();
    }
  }

  /** Rapier collision start events, routed from main.ts. */
  collision(h1: number, h2: number): void {
    const { ball, pins, camera, sfx } = this.d;
    const ballHandle = ball.collider.handle;
    const p1 = pins.indexOf(h1), p2 = pins.indexOf(h2);
    if ((h1 === ballHandle && p2 >= 0) || (h2 === ballHandle && p1 >= 0)) {
      const v = ball.speed();
      pins.wobble(p1 >= 0 ? p1 : p2);
      if (this.impactT < 0) {
        this.impactT = this.rollT;
        camera.shake(v * TUNING.shakeGain);
        camera.zoomPunch(Math.min(1, v / 8));
        sfx.crash(v / 10);
        this.d.backend()?.rumble(Math.min(1, 0.3 + v / 10), 180);
      } else sfx.knock(0.6);
    } else if (p1 >= 0 && p2 >= 0 && p1 !== p2) {
      const now = performance.now();
      if (now - this.lastKnock > 35) { this.lastKnock = now; sfx.knock(0.8); pins.wobble(p1); pins.wobble(p2); }
    }
  }

  private score(): void {
    const { pins, effects, sfx, scoreboard, ball } = this.d;
    const standingNow = pins.standingCount();
    const knocked = Math.max(0, Math.min(this.standingBefore, this.standingBefore - standingNow));
    this.player.rolls.push(knocked);
    const fullRack = this.standingBefore === 10;
    const deck = new THREE.Vector3(0, 0.4, HEAD_PIN_Z - 0.3);

    if (fullRack && knocked === 10) {
      effects.bigText('STRIKE!', '', 'strike');
      effects.confetti(deck, 320, 1.2);
      effects.flash('#fff6c8', 0.8);
      sfx.strike();
      this.d.backend()?.rumble(0.8, 300);
    } else if (!fullRack && standingNow === 0) {
      effects.bigText('SPARE!', '', 'spare');
      effects.confetti(deck, 180, 0.9);
      effects.flash('#c8f6ff', 0.55);
      sfx.spare();
    } else if (knocked === 0) {
      effects.bigText(ball.inGutter ? 'Gutter' : 'Miss', 'Next one!', 'miss');
      sfx.gutterSad();
    } else {
      effects.bigText(String(knocked), knocked === 1 ? 'pin' : 'pins', 'normal');
    }
    pins.removeDown();
    scoreboard.render(this.players, this.cur);
    scoreboard.showFor(SCORE_PAUSE * 1000);
    this.setPhase('SCORE');
  }

  private advance(): void {
    const nr = nextRoll(this.player.rolls);
    if (nr.done || nr.frame !== this.frameAtThrow) {
      // frame finished: next player still bowling, or game over
      const n = this.players.length;
      let next = -1;
      for (let k = 1; k <= n; k++) {
        const idx = (this.cur + k) % n;
        if (!nextRoll(this.players[idx].rolls).done) { next = idx; break; }
      }
      if (next < 0) {
        this.setPhase('DONE');
        this.d.swing.enabled = false;
        this.d.camera.setMode('menu');
        this.onGameOver?.(this.players);
        return;
      }
      this.cur = next;
      if (n > 1) this.d.hud.hint(`${this.player.name}'s turn`, 2200);
    }
    this.beginTurn();
  }

  /** Render-rate update: hand-held ball, aim arrow, sounds, trail, slow-mo timer, camera. */
  update(realDt: number): void {
    const { ball, swing, sfx, effects, camera, aimArrow, hud } = this.d;
    if (this.slowT > 0) {
      this.slowT -= realDt;
      this.timeScale = this.slowT > 0 ? TUNING.slowMoScale : 1;
    }

    const holding = this.phase === 'IDLE' || this.phase === 'AIMING' || this.phase === 'SWING' || this.phase === 'RELEASE';
    const aimX = swing.aimX;
    if (holding && this.players.length) {
      this.bob += realDt;
      // pendulum arm: positive angle = ball behind the player
      const angle = this.phase === 'IDLE' ? Math.sin(this.bob * 2) * 0.05 : THREE.MathUtils.clamp(-swing.pitchRad, -1.4, 1.6);
      const x = THREE.MathUtils.clamp(aimX * TUNING.aimLaneHalfWidth, -HALF_W, HALF_W);
      this.hand.set(x + 0.12, 0.95 - ARM * Math.cos(angle) + 0.25, 0.55 + ARM * Math.sin(angle));
      this.hand.y = Math.max(TUNING.ballRadius, this.hand.y);
      ball.hold(this.hand, angle);
    }
    aimArrow.visible = holding && this.phase !== 'RELEASE' && this.players.length > 0;
    aimArrow.position.x = THREE.MathUtils.clamp(aimX * TUNING.aimLaneHalfWidth, -HALF_W, HALF_W);

    const rolling = this.phase === 'ROLLING' || this.phase === 'SETTLE';
    const p = ball.position;
    const onLane = rolling && ball.live && p.y > -0.05 && p.z > DECK_END_Z && !ball.inGutter;
    sfx.setRoll(onLane ? ball.speed() : 0);
    sfx.setGutter(rolling && ball.inGutter && p.z > DECK_END_Z, ball.speed());
    effects.trailPush(rolling && ball.live && p.z > DECK_END_Z ? p : null);
    camera.update(realDt, p, aimX);
    hud.update(realDt);
    this.d.scoreboard.update(realDt);
  }
}

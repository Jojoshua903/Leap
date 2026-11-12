import * as THREE from 'three';
import type { MatchPlayer, MatchSummary, PlayerResult, SceneContext, SceneFactory } from '../sports/types';
import { bus } from '../core/events';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import { toon } from '../render/Toon';
import { BBBase } from './BBBase';
import { Baller, type JerseyStyle } from './Baller';
import { ensureRapier, type BBBall } from './BallPhysics';
import type { BallSkin } from './CourtScene';
import { ShotControl, type ReleaseInfo } from './ShotControl';
import { BB_TUNING } from './bbTuning';
import {
  BALLS_PER_RACK, CONTEST_TIME, ContestRound, RACK_MOVE_TIME, RACK_SPOTS, TOP_RACK, isMoneyBall, tiedForFirst, type ShotRecord
} from './ContestRules';
import { geometry, HOOP_CENTER, idealRateFor, isMake } from './ShotSolver';
import type { RackBall } from './bbHud';

type Phase = 'intro' | 'turnIntro' | 'shooting' | 'moving' | 'wrap' | 'done';

interface Shooter {
  p: MatchPlayer;
  baller: Baller;
  round: ContestRound | null;
  /** Sudden-death points, summed over tie-break rounds. */
  tiebreak: number;
  /** Swish flags in the order shots were decided, for swish streaks. */
  swishes: boolean[];
  buzzer: number;
  bench: THREE.Vector3;
}

interface Flight { rec: ShotRecord; shooter: number; decided: boolean; decidedAt: number; swish: boolean; info: ReleaseInfo; arc: number; high: boolean }

const FEED_DELAY = 0.55;
const INTRO_TIME = 2.2;
const TURN_INTRO = 3.2;
const WRAP_MAX = 3.5;

/**
 * 3-Point Contest: 5 racks × 5 balls around the arc (5th ball = money ball, 2 points), 60 seconds,
 * 1–4 players in turn (hot seat), sudden death on a tie. Practice: no clock, endless racks and the
 * shot values after each shot. Balls are fed automatically; the shooter walks to the next rack.
 */
class ThreePointScene extends BBBase {
  private readonly shooters: Shooter[] = [];
  private readonly practice: boolean;
  private readonly moneyRack: number | null;
  private readonly control: ShotControl;
  private phase: Phase = 'intro';
  private phaseT = 0;
  private cur = 0;
  private clock = CONTEST_TIME;
  private feedT = 0;
  private holding = false;
  private moveFrom = new THREE.Vector3();
  private moveTo = new THREE.Vector3();
  private flights = new Map<BBBall, Flight>();
  private slowAt = -1;
  private countdown = -1;
  private buzzed = false;
  /** Players still in the current tie-break (indexes), and how many tie-break rounds were played. */
  private tieQueue: number[] = [];
  private tieRound = 0;
  private inTiebreak = false;
  private readonly racks: THREE.Group[] = [];
  private readonly rackBalls: THREE.Mesh[][] = [];
  private readonly heldNormal: THREE.Mesh;
  private readonly heldMoney: THREE.Mesh;
  private readonly tmp = new THREE.Vector3();
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private finishedOnce = false;
  /** Bumped by restart / dispose so pending timers from an old round do nothing. */
  private epoch = 0;

  private later(ms: number, fn: () => void): void {
    const e = this.epoch;
    window.setTimeout(() => { if (e === this.epoch) fn(); }, ms);
  }

  constructor(ctx: SceneContext) {
    super(ctx, 3);
    this.practice = ctx.setup.practice;
    const money = ctx.setup.options.moneyRack === true;
    // the money rack is random but shown before the round
    this.moneyRack = money && !this.practice ? Math.floor(this.rng.next() * 5) : null;
    const c = ctx.setup.cosmetics ?? {};
    const skin = (c.hoopball as BallSkin) || 'classic';
    const jersey = (c.jersey as JerseyStyle) || 'home';
    const players = this.practice ? ctx.setup.players.slice(0, 1) : ctx.setup.players;
    players.forEach((p, i) => {
      const baller = new Baller(this.court.scene, p.buddy, { jersey, team: p.color, number: [7, 23, 11, 3][i % 4], left: i === 0 && ctx.handed() === 'left' });
      const bench = new THREE.Vector3(-8.6, 0, 2 + i * 1.3);
      baller.pos.copy(bench);
      baller.facing = Math.PI / 2;
      baller.anim.play('bbReady');
      this.shooters.push({ p, baller, round: null, tiebreak: 0, swishes: [], buzzer: 0, bench });
    });

    // ball racks: a little stand with five balls, the money rack in gold
    const standGeo = new THREE.BoxGeometry(0.75, 0.55, 0.32); this.geos.push(standGeo);
    RACK_SPOTS.forEach((s, ri) => {
      const g = new THREE.Group();
      const gold = ri === this.moneyRack;
      const m = toon(gold ? '#ffd23a' : '#3a4252'); this.mats.push(m);
      const stand = new THREE.Mesh(standGeo, m);
      stand.position.y = 0.275; stand.castShadow = true;
      g.add(stand);
      const balls: THREE.Mesh[] = [];
      for (let b = 0; b < BALLS_PER_RACK; b++) {
        const mesh = this.court.makeBallMesh(isMoneyBall(ri, b, this.moneyRack) ? 'money' : skin);
        mesh.position.set((b - 2) * 0.13, 0.55 + 0.12 + (b % 2) * 0.02, b % 2 ? 0.05 : -0.05);
        mesh.scale.setScalar(0.92);
        g.add(mesh);
        balls.push(mesh);
      }
      // face the stand toward the shooter's spot
      g.position.set(s.rackX, 0, s.rackZ);
      g.rotation.y = Math.atan2(s.x - s.rackX, s.z - s.rackZ) + Math.PI / 2;
      this.court.scene.add(g);
      this.racks.push(g);
      this.rackBalls.push(balls);
    });
    this.heldNormal = this.court.makeBallMesh(skin);
    this.heldMoney = this.court.makeBallMesh('money');
    this.heldNormal.visible = false; this.heldMoney.visible = false;
    this.court.scene.add(this.heldNormal, this.heldMoney);

    this.control = new ShotControl(ctx.swing, ctx.backend, {
      set: () => this.onSet(),
      unset: () => this.onUnset(),
      lift: at => this.onLift(at),
      release: r => this.onRelease(r)
    });
    this.hud.setKeys('bb.keys.contest');
    this.refreshSettings();
    this.setQuality(ctx.quality());
  }

  private get shooter(): Shooter { return this.shooters[this.cur]; }

  /* ---------------- flow ---------------- */

  start(): void {
    this.phase = 'intro';
    this.phaseT = 0;
    this.court.setCamera('intro', true);
    this.control.attach();
    this.control.ready = false;
    if (this.moneyRack !== null) this.hud.hint(t('bb.moneyRack', { rack: t(`bb.rack.${RACK_SPOTS[this.moneyRack].id}`) }), 3500);
    this.updateBoard();
  }

  private beginTurn(i: number, tiebreak: boolean): void {
    this.cur = i;
    const sh = this.shooter;
    sh.round = tiebreak
      ? new ContestRound({ moneyRack: null, racks: [TOP_RACK] })
      : new ContestRound({ moneyRack: this.moneyRack, practice: this.practice });
    this.resetRacks(tiebreak ? [TOP_RACK] : [0, 1, 2, 3, 4]);
    this.clock = tiebreak || this.practice ? Infinity : CONTEST_TIME;
    this.buzzed = false;
    this.feedT = 0;
    this.holding = false;
    for (const [i2, s] of this.shooters.entries()) {
      if (i2 === i) continue;
      s.baller.pos.copy(s.bench); s.baller.facing = Math.PI / 2; s.baller.anim.play('bbReady');
    }
    const spot = RACK_SPOTS[sh.round.rack];
    sh.baller.pos.set(spot.x, 0, spot.z);
    sh.baller.turnToward(HOOP_CENTER.x, HOOP_CENTER.z, 1, Infinity);
    sh.baller.anim.play('bbReady', { blend: 0.2 });
    this.court.focus.set(spot.x, 0, spot.z);
    this.court.setCamera('shoot', true);
    this.phase = 'turnIntro';
    this.phaseT = 0;
    this.countdown = 3;
    this.hud.call(tiebreak ? t('bb.suddenDeath', { name: sh.p.name }) : sh.p.name, 'big', 1.4);
    if (!this.practice) {
      const key = this.control.isMouse ? 'bb.hint.mouse' : 'bb.hint.motion';
      if (i === 0 || tiebreak) this.hud.hint(t(key), 4200);
    } else this.hud.hint(t(this.control.isMouse ? 'bb.hint.mouse' : 'bb.hint.motion'), 5000);
    this.setFire(false);
    this.updateBoard();
  }

  private resetRacks(active: number[]): void {
    this.rackBalls.forEach((balls, ri) => {
      const on = active.includes(ri);
      this.racks[ri].visible = on;
      for (const b of balls) b.visible = on;
    });
  }

  private go(): void {
    this.phase = 'shooting';
    this.feedT = 0.1;
    sfx.beep(true);
    this.hud.call(t('bb.go'), 'count', 0.7);
  }

  /** The shooter's round is over (clock or last ball): wait for the balls in the air, then move on. */
  private wrapUp(): void {
    if (this.phase === 'wrap' || this.phase === 'done') return;
    this.control.cancel();
    this.control.ready = false;
    this.holding = false;
    this.phase = 'wrap';
    this.phaseT = 0;
  }

  private afterTurn(): void {
    const sh = this.shooter;
    const r = sh.round!;
    if (this.inTiebreak) sh.tiebreak += r.score;
    sh.baller.anim.play(r.score >= (this.inTiebreak ? 4 : 18) ? 'bbCelebrate' : 'bbReady', { blend: 0.2 });
    // next player in this phase?
    if (this.inTiebreak) {
      const pos = this.tieQueue.indexOf(this.cur);
      if (pos >= 0 && pos < this.tieQueue.length - 1) { this.beginTurn(this.tieQueue[pos + 1], true); return; }
      const scores = this.tieQueue.map(i => this.shooters[i].tiebreak);
      const best = tiedForFirst(scores).map(k => this.tieQueue[k]);
      if (best.length > 1 && this.tieRound < 3) { this.startTiebreak(best); return; }
      this.finish(best[0]);
      return;
    }
    if (!this.practice && this.cur < this.shooters.length - 1) {
      this.hud.call(t('bb.turnScore', { name: sh.p.name, n: r.score }), 'score', 2);
      this.phase = 'done';                        // short pause before the next turn
      this.later(1800, () => this.beginTurn(this.cur + 1, false));
      return;
    }
    const scores = this.shooters.map(s => s.round?.score ?? 0);
    const tied = this.shooters.length > 1 ? tiedForFirst(scores) : [0];
    if (tied.length > 1) { this.startTiebreak(tied); return; }
    this.finish(tied[0]);
  }

  private startTiebreak(who: number[]): void {
    this.inTiebreak = true;
    this.tieRound += 1;
    this.tieQueue = who;
    for (const i of who) this.shooters[i].tiebreak = 0;
    this.hud.call(t('bb.tie'), 'big', 2);
    this.phase = 'done';
    this.later(2000, () => this.beginTurn(who[0], true));
  }

  private finish(winner: number): void {
    if (this.finishedOnce) return;
    this.finishedOnce = true;
    this.phase = 'done';
    this.control.detach();
    const w = this.shooters[winner];
    for (const [i, s] of this.shooters.entries()) s.baller.anim.play(i === winner ? 'bbCelebrate' : 'bbReady', { blend: 0.2 });
    this.effects.confetti(new THREE.Vector3(w.baller.pos.x, 1.6, w.baller.pos.z), 260, 1);
    Crowd.cheer(1);
    if (this.shooters.length > 1) bus.emit('gameWon', { sport: 'basketball', winner, score: this.shooters.map(s => s.round?.score ?? 0) });
    this.later(1600, () => this.ctx.onFinished(this.summary(winner)));
  }

  /* ---------------- shooting ---------------- */

  private nextIsMoney(): boolean { return this.shooter.round?.nextIsMoney ?? false; }

  private onSet(): void {
    if (!this.holding) return;
    const sh = this.shooter;
    sh.baller.anim.play('bbSet', { blend: 0.12 });
    this.previewArc(this.releasePoint(sh.baller.pos.x, sh.baller.pos.z));
  }

  private onUnset(): void {
    this.shooter.baller.anim.play('bbReady', { blend: 0.2 });
    this.previewArc(null);
  }

  private onLift(at: number | null): void {
    const b = this.shooter.baller;
    if (at === null) { b.anim.play('bbSet', { blend: 0.15 }); return; }
    b.jump(BB_TUNING.jumpApexMs / 1000, BB_TUNING.jumpHeight);
    b.anim.play('bbRise', { blend: 0.06, restart: true });
  }

  private onRelease(r: ReleaseInfo): void {
    const sh = this.shooter, round = sh.round;
    if (!this.holding || !round || (this.phase !== 'shooting')) return;
    const rec = round.take(this.clock);
    if (!rec) return;
    this.holding = false;
    this.previewArc(null);
    const b = sh.baller;
    if (r.mouse) b.jump(0.14, 0.14);
    b.anim.play('bbShoot', { blend: 0.04, restart: true });
    const from = this.releasePoint(b.pos.x, b.pos.z);
    this.recycle();
    const shot = this.launch(from, r.input, this.assist, 0, rec, r.grade);
    if (!shot) return;
    const { d } = geometry(from);
    this.flights.set(shot.ball, { rec, shooter: this.cur, decided: false, decidedAt: 0, swish: false, info: r, arc: shot.ideal.arcDeg, high: false });
    this.rackBalls[rec.rack][rec.ball].visible = false;
    bus.emit('shotReleased', { shooter: this.cur, team: 0, dist: d, value: rec.value, quality: shot.applied.quality });
    this.showGrade(r.grade, from);
    this.ctx.onThrown();
    // slow-mo close-up for a perfect swish and for buzzer beaters that are going in
    const makeIt = isMake(shot.predicted);
    const buzzer = this.clock <= 1 && this.clock > 0;
    if ((r.grade === 'perfect' && shot.predicted === 'swish') || (buzzer && makeIt)) this.slowAt = this.world.time + Math.max(0, shot.ideal.flightT - 0.38);
    this.feedT = FEED_DELAY;
    if (round.ballsLeft === 0) {
      if (!round.nextRack()) this.later(300, () => { if (this.phase === 'shooting') this.wrapUp(); });
      else this.startMove();
    }
    this.updateBoard();
  }

  /** All three balls busy: put away the one decided longest ago. */
  private recycle(): void {
    if (this.world.freeBall()) return;
    let oldest: BBBall | null = null, t = Infinity;
    for (const [ball, f] of this.flights) if (f.decided && f.decidedAt < t) { t = f.decidedAt; oldest = ball; }
    if (oldest) { oldest.hold(); this.court.setBall(oldest.index, null); this.flights.delete(oldest); }
  }

  private startMove(): void {
    const r = this.shooter.round!;
    this.phase = 'moving';
    this.phaseT = 0;
    this.holding = false;
    this.control.ready = false;
    const to = RACK_SPOTS[r.rack];
    this.moveFrom.copy(this.shooter.baller.pos);
    this.moveTo.set(to.x, 0, to.z);
    this.shooter.baller.anim.play('bbDribble', { blend: 0.2, params: { hand: 1, high: 1 } });
    sfx.squeak();
  }

  /** A shot was decided (made or missed). */
  private decide(f: Flight, made: boolean, swish: boolean): void {
    if (f.decided) return;
    f.decided = true;
    f.decidedAt = this.world.time;
    f.swish = made && swish;
    const sh = this.shooters[f.shooter], round = sh.round;
    if (!round) return;
    const perfectBefore = round.perfectRacks;
    const pts = round.resolve(f.rec, made);
    sh.swishes.push(f.swish);
    if (made) {
      if (f.rec.clock <= 1 && f.rec.clock > 0) sh.buzzer += 1;
      if (f.swish) bus.emit('swish', { shooter: f.shooter });
      bus.emit('basket', { points: pts, shooter: f.shooter, team: 0, swish: f.swish });
      sfx.bbMake(f.rec.money);
      if (f.rec.money) { this.hud.call(t('bb.money'), 'money', 1); Crowd.cheer(0.6); }
      else if (f.swish) this.hud.call(t('bb.swish'), 'make', 0.9);
      else this.hud.call(`+${pts || 1}`, 'make', 0.7);
      this.court.excite(f.rec.money ? 0.8 : 0.45);
      if (round.streak >= 3 && f.shooter === this.cur) this.setFire(true);
      if (round.perfectRacks > perfectBefore) { this.hud.call(t('bb.perfectRack'), 'money', 1.4); this.effects.confetti(new THREE.Vector3(0, 3.2, 0), 120, 0.7); }
    } else {
      bus.emit('miss', { shooter: f.shooter });
      if (f.shooter === this.cur) this.setFire(false);
      Crowd.ooh();
    }
    if (this.practice) this.practiceReadout(f, made);
    this.updateBoard();
  }

  private practiceReadout(f: Flight, made: boolean): void {
    const s = this.lastShot;
    const info = f.info;
    const power = info.mouse
      ? t('bb.pr.meter', { v: Math.round(info.power * 100), s: Math.round(info.sweet * 100) })
      : t('bb.pr.flick', { v: Math.round(info.power / idealRateFor(this.distOf(f)) * 100) });
    this.hud.practice([
      `${t('bb.pr.result')}: ${made ? (f.swish ? t('bb.swish') : t('bb.pr.made')) : t('bb.pr.missed')}`,
      `${t('bb.pr.angle')}: ${f.arc.toFixed(1)}°`,
      `${t('bb.pr.power')}: ${power}${s ? ` (${s.powerErr >= 0 ? '+' : ''}${(s.powerErr * 100).toFixed(1)} %)` : ''}`,
      `${t('bb.pr.aim')}: ${s ? `${s.dirErrDeg >= 0 ? '+' : ''}${s.dirErrDeg.toFixed(1)}°` : '–'}`,
      `${t('bb.pr.timing')}: ${info.mouse ? '–' : `${info.input.timingMs >= 0 ? '+' : ''}${info.input.timingMs.toFixed(0)} ms`} · ${t(`bb.grade.${info.grade}`)}`
    ]);
  }

  private distOf(f: Flight): number { const sp = RACK_SPOTS[f.rec.rack]; return Math.hypot(sp.x, sp.z); }

  protected onBasket(ball: BBBall, swish: boolean): void {
    const f = this.flights.get(ball);
    if (f) this.decide(f, true, swish);
  }

  protected afterStep(dt: number): void {
    const now = this.world.time;
    for (const [ball, f] of this.flights) {
      if (f.decided) {
        // let it bounce a while, then put it away
        if (now - f.decidedAt > 2.2) { ball.hold(); this.court.setBall(ball.index, null); this.flights.delete(ball); }
        continue;
      }
      const age = now - ball.releaseT;
      if (ball.cur.y > HOOP_CENTER.y) f.high = true;
      // missed: it came back down below the rim area after going up, or it is just taking too long
      const gone = (f.high && ball.cur.y < 1.4 && age > 0.5) || ball.touchedFloor || age > 4;
      if (gone) this.decide(f, false, false);
    }
    if (this.slowAt >= 0 && now >= this.slowAt) { this.slowAt = -1; this.slowMo('shoot'); }

    // the clock
    if (this.phase === 'shooting' || this.phase === 'moving') {
      if (Number.isFinite(this.clock)) {
        this.clock = Math.max(0, this.clock - dt);
        if (this.clock <= 0 && !this.buzzed) { this.buzzed = true; sfx.buzzer(); this.hud.call(t('bb.time'), 'big', 1.2); this.wrapUp(); }
      }
    }
  }

  /* ---------------- per frame ---------------- */

  protected frameMode(_alpha: number, dt: number, realDt: number): void {
    this.phaseT += realDt;
    this.control.tick(realDt);
    const sh = this.shooters[this.cur];
    switch (this.phase) {
      case 'intro':
        if (this.phaseT > INTRO_TIME) this.beginTurn(0, false);
        break;
      case 'turnIntro': {
        const left = TURN_INTRO - this.phaseT;
        const n = Math.ceil(left / 0.6);
        if (left < 1.8 && n !== this.countdown && n > 0) { this.countdown = n; this.hud.call(String(n), 'count', 0.5); sfx.beep(false); }
        if (left <= 0) this.go();
        break;
      }
      case 'shooting':
        if (!this.holding) {
          this.feedT -= dt;
          if (this.feedT <= 0 && sh.round && sh.round.ballsLeft > 0 && !sh.round.allTaken) {
            this.holding = true;
            if (sh.baller.anim.current !== 'bbSet') sh.baller.anim.play('bbReady', { blend: 0.15 });
          }
        }
        break;
      case 'moving': {
        const k = Math.min(1, this.phaseT / RACK_MOVE_TIME);
        const e = k * k * (3 - 2 * k);
        sh.baller.pos.lerpVectors(this.moveFrom, this.moveTo, e);
        sh.baller.turnToward(this.moveTo.x, this.moveTo.z, dt, 12);
        this.court.focus.lerp(this.moveTo, 1 - Math.exp(-realDt * 6));
        if (k >= 1) {
          sh.baller.turnToward(HOOP_CENTER.x, HOOP_CENTER.z, 1, Infinity);
          sh.baller.anim.play('bbReady', { blend: 0.15 });
          this.phase = 'shooting';
          this.feedT = 0.05;
          this.court.focus.copy(this.moveTo);
        }
        break;
      }
      case 'wrap': {
        const busy = [...this.flights.values()].some(f => !f.decided);
        if (!busy || this.phaseT > WRAP_MAX) {
          for (const f of this.flights.values()) if (!f.decided) f.decided = true;
          this.phase = 'done';
          this.afterTurn();
        }
        break;
      }
      default: break;
    }
    this.control.ready = this.phase === 'shooting' && this.holding;
    this.control.dist = sh ? Math.hypot(sh.baller.pos.x, sh.baller.pos.z) : 6.75;

    // aim arrow while set
    if (this.control.isSet && this.holding && sh) this.court.showArrow({ x: sh.baller.pos.x, y: 0, z: sh.baller.pos.z }, this.control.aimDeg, Math.abs(this.control.aimDeg) < 6);
    else this.court.showArrow(null);
    const m = this.control.meter;
    this.hud.meter(m.active ? m : null);

    // players + the ball in hand
    for (const s of this.shooters) s.baller.update(dt);
    this.heldNormal.visible = false; this.heldMoney.visible = false;
    if (sh && this.holding && (this.phase === 'shooting')) {
      const mesh = this.nextIsMoney() ? this.heldMoney : this.heldNormal;
      mesh.visible = true;
      sh.baller.ballAnchor(this.tmp, 0.18);
      mesh.position.copy(this.tmp);
    }
    if (sh && Number.isFinite(this.clock) && this.phase !== 'intro') this.updateClockOnly();
  }

  private lastClockShown = -1;
  private updateClockOnly(): void {
    const shown = this.clock >= 10 ? Math.ceil(this.clock) : Math.round(this.clock * 10) / 10;
    if (shown !== this.lastClockShown) { this.lastClockShown = shown; this.updateBoard(); }
  }

  private updateBoard(): void {
    const sh = this.shooters[this.cur];
    if (!sh) return;
    const r = sh.round;
    const balls: RackBall[] = [];
    if (r) {
      const rack = r.rack;
      const start = r.shots.length - (BALLS_PER_RACK - r.ballsLeft);
      for (let b = 0; b < BALLS_PER_RACK; b++) {
        if (b < BALLS_PER_RACK - r.ballsLeft) {
          const s = r.shots[start + b];
          balls.push(!s ? 'gone' : s.made === null ? 'gone' : s.made ? 'made' : 'missed');
        } else balls.push(isMoneyBall(rack, b, r.moneyRack) ? 'money' : 'ready');
      }
    }
    const nextName = !this.practice && !this.inTiebreak && this.cur < this.shooters.length - 1 ? t('bb.upNext', { name: this.shooters[this.cur + 1].p.name }) : undefined;
    this.hud.contest({
      name: sh.p.name, color: sh.p.color, score: this.practice ? (r?.makes ?? 0) : (r?.score ?? 0),
      clock: Number.isFinite(this.clock) ? this.clock : null,
      balls, rack: r ? r.rack : 0, streak: r?.streak ?? 0, next: nextName
    });
  }

  protected debugLines(): string[] {
    const r = this.shooter?.round;
    return [`contest    ${this.phase} · rack ${r ? r.rack + 1 : '–'} · ball ${r ? BALLS_PER_RACK - r.ballsLeft + 1 : '–'} · clock ${Number.isFinite(this.clock) ? this.clock.toFixed(1) : '∞'} · in air ${[...this.flights.values()].filter(f => !f.decided).length}`];
  }

  /* ---------------- results ---------------- */

  private summary(winner: number): MatchSummary {
    const players: PlayerResult[] = this.shooters.map(s => {
      const r = s.round!;
      let run = 0, swishStreaks = 0;
      for (const w of s.swishes) { run = w ? run + 1 : 0; if (run === 3) { swishStreaks += 1; run = 0; } }
      return {
        name: s.p.name, color: s.p.color, profileId: s.p.profileId, buddy: s.p.buddy,
        score: r.score, total: r.score, handicap: 0, rolls: [s.tiebreak],
        stats: {
          points: r.score, makes: r.makes, attempts: r.attempts, swishes: s.swishes.filter(Boolean).length,
          moneyMade: r.moneyMade, perfectRacks: r.perfectRacks, bestStreak: r.bestStreak, buzzer: s.buzzer,
          swishStreaks, tiebreak: s.tiebreak
        }
      };
    });
    return {
      sport: 'basketball', mode: 'threePoint', practice: this.practice, frames: 1, players,
      winner: this.practice ? -1 : winner, history: []
    };
  }

  restart(): void {
    this.epoch += 1;
    for (const b of this.world.balls) { b.hold(); this.court.setBall(b.index, null); }
    this.flights.clear();
    this.finishedOnce = false;
    this.inTiebreak = false; this.tieRound = 0; this.tieQueue = [];
    for (const s of this.shooters) { s.round = null; s.tiebreak = 0; s.swishes = []; s.buzzer = 0; }
    this.makes = 0; this.attempts = 0;
    this.control.attach();
    this.hud.practice(null);
    this.beginTurn(0, false);
  }

  dispose(): void {
    this.finishedOnce = true;
    this.epoch += 1;
    this.control.detach();
    for (const s of this.shooters) s.baller.dispose();
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    super.dispose();
  }
}

export const createThreePoint: SceneFactory = async ctx => {
  await ensureRapier();
  return new ThreePointScene(ctx);
};

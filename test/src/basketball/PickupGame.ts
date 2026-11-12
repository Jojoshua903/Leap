import * as THREE from 'three';
import type { MatchSummary, PlayerResult, SceneContext, SceneFactory } from '../sports/types';
import type { HoopGesture } from '../types';
import type { MouseBackend } from '../input/MouseBackend';
import { bus } from '../core/events';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import { FAV_COLORS, randomBuddy, type BuddyConfig } from '../buddy/BuddyConfig';
import { BBBase } from './BBBase';
import { Baller, type JerseyStyle } from './Baller';
import { ensureRapier, type BBBall } from './BallPhysics';
import { ShotControl, type ReleaseInfo } from './ShotControl';
import { BB_TUNING } from './bbTuning';
import { PickupSim, type SimPlayer, type SimShot } from './PickupSim';
import { shotQuality, type Difficulty } from './bbAI';
import type { Team } from './PickupRules';
import { HOOP_CENTER, predictOutcome, solveIdealShot, type ShotGrade, type V3 } from './ShotSolver';
import { BBReplayPlayer, BBReplayRecorder, type ReplayBody } from './bbReplay';

type Phase = 'intro' | 'play' | 'won' | 'replay' | 'done';

interface MyStats {
  myPoints: number; makes: number; attempts: number; swishes: number; steals: number; blocks: number; assists: number;
  streak: number; bestStreak: number; swishStreaks: number; swishRun: number;
}
const freshStats = (): MyStats => ({ myPoints: 0, makes: 0, attempts: 0, swishes: 0, steals: 0, blocks: 0, assists: 0, streak: 0, bestStreak: 0, swishStreaks: 0, swishRun: 0 });

interface Flight { shooter: number; human: boolean; grade: ShotGrade | null; decided: boolean }

const INTRO_TIME = 2.4;
const WON_HOLD = 1.4;
const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0]
};

/**
 * 3-on-3 Pickup: you control one Buddy on the home team (control switches automatically to the ball
 * handler on offence and to the defender on the ball on defence), with two AI teammates against three AI
 * opponents. PickupSim runs the game and the AI; Rapier flies the ball for shots and loose balls.
 * The game-winning basket is replayed at half speed.
 */
class PickupScene extends BBBase {
  private sim!: PickupSim;
  private readonly target: number;
  private readonly difficulty: Difficulty;
  private readonly ballers: Baller[] = [];
  private readonly control: ShotControl;
  private readonly homeColor: string;
  private readonly awayColor: string;
  private readonly awayBuddy: BuddyConfig;
  private phase: Phase = 'intro';
  private phaseT = 0;
  private me = 0;
  private lastHolder = -1;
  private passTarget = -1;
  private pickT = 0;
  private flight: Flight | null = null;
  private my: MyStats = freshStats();
  private slowAt = -1;
  private readonly prevAction: string[] = [];
  private readonly animKey: string[] = [];
  private readonly wasJump: boolean[] = [];
  private dribblePhase = 0;
  private boardKey = '';
  private readonly keys = new Set<string>();
  private prevLeft = false;
  private prevRight = false;
  private readonly recorder = new BBReplayRecorder();
  private replay: BBReplayPlayer | null = null;
  private finishedOnce = false;
  /** Bumped by restart / dispose so a pending results timer from an old game does nothing. */
  private epoch = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly onKeyDown = (e: KeyboardEvent): void => { this.keys.add(e.code); };
  private readonly onKeyUp = (e: KeyboardEvent): void => { this.keys.delete(e.code); };
  private readonly onBlur = (): void => { this.keys.clear(); };

  constructor(ctx: SceneContext) {
    super(ctx, 1);
    const o = ctx.setup.options;
    this.target = o.target === 21 ? 21 : 11;
    const d = o.difficulty;
    this.difficulty = d === 'easy' || d === 'hard' ? d : 'normal';
    const human = ctx.setup.players[0];
    this.homeColor = human.color;
    this.awayColor = human.color === FAV_COLORS[0] ? FAV_COLORS[8] : FAV_COLORS[0];
    const c = ctx.setup.cosmetics ?? {};
    const jersey = (c.jersey as JerseyStyle) || 'home';
    const rnd = (): number => this.rng.next();
    this.awayBuddy = randomBuddy(rnd);
    const numbers = [7, 23, 11, 3, 33, 9];
    for (let i = 0; i < 6; i++) {
      const home = i < 3;
      const buddy = i === 0 ? human.buddy : i === 3 ? this.awayBuddy : randomBuddy(rnd);
      this.ballers.push(new Baller(this.court.scene, buddy, {
        jersey: home ? jersey : jersey === 'stripes' ? 'retro' : 'stripes',
        team: home ? this.homeColor : this.awayColor,
        number: numbers[i],
        left: i === 0 && ctx.handed() === 'left'
      }));
      this.prevAction.push('idle'); this.animKey.push(''); this.wasJump.push(false);
    }
    this.control = new ShotControl(ctx.swing, ctx.backend, {
      set: () => this.onSet(),
      unset: () => this.onUnset(),
      lift: at => this.onLift(at),
      release: r => this.onRelease(r)
    });
    this.newSim();
    this.hud.setKeys('bb.keys.pickup');
    this.refreshSettings();
    this.setQuality(ctx.quality());
  }

  private get mine(): SimPlayer { return this.sim.players[this.me]; }

  /* ---------------- setup ---------------- */

  private newSim(): void {
    // a new seed per game, so a rematch isn't the same game again
    this.sim = new PickupSim({ target: this.target, difficulty: [this.difficulty, this.difficulty], seed: (this.seed + this.epoch * 7717) >>> 0, external: true, firstOffense: 0 });
    this.me = 0;
    this.sim.players[0].human = true;
    this.lastHolder = -1;
    this.flight = null;
    this.my = freshStats();
    this.recorder.reset();
    this.replay = null;
    this.boardKey = '';
    this.wire();
    this.syncBodies(true);
  }

  private wire(): void {
    const ev = this.sim.events;
    ev.shot = s => this.onSimShot(s);
    ev.deflect = (from, vel) => { this.world.balls[0].launch(from, vel, { x: 0, y: 0, z: 0 }, this.world.time); };
    ev.basket = e => {
      const f = this.flight;
      const swish = this.lastSwish;
      if (f) f.decided = true;
      if (!e.counted) {
        this.hud.call(t('bb.noClear'), 'miss', 1.3);
        sfx.error();
        return;
      }
      const human = this.sim.players[e.shooter].human || (f?.human ?? false);
      bus.emit('basket', { points: e.points, shooter: e.shooter, team: e.team, swish });
      if (swish) bus.emit('swish', { shooter: e.shooter });
      sfx.bbMake(e.points === 2);
      this.court.excite(e.team === 0 ? 0.6 : 0.3);
      if (e.team === 0) Crowd.cheer(e.points === 2 ? 0.7 : 0.45); else Crowd.aww();
      this.hud.call(swish ? t('bb.swish') : `+${e.points}`, e.team === 0 ? 'make' : 'miss', 1);
      if (human) {
        const m = this.my;
        m.myPoints += e.points; m.makes += 1; m.streak += 1; m.bestStreak = Math.max(m.bestStreak, m.streak);
        if (swish) { m.swishes += 1; m.swishRun += 1; if (m.swishRun === 3) { m.swishStreaks += 1; m.swishRun = 0; } } else m.swishRun = 0;
        if (m.streak >= 3) this.setFire(true);
      }
      if (e.assist !== null && e.team === 0 && this.passedByHuman === e.assist) this.my.assists += 1;
      if (e.winner !== null) this.gameOver(e.winner);
    };
    ev.steal = (by, from) => {
      bus.emit('steal', { by, from });
      sfx.whoosh();
      if (this.sim.players[by].human) { this.my.steals += 1; this.hud.call(t('bb.stealCall'), 'make', 1); }
      else if (this.sim.players[from].human) this.hud.call(t('bb.stolen'), 'miss', 1);
      this.control.cancel();
    };
    ev.block = (by, shooter) => {
      bus.emit('block', { by, shooter });
      sfx.thud();
      this.court.shake(0.2);
      Crowd.ooh();
      if (this.sim.players[by].human) { this.my.blocks += 1; this.hud.call(t('bb.blockCall'), 'make', 1); }
      else this.hud.call(t('bb.blocked'), 'miss', 1);
      if (this.flight) this.flight.decided = true;
    };
    ev.pass = (from, to) => {
      bus.emit('pass', { from, to });
      sfx.release();
      this.passedByHuman = this.sim.players[from].human ? from : -1;
    };
    ev.possession = (team, reason) => {
      bus.emit('possessionChange', { team, reason });
      if (reason === 'out') this.hud.call(t('bb.out'), 'big', 1);
    };
    ev.check = team => {
      sfx.beep(false);
      this.hud.call(t(team === 0 ? 'bb.checkYou' : 'bb.checkThem'), 'count', 0.9);
    };
    ev.rebound = () => sfx.bounce(1.5);
  }

  private passedByHuman = -1;
  private lastSwish = false;

  /* ---------------- flow ---------------- */

  start(): void {
    this.phase = 'intro';
    this.phaseT = 0;
    this.court.setCamera('intro', true);
    this.control.attach();
    this.control.ready = false;
    this.ctx.swing.onHoopGesture = g => this.onGesture(g);
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
    this.hud.call(t('bb.firstTo', { n: this.target }), 'big', 1.8);
    this.updateBoard();
  }

  private gameOver(winner: Team): void {
    if (this.phase !== 'play') return;
    this.phase = 'won';
    this.phaseT = 0;
    this.control.cancel();
    this.control.ready = false;
    const won = winner === 0;
    this.hud.call(t(won ? 'bb.youWin' : 'bb.youLose'), won ? 'money' : 'big', 2);
    if (won) { this.effects.confetti(new THREE.Vector3(0, 3, 1.5), 260, 1); Crowd.cheer(1); } else Crowd.aww();
    bus.emit('gameWon', { sport: 'basketball', winner, score: [...this.sim.rules.points] });
  }

  private startReplay(): void {
    const frames = this.recorder.take();
    this.replay = new BBReplayPlayer(frames, 0.5, 4);
    if (this.replay.done) { this.finish(); return; }
    this.phase = 'replay';
    this.phaseT = 0;
    this.world.balls[0].hold();
    this.court.setCamera('replay', true);
    this.hud.replay(true);
    for (let i = 0; i < 6; i++) this.animKey[i] = '';
  }

  private finish(): void {
    if (this.finishedOnce) return;
    this.finishedOnce = true;
    this.phase = 'done';
    this.hud.replay(false);
    this.court.setCamera('pickup');
    this.control.detach();
    const w = this.sim.rules.winner;
    this.ballers.forEach((b, i) => b.anim.play(w !== null && (i < 3) === (w === 0) ? 'bbCelebrate' : 'bbDisappointed', { blend: 0.2 }));
    const epoch = this.epoch;
    window.setTimeout(() => { if (epoch === this.epoch) this.ctx.onFinished(this.summary()); }, 900);
  }

  private skipReplay(): void { if (this.phase === 'replay' && this.replay) this.replay.skip(); }

  /* ---------------- control ---------------- */

  /** Auto-switch: the ball handler on offence, the defender on the ball on defence. */
  private updateControl(): void {
    const h = this.sim.holder();
    let want = this.me;
    if (h && h.team === 0) want = h.id;
    else if (h && h.team === 1 && h.id !== this.lastHolder) want = this.sim.man(h).id;
    this.lastHolder = h ? h.id : -1;
    if (want === this.me) return;
    const old = this.mine;
    old.human = false; old.moveX = 0; old.moveZ = 0; old.sprint = false;
    old.brain.reset();
    if (old.action === 'set') old.action = 'idle';
    this.control.cancel();
    this.me = want;
    this.mine.human = true;
    this.passTarget = -1;
  }

  private readMove(): void {
    const p = this.mine;
    let x = 0, y = 0;
    for (const [code, [dx, dy]] of Object.entries(MOVE_KEYS)) if (this.keys.has(code)) { x += dx; y += dy; }
    const st = this.ctx.swing.stick;
    if (Math.hypot(st[0], st[1]) > 0.18) { x += st[0]; y += st[1]; }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    // the camera looks at the hoop (−z): forward is −z, right is +x
    p.moveX = x; p.moveZ = -y;
    // the mouse reports Space and the right button as its A button, so it is not a sprint key there
    p.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || (!this.control.isMouse && this.ctx.swing.buttonA);
  }

  /** The highlighted pass target: picked with 1 / 2 (for 3 s), otherwise the most open teammate. */
  private updatePassTarget(dt: number): void {
    const p = this.mine;
    if (this.sim.holder() !== p) { this.passTarget = -1; return; }
    this.pickT = Math.max(0, this.pickT - dt);
    if (this.pickT > 0 && this.passTarget >= 0) return;
    let best = -1, bq = -1;
    for (const m of this.sim.teammates(p)) {
      const q = shotQuality(this.sim, m) + (this.sim.laneClear(p.x, p.z, m.x, m.z, 0) ? 0.3 : 0);
      if (q > bq) { bq = q; best = m.id; }
    }
    this.passTarget = best;
  }

  private pickTeammate(k: 0 | 1): void {
    const mates = this.sim.teammates(this.mine).sort((a, b) => a.id - b.id);
    const m = mates[k];
    if (!m) return;
    this.passTarget = m.id;
    this.pickT = 3;
    sfx.tick();
  }

  private doPass(): void {
    const p = this.mine;
    if (this.sim.holder() !== p || this.passTarget < 0) return;
    this.sim.pass(p, this.sim.players[this.passTarget]);
  }

  private doSteal(): void { if (this.mine.team !== this.sim.offense || this.sim.holder() === null) this.sim.steal(this.mine); }
  private doBlock(): void { if (this.sim.holder() !== this.mine) this.sim.block(this.mine); }

  private onGesture(g: HoopGesture): void {
    if (this.paused) return;
    if (this.phase === 'replay') { this.skipReplay(); return; }
    if (this.phase !== 'play' || this.sim.phase !== 'live') return;
    const holding = this.sim.holder() === this.mine;
    if (holding) {
      if (g.kind !== 'push') return;
      // a push turned clearly left / right passes to the teammate on that side
      if (Math.abs(g.yawDeg) > 12) {
        const mates = this.sim.teammates(this.mine).sort((a, b) => a.x - b.x);
        this.passTarget = (g.yawDeg > 0 ? mates[0] : mates[mates.length - 1]).id;
      }
      this.doPass();
      return;
    }
    if (g.kind === 'flickUp') this.doBlock();
    else if (g.kind === 'swipe') this.doSteal();
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.paused || e.repeat) return false;
    if (this.phase === 'replay') {
      if (e.key === 'Escape') return false;
      this.skipReplay();
      return true;
    }
    if (this.phase !== 'play') return false;
    switch (e.code) {
      case 'Digit1': this.pickTeammate(0); return true;
      case 'Digit2': this.pickTeammate(1); return true;
      case 'Space':
        e.preventDefault();
        if (this.sim.holder() === this.mine) this.doPass(); else this.doBlock();
        return true;
      case 'KeyE': this.doSteal(); return true;
      case 'KeyF': this.doBlock(); return true;
      default: return false;
    }
  }

  /** Mouse: right button passes on offence and swipes on defence; left blocks on defence. */
  private readMouseButtons(): void {
    if (!this.control.isMouse) return;
    const ptr = (this.ctx.backend() as MouseBackend | null)?.pointer;
    // MouseBackend's "right" is also true while Space is held; Space is handled in onKey
    const left = !!ptr?.left, right = !!ptr?.right && !this.keys.has('Space');
    const holding = this.sim.holder() === this.mine;
    if (this.phase === 'replay' && ((left && !this.prevLeft) || (right && !this.prevRight))) this.skipReplay();
    else if (this.phase === 'play' && this.sim.phase === 'live') {
      if (right && !this.prevRight) { if (holding) this.doPass(); else this.doSteal(); }
      if (left && !this.prevLeft && !holding) this.doBlock();
    }
    this.prevLeft = left; this.prevRight = right;
  }

  /* ---------------- shooting ---------------- */

  private onSet(): void {
    const p = this.mine;
    if (this.sim.holder() !== p || this.sim.phase !== 'live') return;
    this.sim.setShot(p);
    this.previewArc(this.releasePoint(p.x, p.z));
  }

  private onUnset(): void {
    const p = this.mine;
    if (p.action === 'set') p.action = 'idle';
    this.previewArc(null);
  }

  private onLift(at: number | null): void {
    const b = this.ballers[this.me];
    if (at === null) { b.anim.play('bbSet', { blend: 0.15 }); this.animKey[this.me] = 'bbSet'; return; }
    b.jump(BB_TUNING.jumpApexMs / 1000, BB_TUNING.jumpHeight);
    b.anim.play('bbRise', { blend: 0.06, restart: true });
    this.animKey[this.me] = 'bbRise';
  }

  private pendingGrade: ShotGrade | null = null;

  private onRelease(r: ReleaseInfo): void {
    const p = this.mine;
    this.previewArc(null);
    if (this.sim.holder() !== p) return;
    if (r.mouse) this.ballers[this.me].jump(0.14, 0.14);
    this.pendingGrade = r.grade;
    this.sim.shoot(p, r.input, this.assist);
    this.pendingGrade = null;
    this.ctx.onThrown();
  }

  /** Any shot (AI or you) left the hands: Rapier takes the ball. */
  private onSimShot(s: SimShot): void {
    const ball = this.world.balls[0];
    ball.launch(s.from, s.vel, s.spin, this.world.time);
    this.court.followTrail(0);
    if (s.blocked) return;
    const human = this.sim.players[s.shooter].human;
    this.flight = { shooter: s.shooter, human, grade: human ? this.pendingGrade : null, decided: false };
    this.lastSwish = false;
    const pr = predictOutcome(s.from, s.vel, HOOP_CENTER, 1 / 120, 4, true);
    const ideal = solveIdealShot(s.from);
    this.lastShot = {
      ideal: predictOutcome(s.from, ideal.vel, HOOP_CENTER, 1 / 120, 4, true).path ?? [],
      actual: pr.path ?? [], powerErr: s.input.powerErr, dirErrDeg: s.input.dirErrDeg, timingMs: s.input.timingMs,
      outcome: pr.outcome, grade: this.pendingGrade ?? 'good'
    };
    this.attempts += 1;
    sfx.release();
    const shooter = this.sim.players[s.shooter];
    bus.emit('shotReleased', { shooter: s.shooter, team: shooter.team, dist: this.sim.hoopDist(shooter), value: s.value, quality: 1 });
    if (human) {
      this.my.attempts += 1;
      if (this.pendingGrade) this.showGrade(this.pendingGrade, s.from);
      if (this.pendingGrade === 'perfect' && pr.outcome === 'swish') this.slowAt = this.world.time + Math.max(0, pr.t - 0.38);
    }
  }

  protected onBasket(_ball: BBBall, swish: boolean): void {
    this.lastSwish = swish;
    this.sim.externalBasket(swish);
  }

  /* ---------------- physics ---------------- */

  protected beforeStep(dt: number): void {
    if (this.phase !== 'play' && this.phase !== 'won') return;
    this.sim.step(dt);
    const b = this.sim.ball, rb = this.world.balls[0];
    if (b.state === 'shot' || b.state === 'loose') {
      if (!rb.live) rb.launch({ x: b.x, y: b.y, z: b.z }, { x: b.vx, y: b.vy, z: b.vz }, { x: 0, y: 0, z: 0 }, this.world.time);
    } else if (b.state !== 'dead' && rb.live) rb.hold();
  }

  protected afterStep(): void {
    const rb = this.world.balls[0];
    if (rb.live) this.sim.externalBall(rb.cur, rb.velocity);
    // a shot that came off without a basket or a block: a miss
    const f = this.flight;
    if (f && !f.decided && this.sim.ball.state !== 'shot') {
      f.decided = true;
      bus.emit('miss', { shooter: f.shooter });
      if (f.human) { this.my.streak = 0; this.my.swishRun = 0; this.setFire(false); }
      Crowd.ooh();
    }
    if (this.slowAt >= 0 && this.world.time >= this.slowAt) { this.slowAt = -1; this.slowMo('pickup'); }
    // keep recording a moment after the winner so the replay shows it drop through the net
    if (this.phase === 'play' || (this.phase === 'won' && this.phaseT < 0.9)) {
      const ball = this.sim.ball.state === 'held' || this.sim.ball.state === 'pass' ? null : (rb.live ? rb.cur : null);
      this.recorder.push(this.sim.time, ball ?? { x: this.sim.ball.x, y: this.sim.ball.y, z: this.sim.ball.z }, this.bodies());
    }
  }

  private bodies(): ReplayBody[] {
    return this.sim.players.map((p, i) => ({ x: p.x, z: p.z, facing: p.facing, anim: this.animKey[i] || 'bbReady', jump: p.jumpT >= 0 }));
  }

  /* ---------------- per frame ---------------- */

  protected frameMode(_alpha: number, dt: number, realDt: number): void {
    this.phaseT += realDt;
    this.control.tick(realDt);
    this.readMouseButtons();
    switch (this.phase) {
      case 'intro':
        if (this.phaseT > INTRO_TIME) {
          this.phase = 'play';
          this.court.setCamera('pickup');
          this.hud.hint(t(this.control.isMouse ? 'bb.hint.pickupMouse' : 'bb.hint.pickupMotion'), 5200);
          this.ctx.onFirstTurn();
        }
        break;
      case 'play':
        this.updateControl();
        this.readMove();
        this.updatePassTarget(realDt);
        break;
      case 'won':
        if (this.phaseT > WON_HOLD) this.startReplay();
        break;
      case 'replay':
        this.playReplay(realDt);
        return;
      default: break;
    }
    const me = this.mine;
    this.control.ready = this.phase === 'play' && this.sim.phase === 'live' && this.sim.holder() === me && me.action !== 'shoot';
    this.control.dist = this.sim.hoopDist(me);
    if (this.control.isSet && this.control.ready) this.court.showArrow({ x: me.x, y: 0, z: me.z }, this.control.aimDeg, Math.abs(this.control.aimDeg) < 6);
    else this.court.showArrow(null);
    const m = this.control.meter;
    this.hud.meter(m.active ? m : null);
    this.syncBodies(false, dt);
    this.placeBall(dt);
    this.updateBoard();
  }

  private syncBodies(snap: boolean, dt = 0): void {
    const sim = this.sim;
    sim.players.forEach((p, i) => {
      const b = this.ballers[i];
      b.pos.set(p.x, 0, p.z);
      b.facing = p.facing;
      if (snap) { b.anim.play('bbReady', { blend: 0 }); this.animKey[i] = 'bbReady'; this.prevAction[i] = 'idle'; }
      else this.syncAnim(p, b);
      const jumping = p.jumpT >= 0;
      if (jumping && !this.wasJump[i] && !b.airborne) b.jump(0.28, p.action === 'block' ? 0.55 : BB_TUNING.jumpHeight);
      this.wasJump[i] = jumping;
      const ring = i === this.me ? this.homeColor : i === this.passTarget ? '#ffffff' : null;
      b.setRing(ring, i === this.passTarget ? 1 : 0);
      b.update(dt);
    });
  }

  private syncAnim(p: SimPlayer, b: Baller): void {
    const i = p.id;
    if (p.action !== this.prevAction[i]) {
      this.prevAction[i] = p.action;
      const one: Partial<Record<string, [string, Record<string, number>?]>> = {
        set: ['bbSet'], shoot: ['bbShoot'], pass: ['bbPass'], steal: ['bbSteal', { dir: p.x > this.sim.ball.x ? -1 : 1 }],
        block: ['bbBlock'], celebrate: ['bbCelebrate'], sad: ['bbDisappointed']
      };
      const a = one[p.action];
      // the human's set is already showing (or rising)
      if (a && !(p.action === 'set' && this.animKey[i] === 'bbRise')) {
        b.anim.play(a[0], { blend: p.action === 'shoot' ? 0.04 : 0.1, restart: true, params: a[1] });
        this.animKey[i] = a[0];
        return;
      }
    }
    if (p.action !== 'idle') return;
    const holder = this.sim.holder() === p;
    const want = holder ? 'bbDribble' : p.team !== this.sim.offense && this.sim.phase === 'live' ? 'bbDefend' : 'bbReady';
    if (this.animKey[i] === want) return;
    this.animKey[i] = want;
    b.anim.play(want, { blend: 0.2, params: holder ? { hand: 1, high: Math.hypot(p.vx, p.vz) > 3 ? 1 : 0 } : undefined });
  }

  /** The ball when Rapier doesn't have it: dribbled, held for a shot, or on a pass. */
  private placeBall(dt: number): void {
    const b = this.sim.ball, rb = this.world.balls[0];
    if (rb.live) { this.court.ballFocus.lerp(this.tmp.set(rb.cur.x, 1, rb.cur.z), 1 - Math.exp(-dt * 4)); return; }
    let pos: V3;
    if (b.state === 'held') {
      const h = this.sim.players[b.holder], baller = this.ballers[b.holder];
      if (h.action === 'set' || h.action === 'shoot') pos = baller.ballAnchor(this.tmp, 0.18);
      else {
        const moving = Math.hypot(h.vx, h.vz);
        const before = Math.cos(this.dribblePhase);
        this.dribblePhase += dt * (moving > 0.5 ? 9 : 6.5);
        const after = Math.cos(this.dribblePhase);
        if (Math.sign(before) !== Math.sign(after) && after < before && this.sim.phase === 'live') sfx.bounce(b.holder === this.me ? 1.4 : 0.9);
        baller.hand(1, this.tmp);
        const top = Math.max(0.5, this.tmp.y - 0.08);
        pos = { x: this.tmp.x + Math.sin(h.facing) * 0.12, y: 0.12 + (top - 0.12) * Math.abs(Math.sin(this.dribblePhase)), z: this.tmp.z + Math.cos(h.facing) * 0.12 };
      }
    } else pos = { x: b.x, y: b.y, z: b.z };
    this.court.setBall(0, pos);
    this.court.spinBall(0, dt * 6, 0);
    this.court.ballFocus.lerp(this.tmp.set(pos.x, 1, pos.z), 1 - Math.exp(-dt * 4));
  }

  private playReplay(realDt: number): void {
    const f = this.replay?.update(realDt) ?? null;
    if (!f) { this.finish(); return; }
    f.bodies.forEach((p, i) => {
      const b = this.ballers[i];
      b.pos.set(p.x, 0, p.z);
      b.facing = p.facing;
      if (p.anim !== this.animKey[i]) { this.animKey[i] = p.anim; b.anim.play(p.anim, { blend: 0.1, restart: true }); }
      // the bodies already update at half speed, so the jump keeps its normal length
      if (p.jump && !this.wasJump[i] && !b.airborne) b.jump(0.28, BB_TUNING.jumpHeight);
      this.wasJump[i] = p.jump;
      b.setRing(null);
      b.update(realDt * 0.5);
    });
    this.court.setBall(0, f.ball);
  }

  private updateBoard(): void {
    const r = this.sim.rules;
    const clear = !r.cleared && r.offense === 0 && this.sim.phase === 'live';
    const key = `${r.points[0]}-${r.points[1]}-${r.offense}-${clear}`;
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.hud.pickup({
      teams: [
        { name: t('bb.home', { name: this.ctx.setup.players[0].name }), color: this.homeColor, score: r.points[0] },
        { name: t('bb.away'), color: this.awayColor, score: r.points[1] }
      ],
      target: this.target, offense: r.offense, clear
    });
  }

  protected debugLines(): string[] {
    const sim = this.sim;
    const lines = [`pickup     ${this.phase}/${sim.phase} · ball ${sim.ball.state} · cleared ${sim.rules.cleared} · ${sim.rules.points.join('–')} · ${this.difficulty}`];
    for (const p of sim.players) lines.push(`  #${p.id} T${p.team} ${p.human ? 'YOU ' : ''}${p.brain.role}/${p.brain.state} · ${p.action}${p.jumpT >= 0 ? ' ↑' : ''}`);
    return lines;
  }

  /* ---------------- results ---------------- */

  private summary(): MatchSummary {
    const r = this.sim.rules;
    const [home, away] = r.points;
    const won = r.winner === 0;
    const human = this.ctx.setup.players[0];
    const m = this.my;
    const me: PlayerResult = {
      name: human.name, color: human.color, profileId: human.profileId, buddy: human.buddy,
      score: home, total: home, handicap: 0, rolls: [home, away],
      stats: {
        points: home, myPoints: m.myPoints, makes: m.makes, attempts: m.attempts, swishes: m.swishes,
        steals: m.steals, blocks: m.blocks, assists: m.assists, bestStreak: m.bestStreak, swishStreaks: m.swishStreaks,
        shutouts: won && away === 0 ? 1 : 0, target: this.target
      }
    };
    const them: PlayerResult = {
      name: t('bb.away'), color: this.awayColor, profileId: null, buddy: this.awayBuddy,
      score: away, total: away, handicap: 0, rolls: [away, home], stats: { points: away }
    };
    return { sport: 'basketball', mode: 'pickup', practice: false, frames: 1, players: [me, them], winner: r.winner ?? -1, history: [] };
  }

  restart(): void {
    this.epoch += 1;
    this.finishedOnce = false;
    this.slowAt = -1;
    this.passedByHuman = -1;
    for (const b of this.world.balls) { b.hold(); this.court.setBall(b.index, null); }
    this.makes = 0; this.attempts = 0;
    this.setFire(false);
    this.hud.replay(false);
    this.newSim();
    this.control.attach();
    this.phase = 'play';
    this.phaseT = 0;
    this.court.setCamera('pickup', true);
    this.updateBoard();
  }

  dispose(): void {
    this.finishedOnce = true;
    this.epoch += 1;
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    this.ctx.swing.onHoopGesture = null;
    this.control.detach();
    for (const b of this.ballers) b.dispose();
    super.dispose();
  }
}

export const createPickup: SceneFactory = async ctx => {
  await ensureRapier();
  return new PickupScene(ctx);
};

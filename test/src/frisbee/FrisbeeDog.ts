import * as THREE from 'three';
import type { MatchPlayer, MatchSummary, PlayerResult, SceneContext, SceneFactory } from '../sports/types';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import { DISC_TYPES } from './frisbeeTuning';
import { Wind, flatDist, simulateFlight, type DiscEvent, type V3 } from './DiscPhysics';
import type { ThrowParams } from './ThrowMapper';
import { DOG_BREEDS, DogAI, type DogBreedId, type DogState, type DiscView } from './DogAI';
import { DOG_SCORING, DogRound, zoneAt, type CatchInfo, type ThrowRecord } from './dogScoring';
import { BEACH_LOOK, DogField, DogModel } from './DogFieldScene';
import { DiscMesh, FBBase, FBPlayer, ThrowControl, type DiscSkin, type TrailStyle } from './FBBase';
import type { Terrain } from './Terrain';

type Phase = 'intro' | 'turn' | 'aim' | 'flight' | 'wait' | 'done';

interface Thrower { p: MatchPlayer; fb: FBPlayer; round: DogRound }

const INTRO_TIME = 2.6;
const TURN_TIME = 1.4;
/** Seconds after the dog drops the disc before the next throw is ready. */
const NEXT_DELAY = 2;
/** A throw not decided after this long is a miss; 20 s later the disc is brought back without the dog. */
const FLIGHT_MAX = 40;
const THROW_SPOT = new THREE.Vector3(0, 0, 0);

/**
 * Frisbee Dog: throw, the dog chases and tries to catch. 10 throws per player (hot seat, 1–4 players,
 * one player's full round after the other), scored by dogScoring.ts. Camera: behind the thrower →
 * following the disc → a side view in 0.4× slow motion when the dog leaps. Practice: endless throws
 * with a read-out of the throw and the catch.
 */
class FrisbeeDogScene extends FBBase {
  protected ground: Terrain;
  private readonly field: DogField;
  private readonly dog: DogAI;
  private readonly dogModel: DogModel;
  private readonly control: ThrowControl;
  private readonly throwers: Thrower[] = [];
  private readonly practice: boolean;
  private phase: Phase = 'intro';
  private phaseT = 0;
  private cur = 0;
  private resolved = false;
  private flightT = 0;
  private origin: V3 = { x: 0, y: 0, z: 0 };
  private lastState: DogState = 'idle';
  private wasCarrying = false;
  private sideAt = new THREE.Vector3();
  private sideT = 0;
  private lastRec: ThrowRecord | null = null;
  private readonly tmp = new THREE.Vector3();
  private finishedOnce = false;
  private epoch = 0;

  private later(ms: number, fn: () => void): void {
    const e = this.epoch;
    window.setTimeout(() => { if (e === this.epoch) fn(); }, ms);
  }

  constructor(ctx: SceneContext) {
    super(ctx, BEACH_LOOK);
    this.practice = ctx.setup.practice;
    this.field = new DogField(this.scene, ctx.quality(), this.seed);
    this.ground = this.field.ground;
    const c = ctx.setup.cosmetics ?? {};
    const breedId = (c.dog in DOG_BREEDS ? c.dog : 'mutt') as DogBreedId;
    this.discMesh = new DiscMesh(this.scene, (c.disc as DiscSkin) || 'classic', (c.discTrail as TrailStyle) || 'classic');
    this.dog = new DogAI(DOG_BREEDS[breedId], this.seed + 5);
    this.dogModel = new DogModel(this.scene, DOG_BREEDS[breedId]);
    // a light sea breeze: mostly across the field, never strong
    const dir = (60 + this.rng.next() * 60) * (this.rng.next() < 0.5 ? 1 : -1);
    this.wind = Wind.from(dir, 0.6 + this.rng.next() * 2.4, 0.3, this.seed + 3);
    this.setSunOffset(...BEACH_LOOK.sunDir);

    const players = this.practice ? ctx.setup.players.slice(0, 1) : ctx.setup.players;
    players.forEach((p, i) => {
      const fb = new FBPlayer(this.scene, p.buddy, i === 0 && ctx.handed() === 'left');
      this.throwers.push({ p, fb, round: new DogRound(this.practice) });
    });

    this.control = new ThrowControl(ctx.swing, ctx.backend, ctx.handed, {
      grip: held => this.onGrip(held),
      release: p => this.onRelease(p)
    }, this.seed + 9);
    this.control.disc = DISC_TYPES.dog;
    this.hud.setKeys('fb.keys.dog');
    this.refreshSettings();
    this.setQuality(ctx.quality());
    this.dog.reset(THROW_SPOT);
  }

  private get thrower(): Thrower { return this.throwers[this.cur]; }

  /* ---------------- flow ---------------- */

  start(): void {
    this.phase = 'intro';
    this.phaseT = 0;
    this.cam = 'overview';
    this.camPos.set(16, 10, 12); this.wantPos.copy(this.camPos);
    this.camLook.set(0, 0, -30); this.wantLook.copy(this.camLook);
    this.control.attach();
    this.control.ready = false;
    this.placeThrowers();
    this.updateBoard();
    this.ctx.onFirstTurn();
  }

  /** The current thrower on the mat, the others waiting to the side. */
  private placeThrowers(): void {
    let k = 0;
    for (const [i, th] of this.throwers.entries()) {
      if (i === this.cur) { th.fb.pos.copy(THROW_SPOT); th.fb.facing = 0; continue; }
      th.fb.pos.set(-3 - k * 1.2, 0, 2.2);
      th.fb.facing = 0.4;
      th.fb.anim.play('fbReady', { blend: 0.2 });
      k += 1;
    }
  }

  private beginTurn(i: number): void {
    this.cur = i;
    this.placeThrowers();
    this.dog.reset(THROW_SPOT);
    this.phase = 'turn';
    this.phaseT = 0;
    this.thrower.fb.anim.play('fbReady', { blend: 0.2 });
    if (this.throwers.length > 1 || i === 0) this.hud.call(this.thrower.p.name, 'big', 1.3);
    this.updateBoard();
  }

  private readyThrow(): void {
    this.phase = 'aim';
    this.phaseT = 0;
    this.resolved = false;
    this.cam = 'aim';
    this.camRate = 4;
    this.control.ready = true;
    this.disc.hold({ x: 0, y: 1, z: 0 });
    this.discMesh.clearTrail();
    this.thrower.fb.anim.play('fbReady', { blend: 0.2 });
    const first = this.thrower.round.throws.length === 0;
    if (first || this.practice) this.hud.hint(t(this.control.isMouse ? 'fb.hint.mouse' : 'fb.hint.motion'), first ? 4500 : 2500);
    this.updateBoard();
  }

  /** After the dog brought the disc back (or the throw was called off). */
  private afterThrow(): void {
    const th = this.thrower;
    if (!th.round.done) { this.readyThrow(); return; }
    th.fb.anim.play(th.round.score >= 500 ? 'fbCelebrate' : 'fbReady', { blend: 0.2 });
    this.hud.call(t('fb.dog.roundScore', { name: th.p.name, n: th.round.score }), 'score', 2.2);
    if (this.cur < this.throwers.length - 1) {
      this.phase = 'done';
      this.later(2200, () => this.beginTurn(this.cur + 1));
      return;
    }
    this.finish();
  }

  private finish(): void {
    if (this.finishedOnce) return;
    this.finishedOnce = true;
    this.phase = 'done';
    this.control.detach();
    const scores = this.throwers.map(s => s.round.score);
    const top = Math.max(...scores);
    const winner = scores.indexOf(top);
    for (const [i, s] of this.throwers.entries()) s.fb.anim.play(scores[i] === top ? 'fbCelebrate' : 'fbDisappointed', { blend: 0.2 });
    const w = this.throwers[winner].fb;
    this.effects.confetti(new THREE.Vector3(w.pos.x, 1.6, w.pos.z), 220, 1);
    Crowd.cheer(0.8);
    this.later(1800, () => this.ctx.onFinished(this.summary(winner)));
  }

  /* ---------------- throwing ---------------- */

  private onGrip(held: boolean): void {
    if (this.phase !== 'aim') return;
    this.thrower.fb.anim.play(held ? 'fbGrip' : 'fbReady', { blend: 0.12, params: { fh: 0, putt: 0 } });
  }

  private onRelease(p: ThrowParams): void {
    if (this.phase !== 'aim') return;
    this.control.ready = false;
    const fb = this.thrower.fb;
    fb.anim.play(p.forehand ? 'fbForehand' : 'fbBackhand', { blend: 0.04, restart: true });
    // release point: a little in front of the chest, on the throwing side
    const side = fb.anim.mirror ? -1 : 1;
    const from: V3 = { x: fb.pos.x + (p.forehand ? 0.35 : 0.1) * side, y: 1.05, z: fb.pos.z - 0.45 };
    this.origin = { x: fb.pos.x, y: 0, z: fb.pos.z };
    const l = this.throwDisc(p, from, 0, DISC_TYPES.dog);
    // the dog "reads" the same flight (same seed, same wind) and reacts after its reaction time
    const pred = simulateFlight(l, DISC_TYPES.dog, { wind: this.wind, ground: this.ground, seed: this.flightSeed(), maxT: 12 });
    this.dog.throwStarted(pred);
    this.phase = 'flight';
    this.phaseT = 0;
    this.flightT = 0;
    this.cam = 'follow';
    this.camRate = 3;
    this.hud.practice(null);
    if (Math.random() < 0.6) this.later(250, () => sfx.bark());
  }

  /* ---------------- physics ---------------- */

  protected onDiscEvent(e: DiscEvent): void {
    if (e.kind === 'water') this.hud.call(t('fb.splash'), 'water', 1.2);
  }

  protected stepExtra(dt: number): void {
    const d = this.disc;
    const flying = this.phase === 'flight';
    const view: DiscView | null = flying ? { pos: d.pos, phase: d.phase, landed: d.landed, t: d.t, speed: d.speed, wobble: d.wobble } : null;
    const ev = this.dog.update(dt, view);
    if (this.dog.state === 'jump' && this.lastState !== 'jump' && flying) {
      // a leap: side view, slow motion through the catch
      this.sideAt.set(this.dog.pos.x, 0, this.dog.pos.z);
      this.cam = 'side';
      this.sideT = 1.4;
      this.slowMo(1.1);
    }
    this.lastState = this.dog.state;
    if (this.dog.carrying) { const m = this.dog.mouth; d.hold(m); this.wasCarrying = true; }
    else if (this.wasCarrying) {
      // dropped at the thrower's feet: put it on the ground instead of leaving it at mouth height
      this.wasCarrying = false;
      d.hold({ x: d.pos.x, y: this.ground.height(d.pos.x, d.pos.z) + 0.012, z: d.pos.z });
    }
    if (flying) {
      this.flightT += dt;
      if (!this.resolved && this.flightT > FLIGHT_MAX) this.resolve({ caught: false, distance: 0, midAir: false, leap: false, zone: null });
      if (this.flightT > FLIGHT_MAX + 20) this.callOff();
    }
    if (!ev) return;
    switch (ev.kind) {
      case 'catch': {
        const dist = flatDist(this.origin, ev.at);
        this.resolve({ caught: true, distance: dist, midAir: ev.midAir, leap: ev.leap, zone: zoneAt(ev.at.x, ev.at.z) });
        sfx.catchThump();
        if (ev.midAir) Crowd.cheer(ev.leap ? 0.8 : 0.5);
        if (ev.midAir && this.cam !== 'side') { this.sideAt.set(ev.at.x, 0, ev.at.z); this.cam = 'side'; this.sideT = 0.9; this.slowMo(0.6); }
        break;
      }
      case 'fumble':
        this.hud.call(t('fb.dog.fumble'), 'miss', 0.8);
        break;
      case 'miss':
        this.resolve({ caught: false, distance: flatDist(this.origin, d.pos), midAir: false, leap: false, zone: null });
        Crowd.aww();
        break;
      case 'pickup':
        sfx.bark();
        break;
      case 'returned':
        sfx.pant();
        this.phase = 'wait';
        this.phaseT = 0;
        this.disc.hold({ x: 0, y: 1, z: 0 });
        break;
    }
  }

  /** The throw is decided: score it, call it, update the board. */
  private resolve(c: CatchInfo): void {
    if (this.resolved) return;
    this.resolved = true;
    const th = this.thrower;
    const rec = th.round.record(c);
    this.lastRec = rec;
    if (c.caught) {
      const tag = c.leap ? t('fb.dog.leap') : c.midAir ? t('fb.dog.midAir') : t('fb.dog.catch');
      this.hud.call(this.practice ? tag : `${tag} +${rec.score.points}`, c.leap || (c.zone?.mult ?? 1) >= 3 ? 'big' : 'catch', 1.6);
      this.hud.distance(`${c.distance.toFixed(1)} m${c.zone ? ` · ${t(`fb.zone.${c.zone.id}`)} ×${c.zone.mult}` : ''}`, 2.6);
      th.fb.anim.play('fbCelebrate', { blend: 0.15 });
      if (th.round.streak > 0 && th.round.streak % 5 === 0) this.hud.hint(t('fb.dog.streak', { n: th.round.streak }), 2000);
    } else {
      this.hud.call(t('fb.dog.miss'), 'miss', 1.2);
      th.fb.anim.play('fbDisappointed', { blend: 0.15 });
    }
    if (this.practice) this.practiceReadout(rec);
    this.updateBoard();
  }

  /** Disc lost (e.g. far into the dunes): bring it back without the dog. */
  private callOff(): void {
    this.dog.reset(THROW_SPOT);
    this.phase = 'wait';
    this.phaseT = 0;
    this.disc.hold({ x: 0, y: 1, z: 0 });
  }

  private practiceReadout(rec: ThrowRecord): void {
    const p = this.lastThrow;
    if (!p) return;
    const sgn = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
    this.hud.practice([
      `${t('fb.pr.result')}: ${rec.caught ? (rec.leap ? t('fb.dog.leap') : rec.midAir ? t('fb.dog.midAir') : t('fb.dog.catch')) : t('fb.dog.miss')}`,
      `${t('fb.pr.distance')}: ${rec.distance.toFixed(1)} m${rec.zone ? ` (${t(`fb.zone.${rec.zone.id}`)})` : ''}`,
      `${t('fb.pr.speed')}: ${p.speed.toFixed(1)} m/s · ${t('fb.pr.spin')}: ${Math.abs(p.spin).toFixed(0)} rad/s`,
      `${t('fb.pr.dir')}: ${sgn(p.yawDeg)}° · ${t('fb.pr.loft')}: ${p.loftDeg.toFixed(1)}° · ${t('fb.pr.nose')}: ${sgn(p.noseDeg)}°`,
      `${t('fb.bank')}: ${sgn(p.bankDeg)}° · ${t('fb.pr.quality')}: ${Math.round(p.quality * 100)}% · ${p.forehand ? t('fb.forehand') : t('fb.backhand')}`,
      `${t('fb.pr.wouldScore')}: ${rec.caught ? new DogRound().record(rec).score.points : 0}`
    ]);
  }

  /* ---------------- per frame ---------------- */

  protected frameMode(dt: number, realDt: number): void {
    this.phaseT += realDt;
    this.control.tick();
    switch (this.phase) {
      case 'intro':
        // a slow pan over the field
        this.wantPos.set(16 - this.phaseT * 5, 8 - this.phaseT * 1.5, 12 - this.phaseT);
        if (this.phaseT > INTRO_TIME) this.beginTurn(0);
        break;
      case 'turn':
        if (this.phaseT > TURN_TIME) this.readyThrow();
        break;
      case 'wait':
        if (this.phaseT > NEXT_DELAY) this.afterThrow();
        break;
      default: break;
    }
    this.field.update(dt);
    for (const th of this.throwers) th.fb.update(dt, this.ground.height(th.fb.pos.x, th.fb.pos.z));
    const dg = this.dog;
    this.dogModel.update(dt, dg.pos.x, dg.pos.z, dg.heading, dg.speed, dg.jumpY, dg.state, this.ground.height(dg.pos.x, dg.pos.z));

    // the disc: in a hand, in the mouth, or flying
    const handPhase = this.phase === 'intro' || this.phase === 'turn' || this.phase === 'aim' || this.phase === 'wait';
    let held: THREE.Vector3 | null = null;
    if (dg.carrying) held = this.dogModel.mouthPos(this.tmp);
    else if (handPhase || (this.phase === 'done' && this.disc.phase === 'held')) held = this.thrower.fb.hand(this.tmp);
    this.discMesh.update(held ? null : this.disc, this.ground, dt, held, this.thrower.fb.facing);

    this.updateCamera(realDt);
    this.showWind();
    // HUD: live distance while the disc flies, mouse sliders while aiming
    if (this.phase === 'flight' && !this.resolved && this.disc.phase !== 'held') {
      const z = zoneAt(this.disc.pos.x, this.disc.pos.z);
      this.hud.distance(`${flatDist(this.origin, this.disc.pos).toFixed(1)} m${z ? ` · ${t(`fb.zone.${z.id}`)}` : ''}`, 0.3);
    }
    const mouseAim = this.control.isMouse && this.phase === 'aim';
    this.hud.slingSliders(mouseAim ? { bank: this.control.bank, nose: this.control.nose } : null);
    const pull = this.control.pull;
    this.hud.slingLineAt(pull ? pull.a : null, pull?.b, pull?.power ?? 0);
    this.hud.grip(this.phase === 'aim' && this.control.gripping, t('fb.grip'));
  }

  /** Camera targets per mode (the base lerps toward them). */
  private updateCamera(realDt: number): void {
    const d = this.disc, dg = this.dog;
    if (this.sideT > 0) { this.sideT -= realDt; if (this.sideT <= 0 && this.cam === 'side') this.cam = 'dog'; }
    switch (this.cam) {
      case 'aim': {
        const side = this.thrower.fb.anim.mirror ? -0.6 : 0.6;
        this.wantPos.set(side, 2.1, 4.4);
        this.wantLook.set(0, 1.2, -22);
        break;
      }
      case 'follow': {
        if (d.phase === 'held') { this.cam = 'dog'; break; }
        // behind and above the disc, toward the thrower
        this.wantPos.set(d.pos.x * 0.75, Math.max(2.4, d.pos.y + 1.6), d.pos.z + 8.5);
        this.wantLook.set(d.pos.x, d.pos.y, d.pos.z - 2);
        if (this.resolved && !d.flying) this.cam = 'dog';
        break;
      }
      case 'side':
        this.wantPos.set(this.sideAt.x + 7.5, 1.6, this.sideAt.z + 1.5);
        this.wantLook.set(dg.pos.x, 0.9 + dg.jumpY, dg.pos.z);
        this.camRate = 6;
        break;
      case 'dog':
        this.camRate = 2.5;
        this.wantPos.set(dg.pos.x * 0.4 + 1.2, 3.6, Math.max(dg.pos.z + 9, 5));
        this.wantLook.set(dg.pos.x, 0.6, dg.pos.z);
        if (this.phase === 'wait' && this.phaseT > 0.8) this.cam = 'aim';
        break;
      case 'overview':
        this.wantLook.set(0, 0, -30);
        break;
      default: break;
    }
  }

  private updateBoard(): void {
    const th = this.thrower;
    if (!th) return;
    const r = th.round;
    const rows: Array<[string, string]> = [
      [t('fb.dog.throws'), this.practice ? String(r.throws.length) : `${Math.min(r.throws.length + (this.phase === 'aim' ? 1 : 0), DOG_SCORING.throws)}/${DOG_SCORING.throws}`],
      [t('fb.dog.catches'), String(r.catches)],
      [t('fb.dog.streak.label'), `${r.streak} (×${Math.min(DOG_SCORING.streakMax, 1 + DOG_SCORING.streakStep * r.streak).toFixed(2)})`]
    ];
    if (this.lastRec && this.lastRec.caught && !this.practice) rows.push([t('fb.dog.last'), `+${this.lastRec.score.points}`]);
    this.hud.setBoard({
      name: th.p.name, color: th.p.color, big: this.practice ? t('fb.practice') : String(r.score), rows,
      badge: t(`dog.${this.dog.breed.id}`)
    });
  }

  protected debugLines(): string[] {
    const dg = this.dog, tg = dg.target;
    return [
      `dog        ${dg.breed.id} · ${dg.state} · ${dg.speed.toFixed(1)} m/s · jump ${dg.jumpY.toFixed(2)} m · target ${tg ? `${tg.x.toFixed(1)}, ${tg.y.toFixed(1)}, ${tg.z.toFixed(1)}` : '–'}`,
      `round      ${this.phase} · throw ${this.thrower?.round.throws.length ?? 0} · streak ${this.thrower?.round.streak ?? 0}`
    ];
  }

  /* ---------------- results ---------------- */

  private summary(winner: number): MatchSummary {
    const players: PlayerResult[] = this.throwers.map(s => {
      const r = s.round;
      let run = 0, streak5 = 0;
      for (const rec of r.throws) { run = rec.caught ? run + 1 : 0; if (run > 0 && run % 5 === 0) streak5 += 1; }
      const flags = (rec: ThrowRecord): string =>
        !rec.caught ? '' : [rec.leap ? t('fb.dog.leap') : rec.midAir ? t('fb.dog.midAir') : '', rec.zone ? `${t(`fb.zone.${rec.zone.id}`)} ×${rec.zone.mult}` : ''].filter(Boolean).join(' · ');
      return {
        name: s.p.name, color: s.p.color, profileId: s.p.profileId, buddy: s.p.buddy,
        score: r.score, total: r.score, handicap: 0, rolls: r.throws.map(x => x.score.points),
        stats: {
          points: r.score, catches: r.catches, throws: r.throws.length, midAir: r.midAirCatches, leaps: r.leapCatches,
          bestStreak: r.bestStreak, longest: Math.round(r.longest), longestCatch: Math.round(Math.max(0, ...r.throws.filter(x => x.caught).map(x => x.distance))),
          streak5, perfect: r.catches === DOG_SCORING.throws ? 1 : 0
        },
        breakdown: {
          head: ['#', t('fb.bd.result'), t('fb.bd.distance'), t('fb.bd.bonus'), t('fb.bd.streak'), t('fb.bd.points')],
          rows: r.throws.map((rec, i) => [
            String(i + 1),
            rec.caught ? t('fb.dog.catch') : t('fb.dog.miss'),
            `${rec.distance.toFixed(1)} m`,
            flags(rec),
            rec.caught ? `×${rec.score.streakMult.toFixed(2)}` : '',
            String(rec.score.points) + (rec.score.capped ? '*' : '')
          ])
        }
      };
    });
    return { sport: 'frisbee', mode: 'frisbeeDog', practice: this.practice, frames: DOG_SCORING.throws, players, winner: this.practice ? -1 : winner, history: [] };
  }

  restart(): void {
    this.epoch += 1;
    this.finishedOnce = false;
    for (const th of this.throwers) th.round = new DogRound(this.practice);
    this.lastRec = null;
    this.control.attach();
    this.control.cancel();
    this.hud.practice(null);
    this.disc.hold({ x: 0, y: 1, z: 0 });
    this.beginTurn(0);
  }

  dispose(): void {
    this.finishedOnce = true;
    this.epoch += 1;
    this.control.detach();
    for (const th of this.throwers) th.fb.dispose();
    this.dogModel.dispose();
    this.field.dispose();
    super.dispose();
  }
}

export const createFrisbeeDog: SceneFactory = async ctx => new FrisbeeDogScene(ctx);

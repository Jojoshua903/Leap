import * as THREE from 'three';
import type { MatchPlayer, MatchSummary, PlayerResult, SceneContext, SceneFactory } from '../sports/types';
import type { QualityLevel } from '../core/Quality';
import type { MouseBackend } from '../input/MouseBackend';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import { Rng } from '../tabletennis/BallPhysics';
import { DISC_TYPES, FB_TUNING, type DiscTypeId } from './frisbeeTuning';
import { Wind, simulateFlight, type DiscEvent, type FlightSample, type Launch, type V3 } from './DiscPhysics';
import { mapSling, spinSign, type ThrowParams } from './ThrowMapper';
import { GOLF_RULES, GolfRound, inBounds, puttSpeed, recommendDisc, scoreName, type Lie, type ThrowOutcome } from './GolfRules';
import { basketCheck, bounceOff, restInTray } from './Basket';
import { courseById, coursePar, type CourseDef } from './courses';
import { HoleView } from './GolfScene';
import { MiniMap } from './MiniMap';
import { DiscMesh, FBBase, FBPlayer, ThrowControl, headingDir, type DiscSkin, type TrailStyle } from './FBBase';
import type { Terrain } from './Terrain';
import type { ScorecardRow } from './frisbeeHud';

type Phase = 'flyover' | 'walk' | 'aim' | 'flight' | 'settle' | 'between' | 'holeEnd' | 'done';
export type GolfAids = 'off' | 'short' | 'full';

interface Golfer {
  p: MatchPlayer;
  fb: FBPlayer;
  /** The disc picked for the next throw, and whether the player chose it (else it follows the recommendation). */
  disc: DiscTypeId;
  chosen: boolean;
  windBirdies: number;
  waterClean: number;
  holesUnder: number;
}

const FLYOVER = 4.2;
const SETTLE = 0.7;
const BETWEEN = 1.5;
const HOLE_END = 3.6;
const FLIGHT_MAX = 20;
const DISCS: DiscTypeId[] = ['driver', 'mid', 'putter'];
const D2R = Math.PI / 180;
const ease = (k: number): number => k * k * (3 - 2 * k);

/**
 * Frisbee Golf: stroke play over a 9-hole course (Meadow, Cliffside or the unlockable Night Course),
 * 1–4 players hot seat. Pick a disc (1/2/3, a recommendation is pre-selected), aim with ←/→ (or Q/E),
 * throw; inside 10 m it is a putt. Aids: preview arc Off/Short/Full (V), landing ring with Full, the
 * wind arrow, distance and elevation and a mini-map. Each hole opens with a skippable fly-over.
 */
class FrisbeeGolfScene extends FBBase {
  protected ground: Terrain;
  private readonly course: CourseDef;
  private readonly rules: GolfRound;
  private readonly golfers: Golfer[] = [];
  private readonly control: ThrowControl;
  private readonly practice: boolean;
  private readonly map: MiniMap;
  private readonly basketRng: Rng;
  private aids: GolfAids;
  private view: HoleView | null = null;
  private holeIdx = 0;
  private phase: Phase = 'flyover';
  private phaseT = 0;
  private cur = 0;
  private heading = 0;
  private holed = false;
  private flightT = 0;
  private throwFrom: Lie = { x: 0, y: 0, z: 0 };
  private prevPos: V3 = { x: 0, y: 0, z: 0 };
  private walkFrom = new THREE.Vector3();
  private walkTo = new THREE.Vector3();
  private walkDur = 0;
  private preview: { path: FlightSample[]; landing: V3 | null } | null = null;
  private previewT = 0;
  private previewKey = '';
  private cardShown = false;
  private lastBasket = '–';
  private quality: QualityLevel;
  private finishedOnce = false;
  private epoch = 0;
  private readonly tmp = new THREE.Vector3();

  private later(ms: number, fn: () => void): void {
    const e = this.epoch;
    window.setTimeout(() => { if (e === this.epoch) fn(); }, ms);
  }

  constructor(ctx: SceneContext) {
    const course = courseById(ctx.setup.cosmetics?.course ?? 'meadow');
    super(ctx, course.look);
    this.course = course;
    this.practice = ctx.setup.practice;
    this.quality = ctx.quality();
    const a = ctx.setup.options.aids;
    this.aids = a === 'off' || a === 'full' ? a : 'short';
    const c = ctx.setup.cosmetics ?? {};
    this.discMesh = new DiscMesh(this.scene, (c.disc as DiscSkin) || 'classic', (c.discTrail as TrailStyle) || 'classic', course.night ? '#3cff9a' : null);
    this.basketRng = new Rng(this.seed + 77);
    const players = this.practice ? ctx.setup.players.slice(0, 1) : ctx.setup.players;
    this.rules = new GolfRound(course.holes.map(h => h.par), players.length);
    players.forEach((p, i) => {
      const fb = new FBPlayer(this.scene, p.buddy, i === 0 && ctx.handed() === 'left');
      this.golfers.push({ p, fb, disc: 'driver', chosen: false, windBirdies: 0, waterClean: 0, holesUnder: 0 });
    });
    this.control = new ThrowControl(ctx.swing, ctx.backend, ctx.handed, {
      grip: held => this.onGrip(held),
      release: p => this.onRelease(p)
    }, this.seed + 9);
    this.map = new MiniMap(this.hud.mapSlot);
    this.hud.setKeys('fb.keys.golf');
    // placeholder ground until the first hole is built
    this.view = new HoleView(this.scene, course, course.holes[0], 0, this.quality);
    this.ground = this.view.ground;
    this.refreshSettings();
    this.setQuality(ctx.quality());
  }

  private get golfer(): Golfer { return this.golfers[this.cur]; }
  private get hole() { return this.course.holes[this.holeIdx]; }

  /* ---------------- holes ---------------- */

  start(): void {
    this.control.attach();
    this.control.ready = false;
    this.ctx.onFirstTurn();
    this.startHole(0);
  }

  private startHole(h: number): void {
    this.holeIdx = h;
    if (!(h === 0 && this.view && this.view.hole === this.hole)) {
      this.view?.dispose();
      this.view = new HoleView(this.scene, this.course, this.hole, h, this.quality);
    }
    const v = this.view!;
    this.ground = v.ground;
    const w = this.hole.wind;
    this.wind = Wind.from(w.dir, w.speed, w.gust ?? 0.3, this.seed + h * 13);
    this.rules.startHole(h, { x: 0, y: v.teePos.y, z: 0 }, { x: v.basketPos.x, y: v.basketPos.y, z: v.basketPos.z });
    this.map.setHole(this.hole);
    this.disc.hold({ x: 0, y: v.teePos.y + 1, z: 0 });
    this.discMesh.clearTrail();
    this.golfers.forEach((g, i) => {
      g.fb.pos.set(-1.4 - i * 1.1, 0, 1.8);
      g.fb.pos.y = v.ground.height(g.fb.pos.x, g.fb.pos.z);
      g.fb.facing = this.headingTo(g.fb.pos.x, g.fb.pos.z);
      g.fb.anim.play('fbReady', { blend: 0.2 });
    });
    this.hud.scorecard(null);
    this.cardShown = false;
    this.hud.call(t('fb.golf.holeIntro', { n: h + 1, par: this.hole.par, m: Math.round(Math.hypot(v.basketPos.x, v.basketPos.z)) }), 'big', 2.6);
    this.phase = 'flyover';
    this.phaseT = 0;
    this.cam = 'flyover';
    this.camRate = 9;
    this.flyCam(0, true);
  }

  private endHole(): void {
    this.phase = 'holeEnd';
    this.phaseT = 0;
    this.control.ready = false;
    const h = this.holeIdx, hole = this.hole;
    for (const [i, g] of this.golfers.entries()) {
      const s = this.rules.cards[i][h] ?? GOLF_RULES.maxStrokes;
      if (s < hole.par) g.holesUnder += 1;
      if (s <= hole.par - 1 && hole.wind.speed >= 5) g.windBirdies += 1;
      if ((hole.ponds?.length ?? 0) > 0 && this.rules.state[i].ob === 0) g.waterClean += 1;
    }
    this.showCard(true);
    this.cam = 'overview';
  }

  private afterHole(): void {
    this.hud.scorecard(null);
    this.cardShown = false;
    if (this.holeIdx < this.course.holes.length - 1) { this.startHole(this.holeIdx + 1); return; }
    this.finish();
  }

  private finish(): void {
    if (this.finishedOnce) return;
    this.finishedOnce = true;
    this.phase = 'done';
    this.control.detach();
    const winners = this.rules.winners();
    for (const [i, g] of this.golfers.entries()) g.fb.anim.play(winners.includes(i) ? 'fbCelebrate' : 'fbDisappointed', { blend: 0.2 });
    const w = this.golfers[winners[0]].fb;
    this.effects.confetti(new THREE.Vector3(w.pos.x, w.pos.y + 1.6, w.pos.z), 220, 1);
    Crowd.cheer(0.8);
    this.later(1800, () => this.ctx.onFinished(this.summary(winners[0])));
  }

  /* ---------------- turns ---------------- */

  private nextTurn(): void {
    const p = this.rules.next();
    if (p === null) { this.endHole(); return; }
    this.cur = p;
    const g = this.golfer, st = this.rules.state[p];
    const lie = st.lie;
    // everyone else waits beside their own lie (or by the basket when done)
    for (const [i, o] of this.golfers.entries()) {
      if (i === p) continue;
      const s = this.rules.state[i];
      if (this.rules.finished(i)) { const b = this.view!.basketPos, x = b.x + 2 + i * 0.9, z = b.z + 2.5; o.fb.pos.set(x, this.ground.height(x, z), z); }
      else if (s.onTee) o.fb.pos.set(-1.4 - i * 1.1, this.ground.height(-1.4 - i * 1.1, 1.8), 1.8);
      else o.fb.pos.set(s.lie.x + 1.4, this.ground.height(s.lie.x + 1.4, s.lie.z + 1), s.lie.z + 1);
      o.fb.facing = this.headingTo(o.fb.pos.x, o.fb.pos.z);
      o.fb.anim.play('fbReady', { blend: 0.2 });
    }
    // walk to the lie (short) or cut there (long)
    this.walkFrom.copy(g.fb.pos);
    this.walkTo.set(lie.x, this.ground.height(lie.x, lie.z), lie.z);
    const d = this.walkFrom.distanceTo(this.walkTo);
    this.heading = this.headingTo(lie.x, lie.z) / D2R;
    if (d > 9) { g.fb.pos.copy(this.walkTo); this.walkDur = 0; this.camPos.set(lie.x - headingDir(this.heading).x * 5, lie.y + 2.6, lie.z - headingDir(this.heading).z * 5); }
    else this.walkDur = Math.max(0.2, d / 3.2);
    if (this.walkDur > 0) g.fb.anim.play('fbWalk', { blend: 0.2 });
    // the disc: the recommendation unless the player picked one this hole
    const dist = this.rules.distance(p);
    if (!g.chosen || st.onTee) { g.disc = this.rules.isPutt(p) ? 'putter' : recommendDisc(dist); g.chosen = false; }
    this.phase = 'walk';
    this.phaseT = 0;
    this.cam = 'aim';
    this.camRate = 4;
    this.disc.hold({ x: lie.x, y: lie.y + 1, z: lie.z });
    this.discMesh.clearTrail();
    this.preview = null;
    this.previewKey = '';
    if (this.golfers.length > 1) this.hud.call(g.p.name, 'score', 1);
    this.updateBoard();
  }

  private beginAim(): void {
    const g = this.golfer;
    g.fb.pos.copy(this.walkTo);
    g.fb.facing = this.heading * D2R;
    g.fb.anim.play('fbReady', { blend: 0.2 });
    this.phase = 'aim';
    this.phaseT = 0;
    this.control.ready = true;
    this.control.disc = DISC_TYPES[g.disc];
    const putt = this.rules.isPutt(this.cur);
    if (putt) this.hud.hint(t('fb.golf.putt'), 1800);
    else if (this.rules.state[this.cur].onTee && this.holeIdx === 0) this.hud.hint(t(this.control.isMouse ? 'fb.hint.golfMouse' : 'fb.hint.golfMotion'), 5000);
    this.updateBoard();
  }

  private onGrip(held: boolean): void {
    if (this.phase !== 'aim') return;
    const putt = this.rules.isPutt(this.cur) ? 1 : 0;
    this.golfer.fb.anim.play(held ? 'fbGrip' : 'fbReady', { blend: 0.12, params: { fh: 0, putt } });
  }

  private onRelease(raw: ThrowParams): void {
    if (this.phase !== 'aim') return;
    this.control.ready = false;
    const g = this.golfer, st = this.rules.state[this.cur];
    const type = DISC_TYPES[g.disc];
    const putt = !st.onTee && this.rules.isPutt(this.cur);
    const p: ThrowParams = putt ? { ...raw, speed: puttSpeed(raw.speed, FB_TUNING.speedMin, type.maxSpeed) } : raw;
    g.fb.anim.play(putt ? 'fbPutt' : p.forehand ? 'fbForehand' : 'fbBackhand', { blend: 0.04, restart: true });
    const dir = headingDir(this.heading);
    const lie = st.lie;
    const from: V3 = { x: lie.x + dir.x * 0.45, y: this.ground.height(lie.x, lie.z) + (putt ? 0.95 : 1.05), z: lie.z + dir.z * 0.45 };
    this.throwFrom = { ...lie };
    this.throwDisc(p, from, this.heading, type);
    this.prevPos = { ...from };
    this.holed = false;
    this.flightT = 0;
    this.phase = 'flight';
    this.phaseT = 0;
    this.cam = 'follow';
    this.camRate = 3;
    this.view?.preview(null, 0, null);
    this.view?.aim(0, 0, null);
    this.hud.discPicker(null);
    this.hud.practice(null);
  }

  /* ---------------- physics ---------------- */

  protected onDiscEvent(e: DiscEvent): void {
    if (e.kind === 'water') this.hud.call(t('fb.splash'), 'water', 1.2);
  }

  protected stepExtra(dt: number): void {
    if (this.phase !== 'flight' || this.holed || !this.view) return;
    const d = this.disc;
    this.flightT += dt;
    if (d.phase === 'held' || d.stopped) return;
    const b = this.view.basketPos;
    const hit = basketCheck(this.prevPos, d.pos, d.speed, b, this.basketRng);
    if (hit !== 'none') this.lastBasket = `${hit} @ ${d.speed.toFixed(1)} m/s, ${(d.pos.y - b.y).toFixed(2)} m`;
    if (hit === 'in') {
      this.holed = true;
      const dirAng = Math.atan2(d.vel.x, d.vel.z);
      this.view.basket.hit(Math.min(1, d.speed / 9), dirAng);
      sfx.chains(Math.min(1, 0.4 + d.speed / 12));
      d.hold(restInTray(b, this.prevPos));
    } else if (hit === 'rattle' || hit === 'band' || hit === 'cage') {
      this.view.basket.hit(hit === 'rattle' ? 0.8 : 0.4, Math.atan2(d.vel.x, d.vel.z));
      if (hit === 'rattle') { sfx.chains(0.55); this.hud.call(t('fb.golf.rattle'), 'miss', 1); }
      else sfx.treeHit();
      d.vel = bounceOff(d.vel, d.pos, b, hit, this.basketRng);
      d.pos = { ...this.prevPos };
      d.spin *= 0.4;
      d.knocked = true;
    }
    this.prevPos = { ...d.pos };
  }

  /** The throw is over: work out the outcome and move on. */
  private resolveThrow(): void {
    const d = this.disc, h = this.hole;
    let o: ThrowOutcome;
    if (this.holed) o = { kind: 'in' };
    else if (d.phase === 'water' || !inBounds(h.bounds, d.pos.x, d.pos.z) || this.ground.surface(d.pos.x, d.pos.z) === 'water') o = { kind: 'ob' };
    else o = { kind: 'rest', at: { x: d.pos.x, y: this.ground.height(d.pos.x, d.pos.z), z: d.pos.z } };
    const g = this.golfer;
    const res = this.rules.record(this.cur, o);
    const thrown = o.kind === 'rest' ? Math.hypot(o.at.x - this.throwFrom.x, o.at.z - this.throwFrom.z) : 0;
    if (o.kind === 'in') {
      const name = scoreName(res.strokes, h.par);
      this.hud.call(t(`fb.score.${name}`), name === 'ace' ? 'ace' : name === 'eagle' || name === 'birdie' ? 'big' : 'score', 2);
      g.fb.anim.play(res.strokes <= h.par ? 'fbCelebrate' : 'fbReady', { blend: 0.15 });
      if (name === 'ace') { this.effects.confetti(this.view!.basketPos.clone().setY(this.view!.basketPos.y + 1.5), 260, 1); Crowd.cheer(1); }
      else if (res.strokes < h.par) Crowd.cheer(0.6);
    } else if (o.kind === 'ob') {
      this.hud.call(t('fb.golf.ob'), 'water', 1.6);
      g.fb.anim.play('fbDisappointed', { blend: 0.15 });
      Crowd.aww();
    } else {
      const left = this.rules.distance(this.cur);
      this.hud.distance(t('fb.golf.lie', { m: thrown.toFixed(1), left: left.toFixed(1) }), 2.2);
    }
    if (res.picked) this.hud.call(t('fb.golf.pickUp', { n: GOLF_RULES.maxStrokes }), 'miss', 1.8);
    if (this.practice && this.lastThrow) this.practiceReadout(o, thrown);
    this.phase = 'between';
    this.phaseT = 0;
    this.updateBoard();
  }

  private practiceReadout(o: ThrowOutcome, thrown: number): void {
    const p = this.lastThrow!;
    const sgn = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
    this.hud.practice([
      `${t('fb.pr.result')}: ${o.kind === 'in' ? t('fb.golf.in') : o.kind === 'ob' ? t('fb.golf.ob') : `${thrown.toFixed(1)} m`}`,
      `${t('fb.pr.speed')}: ${p.speed.toFixed(1)} m/s · ${t('fb.pr.spin')}: ${Math.abs(p.spin).toFixed(0)} rad/s`,
      `${t('fb.pr.dir')}: ${sgn(p.yawDeg)}° · ${t('fb.pr.loft')}: ${p.loftDeg.toFixed(1)}° · ${t('fb.pr.nose')}: ${sgn(p.noseDeg)}°`,
      `${t('fb.bank')}: ${sgn(p.bankDeg)}° · ${t('fb.pr.quality')}: ${Math.round(p.quality * 100)}% · ${p.forehand ? t('fb.forehand') : t('fb.backhand')}`,
      `${t('fb.pr.basket')}: ${this.lastBasket}`
    ]);
  }

  /* ---------------- input ---------------- */

  onKey(e: KeyboardEvent): boolean {
    // Esc (pause), Tab (scorecard, handled by the host) and F-keys (F3 debug) always pass through
    if (e.key === 'Escape' || e.key === 'Tab' || /^F\d+$/.test(e.key)) return false;
    if (this.phase === 'flyover' && !e.repeat) { this.phaseT = FLYOVER; return true; }
    if (this.phase === 'holeEnd' && (e.code === 'Space' || e.code === 'Enter')) { this.phaseT = HOLE_END; return true; }
    if (this.phase !== 'aim' && this.phase !== 'walk') {
      if (e.code === 'KeyV') { this.cycleAids(); return true; }
      return false;
    }
    const g = this.golfer;
    const step = e.shiftKey ? 0.5 : 2;
    switch (e.code) {
      case 'ArrowLeft': case 'KeyQ': this.heading -= step; break;
      case 'ArrowRight': case 'KeyE': this.heading += step; break;
      case 'Digit1': case 'Digit2': case 'Digit3':
        g.disc = DISCS[Number(e.code.slice(5)) - 1]; g.chosen = true; this.control.disc = DISC_TYPES[g.disc]; sfx.tick(); break;
      case 'KeyV': this.cycleAids(); break;
      default: return false;
    }
    this.golfer.fb.facing = this.heading * D2R;
    this.updateBoard();
    return true;
  }

  private cycleAids(): void {
    this.aids = this.aids === 'off' ? 'short' : this.aids === 'short' ? 'full' : 'off';
    this.previewKey = '';
    this.hud.hint(t('fb.golf.aids', { v: t(`fb.aids.${this.aids}`) }), 1400);
  }

  toggleScores(): void { this.showCard(!this.cardShown); }

  private showCard(on: boolean): void {
    this.cardShown = on;
    if (!on) { this.hud.scorecard(null); return; }
    const rows: ScorecardRow[] = this.golfers.map((g, i) => ({
      name: g.p.name, color: g.p.color, strokes: this.rules.cards[i], total: this.rules.total(i), vsPar: this.rules.vsPar(i)
    }));
    this.hud.scorecard({ title: t(this.course.nameKey), pars: this.rules.pars, rows, current: this.holeIdx });
  }

  /* ---------------- per frame ---------------- */

  protected frameMode(dt: number, realDt: number): void {
    this.phaseT += realDt;
    this.control.tick();
    const g = this.golfer;
    switch (this.phase) {
      case 'flyover': {
        const b = this.ctx.backend();
        if (b?.kind === 'mouse' && (b as MouseBackend).pointer?.left && this.phaseT > 0.3) this.phaseT = FLYOVER;
        this.flyCam(Math.min(1, this.phaseT / FLYOVER), false);
        if (this.phaseT >= FLYOVER) this.nextTurn();
        break;
      }
      case 'walk': {
        const k = this.walkDur > 0 ? Math.min(1, this.phaseT / this.walkDur) : 1;
        g.fb.pos.lerpVectors(this.walkFrom, this.walkTo, k);
        g.fb.pos.y = this.ground.height(g.fb.pos.x, g.fb.pos.z);
        g.fb.facing = k < 1 ? Math.atan2(this.walkTo.x - this.walkFrom.x, -(this.walkTo.z - this.walkFrom.z)) : this.heading * D2R;
        if (k >= 1) this.beginAim();
        break;
      }
      case 'aim':
        this.updatePreview(realDt);
        break;
      case 'flight': {
        const d = this.disc;
        if (this.holed || d.stopped || this.flightT > FLIGHT_MAX) { this.phase = 'settle'; this.phaseT = 0; }
        break;
      }
      case 'settle':
        if (this.phaseT > SETTLE) this.resolveThrow();
        break;
      case 'between':
        if (this.phaseT > BETWEEN) this.nextTurn();
        break;
      case 'holeEnd':
        if (this.phaseT > HOLE_END) this.afterHole();
        break;
      default: break;
    }
    this.view?.update(dt);
    for (const o of this.golfers) o.fb.update(dt, o.fb.pos.y);

    // the disc: in the hand while aiming, else from the physics (or resting in the basket)
    const inHand = this.phase === 'walk' || this.phase === 'aim' || this.phase === 'flyover';
    this.discMesh.update(inHand ? null : this.disc, this.ground, dt, inHand ? g.fb.hand(this.tmp) : null, g.fb.facing);

    this.updateCamera();
    this.showWind();
    // HUD bits
    const aiming = this.phase === 'aim';
    this.hud.slingSliders(aiming && this.control.isMouse ? { bank: this.control.bank, nose: this.control.nose } : null);
    const pull = this.control.pull;
    this.hud.slingLineAt(pull ? pull.a : null, pull?.b, pull?.power ?? 0);
    this.hud.grip(aiming && this.control.gripping, t('fb.grip'));
    if (aiming) {
      const rec = this.rules.isPutt(this.cur) ? 'putter' : recommendDisc(this.rules.distance(this.cur));
      this.hud.discPicker(DISCS.map((id, i) => ({ id, label: `${i + 1} ${t(`fb.disc.${id}`)}`, color: DISC_TYPES[id].color })), g.disc, rec);
      const lie = this.rules.state[this.cur].lie;
      this.view?.aim(lie.x, lie.z, this.heading);
    } else {
      this.hud.discPicker(null);
      this.view?.aim(0, 0, null);
    }
    this.drawMap();
  }

  /** Recompute the preview arc for the current aim (about 8× a second, only when the aim changed). */
  private updatePreview(realDt: number): void {
    const v = this.view;
    if (!v) return;
    if (this.aids === 'off') { v.preview(null, 0, null); return; }
    this.previewT -= realDt;
    const st = this.rules.state[this.cur], g = this.golfer, type = DISC_TYPES[g.disc];
    const putt = !st.onTee && this.rules.isPutt(this.cur);
    const pull = this.control.pull;
    const key = `${this.heading.toFixed(1)}|${g.disc}|${this.control.bank}|${this.control.nose}|${pull ? pull.power.toFixed(2) + (pull.b.x - pull.a.x).toFixed(0) : ''}|${this.aids}`;
    if (key !== this.previewKey && this.previewT <= 0) {
      this.previewKey = key;
      this.previewT = 0.12;
      const handed = this.ctx.handed();
      let p: ThrowParams | null = null;
      if (this.control.isMouse && pull && pull.power > 0.08) p = mapSling({ dx: pull.b.x - pull.a.x, dy: pull.b.y - pull.a.y, bankDeg: this.control.bank, noseDeg: this.control.nose }, { handed, disc: type });
      const speed = p ? p.speed : type.maxSpeed * 0.78;
      const l: Launch = {
        pos: { x: st.lie.x + headingDir(this.heading).x * 0.45, y: st.lie.y + (putt ? 0.95 : 1.05), z: st.lie.z + headingDir(this.heading).z * 0.45 },
        speed: putt ? puttSpeed(speed, FB_TUNING.speedMin, type.maxSpeed) : speed,
        yawDeg: this.heading + (p ? p.yawDeg : 0),
        loftDeg: p ? p.loftDeg : this.control.isMouse ? this.control.nose : 8,
        noseDeg: p ? p.noseDeg : 0,
        bankDeg: this.control.isMouse ? this.control.bank : 0,
        spin: spinSign(false, handed) * 40, wobble: 0
      };
      const f = simulateFlight(l, type, { wind: this.wind, ground: this.ground, seed: 5, maxT: 10, untilLand: true });
      this.preview = { path: f.path, landing: f.landing };
    }
    if (this.preview) v.preview(this.preview.path, this.aids === 'full' ? Infinity : 1.0, this.aids === 'full' ? this.preview.landing : null);
  }

  private drawMap(): void {
    const markers = this.golfers.map((o, i) => {
      const s = this.rules.state[i];
      return s && !this.rules.finished(i) ? { x: s.lie.x, z: s.lie.z, color: o.p.color, big: i === this.cur } : null;
    }).filter((m): m is { x: number; z: number; color: string; big: boolean } => !!m);
    const lie = this.rules.state[this.cur]?.lie;
    const aim = this.phase === 'aim' && lie ? { x: lie.x, z: lie.z, deg: this.heading, len: Math.min(60, this.rules.distance(this.cur)) } : null;
    const flying = this.phase === 'flight' && !this.disc.stopped;
    this.map.draw(markers, aim, flying ? this.disc.pos : null);
  }

  /** Fly-over: from high above the basket back to behind the tee. */
  private flyCam(k: number, snap: boolean): void {
    const v = this.view!;
    const b = v.basketPos, e = ease(k);
    const toTee = new THREE.Vector3(-b.x, 0, -b.z).normalize();
    const a = new THREE.Vector3(b.x + toTee.z * 10 - toTee.x * 6, b.y + 16, b.z - toTee.x * 10 - toTee.z * 6);
    const c = new THREE.Vector3(-headingDir(this.headingTo(0, 0) / D2R).x * 6, v.teePos.y + 3.4, -headingDir(this.headingTo(0, 0) / D2R).z * 6);
    this.wantPos.lerpVectors(a, c, e);
    this.wantLook.lerpVectors(b, new THREE.Vector3(b.x * 0.5, b.y * 0.5 + 1, b.z * 0.5), e);
    if (snap) { this.camPos.copy(this.wantPos); this.camLook.copy(this.wantLook); }
  }

  private updateCamera(): void {
    const d = this.disc, v = this.view;
    if (!v) return;
    const b = v.basketPos;
    switch (this.cam) {
      case 'aim': {
        const g = this.golfer.fb, dir = headingDir(this.heading);
        const putt = this.rules.isPutt(this.cur);
        const back = putt ? 3.2 : 4.6, up = putt ? 1.7 : 2.3;
        const side = this.golfer.fb.anim.mirror ? -0.5 : 0.5;
        this.wantPos.set(g.pos.x - dir.x * back - dir.z * side, g.pos.y + up, g.pos.z - dir.z * back + dir.x * side);
        const look = putt ? Math.max(3, this.rules.distance(this.cur)) : 22;
        this.wantLook.set(g.pos.x + dir.x * look, g.pos.y + (putt ? b.y - g.pos.y + 0.9 : 1.2), g.pos.z + dir.z * look);
        break;
      }
      case 'follow': {
        const dir = headingDir(this.heading);
        this.wantPos.set(d.pos.x - dir.x * 8, Math.max(d.pos.y + 1.8, this.ground.height(d.pos.x - dir.x * 8, d.pos.z - dir.z * 8) + 2.2), d.pos.z - dir.z * 8);
        this.wantLook.set(d.pos.x, d.pos.y, d.pos.z);
        const nearBasket = Math.hypot(d.pos.x - b.x, d.pos.z - b.z) < 7 && d.flying;
        if (nearBasket) { this.cam = 'basket'; this.camRate = 5; }
        else if (!d.flying && this.phase !== 'flight') this.cam = 'lie';
        break;
      }
      case 'basket': {
        const dir = headingDir(this.heading);
        this.wantPos.set(b.x + dir.z * 4.2 - dir.x * 1.5, b.y + 1.6, b.z - dir.x * 4.2 - dir.z * 1.5);
        this.wantLook.set(b.x, b.y + 1, b.z);
        if (!this.holed && Math.hypot(d.pos.x - b.x, d.pos.z - b.z) > 9) this.cam = 'follow';
        break;
      }
      case 'lie':
        this.wantLook.set(d.pos.x, d.pos.y, d.pos.z);
        break;
      case 'overview':
        this.wantPos.set(b.x + 6, b.y + 7, b.z + 10);
        this.wantLook.set(b.x, b.y + 1, b.z);
        break;
      default: break;
    }
    if (this.phase === 'settle' && this.cam === 'follow') this.cam = 'lie';
  }

  /** Heading (radians, 0 = −z) from a point to the basket. */
  private headingTo(x: number, z: number): number {
    const b = this.view?.basketPos ?? new THREE.Vector3(0, 0, -50);
    return Math.atan2(b.x - x, -(b.z - z));
  }

  private updateBoard(): void {
    const g = this.golfer;
    if (!g || this.rules.hole < 0) return;
    const i = this.cur, st = this.rules.state[i], v = this.view!;
    const elev = v.basketPos.y - this.ground.height(st.lie.x, st.lie.z);
    const vs = this.rules.vsPar(i);
    this.hud.setBoard({
      name: g.p.name, color: g.p.color, big: String(st.strokes),
      rows: [
        [t('fb.golf.holeOf', { n: this.holeIdx + 1, of: this.course.holes.length }), `${t('fb.par')} ${this.hole.par}`],
        [t('fb.golf.toBasket'), `${this.rules.distance(i).toFixed(1)} m`],
        [t('fb.golf.elev'), `${elev >= 0 ? '↑' : '↓'} ${Math.abs(elev).toFixed(1)} m`],
        [t('fb.total'), `${this.rules.total(i)} (${vs > 0 ? '+' : ''}${vs === 0 ? 'E' : vs})`]
      ],
      badge: `${t(`fb.disc.${g.disc}`)} · ${t(`fb.aids.${this.aids}`)}`
    });
  }

  protected debugLines(): string[] {
    const st = this.rules.state[this.cur];
    return [
      `golf       ${this.phase} · hole ${this.holeIdx + 1} · strokes ${st?.strokes ?? 0} · to basket ${this.rules.hole >= 0 ? this.rules.distance(this.cur).toFixed(1) : '–'} m · heading ${this.heading.toFixed(1)}° · disc ${this.golfer?.disc}`,
      `basket     last ${this.lastBasket}`
    ];
  }

  setQuality(q: QualityLevel): void {
    super.setQuality(q);
    this.quality = q;
  }

  /* ---------------- results ---------------- */

  private summary(winner: number): MatchSummary {
    const par = coursePar(this.course);
    const players: PlayerResult[] = this.golfers.map((g, i) => {
      const c = this.rules.counts(i), total = this.rules.total(i);
      return {
        name: g.p.name, color: g.p.color, profileId: g.p.profileId, buddy: g.p.buddy,
        score: total, total, handicap: 0, rolls: this.rules.cards[i].map(s => s ?? 0),
        stats: {
          strokes: total, vsPar: total - par, holes: this.rules.cards[i].filter(s => s !== null).length,
          aces: c.ace, eagles: c.eagle + c.albatross, birdies: c.birdie, pars: c.par, bogeys: c.bogey + c.double + c.triple,
          ob: this.rules.obTotal[i], holesUnder: g.holesUnder, windBirdies: g.windBirdies, waterClean: g.waterClean,
          bestPuttStreak: this.rules.bestPuttStreak[i], putts: this.rules.puttsMade[i], longest: Math.round(this.rules.longest[i]),
          underPar: total < par ? 1 : 0
        },
        breakdown: {
          head: [t('fb.hole'), t('fb.par'), t('fb.bd.strokes'), ''],
          rows: this.rules.cards[i].map((s, h) => [String(h + 1), String(this.rules.pars[h]), s === null ? '–' : String(s), s === null ? '' : t(`fb.score.${scoreName(s, this.rules.pars[h])}`)])
        }
      };
    });
    return {
      sport: 'frisbee', mode: 'frisbeeGolf', practice: this.practice, frames: this.course.holes.length, players,
      winner: this.practice ? -1 : winner, history: [], variant: this.course.id
    };
  }

  restart(): void {
    this.epoch += 1;
    this.finishedOnce = false;
    for (let p = 0; p < this.golfers.length; p++) this.rules.cards[p].fill(null);
    this.rules.obTotal.fill(0); this.rules.puttStreak.fill(0); this.rules.bestPuttStreak.fill(0); this.rules.puttsMade.fill(0); this.rules.longest.fill(0);
    for (const g of this.golfers) { g.windBirdies = 0; g.waterClean = 0; g.holesUnder = 0; g.chosen = false; }
    this.rules.hole = -1;
    this.control.attach();
    this.control.cancel();
    this.hud.practice(null);
    this.startHole(0);
  }

  dispose(): void {
    this.finishedOnce = true;
    this.epoch += 1;
    this.control.detach();
    for (const g of this.golfers) g.fb.dispose();
    this.view?.dispose();
    this.map.dispose();
    super.dispose();
  }
}

export const createFrisbeeGolf: SceneFactory = async ctx => new FrisbeeGolfScene(ctx);

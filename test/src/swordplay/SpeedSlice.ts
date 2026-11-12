import * as THREE from 'three';
import type { PlayerResult, SceneContext, SceneFactory } from '../sports/types';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import { Music } from '../audio/Music';
import { t } from '../i18n';
import { addOutline, toon } from '../render/Toon';
import { SwordBase, type Fighter, type SwordInput } from './SwordBase';
import { ARENA_LOOK, buildRange, type Kit } from './ArenaScenes';
import { sweepCapsule, type Shape } from './HitTest';
import { cachedShape, planeToLocal, shapeGeometry, slicePlane, writeHalf, type SliceShape } from './MeshSlicer';
import { SliceScore, tierFor, type Tier } from './sliceScoring';
import { WAVE, buildPractice, buildRound, isDecoy, type Spawn, type TargetKind } from './sliceWaves';
import { SW_TUNING } from './swordTuning';
import { AXIS_COLOR, DIRS, dirAngle, dirAxis, type Dir8 } from './swMath';
import type { Slash } from './SlashDetector';

/* ---------------- targets ---------------- */

const KIND: Record<TargetKind, { shape: SliceShape; skin: string; inside: string; lying?: boolean }> = {
  log: { shape: { kind: 'cylinder', r: 0.16, h: 0.72, seg: 14 }, skin: '#8a5a32', inside: '#f0d29a', lying: true },
  melon: { shape: { kind: 'sphere', r: 0.21, seg: 16, rings: 10 }, skin: '#3bb37a', inside: '#ff5a6e' },
  bamboo: { shape: { kind: 'cylinder', r: 0.075, h: 1.0, seg: 10 }, skin: '#7cc36b', inside: '#f4f0c8' },
  straw: { shape: { kind: 'cylinder', r: 0.17, h: 0.55, seg: 14 }, skin: '#e9cf7a', inside: '#cfae55' },
  bomb: { shape: { kind: 'sphere', r: 0.17, seg: 14, rings: 9 }, skin: '#2b2f38', inside: '#2b2f38' },
  rock: { shape: { kind: 'sphere', r: 0.19, seg: 7, rings: 5 }, skin: '#9aa6b2', inside: '#9aa6b2' }
};
const GOLD = '#ffd23a';

interface TargetView { group: THREE.Group; body: THREE.Mesh; arrow: THREE.Mesh; arrowMat: THREE.MeshBasicMaterial; skinMat: THREE.MeshToonMaterial; kind: TargetKind; used: boolean }
interface Target { s: Spawn; view: TargetView; age: number; phase: 'in' | 'hover' | 'out'; pos: THREE.Vector3; spin: number; squash: number; dead: boolean; outT: number }
interface Half { mesh: THREE.Mesh; mats: [THREE.MeshToonMaterial, THREE.MeshToonMaterial]; v: THREE.Vector3; axis: THREE.Vector3; spin: number; life: number }

const HALF_POOL = 14;
type Phase = 'intro' | 'play' | 'between' | 'done';

/**
 * Speed Slice: targets fly in and hang in front of you with an arrow; slash them in that direction.
 * Blue arrows are sideways, red up/down, yellow diagonal. Hitting a bomb or rock costs points and
 * staggers you for a moment; letting one pass is worth 50. 60 s per player (1–4 take turns on the same
 * seeded round). Practice: slow, no clock, shows the asked and the actual direction.
 *
 * Hits are by contact: the drawn blade is swept against each target every physics step, and the slash in
 * progress (SlashDetector.live) gives the direction, straightness and speed at that moment.
 */
class SpeedSlice extends SwordBase {
  private readonly arena: Kit;
  private readonly all: Fighter[] = [];
  private fighter: Fighter;
  private readonly input: SwordInput;
  private readonly practice: boolean;
  private readonly scores: SliceScore[];
  private turn = 0;
  private spawns: Spawn[] = [];
  private next = 0;
  private roundT = 0;
  private readonly targets: Target[] = [];
  private readonly views: TargetView[] = [];
  private readonly halves: Half[] = [];
  private phase: Phase = 'intro';
  private phaseT = 0;
  private countdown = 3;
  private staggerT = 0;
  private lastSlashAt = -1;
  private layerOn = false;
  private lastWant: Dir8 | null = null;
  private lastGot: number | null = null;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(ctx: SceneContext) {
    super(ctx, ARENA_LOOK.range);
    this.practice = ctx.setup.practice;
    this.arena = buildRange(this.scene);
    this.disposables.push(this.arena);
    ctx.setup.players.forEach((_, i) => {
      const f = this.makeFighter(i, undefined, i === 0 ? ctx.handed() : 'right');
      f.pos.set(0, 0.12, 0);
      f.yaw = Math.PI;                 // facing −z, down the range
      f.visible = i === 0;
      this.all.push(f);
    });
    this.fighter = this.all[0];
    this.scores = ctx.setup.players.map(() => new SliceScore());
    this.input = this.makeInput({
      slash: s => this.onSlash(s),
      live: () => { /* read in the step */ },
      recenter: () => this.hud.hint(t('sw.hint.recentered'), 1.2)
    });
    this.buildPools();
    this.wantPos.set(0.25, 1.85, 2.1); this.camPos.copy(this.wantPos);
    this.wantLook.set(0, 1.25, -1.6); this.camLook.copy(this.wantLook);
    this.setSunOffset(5, 14, 3);
    this.hud.setKeys('sw.keys.slice');
    this.setQuality(ctx.quality());
    this.refreshSettings();
  }

  protected fighters(): Fighter[] { return this.all ?? []; }

  /* ---------------- pools ---------------- */

  private arrowGeo: THREE.ShapeGeometry | null = null;

  private buildPools(): void {
    const s = new THREE.Shape();
    s.moveTo(-0.16, -0.035); s.lineTo(0.04, -0.035); s.lineTo(0.04, -0.09); s.lineTo(0.17, 0); s.lineTo(0.04, 0.09); s.lineTo(0.04, 0.035); s.lineTo(-0.16, 0.035); s.closePath();
    this.arrowGeo = this.geo(new THREE.ShapeGeometry(s));
    for (let i = 0; i < HALF_POOL; i++) {
      const g = this.geo(new THREE.BufferGeometry());
      const mats: [THREE.MeshToonMaterial, THREE.MeshToonMaterial] = [this.mat(toon('#ffffff', { transparent: true })), this.mat(toon('#ffffff', { transparent: true }))];
      const mesh = new THREE.Mesh(g, mats);
      mesh.visible = false; mesh.castShadow = true;
      this.scene.add(mesh);
      this.halves.push({ mesh, mats, v: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), spin: 0, life: 0 });
    }
  }

  private view(kind: TargetKind): TargetView {
    const free = this.views.find(v => !v.used && v.kind === kind);
    if (free) { free.used = true; free.group.visible = true; return free; }
    const k = KIND[kind];
    const group = new THREE.Group();
    const geo = this.geo(shapeGeometry(k.shape));
    const skinMat = this.mat(toon(k.skin));
    const body = new THREE.Mesh(geo, skinMat);
    body.castShadow = true;
    addOutline(body, 0.05);
    if (k.lying) body.rotation.z = Math.PI / 2;
    group.add(body);
    if (kind === 'melon') for (let i = 0; i < 4; i++) {
      const st = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.212, 0.012, 4, 24, Math.PI)), this.mat(toon('#2a8a58')));
      st.rotation.set(0, (i / 4) * Math.PI, Math.PI / 2); body.add(st);
    }
    if (kind === 'bomb') {
      const fuse = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 5)), this.mat(toon('#c9935a')));
      fuse.position.y = 0.2; body.add(fuse);
      const spark = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.035, 8, 6)), this.mat(new THREE.MeshBasicMaterial({ color: '#ffb020' })));
      spark.position.y = 0.27; body.add(spark);
    }
    if (kind === 'straw') for (const y of [-0.12, 0.12]) {
      const band = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.172, 0.02, 4, 18)), this.mat(toon('#b8402e')));
      band.rotation.x = Math.PI / 2; band.position.y = y; body.add(band);
    }
    const arrowMat = this.mat(new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, depthTest: false, transparent: true }));
    const arrow = new THREE.Mesh(this.arrowGeo!, arrowMat);
    arrow.renderOrder = 5;
    group.add(arrow);
    this.scene.add(group);
    const v: TargetView = { group, body, arrow, arrowMat, skinMat, kind, used: true };
    this.views.push(v);
    return v;
  }

  private release(v: TargetView): void { v.used = false; v.group.visible = false; }

  /* ---------------- flow ---------------- */

  start(): void {
    this.beginTurn(0);
    this.ctx.onFirstTurn();
  }

  restart(): void {
    for (const tg of this.targets) this.release(tg.view);
    this.targets.length = 0;
    this.scores.forEach((_, i) => { this.scores[i] = new SliceScore(); });
    this.beginTurn(0);
  }

  private beginTurn(i: number): void {
    this.turn = i;
    this.all.forEach((f, k) => { f.visible = k === i; });
    this.fighter = this.all[i];
    this.spawns = this.practice ? buildPractice(this.seed) : buildRound(this.seed);
    this.next = 0; this.roundT = 0;
    this.phase = 'intro'; this.phaseT = 0; this.countdown = 3;
    this.input.attach();
    this.input.enabled = false;
    this.input.reset();
    this.fighter.play('swReady');
    const p = this.ctx.setup.players[i];
    this.hud.call(this.ctx.setup.players.length > 1 ? t('sw.slice.turn', { name: p.name }) : t('sw.slice.ready'), 'big', 1.6);
    this.hud.practice(this.practice ? { want: null, got: null, text: t('sw.practice.start') } : null);
    this.showBoard();
  }

  private endTurn(): void {
    this.phase = 'between'; this.phaseT = 0;
    this.input.enabled = false;
    for (const tg of this.targets) this.release(tg.view);
    this.targets.length = 0;
    if (this.layerOn) { Music.setLayer(false); this.layerOn = false; }
    const s = this.scores[this.turn];
    const tier = tierFor(s.score, s.accuracy);
    sfx.gong();
    if (!this.practice) {
      this.effects.bigText(t(`sw.tier.${tier}`), `${s.score} · ${Math.round(s.accuracy * 100)}%`, tier === 'platinum' || tier === 'gold' ? 'strike' : 'normal');
      Crowd.cheer(tier === 'platinum' ? 1 : tier === 'gold' ? 0.8 : 0.5);
      this.fighter.play(tier === 'bronze' ? 'swDefeat' : 'swVictory');
    } else this.effects.bigText(t('sw.practice.done'), `${s.good}/${s.attempts}`);
  }

  private finish(): void {
    this.phase = 'done';
    this.input.detach();
    const players: PlayerResult[] = this.ctx.setup.players.map((p, i) => {
      const s = this.scores[i];
      const tier: Tier = tierFor(s.score, s.accuracy);
      const accPct = Math.round(s.accuracy * 100);
      const stats: Record<string, number> = {
        good: s.good, wrong: s.wrong, missed: s.missed, accPct, bestAcc: accPct, tier: ['bronze', 'silver', 'gold', 'platinum'].indexOf(tier),
        perfects: s.perfects, bestPerfectRun: s.bestPerfectRun, maxMult: s.maxMult, bestStreak: s.bestStreak,
        decoysCut: s.decoysCut, decoysDodged: s.decoysDodged
      };
      for (const d of DIRS) stats[`slash_${d}`] = s.byDir[d];
      return { name: p.name, color: p.color, profileId: p.profileId, buddy: p.buddy, score: s.score, total: s.score, handicap: 0, rolls: [], stats };
    });
    let winner = 0;
    players.forEach((p, i) => { if (p.score > players[winner].score) winner = i; });
    this.ctx.onFinished({
      sport: 'swordplay', mode: 'speedSlice', practice: this.practice, frames: 1, players,
      winner: this.practice ? -1 : winner, history: [players.map(p => p.score)]
    });
  }

  private showBoard(): void {
    const s = this.scores[this.turn], p = this.ctx.setup.players[this.turn];
    this.hud.setBoard({
      name: p.name, color: p.color, big: String(s.score),
      rows: [
        [t('sw.board.combo'), `×${s.mult} (${s.streak})`],
        [t('sw.board.acc'), s.attempts ? `${Math.round(s.accuracy * 100)}%` : '–'],
        [t('sw.board.perfect'), String(s.perfects)]
      ],
      badge: this.practice ? t('setup.practice') : undefined
    });
  }

  /* ---------------- slashes ---------------- */

  private onSlash(s: Slash): void {
    this.lastSlash = s;
    this.lastSlashAt = this.time;
    if (s.kind === 'slash') {
      sfx.bladeWhoosh(s.speed);
      this.fighter.play('swSlash', { ax: Math.cos(s.angle * Math.PI / 180), ay: Math.sin(s.angle * Math.PI / 180) }, 0.06);
      this.fighter.glow = Math.max(this.fighter.glow, s.power);
    }
  }

  /** The direction / quality of the slash touching a target right now, or null when the blade isn't slashing. */
  private currentCut(): { angle: number; dir: Dir8; straight: number; speed: number } | null {
    const live = this.input.detector.live;
    if (live && live.length > 0.06) return { angle: live.angle, dir: live.dir, straight: live.straightness, speed: live.speed };
    const s = this.lastSlash;
    if (s && s.kind === 'slash' && this.time - this.lastSlashAt < 0.1) return { angle: s.angle, dir: s.dir, straight: s.straightness, speed: s.speed };
    return null;
  }

  /* ---------------- physics ---------------- */

  protected stepMode(dt: number): void {
    const f = this.fighter;
    f.pose = this.input.pose();
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      if (this.staggerT <= 0 && this.phase === 'play') { this.input.enabled = true; f.play('swReady'); }
    }
    if (this.phase === 'intro') {
      this.phaseT += dt;
      const c = 3 - Math.floor(this.phaseT / 0.7);
      if (c !== this.countdown && c >= 0) { this.countdown = c; if (c > 0) { sfx.beep(); this.hud.call(String(c), 'big', 0.6); } }
      if (this.phaseT >= 2.1) {
        this.phase = 'play';
        sfx.beep(true);
        this.hud.call(t('sw.slice.go'), 'big', 0.7);
        this.input.enabled = true;
      }
    } else if (this.phase === 'play') {
      this.roundT += dt;
      while (this.next < this.spawns.length && this.spawns[this.next].t <= this.roundT) this.spawn(this.spawns[this.next++]);
      const timeUp = !this.practice && this.roundT >= WAVE.duration;
      const allDone = this.next >= this.spawns.length && this.targets.length === 0;
      if (timeUp || allDone) this.endTurn();
    } else if (this.phase === 'between') {
      this.phaseT += dt;
      if (this.phaseT > 3.2) {
        if (this.turn + 1 < this.ctx.setup.players.length) this.beginTurn(this.turn + 1);
        else this.finish();
      }
    }
    f.stepBlade();
    this.stepTargets(dt);
    f.commitBlade(dt);
    this.stepHalves(dt);
  }

  private spawn(s: Spawn): void {
    const v = this.view(s.kind);
    const decoy = isDecoy(s.kind);
    v.skinMat.color.set(s.golden ? GOLD : KIND[s.kind].skin);
    v.arrow.visible = !decoy && !!s.dir;
    if (s.dir) {
      v.arrowMat.color.set(s.golden ? '#ffffff' : AXIS_COLOR[dirAxis(s.dir)]);
      v.arrow.rotation.set(0, 0, dirAngle(s.dir) * Math.PI / 180);
    }
    const r = this.radius(s.kind);
    v.arrow.position.set(0, 0, r + 0.08);
    v.group.scale.setScalar(1);
    this.targets.push({ s, view: v, age: 0, phase: 'in', pos: new THREE.Vector3(0, 1.6, -WAVE.spawnZ), spin: (this.rng.next() - 0.5) * 2, squash: 0, dead: false, outT: 0 });
  }

  private radius(kind: TargetKind): number {
    const sh = KIND[kind].shape;
    return sh.kind === 'sphere' ? sh.r : sh.kind === 'cylinder' ? sh.r : 0.2;
  }

  /** Hit shape of a target (world). */
  private shapeOf(tg: Target): Shape {
    const k = KIND[tg.s.kind], sh = k.shape, p = tg.pos;
    if (sh.kind === 'cylinder') {
      const half = sh.h / 2;
      const ax = k.lying ? new THREE.Vector3(half, 0, 0) : new THREE.Vector3(0, half, 0);
      ax.applyAxisAngle(new THREE.Vector3(0, 0, 1), tg.view.group.rotation.z);
      return { kind: 'capsule', a: { x: p.x - ax.x, y: p.y - ax.y, z: p.z - ax.z }, b: { x: p.x + ax.x, y: p.y + ax.y, z: p.z + ax.z }, r: sh.r };
    }
    return { kind: 'sphere', c: { x: p.x, y: p.y, z: p.z }, r: sh.kind === 'sphere' ? sh.r : 0.2 };
  }

  private stepTargets(dt: number): void {
    const f = this.fighter;
    const tipSpeed = dt > 0 ? f.tipW.distanceTo(f.prevTipW) / dt : 0;
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const tg = this.targets[i];
      tg.age += dt;
      const s = tg.s;
      // P frame hover point → world (the player faces −z): world = (x, y, −z)
      const hx = s.x, hy = s.y, hz = -WAVE.hoverZ;
      if (tg.phase === 'in') {
        const k = Math.min(1, tg.age / s.travel), e = 1 - (1 - k) * (1 - k);
        tg.pos.set(hx * e, 1.6 + (hy - 1.6) * e + Math.sin(k * Math.PI) * 0.8, -WAVE.spawnZ + (hz + WAVE.spawnZ) * e);
        if (k >= 1) { tg.phase = 'hover'; tg.age = 0; }
      } else if (tg.phase === 'hover') {
        tg.pos.set(hx, hy + Math.sin(tg.age * 4) * 0.03, hz);
        if (tg.age >= s.hover) { tg.phase = 'out'; tg.outT = 0; this.missed(tg); }
      } else {
        tg.outT += dt;
        tg.pos.y -= (1.5 + 9 * tg.outT) * dt;
        tg.view.group.scale.setScalar(Math.max(0.01, 1 - tg.outT / 0.8));
        if (tg.outT > 0.8) { this.release(tg.view); this.targets.splice(i, 1); continue; }
      }
      tg.view.group.rotation.z = s.kind === 'bamboo' || s.kind === 'log' ? 0 : tg.age * tg.spin;
      if (tg.dead || tg.phase === 'out' || !this.input.enabled) continue;
      // in reach only near the end of the approach and while hovering
      if (tg.pos.z < -2.2) continue;
      const hit = sweepCapsule({ a: f.prevHiltW, b: f.prevTipW }, { a: f.hiltW, b: f.tipW }, SW_TUNING.bladeRadius, this.shapeOf(tg));
      if (!hit) continue;
      const cut = this.currentCut();
      if (!cut || tipSpeed < SW_TUNING.hitMinSpeed) { tg.squash = 0.25; continue; }   // a bump, not a cut
      this.hitTarget(tg, i, cut, new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z), new THREE.Vector3(hit.dir.x, hit.dir.y, hit.dir.z));
    }
  }

  private missed(tg: Target): void {
    const s = this.scores[this.turn];
    const at = this.toScreen(tg.pos);
    if (isDecoy(tg.s.kind)) {
      const p = s.decoy(false);
      this.hud.popup(`${t('sw.slice.dodged')} +${p}`, at.x, at.y, 'good');
    } else {
      s.miss();
      this.hud.popup(t('sw.slice.miss'), at.x, at.y, 'bad');
      if (this.layerOn) { Music.setLayer(false); this.layerOn = false; }
    }
    this.showBoard();
  }

  private hitTarget(tg: Target, index: number, cut: { angle: number; dir: Dir8; straight: number; speed: number }, point: THREE.Vector3, motion: THREE.Vector3): void {
    const s = this.scores[this.turn], f = this.fighter;
    const at = this.toScreen(point);
    tg.dead = true;
    if (isDecoy(tg.s.kind)) {
      const lost = s.decoy(true);
      if (tg.s.kind === 'bomb') sfx.bombPoof(); else sfx.bonk();
      this.stars.burst(point, 14, 1.2, () => this.rng.next());
      this.shake(1); this.hitStop(0.8); this.rumble(1, 220);
      this.hud.popup(String(lost), at.x, at.y, 'bad');
      this.hud.call(t('sw.slice.ouch'), 'bad', 0.9);
      this.staggerT = 0.8;
      this.input.enabled = false;
      f.play('swStagger');
      this.release(tg.view);
      this.targets.splice(index, 1);
      if (this.layerOn) { Music.setLayer(false); this.layerOn = false; }
      this.showBoard();
      return;
    }
    const want = tg.s.dir as Dir8;
    const r = s.slice({ want, angle: cut.angle, dir: cut.dir, straight: cut.straight, speed: cut.speed, golden: tg.s.golden });
    this.lastWant = want; this.lastGot = cut.angle;
    // split it along the plane of the blade and its motion
    this.tmpA.copy(f.tipW).sub(f.hiltW).normalize();
    const n = this.tmpB.copy(this.tmpA).cross(motion).normalize();
    if (n.lengthSq() > 0.5) this.split(tg, n, point);
    this.release(tg.view);
    this.targets.splice(index, 1);
    sfx.swishPop(r.perfect);
    this.impact(point, cut.speed / 14, r.perfect ? 14 : 8);
    this.flash.show(this.fighter.hiltW.clone().lerp(this.fighter.tipW, 0.2), point.clone().addScaledVector(motion, 0.5), this.camera, r.dirOk ? '#ffffff' : '#ff9fa8');
    this.hud.popup(r.dirOk ? `+${r.points}${r.mult > 1 ? ` ×${r.mult}` : ''}` : `+${r.points} ${t('sw.slice.wrongDir')}`, at.x, at.y, tg.s.golden ? 'gold' : r.dirOk ? 'good' : 'bad');
    if (r.perfect) { this.hud.call(t('sw.slice.perfect'), 'perfect', 0.8); this.slowMo(0.22, 0.45); this.effects.flash('#ffffff', 0.25); }
    if (r.comboUp) { this.hud.call(`×${s.mult}`, 'big', 0.7); if (s.mult >= 5 && !this.layerOn) { Music.setLayer(true); this.layerOn = true; } }
    if (!r.dirOk && this.layerOn) { Music.setLayer(false); this.layerOn = false; }
    if (this.practice) {
      this.hud.practice({
        want: dirAngle(want), got: cut.angle,
        text: r.dirOk ? (r.perfect ? t('sw.slice.perfect') : t('sw.practice.ok', { deg: Math.round(Math.abs(((cut.angle - dirAngle(want) + 540) % 360) - 180)) })) : t('sw.practice.wrong')
      });
    }
    this.showBoard();
  }

  /** Plane-split the target and throw the two halves apart (pooled meshes that fade). */
  private split(tg: Target, nWorld: THREE.Vector3, point: THREE.Vector3): void {
    const g = tg.view.group, body = tg.view.body;
    g.position.copy(tg.pos);
    g.updateMatrixWorld(true);
    const pl = planeToLocal({ x: nWorld.x, y: nWorld.y, z: nWorld.z }, { x: point.x, y: point.y, z: point.z }, body);
    const res = slicePlane(cachedShape(KIND[tg.s.kind].shape), pl.n, pl.d);
    if (!res) return;
    const k = KIND[tg.s.kind];
    let side = 1;
    for (const h of [res.front, res.back]) {
      const half = this.halves.find(q => q.life <= 0) ?? this.halves[0];
      const c = writeHalf(half.mesh.geometry, h);
      // centre of the half in world space; the mesh takes the body's transform
      half.mesh.position.set(c.x, c.y, c.z).applyMatrix4(body.matrixWorld);
      half.mesh.quaternion.setFromRotationMatrix(body.matrixWorld);
      half.mats[0].color.set(tg.s.golden ? GOLD : k.skin);
      half.mats[1].color.set(k.inside);
      half.mats[0].opacity = 1; half.mats[1].opacity = 1;
      half.mesh.visible = true;
      half.v.copy(nWorld).multiplyScalar(side * 1.4).add(new THREE.Vector3(0, 1.2, 0.6));
      half.axis.copy(nWorld);
      half.spin = side * (5 + this.rng.next() * 4);
      half.life = 1.3;
      side = -1;
    }
  }

  private stepHalves(dt: number): void {
    for (const h of this.halves) {
      if (h.life <= 0) continue;
      h.life -= dt;
      h.v.y -= 9.8 * dt;
      h.mesh.position.addScaledVector(h.v, dt);
      h.mesh.rotateOnWorldAxis(h.axis, h.spin * dt);
      const a = Math.min(1, h.life / 0.4);
      h.mats[0].opacity = a; h.mats[1].opacity = a;
      if (h.mesh.position.y < 0.05) { h.mesh.position.y = 0.05; h.v.multiplyScalar(0.4); h.v.y = Math.abs(h.v.y) * 0.3; }
      if (h.life <= 0) h.mesh.visible = false;
    }
  }

  /* ---------------- frame ---------------- */

  protected frameMode(dt: number, realDt: number): void {
    for (const tg of this.targets) {
      const g = tg.view.group;
      g.position.copy(tg.pos);
      tg.squash = Math.max(0, tg.squash - realDt * 2);
      const sq = 1 + tg.squash * Math.sin(tg.age * 40) * 0.5;
      if (tg.phase !== 'out') g.scale.set(sq, 2 - sq, sq);
      // the arrow always faces the camera, in the screen plane
      tg.view.arrow.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (tg.s.dir ? dirAngle(tg.s.dir) : 0) * Math.PI / 180 - g.rotation.z);
    }
    this.fighter.update(dt);
    if (this.phase === 'play' && !this.practice) {
      const left = Math.max(0, WAVE.duration - this.roundT);
      this.hud.clock(`${Math.ceil(left)}`, left < 10);
    } else this.hud.clock(null);
    const d = this.input.detector;
    this.hud.guard(d.guard?.zone ?? null);
    if (this.practice && this.lastWant === null) this.hud.practice({ want: null, got: null, text: t('sw.practice.start') });
  }

  protected debugLines(): string[] {
    const s = this.scores[this.turn];
    return [
      `slice      phase ${this.phase} · t ${this.roundT.toFixed(1)} s · targets ${this.targets.length} · next ${this.next}/${this.spawns.length}`,
      `score      ${s.score} · ×${s.mult} · good ${s.good} wrong ${s.wrong} miss ${s.missed} · decoys ${s.decoysCut}/${s.decoysDodged}`,
      `practice   want ${this.lastWant ?? '–'} got ${this.lastGot !== null ? `${this.lastGot.toFixed(0)}°` : '–'}`
    ];
  }

  toggleScores(): void { this.showBoard(); }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' || e.key === 'Tab' || /^F\d+$/.test(e.key)) return false;
    // skip the between-turns card
    if ((e.code === 'Enter' || e.code === 'Space') && this.phase === 'between') { this.phaseT = 99; return true; }
    return false;
  }

  dispose(): void {
    if (this.layerOn) Music.setLayer(false);
    for (const h of this.halves) h.mesh.removeFromParent();
    for (const v of this.views) v.group.removeFromParent();
    super.dispose();
  }
}

export const createSpeedSlice: SceneFactory = async ctx => new SpeedSlice(ctx);

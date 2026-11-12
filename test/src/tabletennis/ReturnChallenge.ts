import * as THREE from 'three';
import type { MatchSummary, SceneContext, SceneFactory } from '../sports/types';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import { toon } from '../render/Toon';
import { TTBaseScene } from './TTBase';
import type { Contact } from './BallPhysics';
import type { HitInfo } from './Engine';
import type { RulesOutcome } from './Rules';
import { planShot } from './Shot';
import type { PaddleSkin } from './Paddle';
import { BallMachine, MACHINE_POS, machineStep, targetsHit, type Target } from './BallMachine';
import { RC_RULES, ReturnScore } from './ReturnRules';

/**
 * Return Challenge (house rules, see ReturnRules.ts): a ball machine on the far side fires balls with
 * growing speed, spin and placement. Return them onto its half for points, land in the glowing
 * targets for bonuses, keep the combo going. Three misses and it's over.
 */
class ReturnChallengeScene extends TTBaseScene {
  private score = new ReturnScore();
  private readonly machine: BallMachine;
  private targets: Target[] = [];
  private counted = false;
  private nextBallT = -1;
  private doneT = -1;
  private readonly machineMesh: THREE.Group;
  private readonly barrel: THREE.Mesh;
  private recoil = 0;
  private disposed = false;
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];

  constructor(ctx: SceneContext) {
    super(ctx);
    this.machine = new BallMachine(this.seed);
    const skin = ((ctx.setup.cosmetics ?? {}).paddle as PaddleSkin) || 'classic';
    this.addPlayer(0, ctx.setup.players[0], { kind: 'human', input: 1 }, skin);
    this.createEngine(1, 0);
    this.park();

    // the ball machine: a squat body with a barrel aimed at the player
    this.machineMesh = new THREE.Group();
    const body = new THREE.Mesh(this.g(new THREE.BoxGeometry(0.42, 0.34, 0.36)), this.m(toon('#ff8a3c')));
    body.position.y = -0.2;
    this.barrel = new THREE.Mesh(this.g(new THREE.CylinderGeometry(0.05, 0.065, 0.3, 14)), this.m(toon('#2b2f38')));
    this.barrel.rotation.x = Math.PI / 2;
    this.barrel.position.z = 0.12;
    const stand = new THREE.Mesh(this.g(new THREE.CylinderGeometry(0.04, 0.12, MACHINE_POS.y - 0.36, 10)), this.m(toon('#6b6f7a')));
    stand.position.y = -0.37 - (MACHINE_POS.y - 0.36) / 2;
    const lamp = new THREE.Mesh(this.g(new THREE.SphereGeometry(0.04, 10, 8)), this.m(new THREE.MeshBasicMaterial({ color: '#3ff2ff' })));
    lamp.position.set(0, -0.02, 0.0);
    this.machineMesh.add(body, this.barrel, stand, lamp);
    for (const c of this.machineMesh.children) c.castShadow = true;
    this.machineMesh.position.set(MACHINE_POS.x, MACHINE_POS.y, MACHINE_POS.z - 0.12);
    this.table.scene.add(this.machineMesh);

    this.refreshSettings();
    this.setQuality(ctx.quality());
  }

  private g<G extends THREE.BufferGeometry>(x: G): G { this.geos.push(x); return x; }
  private m<M extends THREE.Material>(x: M): M { this.mats.push(x); return x; }

  /** No serves in this mode: keep the engine between rallies with the ball out of the way. */
  private park(): void {
    this.engine.phase = 'over';
    this.engine.ball.set({ x: MACHINE_POS.x, y: MACHINE_POS.y, z: MACHINE_POS.z + 0.1 }, { x: 0, y: 0, z: 0 });
    this.engine.ball.live = false;
  }

  protected introDone(): void {
    this.beginPlay();
    this.refreshTargets();
    this.updateHud();
    this.hud.call(t('tt.rc.go'), 'big', 1.6);
    const key = this.humans()[0]?.isMouse ? 'tt.hint.rcMouse' : 'tt.hint.rcMotion';
    this.hud.hint(t(key), 4000);
    this.nextBallT = 1.6;
  }

  private refreshTargets(): void {
    this.targets = this.machine.targets(this.score.level);
    this.table.setTargets(this.targets);
  }

  private updateHud(): void {
    this.hud.setReturnStats(this.score.score, this.score.lives, RC_RULES.lives, this.score.multiplier, this.score.level, 0);
  }

  private fire(): void {
    const ball = this.machine.next(this.score.level);
    const plan = planShot(ball.from, ball.intent, 1);
    this.recorder.reset();
    this.engine.launch(ball.from, plan, 1);
    this.counted = false;
    this.recoil = 1;
    sfx.paddleHit(0.4, 0.6);
    this.phase = 'play';
  }

  protected onContact(c: Contact): void {
    super.onContact(c);
    if (c.kind !== 'table' || c.side !== 1 || this.counted || this.engine.lastHit !== 0) return;
    // a valid return: it bounced on the machine's half after the player's shot
    this.counted = true;
    const hits = targetsHit(c.pos, this.targets);
    const spin = !!this.lastHit?.spinShot;
    const r = this.score.addReturn({ spin, targets: hits });
    if (hits) {
      sfx.target();
      this.targets.forEach((tg, i) => { if (Math.hypot(c.pos.x - tg.x, c.pos.z - tg.z) <= tg.r) this.table.hitTarget(i); });
      this.hud.call(t('tt.rc.target', { n: r.points }), 'rally', 1);
      Crowd.cheer(0.5);
    } else this.hud.call(`+${r.points}${r.multiplier > 1 ? ` ×${r.multiplier}` : ''}`, 'point', 0.8);
    if (r.levelUp) { this.hud.call(t('tt.rc.levelUp', { n: r.level }), 'game', 1.6); sfx.ttGame(); }
    if (hits || r.levelUp) window.setTimeout(() => { if (!this.disposed && !this.score.over) this.refreshTargets(); }, 500);
    this.updateHud();
  }

  protected onHit(_h: HitInfo): void { /* scoring happens on the bounce */ }

  protected onOutcome(o: RulesOutcome): void {
    if (o.kind !== 'point') { this.nextBallT = 0.8; return; }
    // the player (side 0) failed to return a playable ball → miss; anything else just moves on
    const playerFailed = o.result.winner === 1 && !this.counted;
    if (playerFailed) {
      const over = this.score.miss();
      sfx.lifeLost();
      Crowd.aww();
      this.bySide(0)?.anim.play('ttDisappointed', { blend: 0.15 });
      this.hud.call(over ? t('tt.rc.over') : t('tt.rc.miss'), over ? 'game' : 'big', over ? 2.2 : 1);
      this.updateHud();
      if (over) { this.phase = 'between'; this.doneT = 2.4; this.nextBallT = -1; return; }
    }
    this.phase = 'between';
    this.nextBallT = Math.max(0.5, machineStep(this.score.level).interval - 1.1);
  }

  frame(alpha: number, realDt: number): void {
    super.frame(alpha, realDt);
    const dt = this.paused ? 0 : realDt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.barrel.position.z = 0.12 - 0.05 * this.recoil;
    if (this.nextBallT > 0 && this.phase !== 'intro' && this.phase !== 'replay') {
      this.nextBallT -= dt;
      if (this.nextBallT <= 0) { this.nextBallT = -1; this.fire(); }
    }
    if (this.doneT > 0) {
      this.doneT -= dt;
      if (this.doneT <= 0) { this.phase = 'done'; this.ctx.onFinished(this.summary()); }
    }
  }

  protected debugLines(): string[] {
    const s = this.score;
    return [`RC         level ${s.level} · ×${s.multiplier} · lives ${s.lives} · returns ${s.returns}`];
  }

  private summary(): MatchSummary {
    const p = this.ctx.setup.players[0], s = this.score;
    return {
      sport: 'tabletennis', mode: 'returnChallenge', practice: false, frames: 1, winner: 0, history: [],
      players: [{
        name: p.name, color: p.color, profileId: p.profileId, buddy: p.buddy,
        score: s.score, total: s.score, handicap: 0, rolls: [],
        stats: { returns: s.returns, targets: s.targets, bestCombo: s.bestCombo, spinShots: s.spinShots }
      }]
    };
  }

  protected restartMatch(): void {
    this.score = new ReturnScore();
    this.doneT = -1;
    this.createEngine(1, 0);
    this.park();
    this.beginPlay();
    this.refreshTargets();
    this.updateHud();
    this.nextBallT = 1.2;
  }

  dispose(): void {
    this.disposed = true;
    super.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

export const createReturnChallenge: SceneFactory = async ctx => new ReturnChallengeScene(ctx);

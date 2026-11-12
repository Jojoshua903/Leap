import type { MatchPlayer, MatchSummary, PlayerResult, SceneContext, SceneFactory } from '../sports/types';
import { bus, type GameEvents } from '../core/events';
import { t } from '../i18n';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import * as THREE from 'three';
import { FAV_COLORS, randomBuddy } from '../buddy/BuddyConfig';
import { TTBaseScene } from './TTBase';
import { Rng } from './BallPhysics';
import type { HitInfo } from './Engine';
import { other, type BestOf, type RulesOutcome, type Side } from './Rules';
import type { PaddleSkin } from './Paddle';
import { getLevel } from './AI';

interface SideStats {
  gamesWon: number; pointsWon: number; longestRally: number; longRallies: number;
  aces: number; smashes: number; spinPoints: number; comebacks: number; perfectGames: number;
}
const freshStats = (): SideStats => ({ gamesWon: 0, pointsWon: 0, longestRally: 0, longRallies: 0, aces: 0, smashes: 0, spinPoints: 0, comebacks: 0, perfectGames: 0 });

const BETWEEN = 1.9;      // s between the end of a rally and the next serve

/**
 * Match Play: 1 player vs. the AI (5 levels) or 2 local players with their own controllers.
 * Best of 1 / 3 / 5 games to 11. Coin toss for the first serve, score call-outs, rally flashes,
 * a camera push-in on game point and a half-speed side-camera replay of the match-winning point.
 */
class MatchPlayScene extends TTBaseScene {
  private readonly bestOf: BestOf;
  private readonly rng: Rng;
  private stats: [SideStats, SideStats] = [freshStats(), freshStats()];
  private down05: [boolean, boolean] = [false, false];
  private betweenT = -1;
  private doneT = -1;
  private queued: { text: string; kind: 'game' | 'deuce'; at: number } | null = null;
  private pendingFinish = false;
  private readonly matchPlayers: [MatchPlayer, MatchPlayer];
  private readonly vsAI: boolean;

  constructor(ctx: SceneContext) {
    super(ctx);
    const opts = ctx.setup.options;
    const g = Number(opts.games ?? 3);
    this.bestOf = (g === 1 || g === 5 ? g : 3) as BestOf;
    this.rng = new Rng(this.seed ^ 0x5eed);
    const skin = ((ctx.setup.cosmetics ?? {}).paddle as PaddleSkin) || 'classic';
    const p1 = ctx.setup.players[0];
    const human2 = ctx.setup.players.length > 1 && !!ctx.second;
    this.vsAI = !human2;
    const level = getLevel(Number(opts.ai ?? 1));
    let p2: MatchPlayer;
    if (human2) p2 = ctx.setup.players[1];
    else {
      const used = FAV_COLORS.indexOf(p1.color);
      const ci = (used >= 0 ? used + 5 : 9) % FAV_COLORS.length;
      const r = new Rng(this.seed);
      const buddy = { ...randomBuddy(() => r.next()), color: ci };
      p2 = { name: `${buddy.name} (${t(level.nameKey)})`, color: FAV_COLORS[ci], profileId: null, buddy, handicap: 0 };
    }
    this.matchPlayers = [p1, p2];
    this.addPlayer(0, p1, { kind: 'human', input: 1 }, skin);
    this.addPlayer(1, p2, human2 ? { kind: 'human', input: 2 } : { kind: 'ai', level: level.id }, human2 ? 'classic' : 'carbon');
    this.createEngine(this.bestOf, this.coin());
    this.refreshSettings();
    this.setQuality(ctx.quality());
  }

  private coin(): Side { return this.rng.next() < 0.5 ? 0 : 1; }

  protected onRulesEvent(ev: string, payload: unknown): void {
    bus.emit(ev as keyof GameEvents, payload as never);
  }

  protected introDone(): void {
    const s = this.engine.server;
    this.hud.call(t('tt.coin', { name: this.matchPlayers[s].name }), 'big', 2.2);
    this.beginPlay();
    this.showScore();
    this.serveHint();
  }

  private serveHint(): void {
    const s = this.engine.server;
    const p = this.bySide(s);
    if (!p?.human) return;
    const key = p.human.isMouse ? 'tt.hint.serveMouse' : 'tt.hint.serveMotion';
    this.hud.hint(`${this.matchPlayers[s].name}: ${t(key)}`, 3200);
  }

  private showScore(): void {
    const sc = this.engine.rules.score;
    const note = sc.deuce ? t('tt.deuce') : t('tt.bestOf', { n: this.bestOf });
    this.hud.setScore(sc.points, sc.games, this.engine.phase === 'over' ? null : this.engine.server, note);
  }

  protected onHit(h: HitInfo): void {
    if (h.type === 'smash') this.stats[h.side].smashes += 1;
  }

  protected onOutcome(o: RulesOutcome): void {
    const sc = this.engine.rules.score;
    if (o.kind === 'continue') return;
    this.betweenT = BETWEEN;
    this.phase = 'between';
    if (o.kind === 'let') { this.hud.call(t('tt.let'), 'big', 1.3); return; }

    const r = o.result, w = r.winner, l = other(w);
    const st = this.stats[w];
    st.pointsWon += 1;
    if (r.ace) st.aces += 1;
    for (const s of this.stats) { s.longestRally = Math.max(s.longestRally, r.rally); if (r.rally > 10) s.longRallies += 1; }
    if (this.lastHit && this.lastHit.side === w && this.lastHit.spinShot) st.spinPoints += 1;
    // comeback: trailing 0–5 in a game you go on to win
    const [a, b] = o.gameScore;
    const mine = [a, b];
    for (const s of [0, 1] as const) if (mine[s] === 0 && mine[other(s)] >= 5) this.down05[s] = true;

    // reactions
    const wp = this.bySide(w), lp = this.bySide(l);
    wp?.anim.play('ttCelebrate', { blend: 0.15 });
    lp?.anim.play('ttDisappointed', { blend: 0.15 });
    sfx.ttPoint(!this.vsAI || w === 0);
    if (r.rally >= 10) Crowd.cheer(Math.min(1, 0.5 + r.rally / 30)); else if (r.ace) Crowd.cheer(0.4);
    this.table.excite(r.rally >= 10 ? 0.9 : 0.35);

    if (o.gameWon !== null) {
      const g = o.gameWon;
      this.stats[g].gamesWon += 1;
      if (this.down05[g]) this.stats[g].comebacks += 1;
      if (o.gameScore[other(g)] === 0) this.stats[g].perfectGames += 1;
      this.down05 = [false, false];
      sfx.ttGame();
    }
    if (o.matchWon !== null) {
      this.hud.call(t('tt.matchWon', { name: this.matchPlayers[o.matchWon].name }), 'game', 2.5);
      this.pendingFinish = true;
      this.betweenT = 1.6;
    } else if (o.gameWon !== null) {
      this.hud.call(t('tt.gameWon', { name: this.matchPlayers[o.gameWon].name, a: o.gameScore[o.gameWon], b: o.gameScore[other(o.gameWon)] }), 'game', 2.2);
      this.betweenT = 2.6;
    } else {
      // call the score server-first, like an umpire
      const srv = sc.server();
      this.hud.call(`${sc.points[srv]}–${sc.points[other(srv)]}`, 'score', 1.2);
      const mp = sc.matchPoint(), gp = sc.gamePoint();
      if (sc.deuce && sc.points[0] === sc.points[1]) this.queued = { text: t('tt.deuceCall'), kind: 'deuce', at: 0.9 };
      else if (mp !== null) this.queued = { text: t('tt.matchPoint'), kind: 'game', at: 0.9 };
      else if (gp !== null) this.queued = { text: t('tt.gamePoint'), kind: 'game', at: 0.9 };
    }
    this.showScore();
  }

  frame(alpha: number, realDt: number): void {
    super.frame(alpha, realDt);
    const dt = this.paused ? 0 : realDt;
    if (this.queued) { this.queued.at -= dt; if (this.queued.at <= 0) { this.hud.call(this.queued.text, this.queued.kind, 1.3); this.queued = null; } }
    if (this.phase === 'between' && this.betweenT > 0) {
      this.betweenT -= dt;
      if (this.betweenT <= 0) {
        if (this.pendingFinish) {
          this.pendingFinish = false;
          if (!this.startReplay(() => this.finish())) this.finish();
        } else this.next();
      }
    }
    if (this.doneT > 0) { this.doneT -= dt; if (this.doneT <= 0) this.ctx.onFinished(this.summary()); }
  }

  private next(): void {
    this.nextRally();
    const sc = this.engine.rules.score;
    this.table.setCamera(sc.gamePoint() !== null ? 'pushIn' : 'play');
    this.showScore();
    this.serveHint();
  }

  private finish(): void {
    this.phase = 'done';
    this.table.setCamera('intro');
    const w = this.engine.rules.score.matchWinner ?? 0;
    const wp = this.bySide(w);
    wp?.anim.play('ttCelebrate', { blend: 0.2 });
    this.bySide(other(w))?.anim.play('ttDisappointed', { blend: 0.2 });
    if (wp) this.effects.confetti(new THREE.Vector3(wp.body.x, 1.6, wp.body.z), 280, 1);
    Crowd.cheer(1);
    this.doneT = 1.4;
  }

  private summary(): MatchSummary {
    const sc = this.engine.rules.score;
    const players: PlayerResult[] = this.matchPlayers.map((p, i) => {
      const s = this.stats[i];
      return {
        name: p.name, color: p.color, profileId: p.profileId, buddy: p.buddy,
        score: s.gamesWon, total: s.gamesWon, handicap: 0,
        rolls: sc.finished.map(g => g[i]),
        stats: { ...s }
      };
    });
    return {
      sport: 'tabletennis', mode: 'matchPlay', practice: false, frames: Math.max(1, sc.finished.length),
      players, winner: sc.matchWinner ?? -1, history: []
    };
  }

  protected restartMatch(): void {
    this.stats = [freshStats(), freshStats()];
    this.down05 = [false, false];
    this.pendingFinish = false;
    this.queued = null;
    this.betweenT = -1; this.doneT = -1;
    this.createEngine(this.bestOf, this.coin());
    this.beginPlay();
    this.nextRally();
    this.hud.call(t('tt.coin', { name: this.matchPlayers[this.engine.server].name }), 'big', 2);
    this.showScore();
  }
}

export const createMatchPlay: SceneFactory = async ctx => new MatchPlayScene(ctx);

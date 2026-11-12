import * as THREE from 'three';
import type { MatchPlayer, PlayerResult, SceneContext, SceneFactory } from '../sports/types';
import { defaultBuddy } from '../buddy/BuddyConfig';
import type { JointName } from '../buddy/BuddyBuilder';
import { sfx } from '../audio/Sfx';
import { Crowd } from '../audio/CrowdSfx';
import { Music } from '../audio/Music';
import { t } from '../i18n';
import { GUARD_POSE, READY_POSE, SwordBase, lerpPose, slashPose, thrustPose, type BladePose, type Fighter, type SwordInput } from './SwordBase';
import { ARENA_LOOK, buildArena, type ArenaId, type Kit } from './ArenaScenes';
import {
  DUEL, canAct, matchWinner, newFighter, resolve, roundWinner, setGuard, tickFighter, tryDodge,
  type Attack, type Fighter as Rules, type Resolution
} from './DuelRules';
import { DuelAI, type Incoming, type Pending } from './DuelAI';
import type { GuardZone, LiveSlash, Slash } from './SlashDetector';
import { DIRS, dirFromAngle, v3, type Dir8 } from './swMath';

/** AI opponents: original names, one per level. */
export const AI_NAME_KEYS = ['sw.ai.1', 'sw.ai.2', 'sw.ai.3', 'sw.ai.4', 'sw.ai.5'];

type Phase = 'intro' | 'fight' | 'ko' | 'replay' | 'roundEnd' | 'matchEnd' | 'done';

const PLATFORM_Y = 0.3;
const GAP = 1.25;
const STAGGER_POSE: BladePose = { hilt: v3(0.25, 0.9, 0.3), dir: v3(-0.25, -0.6, 0.76) };
const JOINTS: JointName[] = ['root', 'hips', 'spine', 'neck', 'head', 'shoulderL', 'shoulderR', 'handL', 'handR', 'hipL', 'hipR'];
const REC_FRAMES = 150;
const REC_PER_FIGHTER = 4 + JOINTS.length * 4 + 6;

/** Records both fighters' poses every frame so the final blow can be replayed. */
class PoseRecorder {
  private readonly buf = new Float32Array(REC_FRAMES * REC_PER_FIGHTER * 2);
  private head = 0;
  count = 0;

  record(fs: Fighter[]): void {
    let o = this.head * REC_PER_FIGHTER * 2;
    for (const f of fs) {
      const b = this.buf;
      b[o++] = f.pos.x; b[o++] = f.pos.y; b[o++] = f.pos.z; b[o++] = f.yaw;
      for (const j of JOINTS) { const r = f.rig.joints[j]; b[o++] = r.rotation.x; b[o++] = r.rotation.y; b[o++] = r.rotation.z; b[o++] = r.position.y; }
      b[o++] = f.pose.hilt.x; b[o++] = f.pose.hilt.y; b[o++] = f.pose.hilt.z; b[o++] = f.pose.dir.x; b[o++] = f.pose.dir.y; b[o++] = f.pose.dir.z;
    }
    this.head = (this.head + 1) % REC_FRAMES;
    this.count = Math.min(REC_FRAMES, this.count + 1);
  }

  /** Apply frame k (0 = oldest kept). */
  apply(k: number, fs: Fighter[]): void {
    const idx = (this.head - this.count + Math.max(0, Math.min(this.count - 1, Math.floor(k))) + REC_FRAMES * 2) % REC_FRAMES;
    let o = idx * REC_PER_FIGHTER * 2;
    for (const f of fs) {
      const b = this.buf;
      f.pos.set(b[o], b[o + 1], b[o + 2]); f.yaw = b[o + 3]; o += 4;
      for (const j of JOINTS) { const r = f.rig.joints[j]; r.rotation.set(b[o], b[o + 1], b[o + 2]); r.position.y = b[o + 3]; o += 4; }
      f.pose = { hilt: v3(b[o], b[o + 1], b[o + 2]), dir: v3(b[o + 3], b[o + 4], b[o + 5]) }; o += 6;
      f.redraw();
    }
  }

  clear(): void { this.head = 0; this.count = 0; }
}

interface Side {
  f: Fighter;
  rules: Rules;
  input: SwordInput | null;
  ai: DuelAI | null;
  /** Its attack on the way (AI wind-ups, and thrusts, which land after DUEL.thrustWindup). */
  pending: Pending | null;
  /** The player's slash in progress, as the other side sees it. */
  live: Incoming | null;
  liveId: number;
  lunge: number;
  dodgeT: number;
  recover: number;
  lastAttack: Attack | null;
  slashes: Record<Dir8, number>;
  kos: number;
  baseX: number;
}

/**
 * Duel: best of 3 (or a single round) on a round wooden platform. Against the AI (levels 1–5) or a second
 * local player on another controller; the camera watches from the side and pushes in on the action.
 *
 * Your slashes count when they END (SlashDetector output: direction, power, straightness); the other side
 * sees them coming from the moment they start. Thrusts are slow: they land DUEL.thrustWindup after the stab.
 * Telegraph arrows over the opponent show its wind-up as YOU would see it facing it (not in the side view):
 * guard where the arrow starts.
 */
class Duel extends SwordBase {
  private readonly arena: Kit;
  private readonly sides: [Side, Side];
  private readonly vsAI: boolean;
  private readonly aiLevel: number;
  private readonly toWin: number;
  private readonly wins: [number, number] = [0, 0];
  private readonly rec = new PoseRecorder();
  private phase: Phase = 'intro';
  private phaseT = 0;
  private round = 0;
  private roundStart = 0;
  private koBy = 0;
  private replayT = 0;
  private push = 0;
  private readonly aiPlayer: MatchPlayer;
  private readonly log: Resolution[] = [];
  private lastRes: { res: Resolution; by: number } | null = null;
  private layer = false;
  private readonly tmp = new THREE.Vector3();

  constructor(ctx: SceneContext) {
    const arena = (ctx.setup.cosmetics?.arena as ArenaId | undefined) ?? 'courtyard';
    super(ctx, ARENA_LOOK[arena] ?? ARENA_LOOK.courtyard);
    this.arena = buildArena(this.scene, ARENA_LOOK[arena] ? arena : 'courtyard');
    this.disposables.push(this.arena);
    this.vsAI = ctx.setup.players.length < 2;
    this.aiLevel = Number(ctx.setup.options.ai ?? 2);
    this.toWin = Number(ctx.setup.options.rounds ?? 3) === 1 ? 1 : DUEL.roundsToWin;
    this.aiPlayer = {
      name: t(AI_NAME_KEYS[Math.max(1, Math.min(5, this.aiLevel)) - 1]), color: '#7a8aa0', profileId: null,
      buddy: { ...defaultBuddy('AI', 4), skin: 2, hair: 4, hairColor: 3 }, handicap: 0
    };
    const f0 = this.makeFighter(0);
    // the AI is a Buddy in a knight outfit
    const f1 = this.vsAI ? this.makeFighter(1, 'knight', 'right', this.aiPlayer) : this.makeFighter(1);
    const side = (f: Fighter, i: number): Side => ({
      f, rules: newFighter(), input: null, ai: null, pending: null, live: null, liveId: -1, lunge: 0, dodgeT: 0, recover: 0,
      lastAttack: null, slashes: { right: 0, upRight: 0, up: 0, upLeft: 0, left: 0, downLeft: 0, down: 0, downRight: 0 }, kos: 0,
      baseX: i === 0 ? -GAP : GAP
    });
    this.sides = [side(f0, 0), side(f1, 1)];
    this.sides[0].input = this.makeInput(this.events(0));
    if (this.vsAI) this.sides[1].ai = new DuelAI(this.aiLevel, this.seed);
    else if (ctx.second) this.sides[1].input = this.makeInput(this.events(1), true);
    else this.sides[1].ai = new DuelAI(this.aiLevel, this.seed);   // no second controller: the AI stands in
    this.placeFighters();
    this.setSunOffset(5, 12, 7);
    this.hud.setKeys('sw.keys.duel');
    this.setQuality(ctx.quality());
    this.refreshSettings();
  }

  protected fighters(): Fighter[] { return this.sides ? this.sides.map(s => s.f) : []; }

  private events(i: number) {
    return {
      slash: (s: Slash) => this.onSlash(i, s),
      ignored: () => { this.sides[i].live = null; },
      live: (l: LiveSlash) => this.onLive(i, l),
      guard: (g: { zone: GuardZone } | null) => { if (this.phase === 'fight') setGuard(this.sides[i].rules, g?.zone ?? null, this.time); },
      dodge: () => this.dodge(i),
      recenter: () => this.hud.hint(t('sw.hint.recentered'), 1.2)
    };
  }

  private placeFighters(): void {
    for (const [i, s] of this.sides.entries()) {
      s.f.pos.set(s.baseX, PLATFORM_Y, 0);
      s.f.yaw = i === 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  /* ---------------- flow ---------------- */

  start(): void {
    for (const s of this.sides) s.input?.attach();
    this.beginRound();
  }

  restart(): void {
    this.wins[0] = 0; this.wins[1] = 0; this.round = 0;
    for (const s of this.sides) { s.kos = 0; s.slashes = { right: 0, upRight: 0, up: 0, upLeft: 0, left: 0, downLeft: 0, down: 0, downRight: 0 }; }
    this.log.length = 0;
    this.beginRound();
  }

  private beginRound(): void {
    this.round += 1;
    this.phase = 'intro'; this.phaseT = 0;
    for (const s of this.sides) {
      const keep = s.rules;
      // HP, meter and timers reset each round; hits / parries / blocks / damage add up for the results
      s.rules = { ...newFighter(), hits: keep.hits, parries: keep.parries, blocks: keep.blocks, damageTaken: keep.damageTaken };
      s.pending = null; s.live = null; s.lunge = 0; s.dodgeT = 0; s.recover = 0;
      s.ai?.reset(this.time);
      s.input?.reset();
      if (s.input) s.input.enabled = false;
      s.f.play('swReady', {}, 0.3);
    }
    this.rec.clear();
    this.placeFighters();
    this.hud.resetGhost();
    this.hud.call(t('sw.duel.round', { n: this.round }), 'big', 1.2);
    sfx.gong();
  }

  private startFight(): void {
    this.phase = 'fight';
    this.roundStart = this.time;
    for (const s of this.sides) if (s.input) s.input.enabled = true;
    this.hud.call(t('sw.duel.fight'), 'big', 0.8);
    sfx.beep(true);
  }

  private endRound(winner: 0 | 1 | -1, ko: boolean): void {
    for (const s of this.sides) { if (s.input) s.input.enabled = false; s.pending = null; s.live = null; }
    if (winner === -1) {
      this.hud.call(t('sw.duel.draw'), 'big', 1.4);
      this.phase = 'roundEnd'; this.phaseT = 0;
      return;
    }
    this.wins[winner] += 1;
    if (ko) {
      this.sides[winner].kos += 1;
      this.koBy = winner;
      this.phase = 'ko'; this.phaseT = 0;
      this.hud.call(t('sw.duel.ko'), 'ko', 1.6);
      sfx.gong();
      Crowd.cheer(1);
      this.slowMo(1.3, 0.3);
      this.sides[winner === 0 ? 1 : 0].f.play('swDefeat', {}, 0.1);
      this.effects.flash('#ffffff', 0.4);
    } else {
      this.hud.call(t('sw.duel.time'), 'big', 1.2);
      this.phase = 'roundEnd'; this.phaseT = 0;
      Crowd.cheer(0.6);
    }
    this.sides[winner].f.play('swVictory', {}, 0.2);
  }

  private afterRound(): void {
    const w = matchWinner(this.wins, this.toWin);
    if (w === null) { this.beginRound(); return; }
    this.phase = 'matchEnd'; this.phaseT = 0;
    const name = w === 0 ? this.ctx.setup.players[0].name : this.vsAI ? this.aiPlayer.name : this.ctx.setup.players[1].name;
    this.effects.bigText(t('sw.duel.wins', { name }), `${this.wins[0]} – ${this.wins[1]}`, 'strike');
    this.effects.confetti(this.sides[w].f.pos.clone().setY(1.8), 240, 1);
    this.sides[w].f.play('swVictory');
    this.sides[w === 0 ? 1 : 0].f.play('swDefeat');
    Crowd.cheer(1);
    Music.setLayer(false); this.layer = false;
  }

  private finish(): void {
    this.phase = 'done';
    for (const s of this.sides) s.input?.detach();
    const w = matchWinner(this.wins, this.toWin) ?? (this.wins[0] >= this.wins[1] ? 0 : 1);
    const mk = (i: 0 | 1, p: MatchPlayer): PlayerResult => {
      const s = this.sides[i], o = this.sides[i === 0 ? 1 : 0];
      const stats: Record<string, number> = {
        won: w === i ? 1 : 0, lost: w === i ? 0 : 1, rounds: this.wins[i], parries: s.rules.parries, kos: s.kos,
        hits: s.rules.hits, damageTaken: s.rules.damageTaken, flawless: w === i && s.rules.damageTaken === 0 ? 1 : 0,
        blocks: s.rules.blocks, opponentHits: o.rules.hits
      };
      for (const d of DIRS) stats[`slash_${d}`] = s.slashes[d];
      return {
        name: p.name, color: p.color, profileId: p.profileId, buddy: p.buddy, score: this.wins[i], total: this.wins[i], handicap: 0, rolls: [], stats,
        breakdown: {
          head: [t('sw.res.hits'), t('sw.res.parries'), t('sw.res.blocks'), t('sw.res.taken')],
          rows: [[String(s.rules.hits), String(s.rules.parries), String(s.rules.blocks), String(s.rules.damageTaken)]]
        }
      };
    };
    const p1 = this.vsAI ? this.aiPlayer : this.ctx.setup.players[1];
    const players = [mk(0, this.ctx.setup.players[0]), mk(1, p1)];
    this.ctx.onFinished({ sport: 'swordplay', mode: 'duel', practice: false, frames: this.round, players, winner: w, history: [] });
  }

  /* ---------------- input ---------------- */

  private onLive(i: number, l: LiveSlash): void {
    const s = this.sides[i];
    if (this.phase !== 'fight' || !canAct(s.rules)) return;
    // what the other side sees: a slash on its way (same object while it lasts, so the AI reacts once)
    if (s.liveId !== l.id || !s.live) {
      s.liveId = l.id;
      const a = l.angle * Math.PI / 180;
      s.live = { attack: { kind: 'slash', dx: Math.cos(a), dy: Math.sin(a), power: l.power, straight: l.straightness }, start: this.time, land: null };
      setGuard(s.rules, null, this.time);
    }
  }

  private onSlash(i: number, sl: Slash): void {
    const s = this.sides[i];
    this.lastSlash = i === 0 ? sl : this.lastSlash;
    s.live = null;
    if (this.phase !== 'fight' || !canAct(s.rules) || s.pending || s.recover > 0) return;
    s.slashes[sl.dir] += 1;
    if (sl.kind === 'thrust') {
      const a: Attack = { kind: 'thrust', dx: 0, dy: 0, power: Math.max(0.4, sl.power), straight: 1 };
      s.pending = { attack: a, start: this.time, land: this.time + DUEL.thrustWindup, feint: false, switchAt: Infinity };
      s.f.play('swThrust', {}, 0.06);
      sfx.bladeWhoosh(6);
      return;
    }
    const a = sl.angle * Math.PI / 180;
    const atk: Attack = { kind: 'slash', dx: Math.cos(a), dy: Math.sin(a), power: sl.power, straight: sl.straightness };
    s.f.play('swSlash', { ax: atk.dx, ay: atk.dy }, 0.05);
    sfx.bladeWhoosh(sl.speed);
    s.lunge = 1;
    s.lastAttack = atk;
    s.recover = 0.18;
    this.land(i, atk);
  }

  private dodge(i: number): void {
    const s = this.sides[i];
    if (this.phase !== 'fight') return;
    if (tryDodge(s.rules)) { s.dodgeT = DUEL.dodgeTime; s.f.play('swDodge', { side: 1 }, 0.05); sfx.whoosh(); }
  }

  /* ---------------- resolving ---------------- */

  private land(i: number, a: Attack): void {
    const att = this.sides[i], def = this.sides[i === 0 ? 1 : 0];
    const r = resolve(att.rules, def.rules, a, this.time);
    this.log.push(r);
    this.lastRes = { res: r, by: i };
    const chest = def.f.toWorld(v3(0, 1.25, 0.15), this.tmp).clone();
    const at = this.toScreen(chest);
    switch (r.outcome) {
      case 'hit': case 'guardBreak':
        sfx.tok(a.power);
        this.impact(chest, 0.4 + a.power * 0.6, 12, i === 1 && !this.vsAI);
        def.f.play(r.outcome === 'guardBreak' ? 'swStagger' : 'swHit', {}, 0.05);
        this.hud.popup(`−${r.damage}`, at.x, at.y, 'bad');
        if (r.outcome === 'guardBreak') { this.hud.call(t('sw.duel.guardBreak'), 'big', 0.9); sfx.clang(0.8); }
        this.push = 1;
        att.f.glow = 1;
        break;
      case 'block':
        sfx.clang(a.power);
        this.stars.burst(chest.clone().addScaledVector(this.tmp.set(i === 0 ? -1 : 1, 0, 0), 0.4), 5, 0.6, () => this.rng.next());
        this.hitStop(a.power * 0.5);
        this.rumble(0.4, 40, i === 0 && !this.vsAI);
        if (r.attackerStaggered) { att.f.play('swStagger'); this.hud.popup(t('sw.duel.staggered'), at.x, at.y - 30, 'gold'); }
        else att.f.play('swRecoil', {}, 0.05);
        def.f.glow = 0.7;
        break;
      case 'parry':
        sfx.clang(1, true);
        this.hud.call(t('sw.duel.parry'), 'parry', 0.9);
        this.stars.burst(chest, 12, 1, () => this.rng.next());
        this.hitStop(1); this.slowMo(0.35, 0.4); this.shake(0.6);
        this.rumble(1, 120, i === 0 && !this.vsAI);
        this.rumble(0.8, 80, i === 1 && !this.vsAI);
        att.f.play('swStagger');
        def.f.glow = 1;
        this.push = 1;
        break;
      case 'dodge':
        this.hud.popup(t('sw.duel.dodge'), at.x, at.y, 'good');
        break;
      default: break;
    }
  }

  /* ---------------- physics ---------------- */

  protected stepMode(dt: number): void {
    this.phaseT += dt;
    for (const s of this.sides) {
      tickFighter(s.rules, dt);
      s.recover = Math.max(0, s.recover - dt);
      s.dodgeT = Math.max(0, s.dodgeT - dt);
      s.lunge = Math.max(0, s.lunge - dt * 4);
    }
    if (this.phase === 'intro' && this.phaseT > 1.4) this.startFight();
    if (this.phase === 'fight') this.stepFight(dt);
    if (this.phase === 'ko' && this.phaseT > 1.4) { this.phase = 'replay'; this.phaseT = 0; this.replayT = 0; }
    if (this.phase === 'roundEnd' && this.phaseT > 1.8) this.afterRound();
    if (this.phase === 'matchEnd' && this.phaseT > 3.2) this.finish();
  }

  private stepFight(_dt: number): void {
    const now = this.time;
    // land what is due first (thrusts and AI swings)
    for (const [i, s] of this.sides.entries()) {
      const p = s.pending;
      if (!p) continue;
      if (s.rules.staggered > 0) { s.pending = null; continue; }
      if (now >= p.land && !p.feint) {
        s.pending = null;
        s.lunge = 1; s.lastAttack = p.attack; s.recover = 0.2;
        if (s.ai) { s.f.play(p.attack.kind === 'thrust' ? 'swThrust' : 'swSlash', { ax: p.attack.dx, ay: p.attack.dy }, 0.04); sfx.bladeWhoosh(9); }
        this.land(i, p.attack);
      }
    }
    // the AI(s) decide
    for (const [i, s] of this.sides.entries()) {
      if (!s.ai) continue;
      const o = this.sides[i === 0 ? 1 : 0];
      const inc: Incoming | null = o.pending ? { attack: o.pending.attack, start: o.pending.start, land: o.pending.land } : o.live;
      const out = s.ai.update(now, s.rules, o.rules, inc);
      if (out.dodge) this.dodge(i);
      setGuard(s.rules, out.attack || s.ai.pending ? null : out.guard, now);
      if (out.attack) s.pending = out.attack;
    }
    // a stagger cancels the player's live slash too
    for (const s of this.sides) if (s.rules.staggered > 0 && s.input) { s.live = null; }
    const w = roundWinner(this.sides[0].rules, this.sides[1].rules, now - this.roundStart);
    if (w !== null) this.endRound(w, this.sides[0].rules.hp <= 0 || this.sides[1].rules.hp <= 0);
    // the intense music layer when someone is low
    const low = this.sides.some(s => s.rules.hp <= 35);
    if (low !== this.layer) { this.layer = low; Music.setLayer(low); }
  }

  /* ---------------- frame ---------------- */

  /** Where a scripted fighter's blade should be this frame. */
  private aiPose(s: Side): BladePose {
    const r = s.rules;
    if (r.staggered > 0) return STAGGER_POSE;
    const p = s.pending;
    if (p) {
      const a = p.attack, total = Math.max(0.01, p.land - p.start), k = (this.time - p.start) / total;
      if (a.kind === 'thrust') return k < 0.85 ? thrustPose(0) : thrustPose((k - 0.85) / 0.15);
      const swingK = Math.max(0, (k - 0.82) / 0.18);
      return slashPose(a.dx, a.dy, swingK, v3(0.22, 1.25 + 0.15 * Math.min(1, k * 3), 0.3));
    }
    if (s.recover > 0 && s.lastAttack) return s.lastAttack.kind === 'thrust' ? thrustPose(1) : slashPose(s.lastAttack.dx, s.lastAttack.dy, 1);
    if (r.guard) return GUARD_POSE[r.guard];
    return READY_POSE;
  }

  protected frameMode(dt: number, realDt: number): void {
    const replay = this.phase === 'replay';
    if (replay) {
      this.replayT += realDt;
      const k = (this.replayT / 2.4) * this.rec.count;
      this.rec.apply(k, this.sides.map(s => s.f));
      if (this.replayT > 2.4) { this.phase = 'roundEnd'; this.phaseT = 0; this.placeFighters(); }
      this.hud.call(t('sw.duel.replay'), 'big', 0.2);
    } else {
      for (const [i, s] of this.sides.entries()) {
        const want = s.input ? s.input.pose() : this.aiPose(s);
        s.f.pose = s.input ? want : lerpPose(s.f.pose, want, 1 - Math.exp(-dt * 22));
        const dir = i === 0 ? 1 : -1;
        const dodgeBack = s.dodgeT > 0 ? Math.sin((1 - s.dodgeT / DUEL.dodgeTime) * Math.PI) * 0.45 : 0;
        s.f.pos.set(s.baseX + dir * (0.28 * Math.sin(s.lunge * Math.PI) - dodgeBack), PLATFORM_Y, 0);
        if (s.input && this.phase === 'fight') {
          const g = s.rules.guard;
          if (g && s.f.anim.current !== 'swGuard' && !s.live) s.f.play('swGuard', { zone: ['high', 'mid', 'low', 'left', 'right'].indexOf(g) }, 0.15);
          if (!g && s.f.anim.current === 'swGuard') s.f.play('swReady', {}, 0.15);
        } else if (s.ai && this.phase === 'fight') {
          const g = s.rules.guard;
          if (g && s.f.anim.current === 'swReady') s.f.play('swGuard', { zone: ['high', 'mid', 'low', 'left', 'right'].indexOf(g) }, 0.15);
        }
        s.f.update(dt);
      }
      if (this.phase === 'fight' || this.phase === 'ko') this.rec.record(this.sides.map(s => s.f));
    }
    this.camera_(replay, realDt);
    this.drawHud();
  }

  private camera_(replay: boolean, realDt: number): void {
    this.push = Math.max(0, this.push - realDt * 1.2);
    const mid = (this.sides[0].f.pos.x + this.sides[1].f.pos.x) / 2;
    if (this.phase === 'ko' || replay) {
      // final blow close-up (replay from the other side, low)
      const loser = this.sides[this.koBy === 0 ? 1 : 0].f.pos;
      if (replay) { this.wantPos.set(mid + (this.koBy === 0 ? 2.2 : -2.2), 1.1, -2.6); this.wantLook.set(mid, 1.2, 0); this.wantFov = 42; }
      else { this.wantPos.set(loser.x * 0.6, 1.4, 2.3); this.wantLook.set(loser.x * 0.8, 1.15, 0); this.wantFov = 38; }
      this.camRate = 5;
      return;
    }
    const k = this.push;
    this.wantPos.set(mid, 1.65 - 0.1 * k, 5.2 - 1.3 * k);
    this.wantLook.set(mid, 1.15, 0);
    this.wantFov = 50 - 6 * k;
    this.camRate = 4;
  }

  private drawHud(): void {
    const [a, b] = this.sides;
    const names: [string, string] = [this.ctx.setup.players[0].name, this.vsAI ? this.aiPlayer.name : this.ctx.setup.players[1]?.name ?? this.aiPlayer.name];
    this.hud.duel({
      names, colors: [a.f.color, b.f.color], hp: [a.rules.hp, b.rules.hp], meter: [a.rules.meter, b.rules.meter],
      wins: this.wins, toWin: this.toWin, staggered: [a.rules.staggered > 0, b.rules.staggered > 0]
    });
    const left = this.phase === 'fight' ? Math.max(0, DUEL.roundTime - (this.time - this.roundStart)) : null;
    this.hud.clock(left === null ? null : String(Math.ceil(left)), left !== null && left < 10);
    this.hud.guard(a.input ? a.rules.guard : null);
    // telegraphs over an attacker winding up: the movement as the defender sees it, facing the attacker
    this.hud.beginTelegraphs();
    for (const s of this.sides) {
      const p = s.pending;
      if (!p || (p.feint && this.time > p.switchAt)) continue;
      const head = s.f.toWorld(v3(0, 2.15, 0), this.tmp);
      const sp = this.toScreen(head);
      const k = (this.time - p.start) / Math.max(0.01, p.land - p.start);
      const ang = p.attack.kind === 'thrust' ? null : Math.atan2(p.attack.dy, -p.attack.dx) * 180 / Math.PI;
      this.hud.telegraph(sp.x, sp.y, ang, k, ang === null ? t('sw.zone.mid') : '');
    }
    this.hud.endTelegraphs();
  }

  protected debugLines(): string[] {
    const [a, b] = this.sides, ai = b.ai ?? a.ai;
    const lr = this.lastRes;
    return [
      `duel       ${this.phase} · round ${this.round} · ${this.wins[0]}–${this.wins[1]} · t ${(this.time - this.roundStart).toFixed(1)} s`,
      `P1         hp ${a.rules.hp} · meter ${a.rules.meter.toFixed(0)} · guard ${a.rules.guard ?? '–'} · stagger ${a.rules.staggered.toFixed(2)} · live ${a.live ? dirFromAngle(Math.atan2(a.live.attack.dy, a.live.attack.dx) * 180 / Math.PI) : '–'}`,
      `P2/AI      hp ${b.rules.hp} · meter ${b.rules.meter.toFixed(0)} · guard ${b.rules.guard ?? '–'} · stagger ${b.rules.staggered.toFixed(2)}`,
      `AI         ${ai ? `L${ai.level} ${ai.state}${ai.pending ? ` · ${ai.pending.attack.kind} lands in ${(ai.pending.land - this.time).toFixed(2)} s${ai.pending.feint ? ' (feint)' : ''}` : ''}` : '–'}`,
      `last       ${lr ? `${lr.by === 0 ? 'P1' : 'P2/AI'} → ${lr.res.outcome}${lr.res.damage ? ` ${lr.res.damage}` : ''}` : '–'}`
    ];
  }

  toggleScores(): void { /* the bars are always shown */ }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' || e.key === 'Tab' || /^F\d+$/.test(e.key)) return false;
    if ((e.code === 'Enter' || e.code === 'Space') && (this.phase === 'replay' || this.phase === 'ko')) {
      this.phase = 'roundEnd'; this.phaseT = 0; this.placeFighters();
      return true;
    }
    return false;
  }

  dispose(): void { Music.setLayer(false); super.dispose(); }
}

export const createDuel: SceneFactory = async ctx => new Duel(ctx);

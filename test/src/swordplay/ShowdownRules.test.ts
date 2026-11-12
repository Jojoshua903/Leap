import { describe, expect, it } from 'vitest';
import { Rng } from '../tabletennis/BallPhysics';
import { BossBrain, SHOWDOWN, ShowdownRun, gradeFor, gradeRank, rankGrade, type BossPhase } from './ShowdownRules';
import { ENEMIES, type EnemyMove } from './enemies';
import { STAGES, seededStages } from './stages';
import { DIRS } from './swMath';

describe('Showdown enemies', () => {
  it('every script gives valid moves and directions for many seeds and every phase', () => {
    for (const def of Object.values(ENEMIES)) {
      expect(def.hp).toBeGreaterThan(0);
      expect(def.count).toBeGreaterThanOrEqual(1);
      for (let seed = 1; seed <= 30; seed++) {
        for (const phase of [1, 2, 3]) {
          const moves: EnemyMove[] = def.script(new Rng(seed), phase);
          expect(moves.length).toBeGreaterThan(0);
          // a loop must take time, or the enemy would spin forever in one frame
          const time = moves.reduce((s, m) => s + ('t' in m ? m.t : 'windup' in m ? m.windup : 'flight' in m ? m.flight : 0.5), 0);
          expect(time).toBeGreaterThan(0.5);
          for (const m of moves) {
            if (m.kind === 'attack') {
              expect(m.dir === 'thrust' || DIRS.includes(m.dir)).toBe(true);
              expect(m.windup).toBeGreaterThanOrEqual(0.4);   // always telegraphed
              expect(m.damage).toBeGreaterThan(0);
            }
            if (m.kind === 'weak') expect(DIRS).toContain(m.dir);
            if (m.kind === 'shield') expect(['high', 'mid', 'low', 'left', 'right']).toContain(m.zone);
          }
        }
      }
    }
  });

  it('the boss gets faster per phase', () => {
    const loop = (p: number) => ENEMIES.scarecrow.script(new Rng(3), p).filter(m => m.kind === 'attack').map(m => (m as { windup: number }).windup);
    expect(Math.min(...loop(2))).toBeLessThan(Math.min(...loop(1)));
    expect(Math.min(...loop(3))).toBeLessThan(Math.min(...loop(2)));
  });
});

describe('Showdown stages', () => {
  it('5 stages and a boss, every enemy known, three hearts', () => {
    expect(STAGES).toHaveLength(6);
    expect(STAGES[5].boss).toBe(true);
    expect(STAGES.filter(s => s.heartAfter !== undefined)).toHaveLength(3);
    for (const s of STAGES) {
      expect(s.waves.length).toBeGreaterThan(0);
      if (s.heartAfter !== undefined) expect(s.heartAfter).toBeLessThan(s.waves.length);
      for (const w of s.waves) for (const e of w.enemies) expect(ENEMIES[e.id]).toBeDefined();
    }
  });

  it('seeded variants are reproducible and keep every enemy', () => {
    expect(seededStages(5)).toEqual(seededStages(5));
    const count = (st: typeof STAGES) => st.flatMap(s => s.waves.flatMap(w => w.enemies.map(e => e.id))).sort();
    expect(count(seededStages(5))).toEqual(count(STAGES));
    expect(seededStages(9)[5]).toEqual(STAGES[5]);
  });

  it('a run goes walk → fight → … through every stage to cleared', () => {
    const run = new ShowdownRun(STAGES);
    const seen: string[] = [];
    let hearts = 0;
    for (let guard = 0; guard < 100 && !run.done; guard++) {
      expect(run.phase).toBe('walk');
      seen.push(run.current.id);
      run.arrive();
      for (;;) {
        run.tick(5);
        const next = run.waveCleared();
        if (next === 'heart') { hearts++; run.heart(); }
        if (next === 'stage' || next === 'cleared' || (next === 'heart' && run.phase === 'walk')) break;
      }
    }
    expect(seen).toEqual(STAGES.map(s => s.id));
    expect(run.phase).toBe('cleared');
    expect(hearts).toBe(3);
    expect(run.stageLog).toHaveLength(6);
  });
});

describe('Showdown scoring', () => {
  it('combo, kills, parries, hearts and damage', () => {
    const run = new ShowdownRun(STAGES);
    run.arrive();
    expect(run.hit()).toBe(10);
    expect(run.hit()).toBe(20);
    run.kill(300);
    run.parry();
    expect(run.score).toBe(10 + 20 + 300 + SHOWDOWN.parryPoints);
    run.hurt(30);
    expect(run.combo).toBe(0);
    expect(run.bestCombo).toBe(2);
    expect(run.hp).toBe(70);
    run.heart();
    expect(run.hp).toBe(95);
    run.heart();
    expect(run.hp).toBe(100);
    expect(run.hurt(150)).toBe(true);
    expect(run.phase).toBe('dead');
  });

  it('stage bonuses: no damage and speed', () => {
    const run = new ShowdownRun(STAGES);
    run.arrive();
    run.tick(10);
    for (let i = 0; i < STAGES[0].waves.length; i++) run.waveCleared();
    const bonus = SHOWDOWN.noDamageBonus + (STAGES[0].parTime - 10) * SHOWDOWN.speedPerSecond;
    expect(run.score).toBe(bonus);
    expect(run.stageLog[0].bonus).toBe(bonus);
  });

  it('grades', () => {
    expect(gradeFor(12000)).toBe('S');
    expect(gradeFor(11999)).toBe('A');
    expect(gradeFor(8000)).toBe('A');
    expect(gradeFor(4500)).toBe('B');
    expect(gradeFor(10)).toBe('C');
    expect(rankGrade(gradeRank('A'))).toBe('A');
    expect(rankGrade(0)).toBeNull();
  });
});

describe('Boss phases', () => {
  it('1 → 2 → 3 by HP, then the final window', () => {
    const b = new BossBrain(24), phases: BossPhase[] = [];
    b.onPhase = p => phases.push(p);
    b.damage(7);
    expect(b.phase).toBe(1);
    b.damage(2);
    expect(b.phase).toBe(2);
    b.damage(8);
    expect(b.phase).toBe(3);
    // healing never goes back a phase here; reaching 0 opens the final thrust
    b.damage(10);
    expect(b.phase).toBe('final');
    expect(b.thrust()).toBe(true);
    expect(b.phase).toBe('down');
    expect(phases).toEqual([2, 3, 'final', 'down']);
  });

  it('missing the final thrust: it recovers a little and fights on in phase 3', () => {
    const b = new BossBrain(20);
    b.damage(20);
    expect(b.phase).toBe('final');
    b.tick(BossBrain.finalWindow + 0.1);
    expect(b.phase).toBe(3);
    expect(b.hp).toBe(Math.ceil(20 * BossBrain.recover));
    expect(b.thrust()).toBe(false);
    b.damage(b.hp);
    expect(b.phase).toBe('final');
  });
});

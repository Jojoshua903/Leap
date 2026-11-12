import { describe, expect, it } from 'vitest';
import { WAVE, buildPractice, buildRound, dirsFor, isDecoy, paramsAt } from './sliceWaves';
import { DIRS } from './swMath';

describe('Speed Slice waves', () => {
  it('the same seed gives the same round, another seed a different one', () => {
    expect(buildRound(7)).toEqual(buildRound(7));
    expect(JSON.stringify(buildRound(7))).not.toBe(JSON.stringify(buildRound(8)));
  });

  it('difficulty only goes up: gaps, approach and hover shrink, decoys grow', () => {
    let prev = paramsAt(0);
    for (let t = 1; t <= WAVE.duration; t++) {
      const p = paramsAt(t);
      expect(p.interval).toBeLessThanOrEqual(prev.interval);
      expect(p.travel).toBeLessThanOrEqual(prev.travel);
      expect(p.hover).toBeLessThanOrEqual(prev.hover);
      expect(p.decoy).toBeGreaterThanOrEqual(prev.decoy);
      prev = p;
    }
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = buildRound(seed).filter(s => !s.burst);
      // hover never grows along the round
      for (let i = 1; i < r.length; i++) expect(r[i].hover).toBeLessThanOrEqual(r[i - 1].hover + 1e-9);
      // the last third is denser than the first
      const first = r.filter(s => s.t < 20).length, last = r.filter(s => s.t >= 40).length;
      expect(last).toBeGreaterThan(first);
    }
  });

  it('every target has a sensible direction, position and timing', () => {
    const r = buildRound(11);
    expect(r.length).toBeGreaterThan(50);
    for (const s of r) {
      expect(s.t).toBeGreaterThan(0);
      expect(s.t).toBeLessThan(WAVE.duration);
      if (isDecoy(s.kind)) { expect(s.dir).toBeNull(); expect(s.golden).toBe(false); }
      else { expect(DIRS).toContain(s.dir); expect(dirsFor(s.kind)).toContain(s.dir); }
      expect(Math.abs(s.x)).toBeLessThanOrEqual(0.45);
      expect(s.y).toBeGreaterThanOrEqual(1);
      expect(s.y).toBeLessThanOrEqual(1.55);
      expect(s.hover).toBeGreaterThan(0.3);
    }
    // spawns come in time order
    for (let i = 1; i < r.length; i++) expect(r[i].t).toBeGreaterThanOrEqual(r[i - 1].t);
  });

  it('has multi-slice bursts and some decoys', () => {
    const r = buildRound(3);
    const bursts = new Set(r.filter(s => s.burst).map(s => s.t));
    expect(bursts.size).toBeGreaterThanOrEqual(3);
    for (const t of bursts) expect(r.filter(s => s.burst && s.t === t).length).toBeGreaterThanOrEqual(2);
    const decoys = [1, 2, 3, 4, 5, 6].map(seed => buildRound(seed).filter(s => isDecoy(s.kind)).length);
    expect(decoys.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('practice: slow, no decoys', () => {
    const p = buildPractice(5);
    expect(p).toHaveLength(WAVE.practiceCount);
    expect(p.every(s => !isDecoy(s.kind) && s.hover === WAVE.practiceHover)).toBe(true);
  });
});

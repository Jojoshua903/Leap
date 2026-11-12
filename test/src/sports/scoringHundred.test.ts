import { describe, expect, it } from 'vitest';
import { bonusFor, hundredCumulative, hundredFrames, hundredMarks, hundredNext, hundredTotal } from './scoringHundred';
import { HUNDRED_ROWS, hundredPinLayout, layoutHalfWidth, tenPinLayout } from './pinLayouts';

const rep = (v: number, n: number): number[] => Array.from({ length: n }, () => v);

describe('100-pin scoring', () => {
  it('score is simply pins knocked down', () => {
    expect(hundredTotal(Array.from({ length: 10 }, () => [60, 25]).flat())).toBe(850);
  });

  it('two balls per frame, fresh rack each frame', () => {
    expect(hundredNext([])).toMatchObject({ frame: 0, ball: 1, resetPins: true, standing: 100 });
    expect(hundredNext([40])).toMatchObject({ frame: 0, ball: 2, resetPins: false, standing: 60 });
    expect(hundredNext([40, 30])).toMatchObject({ frame: 1, ball: 1, resetPins: true, standing: 100 });
  });

  it('clearing all 100 with the first ball ends the frame', () => {
    expect(hundredFrames([100, 50, 20])).toEqual([[100], [50, 20]]);
    expect(hundredNext([100])).toMatchObject({ frame: 1, ball: 1, resetPins: true });
  });

  it('max score is 1000 and the game ends after 10 frames', () => {
    const rolls = rep(100, 10);
    expect(hundredTotal(rolls)).toBe(1000);
    expect(hundredNext(rolls).done).toBe(true);
    expect(hundredNext(rep(0, 20)).done).toBe(true);
    expect(hundredNext(rep(0, 19)).done).toBe(false);
  });

  it('5-frame option', () => {
    expect(hundredNext(rep(0, 10), 5).done).toBe(true);
    expect(hundredTotal(rep(100, 5), 5)).toBe(500);
  });

  it('cumulative and marks', () => {
    expect(hundredCumulative([40, 30, 100, 0, 0])).toEqual([70, 170, 170]);
    expect(hundredMarks([100, 60, 40, 0, 7])).toEqual([['X'], ['60', '/'], ['-', '7']]);
  });

  it('bonus text at 50+ and 80+', () => {
    expect(bonusFor(49)).toBeNull();
    expect(bonusFor(50)).toBe('fx.bonus50');
    expect(bonusFor(79)).toBe('fx.bonus50');
    expect(bonusFor(80)).toBe('fx.bonus80');
  });
});

describe('pin layouts', () => {
  it('ten-pin rack has 10 spots with the head pin first', () => {
    const s = tenPinLayout(-18);
    expect(s).toHaveLength(10);
    expect(s[0]).toEqual([0, -18]);
  });

  it('the 100-pin wall has exactly 100 spots, narrow at the front', () => {
    const s = hundredPinLayout(-18);
    expect(HUNDRED_ROWS.reduce((a, b) => a + b, 0)).toBe(100);
    expect(s).toHaveLength(100);
    const front = s.filter(([, z]) => z === -18).length;
    expect(front).toBe(HUNDRED_ROWS[0]);
    expect(front).toBeLessThan(HUNDRED_ROWS[HUNDRED_ROWS.length - 1]);
  });

  it('fits a 1.9 m lane and no two pins overlap', () => {
    const s = hundredPinLayout(-18);
    expect(layoutHalfWidth(s) + 0.05).toBeLessThan(0.95);
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      expect(Math.hypot(s[i][0] - s[j][0], s[i][1] - s[j][1])).toBeGreaterThan(0.1);
    }
  });
});

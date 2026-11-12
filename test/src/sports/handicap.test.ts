import { describe, expect, it } from 'vitest';
import { basisFor, handicapAverage, handicapFor } from './handicap';

describe('handicap', () => {
  it('80% of the gap to 200, rounded down', () => {
    expect(handicapFor(150)).toBe(40);
    expect(handicapFor(123)).toBe(61);    // 77 * 0.8 = 61.6
  });

  it('never negative and zero without an average', () => {
    expect(handicapFor(230)).toBe(0);
    expect(handicapFor(0)).toBe(0);
    expect(handicapFor(Number.NaN)).toBe(0);
  });

  it('halves for 5-frame games', () => {
    expect(handicapFor(150, 5)).toBe(20);
  });

  it('100-pin uses a bigger basis', () => {
    expect(basisFor('hundred')).toBe(800);
    expect(basisFor('standard')).toBe(200);
    expect(handicapFor(600, 10, basisFor('hundred'))).toBe(160);
  });

  it('average from totals', () => {
    expect(handicapAverage(0, 0)).toBe(0);
    expect(handicapAverage(4, 600)).toBe(150);
  });
});

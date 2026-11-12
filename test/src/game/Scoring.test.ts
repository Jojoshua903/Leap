import { describe, expect, it } from 'vitest';
import { cumulativeScores, frameMarks, isGameOver, nextRoll, runningScore, totalScore } from './Scoring';

const rep = (v: number, n: number): number[] => Array.from({ length: n }, () => v);

describe('Scoring', () => {
  it('perfect game = 300', () => {
    const rolls = rep(10, 12);
    expect(totalScore(rolls)).toBe(300);
    expect(isGameOver(rolls)).toBe(true);
  });

  it('all gutters = 0', () => {
    const rolls = rep(0, 20);
    expect(totalScore(rolls)).toBe(0);
    expect(isGameOver(rolls)).toBe(true);
  });

  it('all spares with 5s = 150', () => {
    const rolls = rep(5, 21);
    expect(totalScore(rolls)).toBe(150);
    expect(isGameOver(rolls)).toBe(true);
  });

  it('9-pin + spare every frame = 190', () => {
    const rolls = [...Array.from({ length: 10 }, () => [9, 1]).flat(), 9];
    expect(totalScore(rolls)).toBe(190);
  });

  it('9-pin + miss every frame = 90', () => {
    expect(totalScore(Array.from({ length: 10 }, () => [9, 0]).flat())).toBe(90);
  });

  it('mixed example = 167', () => {
    const rolls = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
    expect(cumulativeScores(rolls)).toEqual([20, 39, 48, 66, 74, 84, 90, 120, 148, 167]);
    expect(isGameOver(rolls)).toBe(true);
  });

  it('consecutive strikes wait for both bonus balls', () => {
    expect(cumulativeScores([10, 10])).toEqual([null, null]);
    expect(cumulativeScores([10, 10, 10])).toEqual([30, null, null]);
    expect(cumulativeScores([10, 3, 4])).toEqual([17, 24]);
  });

  it('tenth frame racks', () => {
    const nine = rep(0, 18);
    expect(nextRoll([...nine, 10])).toMatchObject({ frame: 9, ball: 2, resetPins: true });
    expect(nextRoll([...nine, 10, 4])).toMatchObject({ frame: 9, ball: 3, resetPins: false, standing: 6 });
    expect(nextRoll([...nine, 6, 4])).toMatchObject({ frame: 9, ball: 3, resetPins: true });
    expect(nextRoll([...nine, 6, 3]).done).toBe(true);
  });

  it('marks', () => {
    expect(frameMarks([10, 7, 3, 0, 9])).toEqual([['X'], ['7', '/'], ['-', '9']]);
    expect(frameMarks([...rep(0, 18), 10, 10, 10])[9]).toEqual(['X', 'X', 'X']);
    expect(frameMarks([...rep(0, 18), 8, 2, 10])[9]).toEqual(['8', '/', 'X']);
    expect(frameMarks([...rep(0, 18), 10, 7, 3])[9]).toEqual(['X', '7', '/']);
  });

  it('5-frame games use frame 5 as the bonus frame', () => {
    expect(totalScore(rep(10, 7), 5)).toBe(150);
    expect(isGameOver(rep(10, 7), 5)).toBe(true);
    expect(isGameOver(rep(0, 10), 5)).toBe(true);
    expect(nextRoll([...rep(0, 8), 10], 5)).toMatchObject({ frame: 4, ball: 2, resetPins: true });
  });

  it('running score counts unresolved strikes', () => {
    expect(runningScore([10, 3])).toBe(13);
    expect(runningScore([7, 2, 10])).toBe(19);
  });
});

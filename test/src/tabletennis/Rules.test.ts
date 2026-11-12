import { describe, expect, it } from 'vitest';
import { MatchScore, Rally, TTRules, type RallyInput, type Side, type TTEventMap } from './Rules';

const feedAll = (r: Rally, inputs: RallyInput[]) => inputs.map(e => r.feed(e)).pop();
const serveIn = (s: Side): RallyInput[] => [{ type: 'serve', by: s }, { type: 'bounce', side: s }, { type: 'bounce', side: (1 - s) as Side }];

describe('MatchScore', () => {
  it('game to 11, win by 2', () => {
    const m = new MatchScore(1, 0);
    for (let i = 0; i < 10; i++) m.addPoint(0);
    expect(m.gamePoint()).toBe(0);
    const r = m.addPoint(0);
    expect(r.gameWon).toBe(0);
    expect(r.matchWon).toBe(0);
    expect(r.gameScore).toEqual([11, 0]);
  });

  it('deuce: 11–10 is not a win, 12–10 is', () => {
    const m = new MatchScore(1, 0);
    for (let i = 0; i < 10; i++) { m.addPoint(0); m.addPoint(1); }
    expect(m.deuce).toBe(true);
    expect(m.addPoint(0).gameWon).toBeNull();          // 11–10
    expect(m.addPoint(1).gameWon).toBeNull();          // 11–11
    expect(m.addPoint(1).gameWon).toBeNull();          // 11–12
    expect(m.addPoint(1).gameWon).toBe(1);             // 11–13
  });

  it('serve changes every 2 points, every point from 10–10', () => {
    const m = new MatchScore(1, 0);
    const order: Side[] = [];
    const seq: Side[] = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0];
    for (const w of seq) { order.push(m.server()); m.addPoint(w); }
    expect(order.slice(0, 8)).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
    // after 20 points (10–10) it alternates every point
    expect(order.slice(20)).toEqual([0, 1, 0, 1]);
  });

  it('the first server alternates between games', () => {
    const m = new MatchScore(3, 1);
    expect(m.server()).toBe(1);
    for (let i = 0; i < 11; i++) m.addPoint(0);
    expect(m.gameIndex).toBe(1);
    expect(m.server()).toBe(0);
  });

  it('best of 3 flow: first to 2 games', () => {
    const m = new MatchScore(3, 0);
    const game = (w: Side) => { let r = m.addPoint(w); for (let i = 1; i < 11; i++) r = m.addPoint(w); return r; };
    expect(game(0)).toMatchObject({ gameWon: 0, matchWon: null });
    expect(game(1)).toMatchObject({ gameWon: 1, matchWon: null });
    expect(m.matchPoint()).toBeNull();
    for (let i = 0; i < 10; i++) m.addPoint(1);
    expect(m.matchPoint()).toBe(1);
    expect(m.addPoint(1)).toMatchObject({ gameWon: 1, matchWon: 1 });
    expect(m.games).toEqual([1, 2]);
    expect(m.finished).toEqual([[11, 0], [0, 11], [0, 11]]);
  });
});

describe('Rally faults', () => {
  it('a good serve, a return and a missed table', () => {
    const r = new Rally(0);
    expect(feedAll(r, serveIn(0))).toEqual({ kind: 'continue' });
    expect(r.toPlay).toBe(1);
    r.feed({ type: 'hit', by: 1 });
    const out = r.feed({ type: 'floor' });
    expect(out).toMatchObject({ kind: 'point', result: { winner: 0, reason: 'missedTable', rally: 2, ace: false } });
  });

  it('ace: receiver never touches it', () => {
    const r = new Rally(1);
    feedAll(r, serveIn(1));
    expect(r.feed({ type: 'floor' })).toMatchObject({ kind: 'point', result: { winner: 1, reason: 'noReturn', ace: true } });
  });

  it('serve must bounce on the server’s half first', () => {
    const r = new Rally(0);
    r.feed({ type: 'serve', by: 0 });
    expect(r.feed({ type: 'bounce', side: 1 })).toMatchObject({ result: { winner: 1, reason: 'serveFault' } });
  });

  it('serve that bounces twice on the server’s half is a fault', () => {
    const r = new Rally(0);
    feedAll(r, [{ type: 'serve', by: 0 }, { type: 'bounce', side: 0 }]);
    expect(r.feed({ type: 'bounce', side: 0 })).toMatchObject({ result: { winner: 1, reason: 'serveFault' } });
  });

  it('a serve that touches the net and lands in is a let', () => {
    const r = new Rally(0);
    feedAll(r, [{ type: 'serve', by: 0 }, { type: 'bounce', side: 0 }, { type: 'netCord' }]);
    expect(r.feed({ type: 'bounce', side: 1 })).toEqual({ kind: 'let' });
  });

  it('a serve into the net that drops back is a fault, not a let', () => {
    const r = new Rally(0);
    feedAll(r, [{ type: 'serve', by: 0 }, { type: 'bounce', side: 0 }, { type: 'net' }]);
    expect(r.feed({ type: 'bounce', side: 0 })).toMatchObject({ result: { winner: 1, reason: 'serveFault' } });
  });

  it('a return into the net is the hitter’s point lost', () => {
    const r = new Rally(0);
    feedAll(r, serveIn(0));
    feedAll(r, [{ type: 'hit', by: 1 }, { type: 'net' }]);
    expect(r.feed({ type: 'bounce', side: 1 })).toMatchObject({ result: { winner: 0, reason: 'net' } });
  });

  it('a net cord during the rally plays on', () => {
    const r = new Rally(0);
    feedAll(r, serveIn(0));
    feedAll(r, [{ type: 'hit', by: 1 }, { type: 'netCord' }]);
    expect(r.feed({ type: 'bounce', side: 0 })).toEqual({ kind: 'continue' });
  });

  it('a return that bounces on its own side is wrong-side', () => {
    const r = new Rally(0);
    feedAll(r, serveIn(0));
    r.feed({ type: 'hit', by: 1 });
    expect(r.feed({ type: 'bounce', side: 1 })).toMatchObject({ result: { winner: 0, reason: 'wrongSide' } });
  });

  it('two bounces on one side', () => {
    const r = new Rally(0);
    feedAll(r, serveIn(0));
    expect(r.feed({ type: 'bounce', side: 1 })).toMatchObject({ result: { winner: 0, reason: 'doubleBounce' } });
  });

  it('volley (hitting before the bounce) is a fault in this version', () => {
    const r = new Rally(0);
    feedAll(r, serveIn(0));
    r.feed({ type: 'hit', by: 1 });
    expect(r.feed({ type: 'hit', by: 0 })).toMatchObject({ result: { winner: 1, reason: 'volley' } });
  });

  it('double hit', () => {
    const r = new Rally(0);
    feedAll(r, serveIn(0));
    r.feed({ type: 'hit', by: 1 });
    expect(r.feed({ type: 'hit', by: 1 })).toMatchObject({ result: { winner: 0, reason: 'doubleHit' } });
  });
});

describe('TTRules events', () => {
  it('emits serve, hit, bounce, point, rallyLength, gameWon and matchWon', () => {
    const got: Array<keyof TTEventMap> = [];
    const rules = new TTRules(1, 0, ev => got.push(ev));
    for (let p = 0; p < 11; p++) {
      const rally = rules.newRally();
      const s = rally.server;
      for (const e of serveIn(s)) rules.feed(e);
      // whoever receives misses unless player 0 served; player 0 wins every point
      if (s === 0) rules.feed({ type: 'floor' });
      else { rules.feed({ type: 'hit', by: 0 }); rules.feed({ type: 'bounce', side: 1 }); rules.feed({ type: 'floor' }); }
    }
    expect(rules.score.matchWinner).toBe(0);
    for (const k of ['serve', 'hit', 'bounce', 'point', 'rallyLength', 'gameWon', 'matchWon'] as const) expect(got).toContain(k);
    expect(got.filter(k => k === 'point')).toHaveLength(11);
  });

  it('a let does not change the score and the same server serves again', () => {
    const rules = new TTRules(1, 0);
    rules.newRally();
    rules.feed({ type: 'serve', by: 0 }); rules.feed({ type: 'bounce', side: 0 }); rules.feed({ type: 'netCord' });
    expect(rules.feed({ type: 'bounce', side: 1 }).kind).toBe('let');
    expect(rules.score.points).toEqual([0, 0]);
    expect(rules.newRally().server).toBe(0);
  });
});

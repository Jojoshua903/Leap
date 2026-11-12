/**
 * Table-tennis rules as pure logic: one Rally (who must do what next) and MatchScore (points, games,
 * serve rotation). TTRules glues them together and reports facts through an injected `emit`,
 * so the scene can forward them to the event bus and tests can just collect them.
 *
 * House rules: the ball must bounce before you hit it (a volley is a fault, point to the opponent),
 * and the ends never swap.
 */
export type Side = 0 | 1;
export const other = (s: Side): Side => (s === 0 ? 1 : 0);

export type RallyInput =
  | { type: 'serve'; by: Side }      // the server's paddle hits the tossed ball
  | { type: 'hit'; by: Side }        // any other paddle contact
  | { type: 'bounce'; side: Side }   // table bounce on that half
  | { type: 'netCord' }              // touched the tape and carried on
  | { type: 'net' }                  // went into the net mesh
  | { type: 'floor' }                // anything off the table: floor, out of reach
  | { type: 'dead' };                // stopped or timed out

export type PointReason =
  | 'serveFault' | 'wrongSide' | 'missedTable' | 'net' | 'doubleBounce' | 'volley' | 'doubleHit' | 'noReturn';

export interface PointResult {
  winner: Side;
  reason: PointReason;
  /** Paddle contacts in the rally, including the serve. */
  rally: number;
  /** Serve won the point without the receiver touching it. */
  ace: boolean;
  server: Side;
  lastHitter: Side | null;
}

export type RallyOutcome =
  | { kind: 'continue' }
  | { kind: 'let' }
  | { kind: 'point'; result: PointResult };

type Stage =
  | { s: 'awaitServe' }
  | { s: 'serveOwn' }                 // served: must bounce on the server's half
  | { s: 'serveRecv' }                // then on the receiver's half
  | { s: 'expectBounce'; by: Side }   // hit by `by`: must bounce on the other half
  | { s: 'expectHit'; side: Side }    // bounced on `side`: that side must hit it
  | { s: 'over' };

export class Rally {
  private stage: Stage = { s: 'awaitServe' };
  private hits = 0;
  private netOnServe = false;
  private intoNet = false;
  lastHitter: Side | null = null;

  constructor(readonly server: Side) {}

  get receiver(): Side { return other(this.server); }
  get length(): number { return this.hits; }
  get over(): boolean { return this.stage.s === 'over'; }
  /** Side that has to play the ball next, or null while it is in flight toward the other side. */
  get toPlay(): Side | null {
    const st = this.stage;
    if (st.s === 'awaitServe') return this.server;
    if (st.s === 'expectHit') return st.side;
    return null;
  }
  /** Side the ball is travelling toward (for the AI and the assisted paddle). */
  get heading(): Side | null {
    const st = this.stage;
    if (st.s === 'serveOwn' || st.s === 'serveRecv') return this.receiver;
    if (st.s === 'expectBounce') return other(st.by);
    if (st.s === 'expectHit') return st.side;
    return null;
  }

  private point(winner: Side, reason: PointReason): RallyOutcome {
    this.stage = { s: 'over' };
    return {
      kind: 'point',
      result: { winner, reason, rally: this.hits, ace: winner === this.server && this.hits === 1, server: this.server, lastHitter: this.lastHitter }
    };
  }

  private contact(by: Side): void { this.hits += 1; this.lastHitter = by; this.intoNet = false; }

  /** Start the rally as if `by` had just hit a rally ball (no serve rules). Used by the Return Challenge ball machine. */
  startAsHit(by: Side): void {
    if (this.stage.s !== 'awaitServe') return;
    this.contact(by);
    this.stage = { s: 'expectBounce', by };
  }

  feed(e: RallyInput): RallyOutcome {
    const st = this.stage;
    switch (st.s) {
      case 'over': return { kind: 'continue' };

      case 'awaitServe':
        if (e.type === 'serve' && e.by === this.server) { this.contact(this.server); this.stage = { s: 'serveOwn' }; }
        return { kind: 'continue' };

      case 'serveOwn':
        if (e.type === 'bounce') {
          if (e.side === this.server) { this.stage = { s: 'serveRecv' }; return { kind: 'continue' }; }
          return this.point(this.receiver, 'serveFault');
        }
        if (e.type === 'net' || e.type === 'netCord') { this.netOnServe = true; return { kind: 'continue' }; }
        if (e.type === 'hit' || e.type === 'serve') return this.point(other(e.by), e.by === this.server ? 'doubleHit' : 'volley');
        return this.point(this.receiver, 'serveFault');

      case 'serveRecv':
        if (e.type === 'net' || e.type === 'netCord') { this.netOnServe = true; return { kind: 'continue' }; }
        if (e.type === 'bounce') {
          if (e.side === this.receiver) {
            if (this.netOnServe) { this.stage = { s: 'over' }; return { kind: 'let' }; }
            this.stage = { s: 'expectHit', side: this.receiver };
            return { kind: 'continue' };
          }
          return this.point(this.receiver, 'serveFault');
        }
        if (e.type === 'hit' || e.type === 'serve') return this.point(other(e.by), e.by === this.server ? 'doubleHit' : 'volley');
        return this.point(this.receiver, 'serveFault');

      case 'expectBounce': {
        const target = other(st.by);
        if (e.type === 'netCord') return { kind: 'continue' };
        if (e.type === 'net') { this.intoNet = true; return { kind: 'continue' }; }
        if (e.type === 'bounce') {
          if (e.side === target) { this.stage = { s: 'expectHit', side: target }; return { kind: 'continue' }; }
          return this.point(target, this.intoNet ? 'net' : 'wrongSide');
        }
        if (e.type === 'hit' || e.type === 'serve') return e.by === target ? this.point(st.by, 'volley') : this.point(target, 'doubleHit');
        return this.point(target, this.intoNet ? 'net' : 'missedTable');
      }

      case 'expectHit': {
        const s = st.side;
        if (e.type === 'hit' || e.type === 'serve') {
          if (e.by !== s) return this.point(s, 'doubleHit');
          this.contact(s);
          this.stage = { s: 'expectBounce', by: s };
          return { kind: 'continue' };
        }
        if (e.type === 'bounce') return this.point(other(s), e.side === s ? 'doubleBounce' : 'noReturn');
        if (e.type === 'net' || e.type === 'netCord') return { kind: 'continue' };
        return this.point(other(s), 'noReturn');
      }
    }
  }
}

/* ---------------- score ---------------- */

export type BestOf = 1 | 3 | 5;

export class MatchScore {
  points: [number, number] = [0, 0];
  games: [number, number] = [0, 0];
  /** Final score of every finished game. */
  readonly finished: Array<[number, number]> = [];
  gameIndex = 0;

  constructor(readonly bestOf: BestOf, readonly firstServer: Side, readonly pointsToWin = 11) {}

  get gamesToWin(): number { return Math.floor(this.bestOf / 2) + 1; }
  get deuce(): boolean { return this.points[0] >= this.pointsToWin - 1 && this.points[1] >= this.pointsToWin - 1; }

  /** Who serves the next point: every 2 points, every point from 10–10. The first server swaps each game. */
  server(): Side {
    const first: Side = this.gameIndex % 2 === 0 ? this.firstServer : other(this.firstServer);
    const p = this.points[0] + this.points[1];
    const base = (this.pointsToWin - 1) * 2;
    const turns = p < base ? Math.floor(p / 2) : (this.pointsToWin - 1) + (p - base);
    return turns % 2 === 0 ? first : other(first);
  }

  private wins(a: number, b: number): boolean { return a >= this.pointsToWin && a - b >= 2; }

  /** Side that wins the game if it takes the next point. */
  gamePoint(): Side | null {
    const [a, b] = this.points;
    if (this.wins(a + 1, b)) return 0;
    if (this.wins(b + 1, a)) return 1;
    return null;
  }

  matchPoint(): Side | null {
    const g = this.gamePoint();
    return g !== null && this.games[g] + 1 >= this.gamesToWin ? g : null;
  }

  get matchWinner(): Side | null {
    if (this.games[0] >= this.gamesToWin) return 0;
    if (this.games[1] >= this.gamesToWin) return 1;
    return null;
  }

  /** Add a point. Returns who won the game / match because of it. */
  addPoint(winner: Side): { gameWon: Side | null; matchWon: Side | null; gameScore: [number, number] } {
    if (this.matchWinner !== null) return { gameWon: null, matchWon: this.matchWinner, gameScore: [...this.points] as [number, number] };
    this.points[winner] += 1;
    const [a, b] = this.points;
    const gameScore: [number, number] = [a, b];
    if (this.wins(a, b) || this.wins(b, a)) {
      const g: Side = a > b ? 0 : 1;
      this.games[g] += 1;
      this.finished.push(gameScore);
      this.points = [0, 0];
      this.gameIndex += 1;
      return { gameWon: g, matchWon: this.matchWinner, gameScore };
    }
    return { gameWon: null, matchWon: null, gameScore };
  }
}

/* ---------------- rules + events ---------------- */

export interface TTEventMap {
  serve: { server: Side };
  hit: { by: Side; shot: number };
  bounce: { side: Side };
  netCord: Record<string, never>;
  point: PointResult & { score: [number, number] };
  gameWon: { winner: Side; games: [number, number]; score: [number, number] };
  matchWon: { winner: Side; games: [number, number] };
  rallyLength: { length: number };
}

export type TTEmit = <K extends keyof TTEventMap>(event: K, payload: TTEventMap[K]) => void;

export type RulesOutcome =
  | { kind: 'continue' }
  | { kind: 'let' }
  | { kind: 'point'; result: PointResult; gameWon: Side | null; matchWon: Side | null; gameScore: [number, number] };

export class TTRules {
  readonly score: MatchScore;
  rally: Rally;

  constructor(bestOf: BestOf, firstServer: Side, private readonly emit: TTEmit = () => undefined) {
    this.score = new MatchScore(bestOf, firstServer);
    this.rally = new Rally(this.score.server());
  }

  /** Start the next rally with whoever serves now (also after a let). */
  newRally(): Rally {
    this.rally = new Rally(this.score.server());
    return this.rally;
  }

  feed(e: RallyInput): RulesOutcome {
    const before = this.rally.length;
    const out = this.rally.feed(e);
    if (this.rally.length > before) {
      if (e.type === 'serve') this.emit('serve', { server: e.by });
      this.emit('hit', { by: this.rally.lastHitter ?? 0, shot: this.rally.length });
    }
    if (out.kind === 'continue') {
      if (e.type === 'bounce') this.emit('bounce', { side: e.side });
      else if (e.type === 'netCord') this.emit('netCord', {});
      return out;
    }
    if (out.kind === 'let') return out;
    const r = out.result;
    const res = this.score.addPoint(r.winner);
    this.emit('rallyLength', { length: r.rally });
    this.emit('point', { ...r, score: res.gameScore });
    if (res.gameWon !== null) this.emit('gameWon', { winner: res.gameWon, games: [...this.score.games] as [number, number], score: res.gameScore });
    if (res.matchWon !== null) this.emit('matchWon', { winner: res.matchWon, games: [...this.score.games] as [number, number] });
    return { kind: 'point', result: r, gameWon: res.gameWon, matchWon: res.matchWon, gameScore: res.gameScore };
  }
}

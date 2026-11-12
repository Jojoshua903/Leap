import { isOutsideArc } from './bbTuning';

/**
 * 3-on-3 Pickup rules (pure, tested), house version:
 *  - 1 point inside the arc, 2 points outside. First to 11 (or 21) wins; win by 1, no win-by-2.
 *  - Make-it-take-it: the team that scores keeps the ball and checks it at the top of the arc.
 *  - After a change of possession (steal, defensive rebound, out of bounds, a basket that didn't count)
 *    the ball must be taken outside the arc ("cleared") before a basket counts.
 *  - No fouls.
 */
export type Team = 0 | 1;
export const otherTeam = (t: Team): Team => (t === 0 ? 1 : 0);

export interface BasketResult {
  counted: boolean;
  points: number;
  /** Set when this basket won the game. */
  winner: Team | null;
  /** Team that has the ball next, from a check at the top. */
  nextOffense: Team;
}

export class PickupScore {
  readonly points: [number, number] = [0, 0];
  offense: Team;
  /** The ball has been outside the arc since the last change of possession. */
  cleared = true;
  winner: Team | null = null;

  constructor(readonly target: number = 11, firstOffense: Team = 0) { this.offense = firstOffense; }

  /** 1 inside the arc, 2 outside. */
  static value(x: number, z: number): 1 | 2 { return isOutsideArc(x, z) ? 2 : 1; }

  /** The ball was checked at the top of the arc: it counts as cleared. */
  check(): void { this.cleared = true; }

  /** The ball handler stands at (x, z): outside the arc clears it. */
  carry(x: number, z: number): void { if (!this.cleared && isOutsideArc(x, z)) this.cleared = true; }

  /** Steal, defensive rebound, out of bounds: the other team must clear before scoring. */
  changePossession(to: Team): void {
    if (to === this.offense) return;
    this.offense = to;
    this.cleared = false;
  }

  /** A basket by `team`, shot from (x, z). */
  basket(team: Team, x: number, z: number): BasketResult {
    if (this.winner !== null) return { counted: false, points: 0, winner: this.winner, nextOffense: this.offense };
    if (team !== this.offense || !this.cleared) {
      // not cleared (or scored by the defence on a scramble): no basket, the other team checks it
      const next = otherTeam(team);
      this.offense = next;
      this.cleared = true;
      return { counted: false, points: 0, winner: null, nextOffense: next };
    }
    const pts = PickupScore.value(x, z);
    this.points[team] += pts;
    if (this.points[team] >= this.target) this.winner = team;
    // make-it-take-it: same team, checked at the top
    this.offense = team;
    this.cleared = true;
    return { counted: true, points: pts, winner: this.winner, nextOffense: team };
  }
}

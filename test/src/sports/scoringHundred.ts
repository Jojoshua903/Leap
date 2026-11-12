/**
 * 100-Pin Bowling scoring. Every frame starts with a full rack of 100, the player gets 2 balls,
 * and the frame score is simply the pins knocked down (no strike/spare bonuses).
 * A "strike" is all 100 with the first ball, a "spare" is clearing the rest with the second.
 */
export const HUNDRED_PINS = 100;
export const BONUS_TIERS = [{ min: 80, key: 'fx.bonus80' }, { min: 50, key: 'fx.bonus50' }] as const;

export interface HundredNext {
  done: boolean;
  frame: number;      // 0-based
  ball: number;       // 1 or 2
  resetPins: boolean;
  standing: number;
}

/** Group rolls into frames. A frame ends after 2 balls, or after 1 if it cleared all 100. */
export function hundredFrames(rolls: readonly number[], frames = 10): number[][] {
  const out: number[][] = [];
  let i = 0;
  while (i < rolls.length && out.length < frames) {
    if (rolls[i] >= HUNDRED_PINS) { out.push([rolls[i]]); i += 1; }
    else { out.push(rolls.slice(i, i + 2)); i += 2; }
  }
  return out;
}

export function hundredNext(rolls: readonly number[], frames = 10): HundredNext {
  const f = hundredFrames(rolls, frames);
  if (f.length === 0) return { done: false, frame: 0, ball: 1, resetPins: true, standing: HUNDRED_PINS };
  const last = f[f.length - 1];
  const complete = last.length === 2 || last[0] >= HUNDRED_PINS;
  if (!complete) return { done: false, frame: f.length - 1, ball: 2, resetPins: false, standing: HUNDRED_PINS - last[0] };
  if (f.length >= frames) return { done: true, frame: frames - 1, ball: last.length, resetPins: false, standing: 0 };
  return { done: false, frame: f.length, ball: 1, resetPins: true, standing: HUNDRED_PINS };
}

/** Running total after each started frame. */
export function hundredCumulative(rolls: readonly number[], frames = 10): number[] {
  let sum = 0;
  return hundredFrames(rolls, frames).map(fr => (sum += fr.reduce((a, b) => a + b, 0)));
}

export function hundredTotal(rolls: readonly number[], frames = 10): number {
  const c = hundredCumulative(rolls, frames);
  return c.length ? c[c.length - 1] : 0;
}

/** Per-frame marks: "X" for 100 on the first ball, "/" for clearing the rest, otherwise the count ("-" for 0). */
export function hundredMarks(rolls: readonly number[], frames = 10): string[][] {
  return hundredFrames(rolls, frames).map(fr => fr.map((v, k) => {
    if (k === 0 && v >= HUNDRED_PINS) return 'X';
    if (k === 1 && fr[0] + v >= HUNDRED_PINS) return '/';
    return v === 0 ? '-' : String(v);
  }));
}

/** Bonus message key for a single ball, or null. Highest tier wins. */
export function bonusFor(pins: number): string | null {
  for (const t of BONUS_TIERS) if (pins >= t.min) return t.key;
  return null;
}

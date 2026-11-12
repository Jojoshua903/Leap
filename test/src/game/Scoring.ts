/**
 * Ten-pin scoring as pure functions over a flat list of rolls (pins knocked down per ball).
 * Frames before the last: strike = 1 ball, otherwise 2. Last frame: 2 balls, or 3 if it has a strike or spare.
 * `frames` defaults to 10; the 5-frame option uses the same rules with frame 5 as the bonus frame.
 */

/** Split rolls into frames. The last frame may be incomplete. */
export function splitFrames(rolls: readonly number[], frames = 10): number[][] {
  const out: number[][] = [];
  let i = 0;
  for (let f = 0; f < frames && i < rolls.length; f++) {
    if (f < frames - 1) {
      if (rolls[i] === 10) { out.push([10]); i += 1; }
      else { out.push(rolls.slice(i, i + 2)); i += 2; }
    } else {
      out.push(rolls.slice(i, i + 3)); i += 3;
    }
  }
  return out;
}

/** Cumulative score per started frame; null while a strike/spare bonus is still pending (and for every frame after it). */
export function cumulativeScores(rolls: readonly number[], frames = 10): Array<number | null> {
  const split = splitFrames(rolls, frames);
  const out: Array<number | null> = [];
  let i = 0, total = 0, pending = false;
  for (let f = 0; f < split.length; f++) {
    const r0 = rolls[i], r1 = rolls[i + 1], r2 = rolls[i + 2];
    let value: number | null = null;
    if (r0 === 10) {
      if (r1 !== undefined && r2 !== undefined) value = 10 + r1 + r2;
      i += 1;
    } else if (r1 !== undefined) {
      if (r0 + r1 === 10) { if (r2 !== undefined) value = 10 + r2; }
      else value = r0 + r1;
      i += 2;
    } else {
      i += 1;
    }
    if (value === null || pending) { pending = true; out.push(null); continue; }
    total += value;
    out.push(total);
  }
  return out;
}

/** Best known total: the last resolved cumulative score. */
export function totalScore(rolls: readonly number[], frames = 10): number {
  let best = 0;
  for (const s of cumulativeScores(rolls, frames)) if (s !== null) best = s;
  return best;
}

/**
 * Pins knocked down so far, counting only what is on the board without waiting for bonuses.
 * Used for live "who is leading" checks (Comeback achievement), where a pending strike shouldn't read as 0.
 */
export function runningScore(rolls: readonly number[], frames = 10): number {
  const cum = cumulativeScores(rolls, frames);
  let resolved = 0, resolvedFrames = 0;
  cum.forEach((s, f) => { if (s !== null) { resolved = s; resolvedFrames = f + 1; } });
  const split = splitFrames(rolls, frames);
  let raw = 0;
  for (let f = resolvedFrames; f < split.length; f++) for (const v of split[f]) raw += v;
  return resolved + raw;
}

function lastComplete(f: readonly number[]): boolean {
  if (f.length === 3) return true;
  return f.length === 2 && f[0] + f[1] < 10;
}

export interface NextRoll {
  done: boolean;
  frame: number;      // 0-based frame index
  ball: number;       // 1-based ball within the frame
  resetPins: boolean; // true when this ball starts with a full rack
  standing: number;   // pins standing before this ball
}

/** What happens next for a player with these rolls. */
export function nextRoll(rolls: readonly number[], frames = 10): NextRoll {
  const split = splitFrames(rolls, frames);
  const lastIdx = frames - 1;
  if (split.length === 0) return { done: false, frame: 0, ball: 1, resetPins: true, standing: 10 };
  const fi = split.length - 1, last = split[fi];
  if (fi < lastIdx) {
    const complete = last[0] === 10 || last.length === 2;
    if (complete) return { done: false, frame: fi + 1, ball: 1, resetPins: true, standing: 10 };
    return { done: false, frame: fi, ball: 2, resetPins: false, standing: 10 - last[0] };
  }
  if (lastComplete(last)) return { done: true, frame: lastIdx, ball: last.length, resetPins: false, standing: 0 };
  if (last.length === 1) {
    return last[0] === 10
      ? { done: false, frame: lastIdx, ball: 2, resetPins: true, standing: 10 }
      : { done: false, frame: lastIdx, ball: 2, resetPins: false, standing: 10 - last[0] };
  }
  // Third ball: full rack after strike-strike or a spare; otherwise what is left after strike + non-strike.
  const fresh = (last[0] === 10 && last[1] === 10) || (last[0] !== 10 && last[0] + last[1] === 10);
  return { done: false, frame: lastIdx, ball: 3, resetPins: fresh, standing: fresh ? 10 : 10 - last[1] };
}

export const isGameOver = (rolls: readonly number[], frames = 10): boolean => nextRoll(rolls, frames).done;

/** Display marks for each roll in each frame: "X", "/", "-" or a digit. */
export function frameMarks(rolls: readonly number[], frames = 10): string[][] {
  const lastIdx = frames - 1;
  return splitFrames(rolls, frames).map((f, fi) => {
    const marks: string[] = [];
    for (let k = 0; k < f.length; k++) {
      const v = f[k];
      const prev = k > 0 ? f[k - 1] : undefined;
      // A ball is a spare when it clears a rack that the previous ball in the same frame started.
      const rackStart = fi === lastIdx
        ? (k === 0 || prev === 10 || (k === 2 && f[0] !== 10 && f[0] + f[1] === 10))
        : k === 0;
      if (!rackStart && prev !== undefined && prev + v === 10) marks.push('/');
      else if (v === 10) marks.push('X');
      else marks.push(v === 0 ? '-' : String(v));
    }
    return marks;
  });
}

/** Is roll index `idx` a strike / spare? (Used for stats and XP.) */
export function classifyRolls(rolls: readonly number[], frames = 10): Array<'strike' | 'spare' | 'gutter' | 'open'> {
  const out: Array<'strike' | 'spare' | 'gutter' | 'open'> = [];
  for (const m of frameMarks(rolls, frames).flat()) {
    out.push(m === 'X' ? 'strike' : m === '/' ? 'spare' : m === '-' ? 'gutter' : 'open');
  }
  return out;
}

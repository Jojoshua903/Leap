/**
 * Pin layouts as pure data: each spot is [x, z] in metres, head pin first.
 * Kept free of Three/Rapier so it can be unit tested in Node.
 */
export type PinSpot = [number, number];

export const TEN_PIN_SPACING = 0.3048;                          // 12 in between pin centres
export const TEN_PIN_ROW_STEP = TEN_PIN_SPACING * Math.sin(Math.PI / 3);

/** Standard 1–10 numbering: rows of 1, 2, 3, 4. */
export function tenPinLayout(headZ: number): PinSpot[] {
  const spots: PinSpot[] = [];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) spots.push([(i - row / 2) * TEN_PIN_SPACING, headZ - row * TEN_PIN_ROW_STEP]);
  }
  return spots;
}

/** Row sizes for the 100-pin wall. Sums to 100. */
export const HUNDRED_ROWS = [6, 7, 8, 9, 10, 11, 12, 12, 12, 13] as const;
export const HUNDRED_SPACING = 0.135;
export const HUNDRED_ROW_STEP = 0.125;

/**
 * A wide wedge of 100 pins. Each row is centred; when two neighbouring rows have the same count,
 * the second is shifted by half a spacing so pins sit in the gaps instead of lining up behind each other.
 */
export function hundredPinLayout(headZ: number): PinSpot[] {
  const spots: PinSpot[] = [];
  let shift = 0;
  HUNDRED_ROWS.forEach((n, r) => {
    if (r > 0 && n === HUNDRED_ROWS[r - 1]) shift = shift === 0 ? HUNDRED_SPACING / 2 : 0;
    else shift = 0;
    for (let i = 0; i < n; i++) spots.push([(i - (n - 1) / 2) * HUNDRED_SPACING + shift, headZ - r * HUNDRED_ROW_STEP]);
  });
  return spots;
}

/** Depth of the rack from the head pin to the back row. */
export function layoutDepth(spots: readonly PinSpot[]): number {
  let min = Infinity, max = -Infinity;
  for (const [, z] of spots) { min = Math.min(min, z); max = Math.max(max, z); }
  return max - min;
}

/** Widest pin centre from the lane centre. */
export function layoutHalfWidth(spots: readonly PinSpot[]): number {
  let m = 0;
  for (const [x] of spots) m = Math.max(m, Math.abs(x));
  return m;
}

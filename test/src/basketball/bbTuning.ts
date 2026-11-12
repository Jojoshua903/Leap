/**
 * Basketball constants. Geometry is real (FIBA-ish half court); BB_TUNING holds the feel values,
 * live-editable with the F3 sliders listed in BB_TUNING_META.
 *
 * Coordinates: the hoop centre is at x = z = 0, y = HOOP.height. The court runs toward +z
 * (the camera side). The backboard is behind the hoop at −z, the baseline further back.
 */
export const BALL = {
  radius: 0.12,
  mass: 0.62
};

export const HOOP = {
  height: 3.05,
  /** Inner radius of the rim (inner diameter 0.457 m). */
  rimRadius: 0.2285,
  /** Radius of the rim tube itself. */
  tube: 0.01,
  /** Capsule colliders around the rim, so the ball rattles. */
  rimSegments: 20,
  /** Front face of the backboard (z). The rim's inner edge sits 15 cm in front of it. */
  boardZ: -0.38,
  boardWidth: 1.83,
  boardHeight: 1.07,
  boardThickness: 0.05,
  /** Bottom edge of the backboard. */
  boardBottom: 2.9,
  /** How deep the net hangs below the rim. */
  netDepth: 0.42
};

export const COURT = {
  halfWidth: 7.5,
  /** Baseline (behind the backboard) and the half-court line. 15 × 14 m in total. */
  baselineZ: -1.575,
  halfCourtZ: -1.575 + 14,
  threeRadius: 6.75,
  /** The 3-point line runs straight along the sidelines at |x| = 6.6 until it meets the arc. */
  cornerX: 6.6,
  /** Free-throw line, 4.6 m from the backboard. */
  freeThrowZ: -0.38 + 4.6,
  keyHalfWidth: 2.45,
  /** Where the ball is checked after a change of possession (top of the arc, outside it). */
  checkZ: 7.7
};

/** Release height at the jump apex without the jump (hands above the head). */
export const RELEASE_HEIGHT = 1.92;

/** z (relative to the hoop) where the arc meets the straight corner lines. */
export const CORNER_JOIN_Z = Math.sqrt(COURT.threeRadius ** 2 - COURT.cornerX ** 2);

/** Outside the 3-point line (a 2-pointer in pickup, a valid contest spot). */
export function isOutsideArc(x: number, z: number): boolean {
  if (z < CORNER_JOIN_Z) return Math.abs(x) >= COURT.cornerX;
  return Math.hypot(x, z) >= COURT.threeRadius;
}

export const BB_TUNING = {
  /* ---- shot solver ---- */
  /** Launch angle of the ideal shot (degrees); short shots get more, see ShotSolver.arcFor. */
  arcDeg: 52,
  /** Highest launch speed a shot may use (m/s). */
  maxLaunchSpeed: 11.5,
  /** Power: this fraction of the ideal swing speed either way still counts as perfect. */
  powerBand: 0.12,
  /** Power: how much of the remaining swing-speed error becomes launch-speed error (0.3 = 30 %). */
  powerGain: 0.3,
  /** Direction: degrees of shot error per degree of controller yaw away from the hoop. */
  dirGain: 0.28,
  /** Direction: yaw (degrees) that still counts as straight at the hoop. */
  dirBandDeg: 3,
  /** Timing: release within this many ms of the jump apex is PERFECT. */
  perfectMs: 40,
  /** Timing: within this many ms is GOOD; beyond is EARLY / LATE. */
  goodMs: 120,
  /** Backspin of a clean release (revolutions per second). */
  backspinRps: 2.2,

  /* ---- jump + flick (motion controllers) ---- */
  /** ms from the start of the lift (the jump) to its apex. */
  jumpApexMs: 280,
  /** Jump height at the apex (m). */
  jumpHeight: 0.36,
  /** Pitch rate (rad/s) that starts the lift / jump while the shot is set. */
  liftRate: 1.6,
  /** Pitch rate (rad/s) the flick must reach to count as a shot. */
  flickRate: 5.5,
  /** Ideal flick peak (rad/s) for a 2 m shot and for a 7 m shot; linear in between. */
  idealRateNear: 7,
  idealRateFar: 11.5,

  /* ---- gestures without the trigger (pickup) ---- */
  /** Up-flick on defence = block jump (pitch rate, rad/s). */
  blockRate: 6.5,
  /** Sideways swipe = steal (yaw rate, rad/s). */
  swipeRate: 6,
  /** Forward push = pass (forward acceleration above the slow average, m/s²). */
  pushAccel: 11,

  /* ---- mouse ---- */
  /** Seconds for the power meter to fill once (it then bounces back). */
  meterPeriod: 1.1,
  /** Width of the sweet spot on the meter (0..1). */
  sweetWidth: 0.12,
  /** How far the sweet spot wanders around its centre (0..1). */
  sweetDrift: 0.22,
  /** Meter error → launch-speed error. */
  meterGain: 0.32,
  /** Slow sway of the mouse aim (degrees), so it isn't a laser. */
  aimSwayDeg: 2.2,

  /* ---- difficulty of a shot (pickup) ---- */
  /** Extra launch error (fraction) for a defender in your face; fades out at 2.2 m. */
  contestErr: 0.05,
  /** Extra launch error per metre beyond 4 m. */
  distErr: 0.006,

  /* ---- physics feel ---- */
  floorRestitution: 0.75,
  rimRestitution: 0.55,
  boardRestitution: 0.6,
  /** Velocity damping inside the net (1/s), so a make drops instead of shooting through. */
  netDrag: 7,
  /** Rolling resistance on the floor (1/s). */
  rollDrag: 0.6,

  /* ---- players (pickup) ---- */
  moveSpeed: 4.2,
  sprintSpeed: 6.2,
  accel: 16,
  passSpeed: 9.5,
  /** Reach for a steal swipe (m). */
  stealRange: 1.25,
  /** Reach for a block (m). */
  blockRange: 1.5
};

export type BBTuningKey = keyof typeof BB_TUNING;

export const BB_TUNING_META: Partial<Record<BBTuningKey, { min: number; max: number; step: number }>> = {
  arcDeg: { min: 44, max: 62, step: 0.5 },
  powerBand: { min: 0, max: 0.3, step: 0.01 },
  powerGain: { min: 0.05, max: 0.6, step: 0.01 },
  dirGain: { min: 0.05, max: 0.6, step: 0.01 },
  perfectMs: { min: 10, max: 100, step: 5 },
  goodMs: { min: 50, max: 250, step: 5 },
  jumpApexMs: { min: 160, max: 420, step: 10 },
  liftRate: { min: 0.6, max: 4, step: 0.1 },
  flickRate: { min: 2.5, max: 10, step: 0.1 },
  idealRateNear: { min: 3, max: 14, step: 0.1 },
  idealRateFar: { min: 5, max: 18, step: 0.1 },
  meterPeriod: { min: 0.6, max: 2, step: 0.05 },
  sweetWidth: { min: 0.04, max: 0.3, step: 0.01 },
  meterGain: { min: 0.05, max: 0.6, step: 0.01 },
  contestErr: { min: 0, max: 0.15, step: 0.005 },
  floorRestitution: { min: 0.4, max: 0.9, step: 0.01 },
  rimRestitution: { min: 0.2, max: 0.9, step: 0.01 },
  netDrag: { min: 0, max: 20, step: 0.5 },
  moveSpeed: { min: 2, max: 7, step: 0.1 }
};

/** Shot Assist setting: Off / Low / High / Very High. Each shrinks the player's error by this factor. */
export const ASSIST_SCALE = [1, 0.72, 0.5, 0.3] as const;
export type ShotAssist = 0 | 1 | 2 | 3;

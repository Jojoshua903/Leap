/**
 * Swordplay feel values. Every number that decides whether a swing counts lives here; the ones listed in
 * SW_TUNING_META get live F3 sliders. Distances in metres, speeds in m/s, times in ms unless noted.
 *
 * Player frame ("P frame", used by BladeTracker, SlashDetector and the HUD): x = the player's right,
 * y = up, z = forward (toward the target), origin between the Buddy's feet.
 */
export const SW_TUNING = {
  /* ---- blade ---- */
  /** Blade length from the hilt to the tip. */
  bladeLen: 0.9,
  /** Blade capsule radius for hit tests. */
  bladeRadius: 0.035,
  /** Hilt anchor in front of the sword shoulder (x is mirrored for left-handers). */
  anchorX: 0.2,
  anchorY: 1.05,
  anchorZ: 0.35,
  /** Extrapolation of the blade along the gyro rate, ms. Capped at one 60 FPS frame (16.7 ms). */
  predictMs: 8,
  /** Yaw re-centering while the controller is held still, degrees per second. 0 = off. */
  recenterRate: 6,
  /** Below this angular speed (rad/s) the controller counts as still. */
  stillRate: 0.35,
  /** ...for at least this long before re-centering starts. */
  stillMs: 400,
  /** Mouse: the blade tip follows the cursor at most this fast (keeps the mouse from out-slashing a real swing). */
  mouseMaxSpeed: 9,
  /** Mouse: distance of the tip plane in front of the hilt, and its width / height. */
  mousePlaneZ: 0.7,
  mouseSpanX: 1.5,
  mouseSpanY: 1.1,

  /* ---- slash detection ---- */
  /** A slash starts when the tip moves faster than this... */
  startSpeed: 3.2,
  /** ...and ends when it drops below this for `endSamples` samples (hysteresis). */
  endSpeed: 1.8,
  endSamples: 2,
  /** Shortest tip path that counts as a slash. */
  minLen: 0.22,
  /** Tip speed for power 0 and power 1. */
  powerMin: 3,
  powerMax: 14,
  /** A slash in the asked direction may be off by this many degrees (Speed Slice). */
  dirTolerance: 30,
  /** PERFECT: direction within this many degrees and straightness above perfectStraight. */
  perfectDeg: 12,
  perfectStraight: 0.9,
  /** Backswing filter: a roughly opposite slash this soon after the last one only counts if it is fast. */
  backswingMs: 380,
  /** ...at least this fraction of the last slash's peak speed... */
  backswingFactor: 0.8,
  /** ...and at least this fast (m/s). */
  backswingMinSpeed: 6,
  /** Thrust from the accelerometer: forward linear acceleration (m/s², gravity removed)... */
  thrustAccel: 14,
  /** ...while the controller barely rotates (rad/s). */
  thrustMaxGyro: 3.5,
  thrustCooldownMs: 400,
  /** Thrust from the tip path: forward travel at least this many times the sideways travel... */
  thrustTipRatio: 2,
  /** ...and at least this far forward. */
  thrustMinDz: 0.18,
  /** Guard: the blade held steady (gyro below this, rad/s)... */
  guardMaxGyro: 0.9,
  /** ...for this long. */
  guardMs: 120,
  /** Blade within this many degrees of horizontal / vertical counts as a guard pose. */
  guardHorizDeg: 28,
  guardVertDeg: 30,
  /** Dodge: a quick wrist twist (roll rate, rad/s) or A/D; cooldown in seconds. */
  dodgeRollRate: 6,
  dodgeCooldown: 0.7,

  /* ---- hits and feedback ---- */
  /** The blade must move at least this fast at contact to cut or hit. */
  hitMinSpeed: 2.5,
  /** Hit-stop freeze, scaled by power. */
  hitStopMin: 30,
  hitStopMax: 60,
  /** Screen shake strength at power 1 (m). */
  shake: 0.06,

  /* ---- AI ---- */
  /** Multiplies every Duel AI reaction time (> 1 = easier). */
  aiReactionScale: 1,
  /** Multiplies how often the AI attacks (< 1 = calmer). */
  aiAggression: 1
};

export type SWTuningKey = keyof typeof SW_TUNING;

export const SW_TUNING_META: Partial<Record<SWTuningKey, { min: number; max: number; step: number }>> = {
  bladeLen: { min: 0.5, max: 1.3, step: 0.02 },
  predictMs: { min: 0, max: 16, step: 1 },
  recenterRate: { min: 0, max: 30, step: 0.5 },
  mouseMaxSpeed: { min: 3, max: 20, step: 0.5 },
  startSpeed: { min: 1, max: 8, step: 0.1 },
  endSpeed: { min: 0.5, max: 5, step: 0.1 },
  minLen: { min: 0.05, max: 0.6, step: 0.01 },
  powerMax: { min: 6, max: 25, step: 0.5 },
  dirTolerance: { min: 10, max: 45, step: 1 },
  perfectDeg: { min: 4, max: 25, step: 1 },
  perfectStraight: { min: 0.6, max: 0.99, step: 0.01 },
  backswingMs: { min: 0, max: 800, step: 10 },
  backswingFactor: { min: 0.3, max: 1.5, step: 0.05 },
  thrustAccel: { min: 5, max: 30, step: 0.5 },
  guardMs: { min: 40, max: 400, step: 10 },
  guardMaxGyro: { min: 0.2, max: 3, step: 0.05 },
  dodgeRollRate: { min: 2, max: 15, step: 0.5 },
  hitMinSpeed: { min: 0.5, max: 6, step: 0.1 },
  aiReactionScale: { min: 0.5, max: 2, step: 0.05 },
  aiAggression: { min: 0.3, max: 2, step: 0.05 }
};

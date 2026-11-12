/**
 * Frisbee constants and feel values. The physics follows the usual flying-disc model (lift and drag from
 * the angle of attack, plus a pitching moment that the spin turns into a bank through precession);
 * see DiscPhysics.ts. FB_TUNING holds the values that are live-editable with the F3 sliders in FB_TUNING_META.
 *
 * World axes in the frisbee scenes: +y up, the thrower stands at the origin and throws toward −z,
 * +x is to the thrower's right.
 */
export const DISC = {
  mass: 0.175,
  diameter: 0.27,
  radius: 0.135,
  /** Planform area π r² (m²). */
  area: Math.PI * 0.135 * 0.135,
  /** Moment of inertia about the spin axis (kg m²); a rim-weighted disc is ~0.6 m r². */
  inertia: 0.6 * 0.175 * 0.135 * 0.135,
  /** Air density (kg/m³). */
  rho: 1.23
};

export type DiscTypeId = 'dog' | 'driver' | 'mid' | 'putter';

/**
 * Aerodynamic coefficients and stability per disc. Lift CL = cl0 + cla·α, drag CD = cd0 + cda·(α − alpha0)²
 * below the stall; the pitching moment CM is cm0 + cma·(α − alpha0) plus two stability terms:
 *   fade: nose-up moment that grows as the speed drops below `fadeSpeed` (the late hook back, left for a
 *         right-hand backhand);
 *   turn: nose-down moment above `turnSpeed` (high-speed turn, right for a right-hand backhand).
 */
export interface DiscType {
  id: DiscTypeId;
  cl0: number; cla: number;
  cd0: number; cda: number;
  /** Angle of attack with the least drag (rad). */
  alpha0: number;
  /** Stall angle (degrees): above it lift falls away and drag climbs. */
  stallDeg: number;
  cm0: number; cma: number;
  /** 0..1 high-speed turn and the speed (m/s) above which it starts. */
  turn: number; turnSpeed: number;
  /** 0..1 low-speed fade and the speed (m/s) below which it grows. */
  fade: number; fadeSpeed: number;
  /** Fastest launch this disc allows (m/s); slower discs can't be thrown as hard. */
  maxSpeed: number;
  /** Multiplier on the throw speed from the flick (putters fly slower for the same arm). */
  armFactor: number;
  /** Ring colours of the default skin. */
  color: string;
}

export const DISC_TYPES: Record<DiscTypeId, DiscType> = {
  // a soft, floaty catch disc
  dog: { id: 'dog', cl0: 0.15, cla: 1.4, cd0: 0.08, cda: 2.72, alpha0: -0.05, stallDeg: 24, cm0: 0, cma: 0.02, turn: 0.15, turnSpeed: 16, fade: 0.4, fadeSpeed: 11, maxSpeed: 26, armFactor: 0.85, color: '#ff8a3c' },
  // fast and long, turns at high speed, fades hard at the end
  driver: { id: 'driver', cl0: 0.12, cla: 1.25, cd0: 0.06, cda: 2.4, alpha0: -0.05, stallDeg: 22, cm0: 0, cma: 0.02, turn: 0.35, turnSpeed: 21, fade: 0.6, fadeSpeed: 14, maxSpeed: 32, armFactor: 1, color: '#ff5a5f' },
  // balanced
  mid: { id: 'mid', cl0: 0.14, cla: 1.35, cd0: 0.075, cda: 2.6, alpha0: -0.05, stallDeg: 23, cm0: 0, cma: 0.02, turn: 0.15, turnSpeed: 17, fade: 0.35, fadeSpeed: 11, maxSpeed: 25, armFactor: 0.88, color: '#3bb37a' },
  // slow and very straight
  putter: { id: 'putter', cl0: 0.16, cla: 1.45, cd0: 0.095, cda: 2.9, alpha0: -0.05, stallDeg: 24, cm0: 0, cma: 0.015, turn: 0.04, turnSpeed: 14, fade: 0.15, fadeSpeed: 7, maxSpeed: 19, armFactor: 0.72, color: '#2f8fd8' }
};

export const FB_TUNING = {
  /* ---- flight ---- */
  /** Strength of the low-speed fade moment (CM per unit `fade`). */
  fadeK: 0.7,
  /** Strength of the high-speed turn moment (CM per unit `turn`). */
  turnK: 0.012,
  /** Speed range (m/s) over which the turn builds up above `turnSpeed`. */
  turnRange: 8,
  /** Roll moment coefficient (per unit advance ratio ω·d / 2v): a slow nose-down drift. */
  crr: 0.004,
  /** Spin below this (rad/s) is treated as this, so precession can't blow up. */
  minSpin: 4,
  /** Spin decay in the air (1/s). */
  spinDecay: 0.03,
  /** Wobble dies down over this many seconds. */
  wobbleDecay: 1.5,
  /** Random precession (rad/s) at full wobble. */
  wobbleNoise: 0.9,
  /** Extra drag at full wobble (0.35 = +35 %). */
  wobbleDrag: 0.35,

  /* ---- ground ---- */
  /** Vertical restitution of a bounce on grass (sand is a third of it). */
  bounce: 0.18,
  /** Horizontal speed kept at the first touch. */
  skidKeep: 0.62,
  /** Sliding friction on grass (sand, rough and fairway scale it). */
  friction: 0.55,
  /** Tilt (degrees) above which a landing disc rolls on its edge instead of sliding. */
  rollTiltDeg: 52,
  /** Deceleration of a rolling disc (m/s²). */
  rollDecel: 2.2,

  /* ---- throw mapping (motion) ---- */
  /** Angular speed (rad/s) a flick must reach to count. */
  flickRate: 6,
  /** Angular speed for the fastest throw. */
  rateForMax: 22,
  /** Linear accel (m/s² above gravity) adds this much rad/s of "virtual" flick speed per m/s². */
  accelWeight: 0.12,
  /** Slowest and fastest throw speed (m/s, before the disc's armFactor). */
  speedMin: 8,
  speedMax: 32,
  /** Shape of the speed curve (> 1 = soft at the bottom, needs a real flick for the top). */
  speedCurve: 1.35,
  /** Controller yaw at release → throw direction (degrees per degree). */
  yawGain: 0.8,
  maxDirDeg: 35,
  /** Controller pitch at release → loft (degrees per degree), plus an offset. */
  pitchGain: 0.6,
  loftOffset: 4,
  /** Controller roll at release → bank (degrees per degree). */
  rollGain: 0.8,
  maxBankDeg: 35,
  /** Spin: base, per rad/s of wrist roll, and per rad/s of flick. */
  spinBase: 12,
  spinRollGain: 1.4,
  spinFlickGain: 1.2,
  spinMin: 10,
  spinMax: 60,
  /** Nose angle relative to the flight path for a clean release (degrees). */
  noseClean: 2,
  /** Smoothness: jerk (sum of accel-magnitude changes, m/s²) below this is a clean release… */
  jerkOk: 40,
  /** …and this much more makes it quality 0. */
  jerkRange: 120,
  /** Angle error (degrees) at quality 0. */
  errDeg: 7,

  /* ---- mouse slingshot ---- */
  /** Drag length (px) for full power. */
  slingPx: 260,
  /** Mouse throws top out at this fraction of the disc's max speed. */
  slingCap: 0.86,
  /** Random direction error (degrees) and power error (fraction) of a mouse throw. */
  slingDirErr: 2.5,
  slingPowerErr: 0.04,
  slingSpin: 36,

  /* ---- dog ---- */
  /** Seconds after the release before the dog reacts (scaled per breed). */
  dogReaction: 0.35,
  /** How high above the ground the dog can snatch a disc without jumping (m). */
  dogMouthY: 0.65,
  /** Base catch chance before speed, wobble and reach penalties. */
  dogCatchBase: 0.97
};

export type FBTuningKey = keyof typeof FB_TUNING;

export const FB_TUNING_META: Partial<Record<FBTuningKey, { min: number; max: number; step: number }>> = {
  fadeK: { min: 0, max: 2, step: 0.05 },
  turnK: { min: 0, max: 0.05, step: 0.001 },
  spinDecay: { min: 0, max: 0.2, step: 0.005 },
  wobbleNoise: { min: 0, max: 3, step: 0.05 },
  bounce: { min: 0, max: 0.5, step: 0.01 },
  friction: { min: 0.1, max: 1.2, step: 0.01 },
  flickRate: { min: 2, max: 12, step: 0.1 },
  rateForMax: { min: 10, max: 40, step: 0.5 },
  speedMax: { min: 20, max: 40, step: 0.5 },
  speedCurve: { min: 0.6, max: 2.5, step: 0.05 },
  yawGain: { min: 0.2, max: 1.5, step: 0.05 },
  pitchGain: { min: 0.1, max: 1.5, step: 0.05 },
  rollGain: { min: 0.2, max: 1.5, step: 0.05 },
  jerkOk: { min: 5, max: 150, step: 1 },
  errDeg: { min: 0, max: 20, step: 0.5 },
  slingCap: { min: 0.5, max: 1, step: 0.01 },
  dogReaction: { min: 0, max: 1, step: 0.01 },
  dogCatchBase: { min: 0.5, max: 1, step: 0.01 }
};

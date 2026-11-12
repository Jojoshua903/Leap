/**
 * Every table-tennis feel constant. SI units unless noted. The DebugPanel (F3) makes a live slider
 * for each entry in TT_TUNING_META. Geometry follows the real table; feel values were picked by hand.
 *
 * Coordinates: table centre at x = z = 0, the playing surface at y = TABLE.height.
 * Side 0 (player 1, near the camera) owns z > 0; side 1 owns z < 0. The net is the plane z = 0.
 */
export const TABLE = {
  length: 2.74,
  width: 1.525,
  height: 0.76,
  netHeight: 0.1525,
  /** Net and posts overhang the table by 15.25 cm on each side. */
  netHalfWidth: 0.7625 + 0.1525,
  postRadius: 0.012
} as const;

export const BALL = {
  radius: 0.02,
  mass: 0.0027,
  /** Hollow shell: I = 2/3 · m · r². */
  inertia: (2 / 3) * 0.0027 * 0.02 * 0.02
} as const;

export const PADDLE_RADIUS = 0.075;
export const PADDLE_HALF_THICKNESS = 0.006;

export const TT_TUNING = {
  /* ---- air ---- */
  drag: 0.12,                // a = -drag·|v|·v. From ½ρ·Cd·A/m with Cd ≈ 0.43. Higher = balls die sooner, feel floatier.
  magnus: 0.0055,            // a = magnus·(ω × v). From ½ρ·A·r·Cl/m with Cl ≈ 1. The "how much does spin curve" knob.
  spinDecay: 0.08,           // fraction of spin lost per second in the air

  /* ---- bounces ---- */
  tableRestitution: 0.9,     // vertical speed kept on a table bounce (0.9 → a 30 cm drop bounces back to ~24 cm)
  tableFriction: 0.22,       // Coulomb limit for the spin ↔ speed exchange on the table
  floorRestitution: 0.65,
  netCordRestitution: 0.35,  // bounce off the top tape
  netCordDamp: 0.72,         // speed kept after touching the tape
  netCordDeflectDeg: 9,      // max seeded random direction change from a net cord
  paddleRestitution: 0.86,   // sweet-spot rebound off the rubber
  paddleEdgeRestitution: 0.55, // rebound at the very edge of the blade
  paddleGrip: 0.55,          // Coulomb limit of the rubber: how strongly a brushing swing turns into spin

  /* ---- shot shaping (player intent → target) ---- */
  shotDepthMin: 0.35,        // m past the net for the softest shot
  shotDepthMax: 1.32,        // m past the net for a full-power shot (the half is 1.37 long)
  shotWideMax: 0.86,         // m lateral target at full direction (the half-width is 0.76: beyond = out)
  driveApex: 0.2,            // m above the table at the top of a flat drive
  lobApex: 1.1,              // m above the table at the top of a full lob
  netClearAssist: 0.6,       // 0..1: how much the player's shots are lifted to clear the net
  topspinMax: 160,           // rad/s from a full brushing swing (~1500 rpm)
  sidespinMax: 70,           // rad/s from a full roll tilt
  smashHeight: 0.32,         // m above the table: contact higher than this + power ≥ smashPower = smash
  smashPower: 0.8,

  /* ---- timing ---- */
  perfectMs: 35,             // |swing peak − ball arrival| under this = PERFECT
  timingWindowMs: 170,       // beyond this the swing misses completely
  edgeAtWindow: 0.95,        // contact offset (share of the paddle radius) at the edge of the window

  /* ---- motion controls ---- */
  swingRate: 5,              // rad/s angular speed that starts a paddle swing
  rateForFullPower: 18,      // rad/s peak angular speed that gives power 1
  faceYawRangeDeg: 30,       // paddle yaw (deg) that aims fully left/right
  facePitchRangeDeg: 35,     // paddle pitch (deg) from flat drive to full lob
  brushForFullSpin: 0.7,     // share of the swing that is vertical for a full top/backspin
  rollForFullSide: 6,        // rad/s wrist roll at contact for full sidespin
  tossHeight: 0.2,           // m the serve toss rises

  /* ---- mouse ---- */
  mouseMaxSpeed: 9,          // m/s paddle speed cap so the mouse can't be overpowered
  mouseSwingSpeed: 2.2,      // m/s forward paddle speed that counts as a swing
  mouseReach: 0.16,          // m lateral distance at which a mouse swing still meets the ball

  /* ---- assist movement ---- */
  paddleSlide: 9,            // 1/s: how fast the assisted paddle slides to the predicted contact point

  /* ---- juice ---- */
  shakeSmash: 0.05
};

export type TTTuningKey = keyof typeof TT_TUNING;

export const TT_TUNING_META: Partial<Record<TTTuningKey, { min: number; max: number; step: number }>> = {
  drag: { min: 0, max: 0.3, step: 0.005 },
  magnus: { min: 0, max: 0.015, step: 0.0005 },
  tableRestitution: { min: 0.6, max: 0.98, step: 0.01 },
  tableFriction: { min: 0, max: 0.6, step: 0.01 },
  paddleRestitution: { min: 0.5, max: 1, step: 0.01 },
  paddleGrip: { min: 0, max: 1, step: 0.01 },
  shotDepthMax: { min: 0.8, max: 1.6, step: 0.01 },
  shotWideMax: { min: 0.4, max: 1.1, step: 0.01 },
  driveApex: { min: 0.05, max: 0.6, step: 0.01 },
  lobApex: { min: 0.5, max: 2, step: 0.05 },
  netClearAssist: { min: 0, max: 1, step: 0.05 },
  topspinMax: { min: 0, max: 400, step: 5 },
  perfectMs: { min: 10, max: 100, step: 5 },
  timingWindowMs: { min: 60, max: 300, step: 5 },
  swingRate: { min: 1, max: 12, step: 0.5 },
  rateForFullPower: { min: 6, max: 35, step: 0.5 },
  mouseMaxSpeed: { min: 3, max: 20, step: 0.5 },
  paddleSlide: { min: 2, max: 20, step: 0.5 }
};

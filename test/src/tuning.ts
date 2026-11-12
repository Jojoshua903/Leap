/**
 * Every feel-related constant in one place. The DebugPanel (F3) creates a live slider for each entry in TUNING_META.
 * Units are SI unless noted otherwise.
 */
export const TUNING = {
  /* ---- sensor fusion ---- */
  filterGain: 0.02,          // complementary filter: share of the accel tilt correction per sample. At 120 Hz ≈ 0.4 s time constant. Higher = less drift, more swing wobble.
  calibrationMs: 2000,       // how long to hold still on the calibration screen

  /* ---- swing detection ---- */
  swingSign: 1,              // flip to -1 if your controller reports the forward swing as negative pitch rate
  backswingRate: 2.0,        // rad/s backwards pitch rate that "arms" a swing
  forwardRate: 3.0,          // rad/s forward pitch rate that starts the forward phase
  releaseGraceMs: 250,       // a release this long after the forward peak still counts as a swing (x3 = "too late")
  weakRate: 4.0,             // peak forward rate below this = "no swing" weak roll
  rateForMaxSpeed: 14,       // rad/s peak forward rate that gives speedMax
  accelWeight: 0.15,         // how much peak linear accel (m/s² above g) adds, in rad/s units
  speedMin: 4,               // m/s for the weakest real swing
  speedMax: 11,              // m/s for the strongest swing
  speedCurve: 0.8,           // <1 boosts gentle throws, >1 makes power harder to reach
  weakSpeed: 2.6,            // m/s for a "no swing" release

  /* ---- aim, direction, spin ---- */
  aimYawRangeDeg: 25,        // controller yaw (deg) that moves the aim marker from centre to the edge
  aimLaneHalfWidth: 0.42,    // m; aim -1..1 maps to this lateral start position
  yawToAngle: 0.5,           // degrees of launch angle per degree of yaw change during the swing
  maxAngleDeg: 8,            // launch angle clamp
  rollRateForMaxSpin: 10,    // rad/s wrist roll at release that gives maxSpin
  maxSpin: 40,               // rad/s ball spin cap
  jerkThreshold: 60,         // jerk metric above this starts adding random angle noise
  jerkNoiseDeg: 2.5,         // max extra random angle for a very jerky swing

  /* ---- mouse backend ---- */
  mouseRateGain: 0.011,      // rad/s of fake pitch rate per px/s of vertical mouse speed
  mouseSpinGain: 0.012,      // rad/s of fake roll rate per px/s of horizontal mouse speed
  mouseYawGain: 0.08,        // deg of fake yaw per px of horizontal drift during the swing

  /* ---- lane + physics ---- */
  laneLength: 18.29,         // foul line to head pin (60 ft)
  laneWidth: 1.05,
  oilLength: 12.2,           // first 2/3 of the lane is oiled
  oilFriction: 0.04,         // collider friction on the oil
  dryFriction: 0.22,         // collider friction on the dry back end
  hookGain: 0.016,           // lateral hook force = hookGain * spin * mass * g * dryness. The main "how much does it curve" knob.
  spinDecay: 0.35,           // fraction of spin lost per second on the dry part (spin turns into hook)
  ballMass: 6,
  ballRadius: 0.11,
  pinMass: 1.5,
  pinRestitution: 0.45,

  /* ---- settling ---- */
  settleSpeed: 0.06,         // m/s; everything below this counts as "still"
  settleTime: 3,             // s of stillness (after the ball reaches the pins) before scoring
  frameTimeout: 6,           // s after release before scoring regardless

  /* ---- juice ---- */
  slowMoScale: 0.3,
  slowMoTime: 0.4,
  shakeGain: 0.035           // camera shake per m/s of impact speed (volume now lives in Settings → Audio)
};

export type TuningKey = keyof typeof TUNING;

/** Slider ranges for the DebugPanel. */
export const TUNING_META: Partial<Record<TuningKey, { min: number; max: number; step: number }>> = {
  filterGain: { min: 0.001, max: 0.2, step: 0.001 },
  swingSign: { min: -1, max: 1, step: 2 },
  backswingRate: { min: 0.5, max: 6, step: 0.1 },
  forwardRate: { min: 0.5, max: 8, step: 0.1 },
  weakRate: { min: 1, max: 10, step: 0.1 },
  rateForMaxSpeed: { min: 5, max: 30, step: 0.5 },
  accelWeight: { min: 0, max: 0.6, step: 0.01 },
  speedMin: { min: 1, max: 8, step: 0.1 },
  speedMax: { min: 6, max: 16, step: 0.1 },
  speedCurve: { min: 0.3, max: 2, step: 0.05 },
  yawToAngle: { min: 0, max: 1.5, step: 0.05 },
  maxAngleDeg: { min: 0, max: 15, step: 0.5 },
  rollRateForMaxSpin: { min: 2, max: 25, step: 0.5 },
  maxSpin: { min: 0, max: 80, step: 1 },
  jerkNoiseDeg: { min: 0, max: 8, step: 0.1 },
  mouseRateGain: { min: 0.002, max: 0.04, step: 0.001 },
  mouseSpinGain: { min: 0, max: 0.04, step: 0.001 },
  oilFriction: { min: 0, max: 0.3, step: 0.005 },
  dryFriction: { min: 0, max: 0.6, step: 0.01 },
  hookGain: { min: 0, max: 0.06, step: 0.001 },
  spinDecay: { min: 0, max: 1.5, step: 0.01 },
  shakeGain: { min: 0, max: 0.1, step: 0.001 }
};

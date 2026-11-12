export type Vec3 = [number, number, number];
/** Quaternion as [x, y, z, w]. */
export type Quat = [number, number, number, number];

/**
 * Device frame used by every backend once its axes are remapped:
 * +x = right, +y = up, +z = toward the player. Pointing at the screen = looking down -z.
 * A forward underhand bowling swing is positive rotation about +x (the controller tip rises).
 * Wrist roll (for spin) is rotation about the forward (-z) axis.
 */
export interface InputSample {
  t: number;            // ms, performance.now() clock of the game page
  accel: Vec3;          // m/s², gravity included
  gyro: Vec3;           // rad/s, bias already removed
  orientation: Quat;    // device -> world, from the complementary filter (or synthesised)
  buttons: { trigger: boolean; a: boolean; b: boolean };
  /** Movement stick, x right / y forward, −1..1 (Joy-Con stick, phone touch pad). Absent on the mouse. */
  stick?: [number, number];
}

export type BackendKind = 'mouse' | 'phone' | 'joycon';

export interface Calibration {
  gyroBias: Vec3;       // averaged gyro while held still
  forward: Quat;        // orientation while pointing at the screen
}

export interface Throw {
  speed: number;        // m/s down the lane
  angleDeg: number;     // + = toward the right gutter
  spin: number;         // rad/s, + hooks to the left (right-handed hook)
  aimX: number;         // start position, -1 (left) .. 1 (right)
  weak: boolean;        // "no swing" release
  jerk: number;         // smoothness metric, used for the accuracy penalty
  peakRate: number;     // rad/s, for the debug panel
  peakAccel: number;    // m/s² above gravity, for the debug panel
}

export interface PlayerInfo { name: string; color: string }

/**
 * One paddle swing (table tennis), emitted by SwingDetector in paddle mode right after the peak.
 * Motion controllers give no position, so this is everything the assisted paddle uses.
 */
export interface PaddleSwing {
  /** ms, performance.now() of the sample with the peak angular speed (the contact moment). */
  t: number;
  /** 0..1 (can exceed 1 slightly for a very hard swing). */
  power: number;
  /** -1 (aim left) .. 1 (aim right), from the paddle face yaw at the peak. */
  direction: number;
  /** 0 = flat drive .. 1 = lob, from the paddle pitch at the peak. */
  loft: number;
  /** -1 chop (brushing down) .. 1 topspin (brushing up). */
  brush: number;
  /** -1 .. 1 sidespin from the wrist roll at the peak. */
  roll: number;
  forehand: boolean;
  peakRate: number;
}

/**
 * One basketball shot (SwingDetector in hoops mode): the trigger was held (the shot is "set"), the controller
 * was lifted (the jump starts at `liftT`) and flicked; `t` is the flick peak, which is the release.
 */
export interface HoopShot {
  /** ms, performance.now() of the flick peak = the release. */
  t: number;
  /** ms, when the lift (the jump) started. */
  liftT: number;
  /** Peak pitch rate of the flick, rad/s. */
  peakRate: number;
  /** Controller yaw at the release, degrees relative to calibration (+ = turned left). */
  yawDeg: number;
}

/** Quick motions without the trigger (pickup defence and passing). */
export interface HoopGesture {
  kind: 'push' | 'swipe' | 'flickUp';
  t: number;
  /** swipe: +1 = to the left, −1 = to the right. */
  dir: number;
  /** Controller yaw at the gesture, degrees (+ = left); a push aims the pass with it. */
  yawDeg: number;
}

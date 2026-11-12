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

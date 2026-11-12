import { Rng } from '../tabletennis/BallPhysics';
import { ASSIST_SCALE, BALL, BB_TUNING, HOOP, type ShotAssist } from './bbTuning';

/**
 * The shot solver: an ideal shot plus the player's error. Pure logic, no Rapier, so it is testable and the
 * headless pickup simulation can use it.
 *
 * Motion controllers can't aim precisely, so the player never aims the ball directly:
 *  1. solveIdealShot finds the launch velocity whose arc passes through the hoop centre.
 *  2. The player's input becomes small errors (power, direction, timing), shrunk by the Shot Assist setting,
 *     and applyError perturbs the ideal velocity with them. Perfect input = swish.
 *
 * Rapier integrates with symplectic Euler (v += g·dt, then x += v·dt). Its trajectory equals the exact
 * parabola of a launch that is g·dt/2 slower upward, so the solver adds g·dt/2 to vy for the physics step
 * it will run at. predictOutcome steps exactly like Rapier.
 */
export interface V3 { x: number; y: number; z: number }

export const G = 9.81;
/** Physics step the game runs Rapier at. */
export const SIM_DT = 1 / 120;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export const HOOP_CENTER: V3 = { x: 0, y: HOOP.height, z: 0 };

export interface IdealShot {
  vel: V3;
  arcDeg: number;
  speed: number;
  /** Seconds until the ball reaches the hoop centre. */
  flightT: number;
  /** The shot needed more than maxLaunchSpeed and was limited (it will fall short). */
  clamped: boolean;
}

/** Horizontal distance and height difference from a release point to the hoop. */
export function geometry(release: V3, hoop: V3 = HOOP_CENTER): { d: number; h: number; ux: number; uz: number } {
  const dx = hoop.x - release.x, dz = hoop.z - release.z;
  const d = Math.hypot(dx, dz);
  return { d, h: hoop.y - release.y, ux: d > 1e-6 ? dx / d : 0, uz: d > 1e-6 ? dz / d : -1 };
}

/**
 * Launch angle for a release point: the tuned arc (48–58°), raised for short shots so the ball still drops
 * in at 40° or steeper (anything flatter clips the rim). Up to 72° under the basket.
 */
export function arcFor(release: V3, hoop: V3 = HOOP_CENTER, base = BB_TUNING.arcDeg): number {
  const { d, h } = geometry(release, hoop);
  if (d < 0.05) return 80;
  const minArc = Math.atan(Math.tan(40 * D2R) + 2 * h / d) * R2D;
  const arc = Math.max(clamp(base, 48, 58), minArc);
  return Math.min(arc, d >= 2 ? 58 : 72);
}

/** The launch velocity that passes through the hoop centre at a launch angle of `arcDeg`. */
export function solveIdealShot(release: V3, hoop: V3 = HOOP_CENTER, arcDeg = arcFor(release, hoop), stepDt = SIM_DT): IdealShot {
  const { d, h, ux, uz } = geometry(release, hoop);
  const vMax = BB_TUNING.maxLaunchSpeed;
  const fix = G * stepDt / 2;
  if (d < 0.05) {
    // straight under the rim: a soft pop up to just above it
    const vy = Math.sqrt(2 * G * Math.max(0.2, h + 0.25));
    return { vel: { x: 0, y: vy + fix, z: 0 }, arcDeg: 90, speed: vy, flightT: vy / G, clamped: false };
  }
  let theta = arcDeg * D2R;
  // the arc must rise above the hoop line; steepen until it does
  while (d * Math.tan(theta) - h < 0.05 && theta < 80 * D2R) theta += D2R;
  const c = Math.cos(theta);
  let v = Math.sqrt(G * d * d / (2 * c * c * (d * Math.tan(theta) - h)));
  let clamped = false;
  if (v > vMax) {
    // too far: use the top speed on the high-arc solution that gets closest
    clamped = true;
    v = vMax;
    const disc = v ** 4 - G * (G * d * d + 2 * h * v * v);
    theta = disc >= 0 ? Math.atan((v * v + Math.sqrt(disc)) / (G * d)) : 45 * D2R;
  }
  const vh = v * Math.cos(theta);
  return {
    vel: { x: ux * vh, y: v * Math.sin(theta) + fix, z: uz * vh },
    arcDeg: theta * R2D,
    speed: v,
    flightT: d / Math.max(0.1, vh),
    clamped
  };
}

/* ---------------- predicting where a ball goes (pure, steps like Rapier) ---------------- */

/** swish: clean through. bank: off the backboard, then clean. rimIn / rimOut: touched the rim, centre inside / outside. */
export type Outcome = 'swish' | 'bank' | 'rimIn' | 'rimOut' | 'airball';
export const isMake = (o: Outcome): boolean => o === 'swish' || o === 'bank' || o === 'rimIn';

export interface OutcomePrediction {
  outcome: Outcome;
  /** Horizontal distance of the ball centre from the hoop axis where it decided (m). */
  rimDist: number;
  /** Seconds after release. */
  t: number;
  /** Angle of descent at the rim (degrees below horizontal). */
  entryDeg: number;
  touchedBoard: boolean;
  /** Sampled path (every step) when asked for. */
  path?: V3[];
}

/**
 * Follow a ball from release with gravity only (like the game: no air drag on the ball) until the rim
 * decides it. The backboard reflects it (bank shots); the rim is a torus: touching it ends the
 * prediction as rimIn / rimOut by where the ball centre is.
 */
export function predictOutcome(from: V3, vel: V3, hoop: V3 = HOOP_CENTER, dt = SIM_DT, maxT = 4, recordPath = false): OutcomePrediction {
  const R = BALL.radius, rimR = HOOP.rimRadius, tube = HOOP.tube;
  const ring = rimR + tube, touch = R + tube;
  const p = { ...from }, v = { ...vel };
  const path: V3[] | undefined = recordPath ? [{ ...p }] : undefined;
  let board = false;
  const SUB = 4;
  for (let t = 0; t < maxT; t += dt) {
    v.y -= G * dt;
    const step = { x: v.x * dt / SUB, y: v.y * dt / SUB, z: v.z * dt / SUB };
    for (let s = 0; s < SUB; s++) {
      const prevY = p.y, prevZ = p.z;
      p.x += step.x; p.y += step.y; p.z += step.z;
      const tt = t + dt * (s + 1) / SUB;
      // backboard front face
      const bz = HOOP.boardZ + hoop.z;
      if (!board && prevZ - R > bz && p.z - R <= bz && Math.abs(p.x - hoop.x) <= HOOP.boardWidth / 2 && p.y >= HOOP.boardBottom - R && p.y <= HOOP.boardBottom + HOOP.boardHeight + R) {
        board = true;
        p.z = bz + R;
        v.z = -v.z * BB_TUNING.boardRestitution; step.z = v.z * dt / SUB;
        v.x *= 0.85; step.x = v.x * dt / SUB;
      }
      const rho = Math.hypot(p.x - hoop.x, p.z - hoop.z), dy = p.y - hoop.y;
      const entryDeg = Math.atan2(-v.y, Math.hypot(v.x, v.z)) * R2D;
      if (Math.hypot(rho - ring, dy) < touch) {
        return { outcome: rho < rimR ? 'rimIn' : 'rimOut', rimDist: rho, t: tt, entryDeg, touchedBoard: board, path };
      }
      if (prevY > hoop.y && p.y <= hoop.y) {
        if (rho < rimR) return { outcome: board ? 'bank' : 'swish', rimDist: rho, t: tt, entryDeg, touchedBoard: board, path };
        if (v.y < 0 && rho > ring + touch) return { outcome: 'airball', rimDist: rho, t: tt, entryDeg, touchedBoard: board, path };
      }
      if (p.y < R) return { outcome: 'airball', rimDist: rho, t: tt, entryDeg, touchedBoard: board, path };
    }
    path?.push({ ...p });
  }
  return { outcome: 'airball', rimDist: Infinity, t: maxT, entryDeg: 0, touchedBoard: board, path };
}

/* ---------------- the player's error ---------------- */

/** Errors from one shot attempt, before Shot Assist. */
export interface ShotInput {
  /** Launch-speed error as a fraction (+0.05 = 5 % too hard). */
  powerErr: number;
  /** Direction error in degrees (+ = right of the hoop, from the shooter's view). */
  dirErrDeg: number;
  /** Release time minus jump apex (ms, − = early). */
  timingMs: number;
}

export type ShotGrade = 'perfect' | 'good' | 'early' | 'late';

export function gradeTiming(ms: number): ShotGrade {
  const a = Math.abs(ms);
  if (a <= BB_TUNING.perfectMs) return 'perfect';
  if (a <= BB_TUNING.goodMs) return 'good';
  return ms < 0 ? 'early' : 'late';
}

/** The flick speed (rad/s) that is "just right" for a shot from `dist` metres. */
export function idealRateFor(dist: number): number {
  const T = BB_TUNING;
  const k = clamp((dist - 2) / 5, 0, 1.3);
  return T.idealRateNear + (T.idealRateFar - T.idealRateNear) * k;
}

/** Motion controller: flick peak (rad/s), controller yaw at the peak (degrees, + = turned left) and timing. */
export function inputFromFlick(peakRate: number, yawDeg: number, timingMs: number, dist: number): ShotInput {
  const T = BB_TUNING;
  const ratio = peakRate / idealRateFor(dist) - 1;
  const p = Math.sign(ratio) * Math.max(0, Math.abs(ratio) - T.powerBand) * T.powerGain;
  const yaw = -yawDeg;                                   // + = right
  const d = Math.sign(yaw) * Math.max(0, Math.abs(yaw) - T.dirBandDeg) * T.dirGain;
  return { powerErr: clamp(p, -0.4, 0.4), dirErrDeg: clamp(d, -25, 25), timingMs };
}

/** Mouse: meter position minus the sweet spot (−1..1 of the meter), and the aim offset (degrees, + = right). */
export function inputFromMeter(meterErr: number, aimDeg: number, width = BB_TUNING.sweetWidth): ShotInput {
  const T = BB_TUNING;
  const outside = Math.sign(meterErr) * Math.max(0, Math.abs(meterErr) - width / 2);
  const d = Math.sign(aimDeg) * Math.max(0, Math.abs(aimDeg) - T.dirBandDeg * 0.5) * 0.5;
  return { powerErr: clamp(outside * T.meterGain, -0.4, 0.4), dirErrDeg: clamp(d, -25, 25), timingMs: 0 };
}

export interface AppliedShot {
  vel: V3;
  /** Backspin, rad/s. */
  spin: V3;
  /** 0..1, how clean the release was (drives the backspin and the label). */
  quality: number;
  /** The errors after assist and the extra (defender/distance) noise. */
  powerErr: number;
  dirErrDeg: number;
  grade: ShotGrade;
}

/**
 * Perturb the ideal velocity with the player's errors, shrunk by Shot Assist (0 Off … 3 Very High).
 * `extraSd` is random error from defenders and distance (a fraction of launch speed); it uses `rng`
 * and is not reduced by assist (the defence is real).
 * Early / late releases fall short (released below the apex) and drift sideways.
 */
export function applyError(ideal: IdealShot, input: ShotInput, assist: ShotAssist, extraSd = 0, rng?: Rng): AppliedShot {
  const T = BB_TUNING;
  const k = ASSIST_SCALE[assist] ?? 1;
  const grade = gradeTiming(input.timingMs);
  const late = Math.max(0, Math.abs(input.timingMs) - T.perfectMs) / T.goodMs;
  let p = input.powerErr * k - 0.022 * late * k;
  let dir = input.dirErrDeg * k + Math.sign(input.timingMs) * 1.2 * late * k;
  if (extraSd > 0 && rng) {
    p += rng.gauss() * extraSd;
    dir += rng.gauss() * extraSd * 30;
  }
  const v = ideal.vel;
  const a = dir * D2R;
  // rotate the horizontal part about the vertical; + = to the shooter's right
  // (shooting toward −z, the right is +x: a clockwise turn seen from above)
  const c = Math.cos(a), s = Math.sin(a);
  const hx = v.x * c - v.z * s, hz = v.x * s + v.z * c;
  const scale = 1 + p;
  const vel = { x: hx * scale, y: v.y * scale, z: hz * scale };
  const quality = clamp(1 - Math.abs(p) / 0.06 * 0.5 - Math.abs(dir) / 6 * 0.3 - late * 0.4, 0, 1);
  // backspin: about the horizontal axis u × up, u = horizontal direction of travel
  const hl = Math.hypot(vel.x, vel.z) || 1;
  const ux = vel.x / hl, uz = vel.z / hl;
  const w = T.backspinRps * 2 * Math.PI * (0.4 + 0.6 * quality);
  return { vel, spin: { x: -uz * w, y: 0, z: ux * w }, quality, powerErr: p, dirErrDeg: dir, grade };
}

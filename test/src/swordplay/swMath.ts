/** Small vector helpers on plain {x, y, z} objects, shared by the swordplay logic (no Three.js needed). */
export interface V3 { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
export const lerpV = (a: V3, b: V3, k: number): V3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const D2R = Math.PI / 180;

/** Wrap an angle in degrees to −180..180. */
export const wrapDeg = (a: number): number => { let d = a % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };

/* ---------------- the 8 slash directions ---------------- */

/** The 8 compass directions of a slash, as the blade MOVES, seen by the one swinging (x right, y up). */
export type Dir8 = 'right' | 'upRight' | 'up' | 'upLeft' | 'left' | 'downLeft' | 'down' | 'downRight';
export const DIRS: readonly Dir8[] = ['right', 'upRight', 'up', 'upLeft', 'left', 'downLeft', 'down', 'downRight'];

/** Angle of a direction in degrees (0 = right, 90 = up). */
export const dirAngle = (d: Dir8): number => DIRS.indexOf(d) * 45;
/** Unit 2D vector of a direction. */
export const dirVec = (d: Dir8): { x: number; y: number } => { const a = dirAngle(d) * D2R; return { x: Math.round(Math.cos(a) * 1e6) / 1e6, y: Math.round(Math.sin(a) * 1e6) / 1e6 }; };
/** The nearest of the 8 directions to an angle in degrees. */
export const dirFromAngle = (deg: number): Dir8 => DIRS[((Math.round(deg / 45) % 8) + 8) % 8];
/** Left/right mirror of a direction (for left-handers and for the opponent's view). */
export const mirrorDir = (d: Dir8): Dir8 => dirFromAngle(180 - dirAngle(d));
export const oppositeDir = (d: Dir8): Dir8 => dirFromAngle(dirAngle(d) + 180);

/** Colour family for the Speed Slice markers: horizontal = blue, vertical = red, diagonal = yellow. */
export type DirAxis = 'horizontal' | 'vertical' | 'diagonal';
export const dirAxis = (d: Dir8): DirAxis => (d === 'left' || d === 'right' ? 'horizontal' : d === 'up' || d === 'down' ? 'vertical' : 'diagonal');
export const AXIS_COLOR: Record<DirAxis, string> = { horizontal: '#3c8cff', vertical: '#ff4f5e', diagonal: '#ffd23a' };

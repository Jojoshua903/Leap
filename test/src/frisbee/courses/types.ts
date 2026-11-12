import type { Ellipse, TerrainPalette, TreeKind, TreeSpot } from '../Terrain';

/**
 * Frisbee Golf courses as data. Each hole is laid out in its own local frame: the tee is at (0, 0) and
 * the basket somewhere toward −z. The terrain, trees, water and out-of-bounds are built from this.
 *
 * Adding a hole: append a HoleDef to a course's `holes` (keep par 3 at 40–75 m, par 4 at 80–120 m).
 * Adding a course: copy meadow9.ts, give it a new id, add it to COURSES in index.ts and register
 * an unlock for `course:<id>` in fbProgression.ts (plus `course.<id>` labels in both languages).
 */
export interface P2 { x: number; z: number }

export interface HoleDef {
  par: 3 | 4 | 5;
  basket: P2;
  /** Fairway centre line from the tee to the basket (defaults to a straight line). */
  fairway?: P2[];
  fairwayW?: number;
  /** In-bounds rectangle; landing outside (or in water) is OB. */
  bounds: { x0: number; x1: number; z0: number; z1: number };
  trees?: TreeSpot[];
  treeKind?: TreeKind;
  rocks?: TreeSpot[];
  ponds?: Ellipse[];
  sand?: Ellipse[];
  /** Height of the basket area above the tee (m); built as a slope. */
  elev?: number;
  /** Hilliness (m) of the noise. */
  hills?: number;
  /** Wind toward `dir` degrees (0 = −z) at `speed` m/s, gusts ±`gust` (0..1). */
  wind: { dir: number; speed: number; gust?: number };
}

export interface CourseLook {
  sky: string; fog: string; fogNear: number; fogFar: number;
  hemiSky: string; hemiGround: string; hemi: number;
  sun: string; sunI: number; sunDir: [number, number, number];
}

export type CourseId = 'meadow' | 'cliffside' | 'night';

export interface CourseDef {
  id: CourseId;
  /** i18n key of the name (`course.<id>`). */
  nameKey: string;
  difficulty: 1 | 2 | 3;
  seed: number;
  look: CourseLook;
  palette: TerrainPalette;
  trees: { trunk: string; leaf: string };
  rock: string;
  water: string;
  /** Glowing baskets and discs (the night course). */
  night?: boolean;
  holes: HoleDef[];
}

export const coursePar = (c: CourseDef): number => c.holes.reduce((s, h) => s + h.par, 0);

/** Distance tee → basket (m). */
export const holeLength = (h: HoleDef): number => Math.hypot(h.basket.x, h.basket.z);

/** A row of trees from a to b, `n` of them, alternating offsets so it doesn't look planted. */
export function treeLine(a: P2, b: P2, n: number, jitter = 1.5, s = 1): TreeSpot[] {
  const out: TreeSpot[] = [];
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0.5 : i / (n - 1);
    const j = ((i * 7919) % 13) / 13 - 0.5;
    out.push({ x: a.x + (b.x - a.x) * k + j * jitter, z: a.z + (b.z - a.z) * k - j * jitter, s: s * (0.85 + ((i * 31) % 7) / 20) });
  }
  return out;
}

/** A loose cluster of `n` trees around a point. */
export function grove(c: P2, r: number, n: number, s = 1): TreeSpot[] {
  const out: TreeSpot[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996, d = r * Math.sqrt((i + 0.5) / n);
    out.push({ x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d, s: s * (0.85 + ((i * 17) % 5) / 12) });
  }
  return out;
}

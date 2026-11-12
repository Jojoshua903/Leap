import { grove, treeLine, type CourseDef } from './types';

/**
 * Night Course (unlockable): a moonlit park with glowing baskets and discs. Medium difficulty,
 * pars 3–4, calm to moderate wind.
 */
export const NIGHT9: CourseDef = {
  id: 'night',
  nameKey: 'course.night',
  difficulty: 2,
  seed: 3313,
  night: true,
  look: {
    sky: '#0f1838', fog: '#131d42', fogNear: 40, fogFar: 160, hemiSky: '#5a6fb8', hemiGround: '#1d2b2a', hemi: 0.9,
    sun: '#b9c8ff', sunI: 1.2, sunDir: [-20, 40, -10]
  },
  palette: { grass: '#2f5a3e', fairway: '#3a6e4a', rough: '#244633', sand: '#7d7360', rock: '#5a5d68', bed: '#0e2a45' },
  trees: { trunk: '#3b2b22', leaf: '#1f4a35' },
  rock: '#5d5f6a',
  water: '#1e4f86',
  holes: [
    { par: 3, basket: { x: -3, z: -50 }, bounds: { x0: -22, x1: 22, z0: -64, z1: 8 },
      trees: [...grove({ x: -14, z: -26 }, 4, 5), ...grove({ x: 12, z: -40 }, 3, 4)], wind: { dir: 70, speed: 1, gust: 0.2 }, hills: 0.6 },
    { par: 3, basket: { x: 12, z: -60 }, fairway: [{ x: 0, z: 0 }, { x: 2, z: -32 }, { x: 12, z: -60 }],
      bounds: { x0: -22, x1: 30, z0: -74, z1: 8 }, ponds: [{ x: -8, z: -40, rx: 6, rz: 8 }],
      trees: treeLine({ x: -12, z: -10 }, { x: -2, z: -66 }, 6), wind: { dir: -90, speed: 2.5, gust: 0.3 }, hills: 0.7 },
    { par: 4, basket: { x: -6, z: -95 }, fairwayW: 9, bounds: { x0: -28, x1: 26, z0: -110, z1: 8 },
      trees: [...treeLine({ x: 14, z: -15 }, { x: 12, z: -90 }, 7), ...grove({ x: -18, z: -50 }, 5, 6)], wind: { dir: 180, speed: 3, gust: 0.3 }, hills: 0.9 },
    { par: 3, basket: { x: 0, z: -44 }, elev: 2.5, bounds: { x0: -20, x1: 20, z0: -58, z1: 8 },
      sand: [{ x: -5, z: -40, rx: 3, rz: 2.5 }], trees: grove({ x: 10, z: -28 }, 3, 4), wind: { dir: 30, speed: 1.5, gust: 0.2 }, hills: 0.5 },
    { par: 4, basket: { x: 28, z: -92 }, fairway: [{ x: 0, z: 0 }, { x: 0, z: -50 }, { x: 28, z: -92 }], fairwayW: 8,
      bounds: { x0: -20, x1: 44, z0: -106, z1: 8 }, trees: [...grove({ x: 16, z: -38 }, 6, 9), ...treeLine({ x: -12, z: -20 }, { x: 8, z: -98 }, 7)],
      wind: { dir: -60, speed: 3.5, gust: 0.35 }, hills: 1 },
    { par: 3, basket: { x: 0, z: -58 }, bounds: { x0: -24, x1: 24, z0: -72, z1: 8 }, ponds: [{ x: 0, z: -30, rx: 10, rz: 6 }],
      trees: grove({ x: -14, z: -58 }, 3, 4), wind: { dir: 0, speed: 2, gust: 0.25 }, hills: 0.4 },
    { par: 3, basket: { x: -14, z: -62 }, fairway: [{ x: 0, z: 0 }, { x: -2, z: -35 }, { x: -14, z: -62 }],
      bounds: { x0: -32, x1: 20, z0: -76, z1: 8 }, trees: [...grove({ x: -9, z: -30 }, 3.5, 5), ...treeLine({ x: 10, z: -15 }, { x: 4, z: -68 }, 5)],
      wind: { dir: 110, speed: 4, gust: 0.35 }, hills: 0.8 },
    { par: 4, basket: { x: 4, z: -104 }, fairwayW: 7, bounds: { x0: -24, x1: 24, z0: -118, z1: 8 },
      trees: [...treeLine({ x: -9, z: -20 }, { x: -9, z: -96 }, 8), ...treeLine({ x: 10, z: -20 }, { x: 12, z: -96 }, 8)], wind: { dir: 90, speed: 2.5, gust: 0.3 }, hills: 0.7 },
    { par: 3, basket: { x: 2, z: -66 }, bounds: { x0: -24, x1: 26, z0: -80, z1: 8 }, ponds: [{ x: 14, z: -50, rx: 6, rz: 10 }],
      trees: grove({ x: -12, z: -36 }, 4, 5), wind: { dir: -100, speed: 5.2, gust: 0.4 }, hills: 0.8 }
  ]
};

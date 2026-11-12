import { grove, treeLine, type CourseDef } from './types';

/** Meadow 9: an easy parkland course. Pars 3–4, gentle hills, two small ponds, light wind. */
export const MEADOW9: CourseDef = {
  id: 'meadow',
  nameKey: 'course.meadow',
  difficulty: 1,
  seed: 1101,
  look: {
    sky: '#9fdcff', fog: '#cdeeff', fogNear: 70, fogFar: 230, hemiSky: '#f4fbff', hemiGround: '#6f9a4f', hemi: 1.2,
    sun: '#fff1d0', sunI: 2.6, sunDir: [24, 40, 14]
  },
  palette: { grass: '#78c257', fairway: '#92d66b', rough: '#5d9c45', sand: '#ecd59a', rock: '#a0a0a0', bed: '#2f7fa8' },
  trees: { trunk: '#8a5a35', leaf: '#3f9d3a' },
  rock: '#a7a196',
  water: '#4cb8e0',
  holes: [
    { // 1 — straight opener
      par: 3, basket: { x: 2, z: -45 }, bounds: { x0: -24, x1: 24, z0: -62, z1: 8 },
      trees: [...grove({ x: -14, z: -22 }, 4, 5), ...grove({ x: 15, z: -34 }, 4, 4), ...grove({ x: -6, z: -56 }, 3, 3)],
      wind: { dir: 90, speed: 1.2, gust: 0.2 }, hills: 0.6
    },
    { // 2 — slight left
      par: 3, basket: { x: -10, z: -57 }, fairway: [{ x: 0, z: 0 }, { x: -3, z: -30 }, { x: -10, z: -57 }],
      bounds: { x0: -30, x1: 22, z0: -72, z1: 8 },
      trees: [...treeLine({ x: 10, z: -10 }, { x: 6, z: -60 }, 6), ...grove({ x: -20, z: -30 }, 4, 4)],
      wind: { dir: -70, speed: 2, gust: 0.25 }, hills: 0.7
    },
    { // 3 — the long one, pond on the left
      par: 4, basket: { x: 8, z: -90 }, fairway: [{ x: 0, z: 0 }, { x: 1, z: -45 }, { x: 8, z: -90 }], fairwayW: 9,
      bounds: { x0: -28, x1: 28, z0: -106, z1: 8 },
      ponds: [{ x: -13, z: -55, rx: 6, rz: 9 }],
      trees: [...treeLine({ x: 16, z: -15 }, { x: 20, z: -80 }, 7), ...grove({ x: -16, z: -20 }, 4, 4), ...grove({ x: 0, z: -101 }, 3, 3)],
      wind: { dir: 180, speed: 2.5, gust: 0.3 }, hills: 0.9
    },
    { // 4 — over the pond
      par: 3, basket: { x: 0, z: -52 }, bounds: { x0: -24, x1: 24, z0: -66, z1: 8 },
      ponds: [{ x: 0, z: -27, rx: 9, rz: 6 }],
      trees: [...grove({ x: -15, z: -48 }, 4, 5), ...grove({ x: 14, z: -44 }, 3, 4)],
      wind: { dir: 0, speed: 1.5, gust: 0.2 }, hills: 0.4
    },
    { // 5 — turns right, trees on the left
      par: 3, basket: { x: 15, z: -64 }, fairway: [{ x: 0, z: 0 }, { x: 3, z: -35 }, { x: 15, z: -64 }],
      bounds: { x0: -22, x1: 32, z0: -78, z1: 8 },
      trees: [...treeLine({ x: -9, z: -12 }, { x: 2, z: -70 }, 7), ...grove({ x: 26, z: -40 }, 3, 3)],
      wind: { dir: -90, speed: 2.2, gust: 0.3 }, hills: 0.7
    },
    { // 6 — dogleg left
      par: 4, basket: { x: -30, z: -98 }, fairway: [{ x: 0, z: 0 }, { x: 0, z: -55 }, { x: -30, z: -98 }], fairwayW: 9,
      bounds: { x0: -48, x1: 22, z0: -112, z1: 8 },
      trees: [...grove({ x: -18, z: -42 }, 6, 9), ...treeLine({ x: 13, z: -20 }, { x: 8, z: -100 }, 7), ...grove({ x: -40, z: -80 }, 3, 3)],
      wind: { dir: 45, speed: 3, gust: 0.3 }, hills: 1
    },
    { // 7 — short and uphill
      par: 3, basket: { x: 0, z: -40 }, elev: 3, bounds: { x0: -20, x1: 20, z0: -54, z1: 8 },
      sand: [{ x: 5, z: -44, rx: 3, rz: 2 }],
      trees: [...grove({ x: -11, z: -30 }, 3, 4), ...grove({ x: 11, z: -24 }, 3, 3)],
      wind: { dir: 160, speed: 1.8, gust: 0.2 }, hills: 0.4
    },
    { // 8 — through the gap
      par: 3, basket: { x: -4, z: -62 }, bounds: { x0: -26, x1: 26, z0: -76, z1: 8 },
      trees: [...grove({ x: -10, z: -32 }, 3.5, 6), ...grove({ x: 9, z: -32 }, 3.5, 6), ...grove({ x: -16, z: -64 }, 3, 3)],
      wind: { dir: 100, speed: 3.2, gust: 0.35 }, hills: 0.6
    },
    { // 9 — home, in a breeze
      par: 4, basket: { x: 0, z: -96 }, fairwayW: 10, bounds: { x0: -28, x1: 30, z0: -110, z1: 8 },
      ponds: [{ x: 15, z: -60, rx: 7, rz: 10 }], sand: [{ x: -6, z: -88, rx: 4, rz: 3 }],
      trees: [...treeLine({ x: -15, z: -12 }, { x: -16, z: -84 }, 7), ...grove({ x: 20, z: -20 }, 4, 4)],
      wind: { dir: 80, speed: 5.5, gust: 0.35 }, hills: 0.8
    }
  ]
};

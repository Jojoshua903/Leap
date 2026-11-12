import { grove, treeLine, type CourseDef } from './types';

/**
 * Cliffside 9: the harder course. Longer holes, elevation, water carries, pines, rocks and
 * stronger wind off the sea.
 */
export const CLIFFSIDE9: CourseDef = {
  id: 'cliffside',
  nameKey: 'course.cliffside',
  difficulty: 2,
  seed: 2207,
  look: {
    sky: '#8ccfee', fog: '#b9dceb', fogNear: 60, fogFar: 210, hemiSky: '#e9f6ff', hemiGround: '#5e7d48', hemi: 1.1,
    sun: '#fff0c8', sunI: 2.7, sunDir: [-28, 36, 20]
  },
  palette: { grass: '#6db150', fairway: '#86c862', rough: '#557f3e', sand: '#e6d29c', rock: '#8f8f8f', bed: '#235f86' },
  trees: { trunk: '#7a5232', leaf: '#2f7d3a' },
  rock: '#8e8a82',
  water: '#3b9fcf',
  holes: [
    { // 1 — downhill to the point
      par: 3, basket: { x: 6, z: -60 }, elev: -4, bounds: { x0: -22, x1: 24, z0: -74, z1: 8 },
      rocks: [{ x: -9, z: -40, s: 1.4 }, { x: 14, z: -50 }, { x: -2, z: -70, s: 1.2 }],
      trees: [...grove({ x: -14, z: -24 }, 4, 5), ...grove({ x: 16, z: -26 }, 3, 3)], treeKind: 'pine',
      wind: { dir: -90, speed: 3.5, gust: 0.35 }, hills: 1.2
    },
    { // 2 — along the cliff edge (tight OB right)
      par: 4, basket: { x: -4, z: -112 }, fairway: [{ x: 0, z: 0 }, { x: 3, z: -60 }, { x: -4, z: -112 }], fairwayW: 7,
      bounds: { x0: -30, x1: 11, z0: -126, z1: 8 },
      rocks: [{ x: 9, z: -30 }, { x: 10, z: -70, s: 1.3 }, { x: 9, z: -95 }],
      trees: [...treeLine({ x: -16, z: -15 }, { x: -18, z: -105 }, 9)], treeKind: 'pine',
      wind: { dir: 70, speed: 4.5, gust: 0.4 }, hills: 1.3
    },
    { // 3 — over the water
      par: 3, basket: { x: 0, z: -70 }, bounds: { x0: -26, x1: 26, z0: -84, z1: 8 },
      ponds: [{ x: 0, z: -36, rx: 15, rz: 11 }],
      trees: [...grove({ x: -12, z: -74 }, 3, 4), ...grove({ x: 13, z: -66 }, 3, 3)], treeKind: 'pine',
      wind: { dir: 180, speed: 4, gust: 0.4 }, hills: 0.8
    },
    { // 4 — dogleg right through the pines
      par: 4, basket: { x: 36, z: -113 }, fairway: [{ x: 0, z: 0 }, { x: 0, z: -60 }, { x: 36, z: -113 }], fairwayW: 7,
      bounds: { x0: -22, x1: 52, z0: -128, z1: 8 },
      trees: [...grove({ x: 20, z: -45 }, 7, 12), ...treeLine({ x: -11, z: -20 }, { x: 10, z: -112 }, 9), ...grove({ x: 46, z: -100 }, 3, 3)], treeKind: 'pine',
      wind: { dir: -45, speed: 3.5, gust: 0.35 }, hills: 1.1
    },
    { // 5 — the island green
      par: 3, basket: { x: 0, z: -48 }, bounds: { x0: -24, x1: 24, z0: -66, z1: 8 },
      ponds: [{ x: 0, z: -35, rx: 11, rz: 5 }, { x: 0, z: -62, rx: 12, rz: 6 }, { x: -12, z: -48, rx: 4, rz: 9 }],
      rocks: [{ x: 9, z: -50 }],
      wind: { dir: 100, speed: 5, gust: 0.4 }, hills: 0.5
    },
    { // 6 — up the hill
      par: 4, basket: { x: -12, z: -99 }, elev: 6, fairway: [{ x: 0, z: 0 }, { x: -4, z: -50 }, { x: -12, z: -99 }],
      bounds: { x0: -34, x1: 24, z0: -114, z1: 8 },
      rocks: [{ x: 6, z: -60, s: 1.5 }, { x: -20, z: -80, s: 1.2 }],
      trees: [...treeLine({ x: 12, z: -14 }, { x: 4, z: -100 }, 8), ...grove({ x: -22, z: -40 }, 4, 5)], treeKind: 'pine',
      wind: { dir: 0, speed: 3, gust: 0.3 }, hills: 1.4
    },
    { // 7 — straight into a gale
      par: 3, basket: { x: 4, z: -75 }, bounds: { x0: -24, x1: 26, z0: -90, z1: 8 },
      rocks: [{ x: -10, z: -55 }, { x: 15, z: -70 }],
      trees: [...grove({ x: -15, z: -30 }, 3, 4)], treeKind: 'pine',
      wind: { dir: 165, speed: 7, gust: 0.45 }, hills: 0.9
    },
    { // 8 — the pine tunnel
      par: 4, basket: { x: 2, z: -120 }, fairwayW: 5, bounds: { x0: -22, x1: 22, z0: -134, z1: 8 },
      trees: [...treeLine({ x: -8, z: -18 }, { x: -8, z: -112 }, 11, 1), ...treeLine({ x: 9, z: -18 }, { x: 10, z: -112 }, 11, 1)], treeKind: 'pine',
      wind: { dir: 90, speed: 3, gust: 0.35 }, hills: 0.7
    },
    { // 9 — up onto the ledge, water left
      par: 3, basket: { x: 3, z: -64 }, elev: 5, bounds: { x0: -26, x1: 24, z0: -78, z1: 8 },
      ponds: [{ x: -15, z: -45, rx: 7, rz: 14 }],
      rocks: [{ x: 10, z: -58, s: 1.3 }, { x: -3, z: -74, s: 1.1 }],
      trees: [...grove({ x: 15, z: -30 }, 4, 5)], treeKind: 'pine',
      wind: { dir: -80, speed: 5.5, gust: 0.4 }, hills: 1
    }
  ]
};

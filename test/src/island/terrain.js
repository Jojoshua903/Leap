import * as THREE from 'three';

/* ---------- math helpers ---------- */
export const ss = (a, b, t) => { t = (t - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
function hash(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash(ix, iy), hash(ix + 1, iy), u), lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v);
}
export function fbm(x, y, o = 4) {
  let a = 0, amp = 1, f = 1, s = 0;
  for (let i = 0; i < o; i++) { a += noise(x * f, y * f) * amp; s += amp; amp *= 0.5; f *= 2; }
  return a / s;
}

/* ---------- island layout (world units, x/z) ---------- */
export const PEAK   = { x: 0,    z: 0 };      // Mount Ember, dead centre
export const TOWN   = { x: 0,    z: 300 };    // Breezy Town, all the venues
export const LAKE   = { x: -160, z: -70, r: 55 };
export const HEAD   = { x: 560,  z: 130 };    // lighthouse headland
export const GOLF   = { x: 780,  z: 640 };    // Fairway Isle
export const ISLET  = { x: 300,  z: 620 };    // Gull Harbor islet
export const HERMIT = { x: -800, z: -330 };   // Hermit Isle

function mask(x, z) {
  const r = Math.hypot(x, z), th = Math.atan2(z, x);
  const R = 540 + 70 * Math.sin(3 * th + 1) + 45 * Math.sin(5 * th + 2.3)
          + (fbm(Math.cos(th) * 2 + 5, Math.sin(th) * 2 + 5, 3) - 0.5) * 120;
  let m = ss(R + 70, R - 60, r);
  m = Math.max(m, ss(1.25, 0.55, Math.hypot((x - HEAD.x) / 170, (z - HEAD.z) / 65)));
  return m;
}
const bump = (x, z, c, rad, hgt) => -40 + (hgt + 40) * ss(rad, rad * 0.35, Math.hypot(x - c.x, z - c.z));

function raw(x, z) {
  const m = mask(x, z), n = fbm(x * 0.004 + 10, z * 0.004 + 10, 5);
  let h = -40 + m * (46 + n * 40);
  const d = Math.hypot(x - PEAK.x, z - PEAK.z), p = Math.max(0, 1 - d / 300);
  h += m * 300 * Math.pow(p, 1.8);          // volcano cone
  h -= ss(60, 0, d) * 130;                  // crater
  const w = ss(210, 110, Math.hypot(x - TOWN.x, z - TOWN.z)) * ss(0.2, 0.6, m);
  h = lerp(h, 9, w);                        // flat town shelf
  h = Math.max(h, bump(x, z, GOLF, 190, 14 + n * 14), bump(x, z, ISLET, 80, 12), bump(x, z, HERMIT, 70, 20));
  return h;
}
export const LAKE_LEVEL = raw(LAKE.x, LAKE.z) - 4;

/* height of the ground (negative = sea floor) */
export function H(x, z) {
  let h = raw(x, z);
  const dL = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (dL < LAKE.r + 45) h = Math.max(h, lerp(h, LAKE_LEVEL + 5, ss(LAKE.r + 45, LAKE.r + 12, dL)));
  if (dL < LAKE.r) h = Math.min(h, LAKE_LEVEL - 5 - (LAKE.r - dL) * 0.15);
  return h;
}

/* walk outward along an angle until we hit the sea */
export function findCoast(theta, from = 150) {
  const cx = Math.cos(theta), cz = Math.sin(theta);
  for (let r = from; r < 1100; r += 4) {
    if (H(cx * r, cz * r) < 1.5) return { x: cx * (r - 6), z: cz * (r - 6), r: r - 6 };
  }
  return { x: cx * 1000, z: cz * 1000, r: 1000 };
}

/* ---------- colours ---------- */
const C = h => new THREE.Color(h);
const WET = C('#dcc58c'), SAND = C('#f6e4ac'), GRASS1 = C('#8ad85e'), GRASS2 = C('#4aa64b'),
      ROCK = C('#a59482'), DARK = C('#5b4a44'), PAVE = C('#e4dccb');
export function colorAt(x, z, h, slope, out) {
  if (h < 1.5) out.copy(WET);
  else if (h < 6) out.copy(SAND);
  else {
    out.copy(GRASS1).lerp(GRASS2, ss(10, 120, h));
    if (h > 110) out.lerp(ROCK, ss(110, 175, h));
  }
  if (slope > 0.25 && h > 6) out.lerp(ROCK, ss(0.25, 0.5, slope));
  const d = Math.hypot(x - PEAK.x, z - PEAK.z);
  if (d < 75 && h > 120) out.lerp(DARK, ss(75, 40, d));
  const t = Math.hypot(x - TOWN.x, z - TOWN.z);
  if (t < 160 && h > 5 && h < 14) out.lerp(PAVE, ss(160, 100, t) * 0.75);
  return out;
}

export function buildTerrain() {
  const S = 2600, N = 260;
  const g = new THREE.PlaneGeometry(S, S, N, N);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const nrm = g.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colorAt(p.getX(i), p.getZ(i), p.getY(i), 1 - nrm.getY(i), c);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

/* top-down map image for the HUD */
export const MAP_EXT = 1150;
export function minimapCanvas(size = 180) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(size, size), c = new THREE.Color();
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i / size * 2 - 1) * MAP_EXT, z = (j / size * 2 - 1) * MAP_EXT, h = H(x, z);
    let r, g, b;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r) { r = 95; g = 195; b = 235; }
    else if (h < 0) { const k = ss(-40, 0, h); r = 60 + 70 * k; g = 170 + 50 * k; b = 215 + 25 * k; }
    else { colorAt(x, z, h, 0, c); const hx = c.getHex(); r = hx >> 16 & 255; g = hx >> 8 & 255; b = hx & 255; }
    const k = (j * size + i) * 4;
    img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

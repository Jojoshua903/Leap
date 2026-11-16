'use strict';
/* =========================================================
   LEVEL: the Phase 1 white-box test room
   Tiles: 0 empty · 1 solid · 2 spikes · 3 one-way platform
   ========================================================= */
const LW = 160, LH = 40;
const grid = new Uint8Array(LW * LH);

function tileAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= LW || ty >= LH) return 1;
  return grid[ty * LW + tx];
}
function fill(x, y, w, h, v) {
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++)
    if (tx >= 0 && ty >= 0 && tx < LW && ty < LH) grid[ty * LW + tx] = v;
}
const solidAt = (tx, ty) => tileAt(tx, ty) === 1;

/* ---------- Geometry ---------- */
(function build() {
  // shell
  fill(0, 0, LW, 1, 1); fill(0, 0, 1, LH, 1); fill(LW - 1, 0, 1, LH, 1); fill(0, 35, LW, 5, 1);

  // A · basics: steps + double-jump platform
  fill(10, 33, 3, 2, 1);
  fill(15, 32, 3, 3, 1);
  fill(22, 29, 17, 6, 1);

  // B · wall-jump shaft (enter through the gap at rows 27-28)
  fill(30, 4, 2, 23, 1);
  fill(37, 14, 2, 15, 1);

  // C · upper floor with a dash gap (x53-60)
  fill(37, 14, 16, 2, 1);
  fill(61, 14, 10, 2, 1);

  // D · the chasm (Bat-Launch) with spike floor
  fill(70, 16, 1, 6, 1);
  fill(91, 14, 20, 2, 1);
  fill(91, 16, 1, 6, 1);
  fill(70, 22, 22, 3, 1);
  fill(71, 21, 20, 1, 2);

  // E · lower arena one-way ladder back up through the dash gap
  fill(46, 30, 4, 1, 3);
  fill(52, 26, 4, 1, 3);
  fill(47, 22, 4, 1, 3);
  fill(54, 18, 4, 1, 3);

  // F · pogo pit
  fill(76, 34, 18, 1, 2);

  // G · drone gallery cover
  fill(126, 32, 4, 3, 1);
  fill(146, 30, 5, 5, 1);
  fill(138, 27, 4, 1, 3);
})();

/* ---------- Placement (tx, surface row) ---------- */
const at = (tx, row) => ({ x: tx * TILE + TILE / 2, y: row * TILE });
const SIGNS = [
  [8, 35,  'A / D to run.  SPACE to jump — hold it longer to jump higher.'],
  [19, 35, 'Press SPACE again in mid‑air to DOUBLE JUMP onto the platform.'],
  [34, 29, 'Hug a wall to slide down it. Jump off it to WALL JUMP. Climb the shaft!'],
  [46, 14, 'SHIFT to AIR DASH. Dash and double jump refresh on landing, walls, and pogos.'],
  [66, 14, 'K tosses a ball. Smack it with J to BAT‑LAUNCH. Hold a direction to aim. 3 balls per air‑time!'],
  [73, 35, 'In the air, hold ↓ and swing to strike down. Hit anything to POGO. Chain 3 over the spikes!'],
  [97, 35, 'J  J  J for a 3‑hit combo — the third hit lands heavy. ↑ + J to up‑slash.'],
  [111, 35,'Hits build HYPE. On the ground, hold H to burn 33 Hype and heal. MVP BABY!'],
  [120, 35,'Drones fire bolts. Swing at a bolt to DEFLECT it straight back at them.'],
  [41, 35, 'Scrap bots charge when they spot you. Teach them some respect.'],
];
const LEVEL = {
  spawn: at(4, 35),
  benches: [at(6, 35), at(98, 14), at(115, 35)],
  signs: SIGNS.map(([tx, row, text]) => Object.assign(at(tx, row), { text })),
  enemies: [
    { type: 'bot',   ...at(44, 35) }, { type: 'bot', ...at(63, 35) }, { type: 'bot', ...at(137, 35) },
    { type: 'drone', x: 60 * TILE, y: 25 * TILE }, { type: 'drone', x: 132 * TILE, y: 24 * TILE },
    { type: 'drone', x: 142 * TILE, y: 21 * TILE }, { type: 'drone', x: 153 * TILE, y: 25 * TILE },
    { type: 'dummy', ...at(100, 35) }, { type: 'dummy', ...at(104, 35) }, { type: 'dummy', ...at(108, 35) },
    { type: 'dummy', ...at(13, 35) },
    { type: 'orb', x: 78 * TILE + 16, y: 31 * TILE + 16 }, { type: 'orb', x: 82 * TILE + 16, y: 31 * TILE + 16 },
    { type: 'orb', x: 86 * TILE + 16, y: 31 * TILE + 16 }, { type: 'orb', x: 90 * TILE + 16, y: 31 * TILE + 16 },
  ],
  labels: [
    { x: 3 * TILE, y: 22 * TILE, text: 'A · BASICS' },
    { x: 32 * TILE, y: 3 * TILE, text: 'B · SHAFT' },
    { x: 40 * TILE, y: 8 * TILE, text: 'C · DASH' },
    { x: 72 * TILE, y: 8 * TILE, text: 'D · THE CHASM' },
    { x: 40 * TILE, y: 18 * TILE, text: 'E · ARENA' },
    { x: 75 * TILE, y: 27 * TILE, text: 'F · POGO PIT' },
    { x: 97 * TILE, y: 24 * TILE, text: 'G · CAGE' },
    { x: 121 * TILE, y: 18 * TILE, text: 'H · DRONE GALLERY' },
  ],
  chasmPlatform: { x0: 91 * TILE, x1: 111 * TILE, y: 14 * TILE }
};

/* ---------- Physics body vs tiles (axis separated) ---------- */
function moveBody(b, dt) {
  const wasGround = b.onGround;
  b.hitWall = 0; b.hitCeil = false; b.onGround = false;

  // X axis
  b.x += b.vx * dt;
  if (b.vx !== 0) {
    const y0 = Math.floor(b.y / TILE), y1 = Math.floor((b.y + b.h - 0.01) / TILE);
    if (b.vx > 0) {
      const tx = Math.floor((b.x + b.w) / TILE);
      for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) { b.x = tx * TILE - b.w; b.hitWall = 1; break; }
    } else {
      const tx = Math.floor(b.x / TILE);
      for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) { b.x = (tx + 1) * TILE; b.hitWall = -1; break; }
    }
    if (b.hitWall) b.vx = 0;
  }

  // Y axis
  const prevBottom = b.y + b.h;
  b.y += b.vy * dt;
  const x0 = Math.floor(b.x / TILE), x1 = Math.floor((b.x + b.w - 0.01) / TILE);
  if (b.vy >= 0) {
    const ty = Math.floor((b.y + b.h) / TILE);
    for (let tx = x0; tx <= x1; tx++) {
      const t = tileAt(tx, ty);
      if (t === 1 || (t === 3 && !(b.dropT > 0) && prevBottom <= ty * TILE + 0.5)) {
        b.y = ty * TILE - b.h; b.vy = 0; b.onGround = true; break;
      }
    }
  } else {
    const ty = Math.floor(b.y / TILE);
    for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) { b.y = (ty + 1) * TILE; b.vy = 0; b.hitCeil = true; break; }
  }
  b.landed = b.onGround && !wasGround;
}

function touchingWall(b, dir) {
  const tx = dir > 0 ? Math.floor((b.x + b.w + 1) / TILE) : Math.floor((b.x - 1) / TILE);
  return solidAt(tx, Math.floor((b.y + 8) / TILE)) || solidAt(tx, Math.floor((b.y + b.h - 8) / TILE));
}
function standingOn(b) {
  const ty = Math.floor((b.y + b.h + 1) / TILE);
  return [tileAt(Math.floor(b.x / TILE), ty), tileAt(Math.floor((b.x + b.w - 0.01) / TILE), ty)];
}
function rectHitsSpikes(r, pad = 0) {
  const x0 = Math.floor(r.x / TILE), x1 = Math.floor((r.x + r.w) / TILE);
  const y0 = Math.floor(r.y / TILE), y1 = Math.floor((r.y + r.h) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++)
    if (tileAt(tx, ty) === 2 && overlap(r, { x: tx * TILE + 4 - pad, y: ty * TILE + 12 - pad, w: 24 + pad * 2, h: 20 + pad })) return true;
  return false;
}
function pointSolid(x, y) { return solidAt(Math.floor(x / TILE), Math.floor(y / TILE)); }

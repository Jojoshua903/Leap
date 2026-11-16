'use strict';
/* =========================================================
   RENDER: ink & cel-shaded white-box look
   ========================================================= */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
let DPR = 1, SCALE = 1, VW = 0, VH = VIEW_TILES_H * TILE;
const INK = '#0d0b10', BONE = '#f3ead8', FLAME = '#e8361c', EMBER = '#ff8a2a', GOLD = '#f2c14e';
const DISPLAY_FONT = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Franklin Gothic Heavy", sans-serif';
const SERIF_FONT = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

function resizeCanvas() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(innerWidth * DPR); cv.height = Math.round(innerHeight * DPR);
  SCALE = cv.height / VH;
  VW = cv.width / SCALE;
}
addEventListener('resize', resizeCanvas);
resizeCanvas();

/* ---------- Deterministic background props ---------- */
let seed = 7;
const srand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const FAR = Array.from({ length: 14 }, (_, i) => ({ x: i * 260 + srand() * 120, w: 60 + srand() * 90, h: 380 + srand() * 520, tiers: 3 + (srand() * 4 | 0), lit: srand() }));
const MID = Array.from({ length: 18 }, (_, i) => ({ x: i * 220 + srand() * 80, w: 30 + srand() * 60, h: 160 + srand() * 300, kind: srand() < 0.4 ? 'crane' : 'stack' }));
const AMBIENT = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: rand(0.8, 2.4), v: rand(0.02, 0.07), ph: rand(0, 6), d: rand(0.3, 0.9) }));
const tileHash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

/* ---------- Helpers ---------- */
function rr(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function inked(fill, lw = 3) { ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.stroke(); }
function starburst(r1, r2, n = 14) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * Math.PI * 2, r = i % 2 ? r2 : r1 * (0.85 + ((i * 37) % 7) / 30); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath();
}
function wrapText(text, maxW) {
  const words = text.split(' '), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}

/* ---------- Background ---------- */
function drawBackground(cx, cy) {
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, '#110b18'); g.addColorStop(0.6, '#24182e'); g.addColorStop(1, '#3a1a20');
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);

  // distant glow from the Gilded Stadium far above
  const glow = ctx.createRadialGradient(VW * 0.7, -VH * 0.2, 0, VW * 0.7, -VH * 0.2, VH * 1.1);
  glow.addColorStop(0, 'rgba(242,193,78,.22)'); glow.addColorStop(1, 'rgba(242,193,78,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, VW, VH);

  // far spires
  const fo = cx * 0.12, fy = cy * 0.08, span = 14 * 260;
  for (const t of FAR) {
    let x = ((t.x - fo) % span + span) % span - 200;
    const base = VH + 80 - fy;
    ctx.fillStyle = '#1b1325';
    let w = t.w, y = base;
    const th = t.h / t.tiers;
    for (let i = 0; i < t.tiers; i++) { ctx.fillRect(x - w / 2, y - th, w, th + 1); y -= th; w *= 0.78; }
    ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x, y - 60); ctx.lineTo(x + w / 2, y); ctx.fill();
    if (t.lit > 0.4) { ctx.fillStyle = `rgba(255,138,42,${0.25 + 0.2 * Math.sin(Game.time * 1.3 + t.x)})`; ctx.fillRect(x - 3, base - t.h * 0.55, 6, 10); ctx.fillRect(x - 3, base - t.h * 0.3, 6, 10); }
  }

  // light shafts
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const sx = ((i * 520 - cx * 0.25) % 2080 + 2080) % 2080 - 300;
    const a = 0.05 + 0.025 * Math.sin(Game.time * 0.7 + i * 2);
    const lg = ctx.createLinearGradient(sx, 0, sx + 260, VH);
    lg.addColorStop(0, `rgba(242,193,78,${a})`); lg.addColorStop(1, 'rgba(242,193,78,0)');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.moveTo(sx, -10); ctx.lineTo(sx + 90, -10); ctx.lineTo(sx + 330, VH); ctx.lineTo(sx + 170, VH); ctx.fill();
  }
  ctx.restore();

  // mid scrapyard silhouettes
  const mo = cx * 0.35, my = cy * 0.2, mspan = 18 * 220;
  for (const m of MID) {
    const x = ((m.x - mo) % mspan + mspan) % mspan - 150, base = VH + 140 - my;
    ctx.fillStyle = '#20172b';
    if (m.kind === 'crane') {
      ctx.fillRect(x, base - m.h, 10, m.h);
      ctx.fillRect(x - 70, base - m.h, 170, 8);
      ctx.fillRect(x + 80, base - m.h, 2, 60);
      ctx.fillRect(x + 72, base - m.h + 60, 18, 14);
    } else {
      let y = base;
      for (let i = 0; i < 4; i++) { const w = m.w * (1 - i * 0.15), h = m.h / 4; ctx.fillRect(x - w / 2 + (i % 2) * 8, y - h, w, h); y -= h; }
    }
  }

  // ambient embers
  for (const e of AMBIENT) {
    e.y -= e.v * 0.016 * (1 + e.d); if (e.y < -0.05) { e.y = 1.05; e.x = Math.random(); }
    const x = ((e.x * VW * 1.4 - cx * e.d * 0.3) % (VW * 1.4) + VW * 1.4) % (VW * 1.4) - VW * 0.2 + Math.sin(Game.time + e.ph) * 12;
    const a = 0.35 + 0.35 * Math.sin(Game.time * 3 + e.ph);
    ctx.fillStyle = `rgba(255,${120 + (e.ph * 15 | 0)},42,${a * e.d})`;
    ctx.beginPath(); ctx.arc(x, e.y * VH, e.s, 0, 7); ctx.fill();
  }
}

/* ---------- World: grid, labels, tiles ---------- */
function drawWorldBack(cam) {
  const x0 = Math.floor(cam.x / TILE) - 1, x1 = Math.ceil((cam.x + VW) / TILE) + 1;
  const y0 = Math.floor(cam.y / TILE) - 1, y1 = Math.ceil((cam.y + VH) / TILE) + 1;
  // measuring grid (it's a test room)
  ctx.lineWidth = 1;
  for (let tx = x0; tx <= x1; tx++) {
    ctx.strokeStyle = tx % 4 === 0 ? 'rgba(243,234,216,.06)' : 'rgba(243,234,216,.025)';
    ctx.beginPath(); ctx.moveTo(tx * TILE, y0 * TILE); ctx.lineTo(tx * TILE, y1 * TILE); ctx.stroke();
  }
  for (let ty = y0; ty <= y1; ty++) {
    ctx.strokeStyle = ty % 4 === 0 ? 'rgba(243,234,216,.06)' : 'rgba(243,234,216,.025)';
    ctx.beginPath(); ctx.moveTo(x0 * TILE, ty * TILE); ctx.lineTo(x1 * TILE, ty * TILE); ctx.stroke();
  }
  // chalk section labels
  ctx.font = `48px ${DISPLAY_FONT}`; ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(243,234,216,.07)';
  for (const l of LEVEL.labels) ctx.fillText(l.text, l.x, l.y);
}

function drawTiles(cam) {
  const x0 = Math.max(0, Math.floor(cam.x / TILE) - 1), x1 = Math.min(LW - 1, Math.ceil((cam.x + VW) / TILE) + 1);
  const y0 = Math.max(0, Math.floor(cam.y / TILE) - 1), y1 = Math.min(LH - 1, Math.ceil((cam.y + VH) / TILE) + 1);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const t = grid[ty * LW + tx]; if (!t) continue;
    const x = tx * TILE, y = ty * TILE;
    if (t === 1) {
      const h = tileHash(tx, ty);
      ctx.fillStyle = h % 5 === 0 ? '#251d30' : '#211a2b'; ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      if (h % 3 === 0) ctx.fillRect(x + 4 + (h % 9), y + 8 + (h % 11), 10, 3);
      if (h % 7 === 1) ctx.fillRect(x + 16, y + 20, 8, 2);
      const up = tileAt(tx, ty - 1) !== 1, dn = tileAt(tx, ty + 1) !== 1, lf = tileAt(tx - 1, ty) !== 1, rt = tileAt(tx + 1, ty) !== 1;
      if (up) { ctx.fillStyle = '#5a4a6e'; ctx.fillRect(x, y, TILE, 5); ctx.fillStyle = '#3c3049'; ctx.fillRect(x, y + 5, TILE, 3); }
      if (lf) { ctx.fillStyle = '#30263c'; ctx.fillRect(x, y, 4, TILE); }
      if (rt) { ctx.fillStyle = '#30263c'; ctx.fillRect(x + TILE - 4, y, 4, TILE); }
      ctx.fillStyle = INK;
      if (up) ctx.fillRect(x - 1, y - 2, TILE + 2, 3);
      if (dn) ctx.fillRect(x - 1, y + TILE - 1, TILE + 2, 3);
      if (lf) ctx.fillRect(x - 2, y - 1, 3, TILE + 2);
      if (rt) ctx.fillRect(x + TILE - 1, y - 1, 3, TILE + 2);
    } else if (t === 2) {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) { const sx = x + i * 10.67; ctx.moveTo(sx, y + TILE); ctx.lineTo(sx + 5.3, y + 10 + (i === 1 ? -3 : 0)); ctx.lineTo(sx + 10.67, y + TILE); }
      ctx.closePath(); ctx.fillStyle = '#d9cfbd'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
      ctx.fillStyle = FLAME;
      for (let i = 0; i < 3; i++) { const sx = x + i * 10.67 + 5.3, sy = y + 10 + (i === 1 ? -3 : 0); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 2, sy + 5); ctx.lineTo(sx + 2, sy + 5); ctx.fill(); }
    } else if (t === 3) {
      ctx.fillStyle = '#8a5a3a'; ctx.fillRect(x, y, TILE, 9);
      ctx.fillStyle = '#a8734c'; ctx.fillRect(x, y, TILE, 3);
      ctx.fillStyle = INK; ctx.fillRect(x, y - 1, TILE, 2); ctx.fillRect(x, y + 8, TILE, 2);
      if (tileAt(tx - 1, ty) !== 3) ctx.fillRect(x - 1, y - 1, 3, 11);
      if (tileAt(tx + 1, ty) !== 3) ctx.fillRect(x + TILE - 2, y - 1, 3, 11);
      ctx.fillRect(x + 15, y + 2, 2, 6);
    }
  }
}

/* ---------- Props: benches & signs ---------- */
function drawBench(b, active, near) {
  ctx.save(); ctx.translate(b.x, b.y);
  if (active) {
    const g = ctx.createRadialGradient(0, -20, 0, 0, -20, 90);
    g.addColorStop(0, `rgba(242,193,78,${0.35 + 0.1 * Math.sin(Game.time * 3)})`); g.addColorStop(1, 'rgba(242,193,78,0)');
    ctx.fillStyle = g; ctx.fillRect(-90, -110, 180, 120);
  }
  ctx.lineJoin = 'round';
  rr(-30, -40, 60, 8, 2); inked('#8a5a3a', 3);             // backrest
  rr(-34, -22, 68, 9, 2); inked('#a8734c', 3);              // seat
  ctx.fillStyle = INK; ctx.fillRect(-28, -14, 5, 14); ctx.fillRect(23, -14, 5, 14); ctx.fillRect(-26, -32, 4, 12); ctx.fillRect(22, -32, 4, 12);
  ctx.font = `11px ${DISPLAY_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = BONE;
  ctx.fillText('DUGOUT', 0, -36);
  if (near) {
    ctx.font = `14px ${DISPLAY_FONT}`; ctx.fillStyle = GOLD;
    ctx.fillText(Game.lastInput === 'pad' ? '▲ D‑PAD UP · REST' : '▲ W / ↑ · REST', 0, -58 + Math.sin(Game.time * 4) * 2);
  }
  ctx.restore();
}
function drawSign(s, near) {
  ctx.save(); ctx.translate(s.x, s.y);
  ctx.fillStyle = INK; ctx.fillRect(-3, -34, 6, 34);
  rr(-16, -50, 32, 22, 3); inked(near ? GOLD : '#c9a36b', 3);
  ctx.font = `18px ${DISPLAY_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = INK; ctx.fillText('!', 0, -39);
  ctx.restore();
}
function drawBubble(s) {
  ctx.save();
  ctx.font = `14px ${SERIF_FONT}`;
  const lines = wrapText(s.text, 250), lh = 18;
  const w = Math.min(276, Math.max(...lines.map(l => ctx.measureText(l).width)) + 26), h = lines.length * lh + 20;
  const bx = clamp(s.x - w / 2, Game.cam.x + 10, Game.cam.x + VW - w - 10), by = s.y - 66 - h;
  ctx.translate(0, Math.sin(Game.time * 2) * 2);
  ctx.fillStyle = 'rgba(0,0,0,.45)'; rr(bx + 6, by + 6, w, h, 4); ctx.fill();
  rr(bx, by, w, h, 4); inked(BONE, 3);
  ctx.beginPath(); ctx.moveTo(s.x - 9, by + h - 1); ctx.lineTo(s.x, by + h + 12); ctx.lineTo(s.x + 9, by + h - 1); ctx.fillStyle = BONE; ctx.fill();
  ctx.beginPath(); ctx.moveTo(s.x - 9, by + h); ctx.lineTo(s.x, by + h + 12); ctx.lineTo(s.x + 9, by + h); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 13, by + 10 + i * lh));
  ctx.restore();
}

/* ---------- Enemies ---------- */
function drawBot(e) {
  const shake = e.state === 'windup' ? rand(-2, 2) : 0;
  ctx.save(); ctx.translate(e.x + e.w / 2 + shake, e.y + e.h); ctx.scale(e.dir, 1);
  ctx.lineJoin = 'round';
  // treads
  rr(-20, -12, 40, 12, 6); inked('#2b2733', 3);
  for (let i = 0; i < 4; i++) { const tx = -14 + ((i * 10 + e.anim * 30) % 40) - 2; if (tx < 16) { ctx.fillStyle = '#6b6f7a'; ctx.beginPath(); ctx.arc(tx, -6, 2.5, 0, 7); ctx.fill(); } }
  // body
  rr(-17, -32, 34, 22, 4); inked(e.flash > 0 ? '#ffffff' : '#7d727a', 3);
  ctx.fillStyle = '#5b5260'; ctx.fillRect(-14, -18, 20, 3); ctx.fillStyle = '#a0522d'; ctx.fillRect(-12, -28, 6, 5);
  // eye
  const angry = e.state === 'windup' || e.state === 'charge';
  ctx.beginPath(); ctx.arc(8, -24, 6, 0, 7); inked(angry ? FLAME : GOLD, 2.5);
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(10, -24, 2.5, 0, 7); ctx.fill();
  if (angry) { ctx.fillStyle = INK; ctx.fillRect(2, -33, 12, 3); }
  // antenna
  ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-8, -32); ctx.lineTo(-11, -42); ctx.stroke();
  ctx.fillStyle = Math.sin(Game.time * 8) > 0 ? FLAME : '#5b1a10'; ctx.beginPath(); ctx.arc(-11, -43, 3, 0, 7); ctx.fill();
  if (e.state === 'stun') { ctx.font = `14px ${DISPLAY_FONT}`; ctx.fillStyle = GOLD; ctx.textAlign = 'center'; ctx.fillText('?!', 0, -48); }
  ctx.restore();
}
function drawDrone(e) {
  ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h / 2); ctx.rotate(clamp(e.vx / 600, -0.35, 0.35));
  // propeller
  const s = Math.cos(e.phase * 45);
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, -18); ctx.stroke();
  ctx.fillStyle = 'rgba(243,234,216,.75)'; ctx.fillRect(-18 * Math.abs(s), -21, 36 * Math.abs(s), 4);
  // legs
  ctx.beginPath(); ctx.moveTo(-8, 8); ctx.lineTo(-12, 16); ctx.moveTo(8, 8); ctx.lineTo(12, 16); ctx.stroke();
  // body
  ctx.beginPath(); ctx.ellipse(0, 0, 16, 12, 0, 0, 7); inked(e.flash > 0 ? '#ffffff' : '#3b4f66', 3);
  // eye
  const pdx = Player.x + Player.w / 2 - (e.x + e.w / 2), pdy = Player.y + Player.h / 2 - (e.y + e.h / 2), pd = Math.hypot(pdx, pdy) || 1;
  if (e.windup) { ctx.shadowColor = '#b98bff'; ctx.shadowBlur = 20; }
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); inked(e.windup ? '#e6d6ff' : (e.engaged ? '#b98bff' : '#6fd3ff'), 2.5);
  ctx.shadowBlur = 0;
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(pdx / pd * 3, pdy / pd * 3, 2.5, 0, 7); ctx.fill();
  ctx.restore();
}
function drawDummy(e) {
  ctx.save(); ctx.translate(e.x + e.w / 2, e.y + e.h); ctx.rotate(e.a * 0.08);
  ctx.fillStyle = INK; ctx.fillRect(-3, -20, 6, 20);
  ctx.beginPath(); ctx.ellipse(0, -32, 15, 18, 0, 0, 7); inked(e.flash > 0 ? '#ffffff' : '#c9a36b', 3);
  ctx.lineWidth = 2.5; ctx.strokeStyle = FLAME; ctx.beginPath(); ctx.arc(0, -32, 9, 0, 7); ctx.stroke();
  ctx.fillStyle = FLAME; ctx.beginPath(); ctx.arc(0, -32, 3.5, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -55, 8, 0, 7); inked(e.flash > 0 ? '#ffffff' : '#b8915c', 3);
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-4, -57); ctx.lineTo(-1, -54); ctx.moveTo(-1, -57); ctx.lineTo(-4, -54); ctx.moveTo(1, -57); ctx.lineTo(4, -54); ctx.moveTo(4, -57); ctx.lineTo(1, -54); ctx.stroke();
  ctx.restore();
  if (e.total > 0 && Math.hypot(Player.x - e.x, Player.y - e.y) < 220) {
    ctx.font = `12px ${DISPLAY_FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(243,234,216,.6)';
    ctx.fillText('DMG ' + e.total, e.x + e.w / 2, e.y + e.h + 16);
  }
}
function drawOrb(e) {
  const cx = e.x + 15, cy = e.y + 15, f = e.flash / 0.25;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40 + f * 20);
  g.addColorStop(0, `rgba(242,193,78,${0.45 + f * 0.4})`); g.addColorStop(1, 'rgba(242,193,78,0)');
  ctx.fillStyle = g; ctx.fillRect(cx - 60, cy - 60, 120, 120);
  ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy - 13); ctx.lineTo(cx, cy - 40); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 12 + f * 3, 0, 7); inked(f > 0 ? '#fff5d6' : GOLD, 3);
  ctx.strokeStyle = 'rgba(13,11,16,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 6, Game.time * 3, Game.time * 3 + 4); ctx.stroke();
}
function drawBolt(b) {
  const col = b.friendly ? '255,138,42' : '185,139,255';
  const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 18);
  g.addColorStop(0, `rgba(${col},.9)`); g.addColorStop(1, `rgba(${col},0)`);
  ctx.fillStyle = g; ctx.fillRect(b.x - 18, b.y - 18, 36, 36);
  ctx.beginPath(); ctx.arc(b.x, b.y, 5 + Math.sin(b.t * 30), 0, 7); inked('#ffffff', 2);
}
function drawBall(b) {
  if (b.state === 'shot' && b.trail.length > 1) {
    ctx.lineCap = 'round';
    for (let i = 1; i < b.trail.length; i++) {
      ctx.strokeStyle = `rgba(255,138,42,${i / b.trail.length})`; ctx.lineWidth = 2 + i * 0.9;
      ctx.beginPath(); ctx.moveTo(b.trail[i - 1].x, b.trail[i - 1].y); ctx.lineTo(b.trail[i].x, b.trail[i].y); ctx.stroke();
    }
  }
  ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.spin);
  if (b.state === 'toss') {
    const c = Player.center(), near = Math.hypot(b.x - c.x, b.y - c.y) < TUNE.connectRange;
    ctx.strokeStyle = near ? `rgba(242,193,78,${0.6 + 0.4 * Math.sin(Game.time * 30)})` : 'rgba(243,234,216,.25)';
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, b.r, 0, 7); inked(BONE, 2.5);
  ctx.strokeStyle = FLAME; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
  ctx.beginPath(); ctx.arc(-6, 0, 5, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(6, 0, 5, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/* ---------- Nathan ---------- */
function batAngle(P) {
  const p = P.attackT > 0 ? 1 - P.attackT / P.attackDur : 1;
  const e = 1 - Math.pow(1 - p, 3);
  if (P.attackT > 0) {
    switch (P.attackType) {
      case 'up': return lerp(0.5, -3.4, e);
      case 'down': return lerp(-0.7, 3.1, e);
      case 'launch': return lerp(-2.7, 0.7, e);
      default:
        if (P.comboIdx === 2) return lerp(1.1, -2.0, e);
        if (P.comboIdx === 3) return lerp(-3.3, 1.5, e);
        return lerp(-2.4, 0.9, e);
    }
  }
  if (P.healT > 0) return -1.57 + Math.sin(Game.time * 40) * 0.05;
  if (P.sliding) return -2.6;
  if (!P.onGround) return -2.0 + clamp(P.vy / 1500, -0.4, 0.4);
  return -2.25 + Math.sin(P.runPhase) * 0.12;
}
function drawSlash(P) {
  if (P.attackT <= 0 || P.attackType === 'launch') return;
  const p = 1 - P.attackT / P.attackDur; if (p > 0.8) return;
  const heavy = P.comboIdx === 3;
  let a0, a1;
  switch (P.attackType) {
    case 'up': a0 = 0.3; a1 = -3.3; break;
    case 'down': a0 = -0.5; a1 = 3.0; break;
    default: if (P.comboIdx === 2) { a0 = 1.0; a1 = -1.9; } else if (heavy) { a0 = -3.2; a1 = 1.4; } else { a0 = -2.3; a1 = 0.85; }
  }
  const cur = lerp(a0, a1, Math.min(1, (1 - Math.pow(1 - p, 3)) * 1.05));
  const r1 = TUNE.batReach * (heavy ? 0.95 : 0.82), r0 = r1 * 0.45, alpha = 1 - p / 0.8;
  ctx.save();
  ctx.translate(P.x + P.w / 2, P.y + P.h / 2 - 6);
  ctx.scale(P.facing, 1);
  const ccw = a1 < a0;
  ctx.beginPath(); ctx.arc(0, 0, r1, a0, cur, ccw); ctx.arc(0, 0, r0, cur, a0, !ccw); ctx.closePath();
  ctx.globalAlpha = alpha * 0.9; ctx.fillStyle = heavy ? GOLD : BONE; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = heavy ? FLAME : INK; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r1 + 4, a0, cur, ccw); ctx.strokeStyle = heavy ? FLAME : EMBER; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
}
function limb(x, y, ang, len, col, w) {
  const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = w + 5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
  return [ex, ey];
}
function drawNathan(P) {
  const px = P.x + P.w / 2, py = P.y + P.h;
  if (P.invuln > 0 && Math.floor(Game.time * 18) % 2 === 0) ctx.globalAlpha = 0.35;

  if (P.healT > 0) {
    const k = P.healT / TUNE.healTime;
    const g = ctx.createRadialGradient(px, py - 22, 0, px, py - 22, 30 + k * 60);
    g.addColorStop(0, `rgba(232,54,28,${0.3 + k * 0.5})`); g.addColorStop(1, 'rgba(232,54,28,0)');
    ctx.fillStyle = g; ctx.fillRect(px - 100, py - 120, 200, 200);
  }
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(px, py, 14 * P.sx, 3, 0, 0, 7); ctx.fill();

  ctx.save();
  ctx.translate(px, py); ctx.scale(P.facing * P.sx, P.sy);
  ctx.lineJoin = 'round';
  const moving = P.onGround && Math.abs(P.vx) > 20;
  const run = moving ? Math.sin(P.runPhase) : 0;
  let back, front;
  if (P.dashT > 0) { back = 2.4; front = 0.8; }
  else if (!P.onGround) { back = P.vy < 0 ? 2.2 : 1.9; front = P.vy < 0 ? 0.9 : 1.3; if (P.sliding) { back = 1.9; front = 1.2; } }
  else { back = Math.PI / 2 + run * 0.75; front = Math.PI / 2 - run * 0.75; }
  const bob = moving ? Math.abs(Math.cos(P.runPhase)) * -2 : 0;
  ctx.translate(0, bob);

  // legs
  let [ex, ey] = limb(-3, -15, back, 15, '#e7dcc6', 5); ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(ex + 2, ey, 5, 3, 0, 0, 7); ctx.fill();
  [ex, ey] = limb(3, -15, front, 15, BONE, 5); ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(ex + 2, ey, 5, 3, 0, 0, 7); ctx.fill();

  // torso
  rr(-10, -35, 20, 22, 6); inked(FLAME, 3);
  ctx.fillStyle = INK; ctx.fillRect(-10, -17, 20, 3);
  ctx.fillStyle = '#ff6a3d'; ctx.fillRect(-6, -32, 3, 10);
  ctx.font = `10px ${DISPLAY_FONT}`; ctx.fillStyle = BONE; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('7', 3, -25);

  // back arm
  limb(-4, -31, Math.PI / 2 + 0.4 + run * 0.4, 11, FLAME, 4);

  // head + cap
  ctx.beginPath(); ctx.arc(2, -44, 10, 0, 7); inked(BONE, 3);
  ctx.beginPath(); ctx.moveTo(-9, -45); ctx.quadraticCurveTo(-8, -57, 3, -57); ctx.quadraticCurveTo(13, -57, 12, -46); ctx.lineTo(18, -45); ctx.quadraticCurveTo(15, -49, 11, -48);
  ctx.closePath(); inked(FLAME, 3);
  // face
  ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  const hurt = P.invuln > 0.8 || P.dead;
  ctx.beginPath();
  if (hurt) { ctx.moveTo(5, -45); ctx.lineTo(9, -42); ctx.moveTo(9, -45); ctx.lineTo(5, -42); }
  else { ctx.moveTo(5, -44); ctx.lineTo(9, -45); }
  ctx.stroke();
  ctx.beginPath();
  if (P.healT > 0 || P.attackT > 0 || hurt) { ctx.ellipse(8, -38, 2.5, 2.2, 0, 0, 7); ctx.fillStyle = INK; ctx.fill(); }
  else { ctx.moveTo(4, -38); ctx.quadraticCurveTo(7, -36, 10, -39); ctx.stroke(); }

  // bat arm + bat
  const ang = batAngle(P);
  const [hx, hy] = limb(3, -30, ang, 10, FLAME, 4);
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(-2, -2); ctx.lineTo(30, -4.5); ctx.quadraticCurveTo(35, 0, 30, 4.5); ctx.lineTo(-2, 2); ctx.closePath();
  inked(P.launched || P.attackType === 'launch' && P.attackT > 0 ? '#ff7b3a' : '#c9a36b', 2.5);
  ctx.fillStyle = INK; ctx.fillRect(-4, -3, 4, 6);
  ctx.restore();

  ctx.restore();
  ctx.globalAlpha = 1;
}
function drawAfterimage(a) {
  const k = a.life / a.max;
  ctx.save(); ctx.globalAlpha = k * 0.45; ctx.fillStyle = a.color;
  ctx.translate(a.x + Player.w / 2, a.y + Player.h);
  rr(-10, -35, 20, 24, 6); ctx.fill();
  ctx.beginPath(); ctx.arc(2 * a.facing, -44, 10, 0, 7); ctx.fill();
  ctx.fillRect(-6, -14, 12, 14);
  ctx.restore();
}

/* ---------- Particles & pops ---------- */
function drawParticles() {
  for (const p of Game.particles) {
    const k = p.life / p.max;
    ctx.globalAlpha = Math.max(0, Math.min(1, k * 1.4));
    switch (p.type) {
      case 'spark':
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke(); break;
      case 'ring':
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size * k + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, lerp(p.r1, p.r0, k), 0, 7); ctx.stroke(); break;
      case 'puff':
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - k), 0, 7); ctx.fill(); break;
      case 'debris':
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(-p.size / 2, -p.size / 2, p.size, p.size); ctx.restore(); break;
      default:
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, 7); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
function drawPops() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const p of Game.pops) {
    const t = p.t / p.life;
    const s = p.t < 0.14 ? easeOutBack(p.t / 0.14) * 1.15 : t > 0.75 ? 1 - (t - 0.75) * 2.5 : 1;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(s, s);
    ctx.globalAlpha = t > 0.8 ? (1 - t) * 5 : 1;
    ctx.font = `${p.size}px ${DISPLAY_FONT}`;
    if (p.burst) {
      const w = ctx.measureText(p.text).width;
      ctx.save(); ctx.scale((w * 0.5 + p.size * 0.6) / p.size, 1);
      starburst(p.size * 1.05, p.size * 0.62); ctx.fillStyle = p.burstColor; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
    }
    ctx.lineWidth = p.size * 0.2; ctx.strokeStyle = INK;
    ctx.strokeText(p.text, 3, 3); ctx.strokeText(p.text, 0, 0);
    ctx.fillStyle = p.color; ctx.fillText(p.text, 0, 0);
    ctx.restore();
  }
}

/* ---------- Debug ---------- */
function drawDebug() {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#6fd3ff'; const hb = Player.hurtbox(); ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
  ctx.strokeStyle = '#ffffff'; ctx.strokeRect(Player.x, Player.y, Player.w, Player.h);
  if (Player.attackT > 0 && Player.attackType !== 'launch') { const a = Player.hitbox(); ctx.fillStyle = 'rgba(232,54,28,.3)'; ctx.fillRect(a.x, a.y, a.w, a.h); ctx.strokeStyle = FLAME; ctx.strokeRect(a.x, a.y, a.w, a.h); }
  ctx.strokeStyle = GOLD; for (const e of Enemies) if (!e.dead) ctx.strokeRect(e.x, e.y, e.w, e.h);
  ctx.strokeStyle = 'rgba(242,193,78,.5)'; const c = Player.center(); ctx.beginPath(); ctx.arc(c.x, c.y, TUNE.connectRange, 0, 7); ctx.stroke();
  ctx.fillStyle = 'rgba(111,211,255,.5)'; ctx.fillRect(Player.lastSafe.x, Player.lastSafe.y, Player.w, Player.h);
}

/* ---------- Frame ---------- */
function render() {
  const cam = Game.cam;
  const shx = Game.shake > 0.1 ? rand(-Game.shake, Game.shake) : 0, shy = Game.shake > 0.1 ? rand(-Game.shake, Game.shake) : 0;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  drawBackground(cam.x, cam.y);

  ctx.setTransform(SCALE, 0, 0, SCALE, (-cam.x + shx) * SCALE, (-cam.y + shy) * SCALE);
  drawWorldBack(cam);
  drawTiles(cam);

  for (const s of LEVEL.signs) drawSign(s, s.near);
  LEVEL.benches.forEach((b, i) => drawBench(b, i === Game.checkpoint, b.near));
  for (const e of Enemies) {
    if (e.dead) continue;
    if (e.type === 'bot') drawBot(e); else if (e.type === 'drone') drawDrone(e); else if (e.type === 'dummy') drawDummy(e); else drawOrb(e);
  }
  for (const a of Game.afterimages) drawAfterimage(a);
  if (!Player.dead) { drawSlash(Player); drawNathan(Player); }
  for (const b of Balls) if (!b.dead) drawBall(b);
  for (const b of Bolts) if (!b.dead) drawBolt(b);
  drawParticles();
  for (const s of LEVEL.signs) if (s.near) drawBubble(s);
  drawPops();
  if (OPT.boxes) drawDebug();

  // screen-space overlays
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  const fog = ctx.createLinearGradient(0, VH * 0.7, 0, VH);
  fog.addColorStop(0, 'rgba(58,26,32,0)'); fog.addColorStop(1, 'rgba(58,26,32,.35)');
  ctx.fillStyle = fog; ctx.fillRect(0, VH * 0.7, VW, VH * 0.3);
  const vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VH * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(5,3,8,.7)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);
  const low = Player.hp === 1 && !Player.dead ? 0.25 + 0.15 * Math.sin(Game.time * 6) : 0;
  if (Game.flashRed > 0 || low > 0) {
    const a = Math.max(Game.flashRed, low);
    const rg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.3, VW / 2, VH / 2, VH);
    rg.addColorStop(0, 'rgba(232,54,28,0)'); rg.addColorStop(1, `rgba(232,54,28,${a})`);
    ctx.fillStyle = rg; ctx.fillRect(0, 0, VW, VH);
  }
  if (Game.flashWhite > 0) { ctx.fillStyle = `rgba(255,240,220,${Game.flashWhite * 0.5})`; ctx.fillRect(0, 0, VW, VH); }
  if (Game.fade > 0.001) { ctx.fillStyle = `rgba(13,11,16,${Game.fade})`; ctx.fillRect(0, 0, VW, VH); }
}

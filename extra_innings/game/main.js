'use strict';
/* =========================================================
   MAIN: loop, camera, checkpoints, drills, HUD, menus
   ========================================================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------- Drills (Phase 1 checklist) ---------- */
const DRILLS = [
  { id: 'double', label: 'Double jump' },
  { id: 'wall', label: 'Wall jump', goal: 3 },
  { id: 'dash', label: 'Air dash' },
  { id: 'combo', label: 'Land a 3‑hit finisher' },
  { id: 'pogo', label: 'Chain pogos', goal: 3 },
  { id: 'launch', label: 'Bat‑Launch' },
  { id: 'chasm', label: 'Cross The Chasm' },
  { id: 'deflect', label: 'Deflect a drone bolt' },
  { id: 'heal', label: 'Heal with Hype' },
  { id: 'kills', label: 'Scrap enemies', goal: 5 },
];
try { const saved = JSON.parse(localStorage.getItem('mpz_drills') || '{}'); DRILLS.forEach(d => { if (saved[d.id]) { d.done = true; d.prog = d.goal || 1; } }); } catch (e) {}
function saveDrills() { try { const o = {}; DRILLS.forEach(d => { if (d.done) o[d.id] = 1; }); localStorage.setItem('mpz_drills', JSON.stringify(o)); } catch (e) {} }

function renderDrills(flashId) {
  $('#drillList').innerHTML = DRILLS.map(d =>
    `<li class="${d.done ? 'done' : ''} ${d.id === flashId ? 'flash' : ''}">${d.label}${d.goal ? `<em>${Math.min(d.prog || 0, d.goal)}/${d.goal}</em>` : ''}</li>`).join('');
  $('#drillCount').textContent = `${DRILLS.filter(d => d.done).length}/${DRILLS.length}`;
}
function drill(id) {
  const d = DRILLS.find(x => x.id === id);
  if (!d || d.done) return;
  d.done = true; d.prog = d.goal || 1;
  SFX.drill(); toast('DRILL CLEARED · ' + d.label.toUpperCase());
  renderDrills(id); saveDrills();
  if (DRILLS.every(x => x.done)) setTimeout(() => {
    const c = Player.center();
    pop(c.x, c.y - 90, 'PROTOTYPE CLEARED!', { size: 50, life: 2, rot: -0.06 });
    toast('ALL DRILLS DONE · NOW TUNE THE FEEL (T)'); addShake(10); SFX.heal();
  }, 600);
}
function drillProgress(id, n) {
  const d = DRILLS.find(x => x.id === id);
  if (!d || d.done) return;
  d.prog = Math.max(d.prog || 0, n);
  if (n >= (d.goal || 1)) drill(id); else renderDrills();
}

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- World setup ---------- */
Game.checkpoint = 0;
Game.combo = 0; Game.comboT = 0; Game.hazardT = 0; Game.respawnT = 0; Game.paused = true;

function snapCamera() {
  const c = Player.center();
  Game.cam.x = clamp(c.x - VW / 2, 0, Math.max(0, LW * TILE - VW));
  Game.cam.y = clamp(c.y - VH * 0.55, 0, 37 * TILE - VH);
  Game.cam.look = 0;
}
function respawn() {
  Player.reset(LEVEL.benches[Game.checkpoint], true);
  Player.invuln = 1;
  resetEnemies();
  Game.fadeTarget = 0; Game.combo = 0;
  snapCamera();
}
function restartRoom() {
  Game.checkpoint = 0; Player.reset(LEVEL.spawn, false); resetEnemies();
  Game.particles.length = 0; Game.pops.length = 0; Game.fade = 1; Game.fadeTarget = 0; snapCamera();
}

/* ---------- Simulation step ---------- */
function step(dt) {
  Game.time += dt;
  Input.pollPad();
  if (Game.hitstop > 0) { Game.hitstop -= dt; return; }

  if (Game.hazardT > 0) {
    Game.hazardT -= dt;
    if (Game.hazardT <= 0) {
      Player.x = Player.lastSafe.x; Player.y = Player.lastSafe.y; Player.vx = Player.vy = 0;
      Player.hazard = false; Player.invuln = 0.9; Balls.length = 0;
      Game.fadeTarget = 0; snapCamera();
    }
  }
  if (Game.respawnT > 0) { Game.respawnT -= dt; if (Game.respawnT <= 0) respawn(); }

  Player.update(dt);

  for (const e of Enemies) if (!e.dead) e.update(dt);
  if (!Player.dead && !Player.hazard) {
    const hb = Player.hurtbox();
    for (const e of Enemies) if (!e.dead && e.harmful && overlap(hb, { x: e.x + 4, y: e.y + 4, w: e.w - 8, h: e.h - 8 }))
      Player.hurt(sgn(Player.x + Player.w / 2 - (e.x + e.w / 2)) || 1);
  }
  for (const b of Bolts) b.update(dt);
  for (const b of Balls) b.update(dt);
  for (let i = Bolts.length - 1; i >= 0; i--) if (Bolts[i].dead) Bolts.splice(i, 1);
  for (let i = Balls.length - 1; i >= 0; i--) if (Balls[i].dead) Balls.splice(i, 1);

  // benches & signs
  const c = Player.center(), feet = Player.y + Player.h;
  LEVEL.benches.forEach((b, i) => {
    b.near = !Player.dead && Math.abs(c.x - b.x) < 44 && Math.abs(feet - b.y) < 12;
    if (b.near && Game.checkpoint !== i) { Game.checkpoint = i; toast('CHECKPOINT · DUGOUT BENCH'); SFX.bench(); }
    if (b.near && Input.pressed('up') && Player.onGround) {
      Player.hp = Player.maxHp; resetEnemies(); SFX.bench(); Game.flashWhite = 0.3; HUD.hpPop = true;
      pop(b.x, b.y - 80, 'REST UP!', { size: 34 }); toast('HEALED · ENEMIES RESPAWNED');
    }
  });
  for (const s of LEVEL.signs) s.near = Math.abs(c.x - s.x) < 70 && Math.abs(feet - s.y) < 90;

  // particles, pops, afterimages
  const P = Game.particles;
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]; p.life -= dt;
    if (p.life <= 0) { P.splice(i, 1); continue; }
    const dr = Math.max(0, 1 - p.drag * dt); p.vx *= dr; p.vy = p.vy * dr + p.grav * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
  }
  for (let i = Game.pops.length - 1; i >= 0; i--) {
    const p = Game.pops[i]; p.t += dt; p.y += p.vy * dt; p.vy *= Math.max(0, 1 - 3 * dt);
    if (p.t >= p.life) Game.pops.splice(i, 1);
  }
  for (let i = Game.afterimages.length - 1; i >= 0; i--) { const a = Game.afterimages[i]; a.life -= dt; if (a.life <= 0) Game.afterimages.splice(i, 1); }

  // combo timeout
  if (Game.comboT > 0) { Game.comboT -= dt; if (Game.comboT <= 0) Game.combo = 0; }

  // camera
  const cam = Game.cam;
  if (!Player.dead && !Player.hazard) {
    cam.look = lerp(cam.look, Player.facing * 70 + Player.vx * 0.12, 1 - Math.exp(-3 * dt));
    const fallLead = Player.vy > 400 ? Math.min(140, (Player.vy - 400) * 0.3) : 0;
    const tx = c.x + cam.look - VW / 2;
    const ty = c.y - VH * 0.55 + cam.lookY + fallLead;
    cam.x = lerp(cam.x, tx, 1 - Math.exp(-7 * dt));
    cam.y = lerp(cam.y, ty, 1 - Math.exp(-(Player.launched ? 9 : 6) * dt));
  }
  const maxX = LW * TILE - VW;
  cam.x = maxX > 0 ? clamp(cam.x, 0, maxX) : maxX / 2;
  cam.y = clamp(cam.y, 0, 37 * TILE - VH);

  Input.endStep();
}

/* ---------- HUD ---------- */
const HUD = { hp: -1, maxHp: -1, balls: -1, ballMax: -1, hype: -1, combo: -1, hpPop: false };
const HP_SVG = '<svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="12" fill="#f3ead8" stroke="#0d0b10" stroke-width="3"/><path d="M7 7 Q12 15 7 23" fill="none" stroke="#e8361c" stroke-width="2" stroke-dasharray="3 2"/><path d="M23 7 Q18 15 23 23" fill="none" stroke="#e8361c" stroke-width="2" stroke-dasharray="3 2"/></svg>';
function updateHUD() {
  const P = Player;
  if (P.maxHp !== HUD.maxHp) { $('#hp').innerHTML = HP_SVG.repeat(P.maxHp); HUD.maxHp = P.maxHp; HUD.hp = -1; }
  if (P.hp !== HUD.hp || HUD.hpPop) {
    $$('#hp svg').forEach((s, i) => {
      const was = s.classList.contains('empty');
      s.classList.toggle('empty', i >= P.hp);
      if (was && i < P.hp) { s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop'); }
    });
    HUD.hp = P.hp; HUD.hpPop = false;
  }
  const hype = Math.round(P.hype);
  if (hype !== HUD.hype) {
    $('#hypeFill').style.width = (hype / 99 * 100) + '%';
    $('#hype').classList.toggle('ready', hype >= TUNE.healCost);
    HUD.hype = hype;
  }
  if (TUNE.ballCount !== HUD.ballMax) { $('#balls').innerHTML = '<span></span>'.repeat(TUNE.ballCount); HUD.ballMax = TUNE.ballCount; HUD.balls = -1; }
  if (P.balls !== HUD.balls) { $$('#balls span').forEach((s, i) => s.classList.toggle('used', i >= P.balls)); HUD.balls = P.balls; }
  if (Game.combo !== HUD.combo) {
    const el = $('#combo');
    el.classList.toggle('show', Game.combo >= 2);
    if (Game.combo >= 2) { $('#comboN').textContent = Game.combo; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    HUD.combo = Game.combo;
  }
}

/* ---------- Main loop ---------- */
let last = performance.now(), acc = 0, fps = 60, fpsAcc = 0, fpsN = 0, statT = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  if (!Game.paused) {
    acc += dt * (OPT.slow ? 0.3 : 1);
    let n = 0;
    while (acc >= STEP && n < 24) { step(STEP); acc -= STEP; n++; }
    if (n >= 24) acc = 0;
  } else {
    // controller navigation for intro & pause screens
    Input.pollPad();
    const B = Input.buffered;
    if ($('#intro').classList.contains('show')) { if (B.has('jump') || B.has('attack')) startGame(); }
    else if ($('#pause').classList.contains('show')) {
      if (B.has('down')) { pauseSel = (pauseSel + 1) % pauseBtns.length; markPause(); SFX.ui(); }
      if (B.has('up')) { pauseSel = (pauseSel + pauseBtns.length - 1) % pauseBtns.length; markPause(); SFX.ui(); }
      if (B.has('jump')) pauseAction(pauseBtns[pauseSel].dataset.p);
      else if (B.has('dash')) setPaused(false);
    }
    Input.endStep();
  }
  Game.shake *= Math.exp(-dt * 10);
  Game.flashRed = Math.max(0, Game.flashRed - dt * 1.5);
  Game.flashWhite = Math.max(0, Game.flashWhite - dt * 2);
  Game.fade = approach(Game.fade, Game.fadeTarget, dt * 4);
  render(); updateHUD();
  statT -= dt; if (statT <= 0 && $('#tune').classList.contains('open')) { updateStats(); statT = 0.1; }
  requestAnimationFrame(loop);
}

/* ---------- Intro / pause ---------- */
function startGame() {
  if (!$('#intro').classList.contains('show')) return;
  SFX.ensure(); SFX.bench();
  $('#intro').classList.remove('show');
  Game.paused = false; Input.enabled = true; Input.clear();
  Game.fade = 1; Game.fadeTarget = 0;
  setTimeout(() => $('#hint').classList.add('fade'), 30000);
}
$('#startBtn').addEventListener('click', startGame);

function setPaused(p) {
  if ($('#intro').classList.contains('show')) return;
  Game.paused = p; Input.enabled = !p; Input.clear();
  $('#pause').classList.toggle('show', p);
  if (p) { SFX.ui(); pauseSel = 0; markPause(); }
}
let pauseSel = 0;
const pauseBtns = $$('.pbtn');
function markPause() { pauseBtns.forEach((b, i) => b.classList.toggle('sel', i === pauseSel)); }
pauseBtns.forEach((b, i) => {
  b.addEventListener('mouseenter', () => { pauseSel = i; markPause(); });
  b.addEventListener('click', () => pauseAction(b.dataset.p));
});
function pauseAction(a) {
  SFX.ui();
  if (a === 'resume') setPaused(false);
  if (a === 'tune') { setPaused(false); toggleTune(true); }
  if (a === 'restart') { setPaused(false); restartRoom(); }
  if (a === 'reset') { DRILLS.forEach(d => { d.done = false; d.prog = 0; }); Game.stats.kills = 0; Game.stats.wallJumps = 0; saveDrills(); renderDrills(); toast('DRILLS RESET'); }
  if (a === 'menu') location.href = 'index.html#menu';
}
$('#vol').value = Math.round(SFX.volume * 100);
$('#vol').addEventListener('input', e => { SFX.volume = e.target.value / 100; });

addEventListener('keydown', e => {
  if ($('#intro').classList.contains('show')) {
    if (['Enter', 'Space', 'KeyJ', 'KeyX'].includes(e.code)) { e.preventDefault(); startGame(); }
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    if ($('#tune').classList.contains('open') && e.code === 'Escape') { toggleTune(false); return; }
    setPaused(!Game.paused); return;
  }
  if (Game.paused) {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { pauseSel = (pauseSel + 1) % pauseBtns.length; markPause(); SFX.ui(); }
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { pauseSel = (pauseSel + pauseBtns.length - 1) % pauseBtns.length; markPause(); SFX.ui(); }
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyJ') { e.preventDefault(); pauseAction(pauseBtns[pauseSel].dataset.p); }
    return;
  }
  if (e.code === 'KeyT' || e.code === 'Backquote') toggleTune();
});
addEventListener('padpause', () => { if ($('#intro').classList.contains('show')) startGame(); else setPaused(!Game.paused); });
$('#drills header').addEventListener('click', () => $('#drills').classList.toggle('collapsed'));

/* ---------- Tuning drawer ---------- */
function buildTune() {
  $('#tuneGroups').innerHTML = TUNE_SPEC.map(([group, rows]) => `<h3>${group}</h3>` + rows.map(([k, label, def, min, max, step]) =>
    `<div class="tr" data-k="${k}"><label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${TUNE[k]}"><output></output></div>`).join('')).join('');
  $$('#tuneGroups .tr').forEach(row => {
    const k = row.dataset.k, inp = row.querySelector('input');
    const show = () => {
      const v = TUNE[k];
      row.querySelector('output').textContent = Number.isInteger(v) ? v : v.toFixed(v < 1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '');
      row.classList.toggle('changed', Math.abs(v - DEFAULTS[k]) > 1e-9);
    };
    inp.addEventListener('input', () => { TUNE[k] = +inp.value; show(); saveTune(); });
    inp.addEventListener('change', () => inp.blur());
    show();
  });
}
function toggleTune(force) {
  const el = $('#tune'), open = force !== undefined ? force : !el.classList.contains('open');
  el.classList.toggle('open', open); SFX.ui();
}
function updateStats() {
  const P = Player;
  const state = P.dead ? 'DEAD' : P.healT > 0 ? 'HEALING' : P.dashT > 0 ? 'DASH' : P.launched ? 'LAUNCHED' : P.sliding ? 'WALL SLIDE' : P.onGround ? (Math.abs(P.vx) > 5 ? 'RUN' : 'IDLE') : P.vy < 0 ? 'RISE' : 'FALL';
  $('#tuneStats').textContent =
    `STATE   ${state.padEnd(11)} FPS ${fps}\n` +
    `VEL     x ${String(Math.round(P.vx)).padStart(5)}   y ${String(Math.round(P.vy)).padStart(5)}\n` +
    `AIR     dbl ${P.canDouble ? '●' : '○'}  dash ${P.canDash ? '●' : '○'}  balls ${P.balls}\n` +
    `HYPE    ${Math.round(P.hype)}   COMBO ${Game.combo}   POGO CHAIN ${P.pogoChain}`;
}
$('#tuneClose').addEventListener('click', () => toggleTune(false));
$('#tuneReset').addEventListener('click', () => { Object.assign(TUNE, DEFAULTS); saveTune(); buildTune(); toast('FEEL RESET TO DEFAULTS'); });
$('#tuneExport').addEventListener('click', () => {
  const lines = TUNE_SPEC.map(([g, rows]) => `  // ${g}\n` + rows.map(([k, label]) => `  ${k}: ${TUNE[k]},${' '.repeat(Math.max(1, 16 - k.length - String(TUNE[k]).length))}// ${label}`).join('\n')).join('\n');
  const txt = `// Extra Innings (Ibrahim Interactive) · Phase 1 feel numbers (px, seconds; 1 tile = 32px)\nconst TUNE = {\n${lines}\n};`;
  const out = $('#tuneOut'); out.hidden = false; out.value = txt; out.select();
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('COPIED TO CLIPBOARD'), () => toast('SELECT & COPY THE NUMBERS BELOW'));
  else toast('SELECT & COPY THE NUMBERS BELOW');
});
[['#optBoxes', 'boxes'], ['#optSlow', 'slow'], ['#optHype', 'infHype'], ['#optGod', 'god']].forEach(([sel, k]) => {
  const el = $(sel); el.checked = OPT[k];
  el.addEventListener('change', () => { OPT[k] = el.checked; el.blur(); });
});

/* ---------- Boot ---------- */
buildTune();
renderDrills();
restartRoom();
Game.fade = 0;
requestAnimationFrame(loop);

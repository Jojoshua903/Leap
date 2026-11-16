'use strict';
/* =========================================================
   CORE: constants, feel numbers, input, math, FX helpers
   ========================================================= */
const TILE = 32;
const STEP = 1 / 120;          // fixed simulation step
const VIEW_TILES_H = 17;       // world tiles visible vertically

/* ---------- Feel numbers (all live-tunable) ----------
   Units: pixels, seconds. 1 tile = 32 px. */
const TUNE_SPEC = [
  ['Movement', [
    ['runSpeed',     'Run speed',        310, 120, 600, 5],
    ['groundAccel',  'Ground accel',    3200, 500, 8000, 100],
    ['groundDecel',  'Ground decel',    3800, 500, 9000, 100],
    ['airAccel',     'Air accel',       2300, 300, 6000, 100],
  ]],
  ['Jump', [
    ['gravity',      'Gravity',         2300, 800, 5000, 50],
    ['fallMult',     'Fall gravity ×',  1.35, 1, 3, 0.05],
    ['maxFall',      'Max fall speed',   950, 300, 2000, 25],
    ['jumpVel',      'Jump velocity',    740, 300, 1300, 10],
    ['jumpCut',      'Jump release cut',0.42, 0.1, 1, 0.02],
    ['doubleJumpVel','Double jump vel',  650, 0, 1200, 10],
    ['coyote',       'Coyote time',     0.10, 0, 0.3, 0.01],
    ['jumpBuffer',   'Jump buffer',     0.12, 0, 0.3, 0.01],
  ]],
  ['Dash & Wall', [
    ['dashSpeed',    'Dash speed',       760, 300, 1600, 10],
    ['dashTime',     'Dash duration',   0.15, 0.05, 0.4, 0.01],
    ['dashCooldown', 'Dash cooldown',   0.30, 0, 1, 0.02],
    ['wallSlide',    'Wall slide speed', 150, 0, 600, 10],
    ['wallJumpX',    'Wall jump push',   400, 100, 900, 10],
    ['wallJumpY',    'Wall jump height', 690, 300, 1200, 10],
    ['wallJumpLock', 'Wall jump lock',  0.14, 0, 0.4, 0.01],
  ]],
  ['Bat Combat', [
    ['attackCooldown','Swing cooldown', 0.25, 0.08, 0.6, 0.01],
    ['comboWindow',  'Combo window',    0.42, 0.1, 1, 0.02],
    ['batReach',     'Bat reach',         62, 30, 120, 2],
    ['pogoVel',      'Pogo bounce',      660, 300, 1200, 10],
    ['hitstop',      'Hit-stop',       0.055, 0, 0.2, 0.005],
    ['knockback',    'Enemy knockback',  260, 0, 800, 10],
  ]],
  ['Bat‑Launch', [
    ['launchSpeed',  'Launch speed',    1150, 500, 2200, 10],
    ['launchFloat',  'Low-grav time',   0.22, 0, 0.6, 0.01],
    ['launchDrag',   'Momentum drag',    700, 0, 3000, 25],
    ['ballCount',    'Balls per air',      3, 1, 9, 1],
    ['connectRange', 'Connect range',    110, 40, 220, 5],
  ]],
  ['Hype & Heal', [
    ['hypePerHit',   'Hype per hit',       7, 1, 40, 1],
    ['healCost',     'Heal cost',         33, 5, 99, 1],
    ['healTime',     'Heal hold time',  0.65, 0.1, 2, 0.05],
  ]],
];
const DEFAULTS = {};
TUNE_SPEC.forEach(([, rows]) => rows.forEach(([k, , v]) => DEFAULTS[k] = v));
const TUNE = Object.assign({}, DEFAULTS);
try { Object.assign(TUNE, JSON.parse(localStorage.getItem('mpz_tune') || '{}')); } catch (e) {}
function saveTune() { try { localStorage.setItem('mpz_tune', JSON.stringify(TUNE)); } catch (e) {} }

const OPT = { boxes: false, slow: false, infHype: false, god: false };

/* ---------- Math ---------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const approach = (v, t, d) => v < t ? Math.min(v + d, t) : Math.max(v - d, t);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const sgn = v => v > 0 ? 1 : v < 0 ? -1 : 0;
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const easeOutBack = t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

/* ---------- Input (keyboard + gamepad) ---------- */
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'jump', KeyZ: 'jump', KeyJ: 'attack', KeyX: 'attack',
  KeyK: 'ball', KeyC: 'ball', ShiftLeft: 'dash', ShiftRight: 'dash', KeyL: 'dash',
  KeyH: 'heal', KeyV: 'heal'
};
const PADMAP = { 0: 'jump', 2: 'attack', 3: 'ball', 1: 'dash', 7: 'dash', 5: 'heal', 4: 'heal', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

const Input = {
  keyDown: new Set(), padDown: new Set(), prevPad: new Set(), buffered: new Set(),
  enabled: false,
  down(a) { return this.keyDown.has(a) || this.padDown.has(a); },
  pressed(a) { return this.buffered.has(a); },
  consume(a) { this.buffered.delete(a); },
  endStep() { this.buffered.clear(); },
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find(Boolean);
    this.prevPad = this.padDown; this.padDown = new Set();
    if (!p) return;
    p.buttons.forEach((b, i) => { if (b.pressed && PADMAP[i]) this.padDown.add(PADMAP[i]); });
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    if (ax < -0.4) this.padDown.add('left'); if (ax > 0.4) this.padDown.add('right');
    if (ay < -0.5) this.padDown.add('up'); if (ay > 0.5) this.padDown.add('down');
    this.padDown.forEach(a => { if (!this.prevPad.has(a)) this.buffered.add(a); });
    if (p.buttons[9] && p.buttons[9].pressed && !this._start) { this._start = true; window.dispatchEvent(new CustomEvent('padpause')); }
    if (p.buttons[9] && !p.buttons[9].pressed) this._start = false;
    if (this.padDown.size) Game.lastInput = 'pad';
  },
  clear() { this.keyDown.clear(); this.buffered.clear(); }
};
addEventListener('keydown', e => {
  const a = KEYMAP[e.code];
  if (a) {
    e.preventDefault();
    if (!Input.enabled) return;
    if (!e.repeat) Input.buffered.add(a);
    Input.keyDown.add(a);
    Game.lastInput = 'key';
  }
});
addEventListener('keyup', e => { const a = KEYMAP[e.code]; if (a) Input.keyDown.delete(a); });
addEventListener('blur', () => Input.clear());

/* ---------- Global game state ---------- */
const Game = {
  time: 0, hitstop: 0, freeze: 0, shake: 0, flashRed: 0, flashWhite: 0, fade: 0, fadeTarget: 0,
  particles: [], pops: [], afterimages: [], lastInput: 'key',
  cam: { x: 0, y: 0, look: 0, lookY: 0 },
  stats: { kills: 0, wallJumps: 0 }
};

function addHitstop(t) { Game.hitstop = Math.max(Game.hitstop, t); }
function addShake(a) { Game.shake = Math.max(Game.shake, a); }

/* ---------- Particles ---------- */
function spawnParticle(o) {
  if (Game.particles.length > 600) Game.particles.shift();
  Game.particles.push(Object.assign({ vx: 0, vy: 0, life: 0.5, max: 0.5, size: 3, grav: 0, drag: 0, color: '#ff8a2a', type: 'dot', rot: 0, vr: 0 }, o, { max: o.life || 0.5 }));
}
function burst(x, y, n, opts = {}) {
  for (let i = 0; i < n; i++) {
    const a = opts.angle !== undefined ? opts.angle + rand(-opts.spread || 0, opts.spread || 0) : rand(0, Math.PI * 2);
    const s = rand(opts.minSpeed || 120, opts.maxSpeed || 420);
    spawnParticle({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(opts.minLife || 0.2, opts.maxLife || 0.5),
      size: rand(opts.minSize || 2, opts.maxSize || 4), color: opts.colors ? opts.colors[i % opts.colors.length] : (opts.color || '#ff8a2a'),
      grav: opts.grav || 0, drag: opts.drag || 3, type: opts.type || 'spark' });
  }
}
function ring(x, y, r0, r1, life, color, width = 5) {
  spawnParticle({ x, y, type: 'ring', r0, r1, life, color, size: width });
}
function dust(x, y, n = 6, dir = 0) {
  for (let i = 0; i < n; i++) spawnParticle({ x: x + rand(-10, 10), y, vx: (dir || rand(-1, 1)) * rand(30, 140), vy: rand(-90, -20),
    life: rand(0.25, 0.45), size: rand(4, 8), color: 'rgba(200,190,215,0.5)', type: 'puff', drag: 4 });
}

/* ---------- Comic pop text ---------- */
const POW_WORDS = ['CRACK!', 'WHAM!', 'THWACK!', 'SMACK!', 'BONK!', 'POW!'];
function pop(x, y, text, opts = {}) {
  Game.pops.push({ x, y, text: text || POW_WORDS[(Math.random() * POW_WORDS.length) | 0], t: 0,
    life: opts.life || 0.75, size: opts.size || 30, color: opts.color || '#f2c14e', burst: opts.burst !== false,
    burstColor: opts.burstColor || '#e8361c', rot: opts.rot !== undefined ? opts.rot : rand(-0.25, 0.25), vy: opts.vy !== undefined ? opts.vy : -40 });
}

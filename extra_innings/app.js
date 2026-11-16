/* =========================================================
   EXTRA INNINGS — Main Menu · Ibrahim Interactive
   ========================================================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------------- Settings ---------------- */
const settings = { master: 80, music: 65, sfx: 90, shake: true, flashes: true, particles: 'High', subtitles: true };

/* ---------------- Audio (synthesized, no files) ---------------- */
const Sfx = (() => {
  let ctx, master, drone;
  const ensure = () => {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.connect(ctx.destination); setVol();
  };
  const setVol = () => { if (master) master.gain.value = (settings.master / 100) * 0.5; };
  const sfxVol = () => settings.sfx / 100;
  const tone = (f, d, type = 'square', v = .15, slide) => {
    ensure(); const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(v * sfxVol(), t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g).connect(master); o.start(t); o.stop(t + d);
  };
  const noise = (d, v = .3, hp = 800) => {
    ensure(); const t = ctx.currentTime;
    const b = ctx.createBuffer(1, ctx.sampleRate * d, ctx.sampleRate), data = b.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = b; f.type = 'highpass'; f.frequency.value = hp; g.gain.value = v * sfxVol();
    s.connect(f).connect(g).connect(master); s.start(t);
  };
  return {
    setVol,
    tick: () => tone(660, .06, 'square', .05),
    select: () => { tone(220, .12, 'sawtooth', .12, 880); },
    back: () => tone(500, .12, 'triangle', .1, 200),
    crack: () => { noise(.25, .5, 1200); tone(140, .25, 'sine', .35, 50); },
    boom: () => { noise(.8, .55, 80); tone(90, .7, 'sine', .5, 30); },
    whoosh: () => noise(.45, .18, 2500),
    startDrone() {
      ensure(); if (drone) return;
      const g = ctx.createGain(); g.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      [55, 82.4, 110.5].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = i ? 'sawtooth' : 'sine'; o.frequency.value = f;
        const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = .08 + i * .05; lg.gain.value = 1.6;
        l.connect(lg).connect(o.frequency); l.start(); o.connect(lp); o.start();
      });
      lp.connect(g).connect(master);
      g.gain.linearRampToValueAtTime((settings.music / 100) * .12, ctx.currentTime + 4);
      drone = g;
    },
    setMusic() { if (drone) drone.gain.value = (settings.music / 100) * .12; }
  };
})();

/* ---------------- World canvas: the Spire ---------------- */
const cv = $('#world'), cx = cv.getContext('2d');
let W, H, DPR, embers = [], mouse = { x: 0, y: 0 }, para = { x: 0, y: 0 }, flash = 0, spireMode = 'loader';
const spire = []; // tiers of the tower
function buildSpire() {
  spire.length = 0;
  let w = 0.30, y = 1.05;
  while (y > 0.02) {
    const h = 0.04 + Math.random() * 0.05;
    spire.push({ y, h, w, win: Math.random() > .35, ledge: Math.random() > .5 });
    y -= h; w *= 0.86 + Math.random() * 0.06;
  }
}
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR; cx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
function spawnEmber(initial) {
  const n = { High: 1, Medium: .55, Low: .2 }[settings.particles];
  if (Math.random() > n) return;
  embers.push({
    x: Math.random() * W, y: initial ? Math.random() * H : H + 10,
    vy: -(0.3 + Math.random() * 1.1), vx: (Math.random() - .5) * .4,
    r: .8 + Math.random() * 2.2, life: 1, hue: Math.random() > .85 ? 'gold' : 'flame', ph: Math.random() * 6
  });
}
function drawSpire(ox, oy, scale, color, lit) {
  const cxm = W * 0.62 + ox;
  cx.fillStyle = color;
  for (const t of spire) {
    const tw = t.w * H * scale, ty = H - (1 - t.y) * H * scale - oy, th = t.h * H * scale;
    cx.fillRect(cxm - tw / 2, ty - th, tw, th + 1);
    if (t.ledge) cx.fillRect(cxm - tw / 2 - tw * .12, ty - th, tw * 1.24, th * .14);
    if (lit && t.win) {
      cx.fillStyle = `rgba(255,138,42,${.35 + .25 * Math.sin(perf / 900 + t.y * 20)})`;
      const n = 3, ww = tw * .06;
      for (let i = 0; i < n; i++) cx.fillRect(cxm - tw / 2 + tw * (.2 + i * .3) - ww / 2, ty - th * .7, ww, th * .4);
      cx.fillStyle = color;
    }
  }
  // stadium crown at the top
  const top = spire[spire.length - 1], tw = top.w * H * scale * 1.8, ty = H - (1 - top.y) * H * scale - oy - top.h * H * scale;
  cx.beginPath(); cx.ellipse(cxm, ty, tw / 2, tw / 7, 0, Math.PI, 0); cx.fill();
  if (lit) {
    const g = cx.createRadialGradient(cxm, ty - 10, 0, cxm, ty - 10, tw * 1.4);
    g.addColorStop(0, 'rgba(242,193,78,.55)'); g.addColorStop(1, 'rgba(242,193,78,0)');
    cx.fillStyle = g; cx.fillRect(cxm - tw * 1.5, ty - tw * 1.5, tw * 3, tw * 2);
  }
}
let perf = 0;
function frame(t) {
  perf = t;
  para.x += (mouse.x - para.x) * .05; para.y += (mouse.y - para.y) * .05;
  // sky
  const g = cx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#120c1a'); g.addColorStop(.55, '#2a1d33'); g.addColorStop(1, '#4a1d1a');
  cx.fillStyle = g; cx.fillRect(0, 0, W, H);
  // moon / stadium lights glow
  const mg = cx.createRadialGradient(W * .62 + para.x * -8, H * .12, 0, W * .62, H * .12, H * .55);
  mg.addColorStop(0, 'rgba(243,234,216,.18)'); mg.addColorStop(1, 'rgba(243,234,216,0)');
  cx.fillStyle = mg; cx.fillRect(0, 0, W, H);
  // lightning flash (Storm Atrium flavor)
  if (settings.flashes && spireMode === 'menu' && Math.random() < .0025) flash = 1;
  if (flash > 0) { cx.fillStyle = `rgba(111,211,255,${flash * .22})`; cx.fillRect(0, 0, W, H); flash -= .04; }
  // layers
  drawSpire(para.x * -10, para.y * -5, 1.0, '#1b1424', true);
  // scrapyard foreground
  cx.fillStyle = '#0d0b10';
  cx.beginPath(); cx.moveTo(0, H);
  for (let x = 0; x <= W + 40; x += 40) {
    const h = 60 + 40 * Math.sin(x * .013) + 30 * Math.sin(x * .041 + 1) + para.x * -20 * (x / W - .5);
    cx.lineTo(x + para.x * -25, H - h);
  }
  cx.lineTo(W, H); cx.fill();
  // embers
  if (embers.length < 140) spawnEmber();
  for (let i = embers.length - 1; i >= 0; i--) {
    const e = embers[i];
    e.y += e.vy; e.x += e.vx + Math.sin(t / 700 + e.ph) * .35 + para.x * -.02;
    e.life -= .0016;
    if (e.y < -10 || e.life <= 0) { embers.splice(i, 1); continue; }
    const a = Math.min(1, e.life * 1.5) * (.5 + .5 * Math.sin(t / 200 + e.ph));
    cx.fillStyle = e.hue === 'gold' ? `rgba(242,193,78,${a})` : `rgba(255,${90 + (e.ph * 20 | 0)},42,${a})`;
    cx.shadowBlur = 10; cx.shadowColor = '#e8361c';
    cx.beginPath(); cx.arc(e.x, e.y, e.r, 0, 7); cx.fill();
  }
  cx.shadowBlur = 0;
  requestAnimationFrame(frame);
}
addEventListener('resize', resize);
addEventListener('mousemove', e => { mouse.x = (e.clientX / W - .5) * 2; mouse.y = (e.clientY / H - .5) * 2; });
resize(); buildSpire(); for (let i = 0; i < 80; i++) spawnEmber(true); requestAnimationFrame(frame);

/* ---------------- FX helpers ---------------- */
const POWS = ['CRACK!', 'BOOM!', 'WHAM!', 'THWACK!', 'BLORP!', 'KRAKOOM!', 'SMACK!'];
function pow(x, y, word, size = 56) {
  const el = document.createElement('div');
  el.className = 'pow'; el.textContent = word || POWS[Math.random() * POWS.length | 0];
  el.style.fontSize = size + 'px';
  $('#fx').appendChild(el);
  const r = el.getBoundingClientRect();
  gsap.set(el, { left: x - r.width / 2, top: y - r.height / 2, scale: 0, rotation: gsap.utils.random(-18, 18) });
  gsap.timeline({ onComplete: () => el.remove() })
    .to(el, { scale: 1.15, duration: .18, ease: 'back.out(3)' })
    .to(el, { scale: 1, duration: .1 })
    .to(el, { opacity: 0, y: -30, scale: .8, duration: .4, delay: .35, ease: 'power2.in' });
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('div'); s.className = 'spark'; $('#fx').appendChild(s);
    const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 120;
    gsap.fromTo(s, { left: x, top: y, scale: 1 }, { left: x + Math.cos(a) * d, top: y + Math.sin(a) * d, scale: 0, duration: .5 + Math.random() * .4, ease: 'power3.out', onComplete: () => s.remove() });
  }
}
function shake(amt = 10) {
  if (!settings.shake) return;
  gsap.fromTo('.screen.active', { x: 0, y: 0 }, { duration: .4, ease: 'none', keyframes: Array.from({ length: 8 }, (_, i) => ({ x: gsap.utils.random(-amt, amt) * (1 - i / 8), y: gsap.utils.random(-amt, amt) * (1 - i / 8) })).concat([{ x: 0, y: 0 }]) });
}
function wipe(mid) {
  Sfx.whoosh();
  const tl = gsap.timeline();
  tl.set('#wipe', { clipPath: 'circle(0% at 50% 50%)' })
    .set('.wipe-ball', { opacity: 1, scale: 0, rotation: 0 })
    .to('#wipe', { clipPath: 'circle(75% at 50% 50%)', duration: .55, ease: 'power3.in' })
    .to('.wipe-ball', { scale: 1, rotation: 360, duration: .4, ease: 'back.out(2)' }, '-=.15')
    .add(() => mid && mid())
    .to('.wipe-ball', { scale: 0, duration: .25, delay: .15 })
    .to('#wipe', { clipPath: 'circle(0% at 50% 50%)', duration: .55, ease: 'power3.out' });
  return tl;
}
function show(id) { $$('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }

/* ---------------- LOADER (lowkey) ---------------- */
function runLoader(label, done) {
  const fill = $('#loadFill'), st = $('#loadStatus');
  let p = 0;
  st.textContent = label || 'Loading';
  fill.style.width = '0%';
  const step = () => {
    p = Math.min(100, p + Math.random() * (p > 80 ? 5 : 11));
    fill.style.width = p + '%';
    if (p < 100) setTimeout(step, 140 + Math.random() * 220);
    else setTimeout(done, 350);
  };
  step();
}
function fadeOut(cb) {
  gsap.to('#loader', { opacity: 0, duration: .6, ease: 'power1.inOut', onComplete: () => { cb(); gsap.set('#loader', { opacity: 1 }); } });
}

if (location.hash === '#menu') {
  // returning from the game: skip the boot sequence
  setTimeout(() => { try { history.replaceState(null, '', location.pathname); } catch (e) {} enterMenu(); }, 0);
} else gsap.timeline()
  .to('.load-block', { opacity: 1, duration: .8, ease: 'power1.out' }, .3)
  .add(() => runLoader(null, () => fadeOut(enterTitle)));

/* ---------------- TITLE ---------------- */
let titleReady = false;
function enterTitle() {
  show('title'); spireMode = 'title';
  gsap.set('#title .logo-top span', { y: -120, opacity: 0, rotation: () => gsap.utils.random(-40, 40) });
  gsap.set('#title .logo-main', { scale: 3, opacity: 0 });
  gsap.timeline({ delay: .5 })
    .to('#title .logo-top span', { y: 0, opacity: 1, rotation: 0, duration: .5, stagger: .05, ease: 'bounce.out' })
    .to('#title .logo-main', { scale: 1, opacity: 1, duration: .35, ease: 'power4.in' }, '+=.1')
    .add(() => { Sfx.boom(); shake(18); const r = $('#title .logo-main').getBoundingClientRect(); pow(r.right - 40, r.top + 20, 'BOOM!', 64); })
    .to('#title .logo-slash', { scaleX: 1, duration: .5, ease: 'power3.out' })
    .to('#title .logo-sub', { opacity: .75, duration: .8 }, '-=.2')
    .add(() => { $('.press-start').style.animationPlayState = 'running'; titleReady = true; });
}
function leaveTitle() {
  if (!titleReady) return; titleReady = false;
  Sfx.crack(); Sfx.startDrone();
  pow(innerWidth / 2, innerHeight * .78, 'CRACK!', 60);
  wipe(enterMenu);
}
addEventListener('keydown', e => { if ($('#title').classList.contains('active')) leaveTitle(); });
$('#title').addEventListener('click', leaveTitle);

/* ---------------- MENU ---------------- */
const items = $$('.mi');
let sel = 0, hype = 0, inMenu = false;
const QUOTES = {
  continue: ['"Pick up where I left off? Obviously."', 'Nathan'],
  new: ['"Match point! …Again."', 'Adam'],
  load: ['"…blorp."', 'Reshman'],
  options: ['"Works on my machine."', 'Josh'],
  extras: ['"Rock and stone! Grab a beer."', 'Lars'],
  credits: ['"I improved the credits. They explode now."', 'Daniel'],
  quit: ['"KNEEL! …or, like, leave. Whatever, man."', 'Deniz']
};
function enterMenu() {
  show('menu'); spireMode = 'menu'; inMenu = true;
  gsap.set(items, { opacity: 0, x: -80 });
  gsap.timeline()
    .from('#menu .logo', { y: -40, opacity: 0, duration: .6, ease: 'power3.out' })
    .to(items, { opacity: 1, x: 0, duration: .45, stagger: .06, ease: 'back.out(1.6)' }, '-=.2')
    .fromTo('.hero', { opacity: 0, x: 120, rotation: 8 }, { opacity: 1, x: 0, rotation: 0, duration: .8, ease: 'power4.out' }, '-=.6')
    .fromTo('.quote-card', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: .4, ease: 'back.out(2.5)' }, '-=.2')
    .to(['.hype-meter', '.menu-foot'], { opacity: 1, duration: .5 }, '-=.3');
  setSel(0, true);
}
function setSel(i, silent) {
  sel = (i + items.length) % items.length;
  items.forEach((el, k) => el.classList.toggle('sel', k === sel));
  if (!silent) { Sfx.tick(); bumpHype(); }
  const [q, w] = QUOTES[items[sel].dataset.action];
  gsap.timeline()
    .to('#quoteCard', { scale: .85, rotation: 0, duration: .08 })
    .add(() => { $('#quoteText').textContent = q; $('#quoteWho').textContent = '— ' + w; })
    .to('#quoteCard', { scale: 1, rotation: gsap.utils.random(-4, 4), duration: .3, ease: 'back.out(3)' });
}
function bumpHype() {
  hype = Math.min(5, hype + .34);
  $$('.hype-pips i').forEach((p, k) => p.classList.toggle('on', k < Math.floor(hype)));
  if (hype >= 5) {
    hype = 0;
    const r = $('.hero').getBoundingClientRect();
    Sfx.boom(); shake(8); pow(r.left + r.width / 2, r.top + 40, 'MVP BABY!', 52);
    gsap.fromTo('.hero-glow', { scale: 1.6, opacity: 1 }, { scale: 1, duration: .8 });
    setTimeout(() => $$('.hype-pips i').forEach(p => p.classList.remove('on')), 500);
  }
}
items.forEach((el, k) => {
  el.addEventListener('mouseenter', () => { if (sel !== k) setSel(k); });
  el.addEventListener('click', e => activate(k, e));
});
function activate(k, e) {
  setSel(k, true);
  const el = items[k], r = el.getBoundingClientRect();
  Sfx.select(); Sfx.crack();
  pow(e && e.clientX ? e.clientX : r.left + r.width * .6, r.top + r.height / 2);
  gsap.fromTo(el, { x: 0 }, { x: 24, duration: .1, yoyo: true, repeat: 1 });
  gsap.fromTo('.hero-bat', { rotation: 0 }, { rotation: -70, duration: .12, yoyo: true, repeat: 1, transformOrigin: '205px 80px', ease: 'power2.in' });
  setTimeout(() => ACTIONS[el.dataset.action](), 260);
}
addEventListener('keydown', e => {
  if (!inMenu) return;
  if ($('#panelWrap').classList.contains('open')) { if (e.key === 'Escape') closePanel(); return; }
  if (['ArrowDown', 's', 'S'].includes(e.key)) { e.preventDefault(); setSel(sel + 1); }
  if (['ArrowUp', 'w', 'W'].includes(e.key)) { e.preventDefault(); setSel(sel - 1); }
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(sel); }
});

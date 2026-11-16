'use strict';
/* =========================================================
   ENTITIES: enemies, training targets, bolts, kinetic balls
   ========================================================= */
const Enemies = [], Bolts = [], Balls = [];

function enemyDie(e) {
  e.dead = true;
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  burst(cx, cy, 22, { colors: ['#f2c14e', '#ff8a2a', '#e8361c', '#f3ead8'], maxSpeed: 520, grav: 900, maxLife: 0.7 });
  for (let i = 0; i < 7; i++) spawnParticle({ x: cx, y: cy, vx: rand(-260, 260), vy: rand(-520, -180), life: rand(0.6, 1.1), size: rand(5, 9),
    color: e.type === 'drone' ? '#6fd3ff' : '#8a8f98', grav: 1600, type: 'debris', rot: rand(0, 6), vr: rand(-14, 14), drag: 0.5 });
  ring(cx, cy, 8, 90, 0.35, '#f3ead8', 6);
  pop(cx, cy - 20, e.type === 'drone' ? 'KRZZT!' : 'KA‑BLAM!', { size: 34 });
  SFX.enemyDie(); addShake(6);
  Game.stats.kills++;
  drillProgress('kills', Game.stats.kills);
}

/* ---------- Scrap Bot: patrols, spots you, winds up, charges ---------- */
class Bot {
  constructor(x, y) {
    Object.assign(this, { type: 'bot', w: 38, h: 32, vx: 0, vy: 0, dir: -1, hp: 5, maxHp: 5, state: 'patrol', t: 0, flash: 0,
      onGround: false, harmful: true, pogoable: true, givesHype: true, anim: rand(0, 5) });
    this.x = x - this.w / 2; this.y = y - this.h;
  }
  groundAhead() {
    const fx = this.dir > 0 ? this.x + this.w + 2 : this.x - 2;
    const tx = Math.floor(fx / TILE), ty = Math.floor((this.y + this.h + 2) / TILE);
    const t = tileAt(tx, ty);
    return (t === 1 || t === 3) && tileAt(tx, ty - 1) !== 2;
  }
  update(dt) {
    const P = Player;
    this.flash = Math.max(0, this.flash - dt); this.t -= dt; this.anim += dt * (1 + Math.abs(this.vx) / 60);
    const pcx = P.x + P.w / 2, cx = this.x + this.w / 2;
    switch (this.state) {
      case 'patrol':
        this.vx = approach(this.vx, this.dir * 70, 600 * dt);
        if (this.onGround && (this.hitWall || !this.groundAhead())) { this.dir *= -1; this.vx = 0; }
        if (!P.dead && Math.abs(pcx - cx) < 260 && Math.abs((P.y + P.h) - (this.y + this.h)) < 70) {
          this.dir = sgn(pcx - cx) || 1; this.state = 'windup'; this.t = 0.42; SFX.windup();
        }
        break;
      case 'windup':
        this.vx = approach(this.vx, 0, 1500 * dt);
        if (this.t <= 0) { this.state = 'charge'; this.t = 1.1; }
        break;
      case 'charge':
        this.vx = this.dir * 250;
        if (Math.random() < 0.4) dust(cx - this.dir * 16, this.y + this.h, 1, -this.dir);
        if (this.hitWall || !this.groundAhead() || this.t <= 0) {
          if (this.hitWall) { addShake(3); burst(cx + this.dir * 20, this.y + 16, 8, { color: '#f2c14e' }); }
          this.state = 'stun'; this.t = 0.6; this.vx = 0;
        }
        break;
      default: // stun / hurt
        this.vx = approach(this.vx, 0, 900 * dt);
        if (this.t <= 0) this.state = 'patrol';
    }
    this.vy = Math.min(this.vy + TUNE.gravity * dt, 900);
    moveBody(this, dt);
  }
  takeHit(dmg, kx) {
    this.hp -= dmg; this.flash = 0.12;
    this.vx = kx * TUNE.knockback; this.vy = -170; this.state = 'hurt'; this.t = 0.28;
    if (this.hp <= 0) enemyDie(this);
    return true;
  }
}

/* ---------- Feral Drone: hovers, stalks, fires bolts ---------- */
class Drone {
  constructor(x, y) {
    Object.assign(this, { type: 'drone', w: 32, h: 26, hx: x, hy: y, vx: 0, vy: 0, hp: 3, maxHp: 3, flash: 0,
      shootT: rand(1.2, 2.2), phase: rand(0, 6), harmful: true, pogoable: true, givesHype: true, windup: false, dropT: 99, engaged: false });
    this.x = x - this.w / 2; this.y = y - this.h / 2;
  }
  update(dt) {
    const P = Player;
    this.phase += dt; this.flash = Math.max(0, this.flash - dt);
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const pcx = P.x + P.w / 2, pcy = P.y + P.h / 2;
    const d = Math.hypot(pcx - cx, pcy - cy);
    this.engaged = d < 440 && !P.dead;
    let tx, ty;
    if (this.engaged) { const side = sgn(cx - pcx) || 1; tx = pcx + side * 150; ty = P.y - 70; }
    else { tx = this.hx + Math.cos(this.phase * 0.6) * 50; ty = this.hy + Math.sin(this.phase * 1.3) * 20; }
    const lx = tx - this.hx, ly = ty - this.hy, ld = Math.hypot(lx, ly);
    if (ld > 380) { tx = this.hx + lx / ld * 380; ty = this.hy + ly / ld * 380; }
    this.vx = approach(this.vx, clamp((tx - cx) * 2.2, -170, 170), 520 * dt);
    this.vy = approach(this.vy, clamp((ty - cy) * 2.2, -170, 170) + Math.sin(this.phase * 4) * 30, 520 * dt);
    moveBody(this, dt);
    if (this.engaged) {
      this.shootT -= dt;
      if (this.shootT < 0.45 && !this.windup) { this.windup = true; SFX.windup(); }
      if (this.shootT <= 0) {
        const dx = pcx - cx, dy = pcy - cy, dd = Math.hypot(dx, dy) || 1;
        Bolts.push(new Bolt(cx, cy + 6, dx / dd * 280, dy / dd * 280));
        SFX.shoot(); this.shootT = rand(1.9, 2.6); this.windup = false;
        this.vx -= dx / dd * 120; this.vy -= dy / dd * 120;
      }
    } else { this.windup = false; this.shootT = Math.max(this.shootT, 0.8); }
  }
  takeHit(dmg, kx, ky) {
    this.hp -= dmg; this.flash = 0.12;
    this.vx = kx * TUNE.knockback * 1.4; this.vy = (ky || -0.4) * TUNE.knockback;
    this.shootT += 0.4; this.windup = false;
    if (this.hp <= 0) enemyDie(this);
    return true;
  }
}

/* ---------- Training Dummy: unkillable, wobbles, counts damage ---------- */
class Dummy {
  constructor(x, y) {
    Object.assign(this, { type: 'dummy', w: 30, h: 58, a: 0, av: 0, flash: 0, harmful: false, pogoable: true, givesHype: true, total: 0 });
    this.x = x - this.w / 2; this.y = y - this.h;
  }
  update(dt) {
    this.flash = Math.max(0, this.flash - dt);
    this.av += (-this.a * 120 - this.av * 7) * dt; this.a += this.av * dt;
  }
  takeHit(dmg, kx, ky) {
    this.flash = 0.12; this.av += (kx || 0) * 9 + (ky ? rand(-4, 4) : 0);
    this.total += dmg;
    pop(this.x + this.w / 2 + rand(-10, 10), this.y - 8, String(dmg), { size: dmg > 1 ? 30 : 22, burst: false, color: dmg > 1 ? '#f2c14e' : '#f3ead8', vy: -90, life: 0.6 });
    SFX.dummy();
    return true;
  }
}

/* ---------- Pogo Lantern: floating bounce target ---------- */
class Orb {
  constructor(x, y) {
    Object.assign(this, { type: 'orb', w: 30, h: 30, flash: 0, harmful: false, pogoable: true, givesHype: false, phase: rand(0, 6), oy: y });
    this.x = x - 15; this.y = y - 15;
  }
  update(dt) { this.phase += dt; this.flash = Math.max(0, this.flash - dt); this.y = this.oy - 15 + Math.sin(this.phase * 2) * 3; }
  takeHit() { this.flash = 0.25; ring(this.x + 15, this.y + 15, 10, 46, 0.3, '#f2c14e', 4); return true; }
}

/* ---------- Drone Bolt ---------- */
class Bolt {
  constructor(x, y, vx, vy) { Object.assign(this, { x, y, vx, vy, r: 8, life: 4, friendly: false, dead: false, t: 0 }); }
  box() { return { x: this.x - this.r - 4, y: this.y - this.r - 4, w: this.r * 2 + 8, h: this.r * 2 + 8 }; }
  update(dt) {
    this.t += dt; this.life -= dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (Math.random() < 0.6) spawnParticle({ x: this.x, y: this.y, life: 0.25, size: rand(2, 4), color: this.friendly ? '#ff8a2a' : '#b98bff', type: 'dot' });
    if (this.life <= 0 || pointSolid(this.x, this.y)) { this.dead = true; burst(this.x, this.y, 8, { color: this.friendly ? '#ff8a2a' : '#b98bff', maxSpeed: 220 }); return; }
    const b = { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 };
    if (this.friendly) {
      for (const e of Enemies) if (!e.dead && e.harmful && overlap(b, e)) {
        e.takeHit(2, sgn(this.vx), sgn(this.vy)); this.dead = true;
        pop(this.x, this.y - 10, 'ZAP!', { size: 30 }); addHitstop(0.06); addShake(5); SFX.hit(true); return;
      }
    } else if (overlap(b, Player.hurtbox())) {
      Player.hurt(sgn(this.vx) || 1); this.dead = true;
    }
  }
  deflect() {
    this.friendly = true; this.life = 2.2;
    let target = null, best = 800;
    for (const e of Enemies) if (!e.dead && e.type === 'drone') {
      const d = Math.hypot(e.x + e.w / 2 - this.x, e.y + e.h / 2 - this.y);
      if (d < best) { best = d; target = e; }
    }
    if (target) {
      const dx = target.x + target.w / 2 - this.x, dy = target.y + target.h / 2 - this.y, d = Math.hypot(dx, dy) || 1;
      this.vx = dx / d * 620; this.vy = dy / d * 620;
    } else { this.vx *= -2; this.vy *= -2; }
    ring(this.x, this.y, 6, 50, 0.3, '#ff8a2a', 4);
    SFX.deflect();
  }
}

/* ---------- Kinetic Baseball ---------- */
class Ball {
  constructor(x, y, vx, vy) { Object.assign(this, { x, y, vx, vy, r: 7, state: 'toss', life: 0.6, spin: 0, dead: false, hitSet: new Set(), trail: [] }); }
  update(dt) {
    this.spin += dt * (this.state === 'shot' ? 40 : 12);
    this.life -= dt;
    if (this.state === 'toss') {
      this.vy = Math.min(this.vy + TUNE.gravity * dt, TUNE.maxFall);
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (this.life <= 0 || pointSolid(this.x, this.y)) this.fizzle();
    } else {
      this.trail.push({ x: this.x, y: this.y }); if (this.trail.length > 10) this.trail.shift();
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (Math.random() < 0.8) spawnParticle({ x: this.x, y: this.y, vx: rand(-40, 40), vy: rand(-40, 40), life: 0.3, size: rand(2, 4), color: Math.random() < 0.5 ? '#ff8a2a' : '#f2c14e', type: 'dot' });
      const b = { x: this.x - 10, y: this.y - 10, w: 20, h: 20 };
      for (const e of Enemies) if (!e.dead && !this.hitSet.has(e) && overlap(b, e) && e.type !== 'orb') {
        this.hitSet.add(e); e.takeHit(2, sgn(this.vx), sgn(this.vy));
        if (e.givesHype) Player.gainHype(TUNE.hypePerHit);
        pop(this.x, this.y - 12, 'FASTBALL!', { size: 28 }); addHitstop(0.05); addShake(5); SFX.hit(true);
      }
      if (this.life <= 0 || pointSolid(this.x, this.y)) { burst(this.x, this.y, 12, { color: '#f3ead8', maxSpeed: 300 }); this.dead = true; }
    }
  }
  shoot(ax, ay) { this.state = 'shot'; this.life = 0.5; this.vx = ax * 1600; this.vy = ay * 1600; }
  fizzle() { this.dead = true; dust(this.x, this.y, 4); }
}

function makeEnemy(s) {
  switch (s.type) {
    case 'bot': return new Bot(s.x, s.y);
    case 'drone': return new Drone(s.x, s.y);
    case 'dummy': return new Dummy(s.x, s.y);
    case 'orb': return new Orb(s.x, s.y);
  }
}
function resetEnemies() {
  Enemies.length = 0; Bolts.length = 0; Balls.length = 0;
  LEVEL.enemies.forEach(s => Enemies.push(makeEnemy(s)));
}

'use strict';
/* =========================================================
   PLAYER: Nathan — movement, bat, kinetic baseballs, Hype
   ========================================================= */
const Player = {
  w: 22, h: 44,

  reset(pos, keepHype) {
    Object.assign(this, {
      x: pos.x - this.w / 2, y: pos.y - this.h, vx: 0, vy: 0, facing: 1,
      hp: 5, maxHp: 5, hype: keepHype ? this.hype || 0 : 0,
      onGround: false, landed: false, hitWall: 0, hitCeil: false,
      coyoteT: 0, bufT: 0, jumping: false, canDouble: true, canDash: true,
      dashT: 0, dashCD: 0, dashDir: 1, wallDir: 0, wallLock: 0, wallCoyote: 0, wallLastDir: 0, sliding: false,
      attackT: 0, attackDur: 0.2, attackType: 'fwd', comboIdx: 0, comboWindow: 0, attackCD: 0, hitSet: new Set(), pogoed: false,
      recoilT: 0, launchT: 0, launched: false, balls: TUNE.ballCount, invuln: 0, healT: 0, healTick: 0,
      dead: false, hazard: false, sx: 1, sy: 1, runPhase: 0, stepFlip: false, afterT: 0,
      lastSafe: { x: pos.x - this.w / 2, y: pos.y - this.h }, pogoChain: 0, dropT: 0, lookT: 0
    });
  },

  hurtbox() { return { x: this.x + 3, y: this.y + 4, w: this.w - 6, h: this.h - 6 }; },
  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; },
  gainHype(n) { this.hype = Math.min(99, this.hype + n); },

  update(dt) {
    if (this.dead || this.hazard) return;
    const L = Input.down('left'), R = Input.down('right'), U = Input.down('up'), D = Input.down('down');
    const ix = (R ? 1 : 0) - (L ? 1 : 0);

    // timers
    this.coyoteT -= dt; this.bufT -= dt; this.dashCD -= dt; this.wallLock -= dt; this.attackCD -= dt;
    this.comboWindow -= dt; this.invuln -= dt; this.recoilT -= dt; this.launchT -= dt; this.dropT -= dt; this.wallCoyote -= dt;
    if (Input.pressed('jump')) this.bufT = TUNE.jumpBuffer;
    if (OPT.infHype) this.hype = 99;

    /* ----- Heal (hold) ----- */
    const canHeal = this.onGround && this.attackT <= 0 && this.dashT <= 0 && this.hype >= TUNE.healCost;
    if (Input.down('heal') && canHeal) {
      this.healT += dt; this.healTick -= dt;
      const p = this.healT / TUNE.healTime;
      if (this.healTick <= 0) { SFX.healCharge(p); this.healTick = 0.08; }
      const c = this.center(), a = rand(0, Math.PI * 2), r = rand(40, 70);
      spawnParticle({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, vx: -Math.cos(a) * r * 4, vy: -Math.sin(a) * r * 4, life: 0.22, size: rand(2, 4), color: Math.random() < 0.5 ? '#e8361c' : '#f2c14e', type: 'dot' });
      if (this.healT >= TUNE.healTime) this.doHeal();
    } else this.healT = 0;
    const healing = this.healT > 0;

    /* ----- Dash ----- */
    if (Input.pressed('dash') && this.dashCD <= 0 && this.dashT <= 0 && (this.onGround || this.canDash) && !healing) {
      this.dashT = TUNE.dashTime; this.dashCD = TUNE.dashCooldown + TUNE.dashTime;
      this.dashDir = ix || this.facing; this.facing = this.dashDir;
      if (!this.onGround) { this.canDash = false; drill('dash'); }
      this.launched = false; this.jumping = false; this.attackT = 0;
      this.sx = 1.4; this.sy = 0.7;
      SFX.dash(); burst(this.x + this.w / 2, this.y + this.h / 2, 10, { angle: this.dashDir > 0 ? Math.PI : 0, spread: 0.5, color: '#f3ead8', maxSpeed: 300 });
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashDir * TUNE.dashSpeed; this.vy = 0;
      if (this.dashT <= 0) this.vx = this.dashDir * TUNE.runSpeed;
    } else {
      /* ----- Horizontal ----- */
      if (healing) this.vx = approach(this.vx, 0, TUNE.groundDecel * dt);
      else if (this.recoilT > 0 || this.wallLock > 0) { /* momentum locked */ }
      else if (this.launched && Math.abs(this.vx) > TUNE.runSpeed && (ix === 0 || ix === sgn(this.vx))) {
        this.vx -= sgn(this.vx) * TUNE.launchDrag * dt;
      } else {
        const target = ix * TUNE.runSpeed;
        let acc;
        if (this.onGround) acc = ix !== 0 ? (this.vx !== 0 && sgn(this.vx) !== ix ? TUNE.groundDecel + TUNE.groundAccel * 0.5 : TUNE.groundAccel) : TUNE.groundDecel;
        else acc = TUNE.airAccel;
        this.vx = approach(this.vx, target, acc * dt);
      }
      if (ix !== 0 && this.attackT <= 0 && this.wallLock <= 0 && !healing) this.facing = ix;

      /* ----- Gravity & variable jump ----- */
      let g = TUNE.gravity;
      if (this.vy > 0) g *= TUNE.fallMult;
      if (this.launchT > 0) g *= 0.25;
      if (this.jumping && !Input.down('jump') && this.vy < 0) { this.vy *= TUNE.jumpCut; this.jumping = false; }
      if (this.vy >= 0) this.jumping = false;
      this.vy += g * dt;

      /* ----- Wall slide ----- */
      this.wallDir = 0;
      if (!this.onGround) { if (touchingWall(this, 1)) this.wallDir = 1; else if (touchingWall(this, -1)) this.wallDir = -1; }
      this.sliding = this.wallDir !== 0 && ix === this.wallDir && this.vy > 0;
      if (this.sliding) {
        this.vy = Math.min(this.vy, TUNE.wallSlide);
        this.canDouble = true; this.canDash = true; this.launched = false;
        this.wallCoyote = 0.1; this.wallLastDir = this.wallDir; this.facing = this.wallDir;
        if (Math.random() < 0.3) spawnParticle({ x: this.wallDir > 0 ? this.x + this.w : this.x, y: this.y + rand(4, 20), vx: -this.wallDir * rand(20, 60), vy: rand(-30, 10), life: 0.3, size: rand(2, 3), color: '#f3ead8', type: 'dot' });
      }
      this.vy = Math.min(this.vy, TUNE.maxFall);
    }

    /* ----- Jump: ground / coyote · wall · double ----- */
    if (this.bufT > 0 && !healing) {
      const under = standingOn(this);
      const onOneWay = this.onGround && under.includes(3) && !under.includes(1);
      if (this.onGround && onOneWay && D) {
        this.dropT = 0.25; this.y += 2; this.onGround = false; this.bufT = 0; this.coyoteT = 0;
      } else if (this.onGround || this.coyoteT > 0) {
        this.vy = -TUNE.jumpVel; this.jumping = true; this.coyoteT = 0; this.bufT = 0; this.dashT = 0;
        this.sx = 0.72; this.sy = 1.3; SFX.jump(); dust(this.x + this.w / 2, this.y + this.h, 5);
      } else if (this.wallDir !== 0 || this.wallCoyote > 0) {
        const wd = this.wallDir || this.wallLastDir;
        this.vy = -TUNE.wallJumpY; this.vx = -wd * TUNE.wallJumpX; this.facing = -wd;
        this.wallLock = TUNE.wallJumpLock; this.jumping = true; this.bufT = 0; this.wallCoyote = 0; this.dashT = 0; this.launched = false;
        this.sx = 0.75; this.sy = 1.25;
        SFX.walljump(); burst(wd > 0 ? this.x + this.w : this.x, this.y + this.h / 2, 8, { angle: wd > 0 ? Math.PI : 0, spread: 0.8, color: '#f3ead8', maxSpeed: 260 });
        Game.stats.wallJumps++; drillProgress('wall', Game.stats.wallJumps);
      } else if (this.canDouble && TUNE.doubleJumpVel > 0) {
        this.vy = -TUNE.doubleJumpVel; this.canDouble = false; this.jumping = true; this.bufT = 0; this.dashT = 0;
        this.sx = 0.75; this.sy = 1.25;
        SFX.djump(); ring(this.x + this.w / 2, this.y + this.h, 6, 34, 0.25, '#f3ead8', 4); drill('double');
      }
    }

    /* ----- Swing / Bat-Launch ----- */
    this.atkBuf = (this.atkBuf || 0) - dt;
    if (Input.pressed('attack')) this.atkBuf = 0.14;
    if (this.atkBuf > 0 && this.attackCD <= 0 && !healing) {
      this.atkBuf = 0;
      const c = this.center();
      const ball = Balls.find(b => b.state === 'toss' && !b.dead);
      if (ball && Math.hypot(ball.x - c.x, ball.y - c.y) < TUNE.connectRange) this.batLaunch(ball, ix, U, D);
      else this.startSwing(U, D);
    }
    if (this.attackT > 0) {
      this.attackT -= dt;
      const el = this.attackDur - this.attackT;
      if (this.attackType !== 'launch' && el >= 0.012 && el <= 0.13) this.checkHits();
    }

    /* ----- Toss a ball ----- */
    if (Input.pressed('ball') && this.balls > 0 && !healing && !Balls.some(b => b.state === 'toss' && !b.dead)) {
      this.balls--;
      const vy = this.onGround ? -430 : this.vy * 0.9 - 240;
      Balls.push(new Ball(this.x + this.w / 2 + this.facing * 14, this.y + 8, this.vx * 0.9 + this.facing * 50, vy));
      SFX.toss();
    }

    /* ----- Move & resolve ----- */
    moveBody(this, dt);

    if (this.onGround) {
      if (this.landed) {
        SFX.land(); dust(this.x + this.w / 2, this.y + this.h, this.vyBeforeLand > 700 ? 10 : 5);
        this.sx = 1.28; this.sy = 0.76;
      }
      this.coyoteT = TUNE.coyote; this.canDouble = true; this.canDash = true; this.launched = false; this.launchT = 0;
      this.balls = TUNE.ballCount; this.pogoChain = 0;
      const [a, b] = standingOn(this);
      if (a === 1 && b === 1 && !rectHitsSpikes({ x: this.x - 48, y: this.y, w: this.w + 96, h: this.h + 6 })) this.lastSafe = { x: this.x, y: this.y };
      const ch = LEVEL.chasmPlatform;
      if (this.x > ch.x0 && this.x < ch.x1 && Math.abs(this.y + this.h - ch.y) < 2) drill('chasm');
    }
    this.vyBeforeLand = this.vy || this.vyBeforeLand;
    if (this.hitWall && this.launched) this.launched = false;
    if (this.hitCeil) this.jumping = false;

    /* ----- Hazards ----- */
    if (rectHitsSpikes(this.hurtbox())) this.hitSpikes();

    /* ----- Animation bookkeeping ----- */
    const k = 1 - Math.exp(-14 * dt);
    this.sx = lerp(this.sx, 1, k); this.sy = lerp(this.sy, 1, k);
    if (this.onGround && Math.abs(this.vx) > 20) {
      const before = Math.sin(this.runPhase);
      this.runPhase += dt * Math.abs(this.vx) / 20;
      if (sgn(before) !== sgn(Math.sin(this.runPhase))) { SFX.step(); if (Math.random() < 0.5) dust(this.x + this.w / 2, this.y + this.h, 1, -this.facing); }
    }
    this.afterT -= dt;
    if ((this.dashT > 0 || this.launchT > 0 || (this.launched && Math.hypot(this.vx, this.vy) > 650)) && this.afterT <= 0) {
      Game.afterimages.push({ x: this.x, y: this.y, facing: this.facing, life: 0.22, max: 0.22, color: this.launched ? '#ff8a2a' : '#f3ead8' });
      this.afterT = 0.022;
    }
    // look up / down when standing still
    if (this.onGround && Math.abs(this.vx) < 5 && (U || D) && this.attackT <= 0 && !healing) this.lookT += dt; else this.lookT = 0;
    Game.cam.lookY = this.lookT > 0.45 ? (U ? -150 : 150) : 0;
  },

  startSwing(U, D) {
    const type = U ? 'up' : (D && !this.onGround) ? 'down' : 'fwd';
    if (type === 'fwd') this.comboIdx = this.comboWindow > 0 ? (this.comboIdx % 3) + 1 : 1;
    else this.comboIdx = 0;
    this.attackType = type; this.attackDur = this.comboIdx === 3 ? 0.24 : 0.2; this.attackT = this.attackDur;
    this.attackCD = TUNE.attackCooldown * (this.comboIdx === 3 ? 1.45 : 1);
    this.comboWindow = TUNE.attackCooldown + TUNE.comboWindow;
    this.hitSet = new Set(); this.pogoed = false; this.dashT = 0;
    SFX.swing(this.comboIdx);
  },

  hitbox() {
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2, R = TUNE.batReach;
    if (this.attackType === 'up') return { x: cx - 30, y: this.y - R + 10, w: 60, h: R };
    if (this.attackType === 'down') return { x: cx - 28, y: this.y + this.h - 10, w: 56, h: R };
    const h = this.comboIdx === 3 ? 62 : 48, w = R + (this.comboIdx === 3 ? 10 : 0);
    return { x: this.facing > 0 ? cx + 4 : cx - 4 - w, y: cy - h / 2 - 6, w, h };
  },

  checkHits() {
    const hb = this.hitbox();
    let any = false, pogo = false, heavy = this.comboIdx === 3;
    const c = this.center();
    for (const e of Enemies) {
      if (e.dead || this.hitSet.has(e) || !overlap(hb, e)) continue;
      this.hitSet.add(e);
      const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
      const kx = this.attackType === 'fwd' ? this.facing : (sgn(ecx - c.x) || this.facing);
      const ky = this.attackType === 'up' ? -1 : this.attackType === 'down' ? 1 : 0;
      e.takeHit(heavy ? 2 : 1, kx, ky, this.attackType);
      any = true;
      if (e.givesHype) this.gainHype(TUNE.hypePerHit * (heavy ? 1.5 : 1));
      if (this.attackType === 'down' && e.pogoable) pogo = true;
      const hx = clamp(ecx, hb.x, hb.x + hb.w), hy = clamp(ecy, hb.y, hb.y + hb.h);
      burst(hx, hy, heavy ? 16 : 9, { angle: Math.atan2(ky, kx || 0.0001), spread: 1, colors: ['#f3ead8', '#f2c14e', '#ff8a2a'], maxSpeed: heavy ? 620 : 440, type: 'spark' });
      if (e.type !== 'dummy' || heavy) if (heavy || Math.random() < 0.3) pop(hx, hy - 14, null, { size: heavy ? 38 : 28 });
      if (heavy && e.type !== 'orb') drill('combo');
      if (e.type !== 'orb') { Game.combo++; Game.comboT = 1.6; }
    }
    for (const b of Bolts) {
      if (b.dead || b.friendly || this.hitSet.has(b) || !overlap(hb, b.box())) continue;
      this.hitSet.add(b); any = true; this.gainHype(5);
      if (this.attackType === 'down') { b.dead = true; pogo = true; burst(b.x, b.y, 10, { color: '#b98bff' }); }
      else { b.deflect(); drill('deflect'); pop(b.x, b.y - 16, 'DEFLECT!', { size: 30, color: '#6fd3ff' }); }
    }
    if (this.attackType === 'down' && !this.pogoed && rectHitsSpikes(hb, 6)) {
      pogo = true; burst(c.x, this.y + this.h + 16, 8, { color: '#f3ead8', angle: -Math.PI / 2, spread: 1 });
    }
    if (pogo && !this.pogoed) this.pogo();
    if (any) {
      addHitstop(TUNE.hitstop * (heavy ? 1.8 : 1)); addShake(heavy ? 7 : 4); SFX.hit(heavy);
      if (this.attackType === 'fwd') { this.recoilT = 0.07; this.vx = -this.facing * (this.onGround ? 170 : 130); }
    }
  },

  pogo() {
    this.pogoed = true; this.vy = -TUNE.pogoVel; this.jumping = false;
    this.canDouble = true; this.canDash = true; this.launched = false; this.dashT = 0;
    this.pogoChain++; drillProgress('pogo', this.pogoChain);
    this.sx = 0.75; this.sy = 1.3;
    SFX.pogo(); ring(this.x + this.w / 2, this.y + this.h + 16, 6, 40, 0.25, '#f2c14e', 4);
    if (this.pogoChain >= 2) pop(this.x + this.w / 2, this.y + this.h + 10, 'BOING ×' + this.pogoChain, { size: 22, burst: false, color: '#f2c14e', vy: 30 });
  },

  batLaunch(ball, ix, U, D) {
    let ax = ix, ay = U ? -1 : D ? 1 : 0;
    if (ax === 0 && ay === 0) { ax = this.facing; ay = -1; }
    else if (ay === 0) ay = -0.3;
    const len = Math.hypot(ax, ay); ax /= len; ay /= len;
    this.vx = ax * TUNE.launchSpeed; this.vy = ay * TUNE.launchSpeed;
    this.launchT = TUNE.launchFloat; this.launched = true; this.jumping = false; this.dashT = 0;
    this.canDouble = true; this.canDash = true;
    if (ax) this.facing = sgn(ax);
    this.attackType = 'launch'; this.attackDur = 0.2; this.attackT = 0.2; this.attackCD = 0.16; this.comboIdx = 0;
    this.sx = 1.35; this.sy = 0.7;
    const c = this.center();
    ball.x = c.x + ax * 16; ball.y = c.y + ay * 16; ball.shoot(ax, ay);
    addHitstop(0.07); addShake(9);
    SFX.launch();
    pop(ball.x, ball.y - 10, 'CRACK!', { size: 42 });
    ring(c.x, c.y, 8, 70, 0.3, '#ff8a2a', 6);
    burst(c.x, c.y, 18, { angle: Math.atan2(-ay, -ax), spread: 0.9, colors: ['#e8361c', '#ff8a2a', '#f2c14e'], maxSpeed: 520 });
    drill('launch');
  },

  doHeal() {
    this.healT = 0;
    this.hp = Math.min(this.maxHp, this.hp + 1);
    if (!OPT.infHype) this.hype -= TUNE.healCost;
    const c = this.center();
    for (const e of Enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x + e.w / 2 - c.x, e.y + e.h / 2 - c.y);
      if (d < 160 && e.type !== 'orb') e.takeHit(1, sgn(e.x + e.w / 2 - c.x) || 1, -1);
    }
    ring(c.x, this.y + this.h, 10, 180, 0.5, '#e8361c', 10);
    ring(c.x, this.y + this.h, 10, 130, 0.4, '#f2c14e', 5);
    burst(c.x, this.y + this.h, 30, { angle: -Math.PI / 2, spread: 1.4, colors: ['#e8361c', '#ff8a2a', '#f2c14e'], maxSpeed: 600, grav: 900 });
    pop(c.x, this.y - 30, 'MVP BABY!', { size: 44, rot: -0.08 });
    addShake(10); addHitstop(0.09); Game.flashWhite = 0.35;
    this.sx = 1.3; this.sy = 0.75;
    SFX.heal(); drill('heal'); HUD.hpPop = true;
  },

  hurt(dir) {
    if (this.invuln > 0 || this.dead || this.hazard || OPT.god) return;
    this.hp--; this.invuln = 1.1;
    this.vx = dir * 360; this.vy = -420; this.recoilT = 0.15;
    this.launched = false; this.dashT = 0; this.attackT = 0; this.healT = 0; this.jumping = false;
    addHitstop(0.16); addShake(12); Game.flashRed = 0.6; Game.combo = 0;
    SFX.hurt();
    const c = this.center();
    burst(c.x, c.y, 16, { colors: ['#e8361c', '#0d0b10', '#f3ead8'], maxSpeed: 420, grav: 600 });
    pop(c.x, this.y - 18, 'OOF!', { size: 34, color: '#f3ead8', burstColor: '#0d0b10' });
    if (this.hp <= 0) this.die();
  },

  hitSpikes() {
    if (!OPT.god) this.hp--;
    Game.flashRed = 0.6; addShake(10); addHitstop(0.12); SFX.spike();
    const c = this.center();
    pop(c.x, this.y - 18, 'YOWCH!', { size: 34, color: '#f3ead8', burstColor: '#0d0b10' });
    burst(c.x, c.y, 14, { colors: ['#e8361c', '#f3ead8'], maxSpeed: 380, grav: 800 });
    if (this.hp <= 0) { this.die(); return; }
    this.hazard = true; this.vx = 0; this.vy = 0; this.attackT = 0; this.launched = false;
    Game.hazardT = 0.55; Game.fadeTarget = 1;
  },

  die() {
    this.dead = true; this.hp = 0; Game.combo = 0;
    SFX.die();
    const c = this.center();
    pop(c.x, this.y - 40, 'STRIKE OUT!', { size: 54, life: 1.3, rot: -0.1 });
    burst(c.x, c.y, 40, { colors: ['#e8361c', '#ff8a2a', '#0d0b10'], maxSpeed: 600, grav: 900, maxLife: 0.9 });
    Game.respawnT = 1.5;
    setTimeout(() => { Game.fadeTarget = 1; }, 700);
  }
};

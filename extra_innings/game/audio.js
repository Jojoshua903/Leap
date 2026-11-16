'use strict';
/* =========================================================
   Synthesized sound effects (no audio files needed)
   ========================================================= */
const SFX = (() => {
  let ctx = null, master = null, vol = 0.7;
  try { const v = localStorage.getItem('mpz_vol'); if (v !== null) vol = +v; } catch (e) {}

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = vol * 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      return true;
    } catch (e) { return false; }
  }

  function tone(freq, dur, type = 'square', v = 0.15, slideTo = null, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
  }

  let noiseBuf = null;
  function noise(dur, v = 0.3, filter = 'highpass', freq = 800, decay = 3, delay = 0) {
    if (!ctx) return;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = filter; f.frequency.value = freq;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  return {
    ensure,
    get volume() { return vol; },
    set volume(v) { vol = v; if (master) master.gain.value = v * 0.55; try { localStorage.setItem('mpz_vol', v); } catch (e) {} },
    jump()   { tone(260, 0.12, 'square', 0.06, 520); },
    djump()  { tone(420, 0.14, 'square', 0.06, 900); noise(0.12, 0.05, 'highpass', 3000); },
    walljump(){ tone(320, 0.1, 'square', 0.06, 700); noise(0.06, 0.08, 'bandpass', 1800); },
    land()   { noise(0.08, 0.12, 'lowpass', 500); },
    step()   { noise(0.03, 0.03, 'bandpass', 1400); },
    dash()   { noise(0.22, 0.18, 'bandpass', 2400); tone(700, 0.15, 'sawtooth', 0.03, 200); },
    swing(n) { noise(0.13, 0.12, 'highpass', 2200 + n * 500); },
    hit(heavy) { noise(0.16, 0.38, 'highpass', 900); tone(heavy ? 120 : 170, 0.16, 'sine', 0.3, 50); if (heavy) noise(0.3, 0.2, 'lowpass', 300); },
    dummy()  { noise(0.1, 0.22, 'bandpass', 700); tone(110, 0.1, 'triangle', 0.18, 70); },
    pogo()   { tone(300, 0.16, 'square', 0.08, 900); noise(0.08, 0.15, 'highpass', 1500); },
    toss()   { tone(500, 0.08, 'triangle', 0.08, 760); },
    launch() { noise(0.3, 0.5, 'highpass', 1000); tone(150, 0.35, 'sine', 0.4, 40); tone(900, 0.25, 'sawtooth', 0.04, 2400); },
    deflect(){ tone(1200, 0.18, 'square', 0.07, 2400); noise(0.08, 0.2, 'highpass', 3000); },
    hurt()   { tone(220, 0.3, 'sawtooth', 0.15, 60); noise(0.25, 0.3, 'lowpass', 600); },
    die()    { tone(300, 0.9, 'sawtooth', 0.15, 40); noise(0.9, 0.3, 'lowpass', 300); },
    healCharge(p) { tone(180 + p * 500, 0.06, 'triangle', 0.04); },
    heal()   { noise(0.7, 0.45, 'lowpass', 200); tone(80, 0.6, 'sine', 0.5, 30); tone(440, 0.4, 'square', 0.05, 880, 0.05); tone(660, 0.4, 'square', 0.05, 1320, 0.12); },
    enemyDie(){ noise(0.5, 0.4, 'lowpass', 800); tone(400, 0.4, 'square', 0.08, 50); },
    shoot()  { tone(900, 0.2, 'sine', 0.06, 300); },
    windup() { tone(200, 0.35, 'sawtooth', 0.04, 600); },
    bench()  { [523, 659, 784].forEach((f, i) => tone(f, 0.35, 'triangle', 0.08, null, i * 0.09)); },
    drill()  { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.22, 'square', 0.05, null, i * 0.07)); },
    ui()     { tone(660, 0.05, 'square', 0.04); },
    spike()  { noise(0.2, 0.3, 'highpass', 1600); tone(500, 0.2, 'sawtooth', 0.1, 120); }
  };
})();

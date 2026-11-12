import * as THREE from 'three';

interface Burst { points: THREE.Points; vel: Float32Array; life: number }

const CONFETTI_COLORS = ['#ff5a5f', '#ffd23a', '#3bb37a', '#3ff2ff', '#ff4fd8', '#2f8fd8', '#ffffff'].map(c => new THREE.Color(c));
const TRAIL_N = 48;

export type TrailStyle = 'classic' | 'sparkle' | 'rainbow' | 'fire';

/** Juice: confetti, screen flash, big text, and the fading ball trail ribbon. `calm` (reduced motion) skips flashes and shrinks bursts. */
export class Effects {
  private readonly bursts: Burst[] = [];
  private readonly flashEl: HTMLDivElement;
  private readonly bigEl: HTMLDivElement;
  private bigTimer = 0;
  private flashT = 0;
  calm = false;
  private trailStyle: TrailStyle = 'classic';
  private sparkT = 0;
  private readonly tmpC = new THREE.Color();

  // trail ribbon: two vertices per point, RGBA vertex colours for the fade
  private readonly trail: THREE.Mesh;
  private readonly trailPts: THREE.Vector3[] = [];
  private readonly trailPos: Float32Array;
  private readonly trailCol: Float32Array;
  private readonly trailColor = new THREE.Color('#ffffff');

  constructor(private readonly scene: THREE.Scene, overlay: HTMLElement) {
    this.flashEl = document.createElement('div'); this.flashEl.className = 'fx-flash'; overlay.appendChild(this.flashEl);
    this.bigEl = document.createElement('div'); this.bigEl.className = 'fx-big'; overlay.appendChild(this.bigEl);

    const geo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL_N * 2 * 3);
    this.trailCol = new Float32Array(TRAIL_N * 2 * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 4));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.trail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
  }

  /** Confetti burst (Three.js Points) from a world position. */
  confetti(at: THREE.Vector3, count = 220, power = 1): void {
    if (this.calm) { count = Math.round(count * 0.3); power *= 0.6; }
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
      const c = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      const a = Math.random() * Math.PI * 2, up = 1.5 + Math.random() * 3;
      vel[i * 3] = Math.cos(a) * (0.5 + Math.random() * 1.6) * power;
      vel[i * 3 + 1] = up * power;
      vel[i * 3 + 2] = Math.sin(a) * (0.5 + Math.random() * 1.6) * power + 0.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, depthWrite: false }));
    this.scene.add(points);
    this.bursts.push({ points, vel, life: 0 });
  }

  flash(color = '#ffffff', strength = 0.75): void {
    if (this.calm) return;
    this.flashEl.style.background = color;
    this.flashEl.style.opacity = String(strength);
    this.flashT = 0.35;
  }

  bigText(text: string, sub = '', kind: 'strike' | 'spare' | 'normal' | 'miss' | 'bonus' = 'normal'): void {
    this.bigEl.className = `fx-big show ${kind}${this.calm ? ' calm' : ''}`;
    this.bigEl.innerHTML = '';
    const main = document.createElement('div'); main.className = 'fx-big-main'; main.textContent = text;
    this.bigEl.appendChild(main);
    if (sub) { const s = document.createElement('div'); s.className = 'fx-big-sub'; s.textContent = sub; this.bigEl.appendChild(s); }
    this.bigTimer = 1.7;
  }

  setTrailColor(c: string): void { this.trailColor.set(c); }
  setTrailStyle(s: TrailStyle): void { this.trailStyle = s; }

  /** Add the ball position each render frame while it rolls; pass null to let the trail fade out. dt drives sparkles. */
  trailPush(p: THREE.Vector3 | null, dt = 1 / 60): void {
    if (p) {
      this.trailPts.unshift(new THREE.Vector3(p.x, 0.012, p.z));
      if (this.trailPts.length > TRAIL_N) this.trailPts.pop();
      // Sparkle and Fire trails throw off a few particles while rolling
      if ((this.trailStyle === 'sparkle' || this.trailStyle === 'fire') && !this.calm) {
        this.sparkT += dt;
        if (this.sparkT > 0.05) {
          this.sparkT = 0;
          this.confetti(new THREE.Vector3(p.x, 0.05, p.z), 6, 0.25);
        }
      }
    } else if (this.trailPts.length) this.trailPts.pop();
    this.rebuildTrail();
  }

  clearTrail(): void { this.trailPts.length = 0; this.rebuildTrail(); }

  private trailColourAt(i: number): THREE.Color {
    const c = this.tmpC;
    switch (this.trailStyle) {
      case 'rainbow': return c.setHSL(((i / TRAIL_N) * 0.85 + performance.now() / 4000) % 1, 0.9, 0.6);
      case 'fire': return c.setRGB(1, Math.max(0.15, 0.85 - i / TRAIL_N), 0.1 * (1 - i / TRAIL_N));
      case 'sparkle': return c.copy(this.trailColor).lerp(new THREE.Color('#ffffff'), 0.55);
      default: return c.copy(this.trailColor);
    }
  }

  private rebuildTrail(): void {
    const n = this.trailPts.length, w = this.trailStyle === 'fire' ? 0.12 : 0.09;
    const peak = this.trailStyle === 'classic' ? 0.55 : 0.75;
    for (let i = 0; i < TRAIL_N; i++) {
      const p = this.trailPts[Math.min(i, Math.max(0, n - 1))];
      const fade = n > 1 && i < n ? (1 - i / n) * peak : 0;
      const col = this.trailColourAt(i);
      for (let s = 0; s < 2; s++) {
        const v = (i * 2 + s);
        this.trailPos[v * 3] = p ? p.x + (s ? w : -w) * (1 - i / TRAIL_N) : 0;
        this.trailPos[v * 3 + 1] = p ? p.y : -10;
        this.trailPos[v * 3 + 2] = p ? p.z : 0;
        this.trailCol[v * 4] = col.r; this.trailCol[v * 4 + 1] = col.g; this.trailCol[v * 4 + 2] = col.b;
        this.trailCol[v * 4 + 3] = fade;
      }
    }
    const g = this.trail.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number): void {
    for (let b = this.bursts.length - 1; b >= 0; b--) {
      const burst = this.bursts[b];
      burst.life += dt;
      const attr = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array, v = burst.vel;
      for (let i = 0; i < v.length; i += 3) {
        v[i + 1] -= 4.5 * dt;                      // gentle gravity, confetti floats
        v[i] *= 0.985; v[i + 2] *= 0.985;
        arr[i] += v[i] * dt; arr[i + 1] += v[i + 1] * dt; arr[i + 2] += v[i + 2] * dt;
        if (arr[i + 1] < 0.01) { arr[i + 1] = 0.01; v[i + 1] = 0; v[i] *= 0.8; v[i + 2] *= 0.8; }
      }
      attr.needsUpdate = true;
      (burst.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - Math.max(0, burst.life - 1.8) / 0.8);
      if (burst.life > 2.6) {
        this.scene.remove(burst.points);
        burst.points.geometry.dispose();
        (burst.points.material as THREE.Material).dispose();
        this.bursts.splice(b, 1);
      }
    }
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      if (this.flashT === 0) this.flashEl.style.opacity = '0';
    }
    if (this.bigTimer > 0) {
      this.bigTimer -= dt;
      if (this.bigTimer <= 0) this.bigEl.classList.remove('show');
    }
  }

  dispose(): void {
    for (const b of this.bursts) { this.scene.remove(b.points); b.points.geometry.dispose(); (b.points.material as THREE.Material).dispose(); }
    this.bursts.length = 0;
    this.trail.geometry.dispose();
    (this.trail.material as THREE.Material).dispose();
    this.scene.remove(this.trail);
    this.flashEl.remove();
    this.bigEl.remove();
  }
}

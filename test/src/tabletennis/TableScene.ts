import * as THREE from 'three';
import { addOutline, glow, toon } from '../render/Toon';
import { QUALITY, type QualityLevel } from '../core/Quality';
import { Rng, TABLE_HALF_LENGTH, TABLE_HALF_WIDTH, type V3 } from './BallPhysics';
import type { Target } from './BallMachine';
import { BALL, TABLE } from './ttTuning';

export type TableLook = 'blue' | 'green' | 'night' | 'beach';
export type HallTheme = 'island' | 'arena';
export type CamMode = 'intro' | 'play' | 'pushIn' | 'side';

const LOOKS: Record<TableLook, { top: string; line: string; glowLines: boolean }> = {
  blue: { top: '#1f5fb8', line: '#ffffff', glowLines: false },
  green: { top: '#2e8b57', line: '#ffffff', glowLines: false },
  night: { top: '#1c2340', line: '#3ff2ff', glowLines: true },
  beach: { top: '#2fb6d6', line: '#fff6c8', glowLines: false }
};

const HALLS: Record<HallTheme, { sky: string; fog: string; floor: string; court: string; wall: string; hemi: number; sun: number; roof: boolean }> = {
  island: { sky: '#8fd6ff', fog: '#bfe9ff', floor: '#8a96a3', court: '#3f9a5e', wall: '#e9f3f8', hemi: 1.9, sun: 2.3, roof: false },
  arena: { sky: '#1e2840', fog: '#1e2840', floor: '#5b6472', court: '#2f6d4f', wall: '#2b3550', hemi: 1.1, sun: 2.8, roof: true }
};

const BANNER_COLORS = ['#ff5a5f', '#ffd23a', '#3bb37a', '#2f8fd8', '#ff8a3c', '#7a5cff'];
const TRAIL_N = 26;
const RINGS = 6;

/**
 * Everything you see in a table-tennis match except the players: hall (open-air island court or an
 * indoor arena), the toon table with lines, net and posts, banners, an instanced crowd that bounces
 * with the rally, the ball with its shadow, trail and bounce rings, Return Challenge targets, and
 * the camera rig. Primitives and canvas textures only.
 */
export class TableScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.03, 80);
  calm = false;
  mode: CamMode = 'intro';

  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly sun: THREE.DirectionalLight;
  private readonly ball: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly trail: THREE.Mesh;
  private readonly trailPts: THREE.Vector3[] = [];
  private readonly trailPos: Float32Array;
  private readonly trailCol: Float32Array;
  private trailStrength = 0.3;
  private readonly rings: Array<{ mesh: THREE.Mesh; t: number }> = [];
  private readonly targetGroup = new THREE.Group();
  private targets: Array<{ mesh: THREE.Mesh; inner: THREE.Mesh; hitT: number }> = [];
  private crowd: THREE.InstancedMesh | null = null;
  private heads: THREE.InstancedMesh | null = null;
  private crowdBase: Array<{ x: number; y: number; z: number; phase: number; speed: number }> = [];
  private excitement = 0;
  private excitementT = 0;
  private t = 0;
  private shakeAmp = 0;
  private readonly pos = new THREE.Vector3(2.4, 2.2, 4.5);
  private readonly look = new THREE.Vector3(0, TABLE.height, 0);
  private readonly wantPos = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly mat4 = new THREE.Matrix4();
  private quality: QualityLevel;

  constructor(look: TableLook, hall: HallTheme, quality: QualityLevel) {
    const L = LOOKS[look] ?? LOOKS.blue, Hd = HALLS[hall] ?? HALLS.island;
    const s = this.scene;
    this.quality = quality;
    s.background = new THREE.Color(Hd.sky);
    s.fog = new THREE.Fog(Hd.fog, 12, 34);
    s.add(new THREE.HemisphereLight('#ffffff', '#cfd8c0', Hd.hemi));
    this.sun = new THREE.DirectionalLight('#fff4e0', Hd.sun);
    this.sun.position.set(2.5, 7, 3);
    this.sun.target.position.set(0, TABLE.height, 0);
    Object.assign(this.sun.shadow.camera, { left: -3, right: 3, top: 3.5, bottom: -3.5, near: 1, far: 16 });
    this.sun.shadow.bias = -0.0004;
    s.add(this.sun, this.sun.target);

    this.buildHall(Hd, hall);
    this.buildTable(L);

    // ball, shadow, trail
    const bg = this.geo(new THREE.SphereGeometry(BALL.radius, 16, 12));
    this.ball = new THREE.Mesh(bg, this.mat(toon('#ffffff', { emissive: '#333333' })));
    this.ball.castShadow = true;
    addOutline(this.ball, 0.12);
    s.add(this.ball);
    this.shadow = new THREE.Mesh(this.geo(new THREE.CircleGeometry(BALL.radius * 1.2, 16)),
      this.mat(new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.45, depthWrite: false })));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    s.add(this.shadow);

    const tg = this.geo(new THREE.BufferGeometry());
    this.trailPos = new Float32Array(TRAIL_N * 2 * 3);
    this.trailCol = new Float32Array(TRAIL_N * 2 * 4);
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 4));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    tg.setIndex(idx);
    this.trail = new THREE.Mesh(tg, this.mat(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
    this.trail.frustumCulled = false;
    s.add(this.trail);

    // bounce rings
    const rg = this.geo(new THREE.RingGeometry(0.03, 0.045, 24));
    for (let i = 0; i < RINGS; i++) {
      const m = new THREE.Mesh(rg, this.mat(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false })));
      m.rotation.x = -Math.PI / 2; m.visible = false;
      s.add(m);
      this.rings.push({ mesh: m, t: 0 });
    }
    s.add(this.targetGroup);
    this.setQuality(quality);
  }

  private geo<G extends THREE.BufferGeometry>(g: G): G { this.disposables.push(g); return g; }
  private mat<M extends THREE.Material>(m: M): M { this.disposables.push(m); return m; }

  private box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, outline = 0): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), this.mat(toon(color)));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    if (outline) addOutline(m, outline);
    this.scene.add(m);
    return m;
  }

  /* ---------------- building ---------------- */

  private buildHall(Hd: typeof HALLS[HallTheme], hall: HallTheme): void {
    const s = this.scene;
    const floor = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(40, 40)), this.mat(toon(Hd.floor)));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    const court = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(6, 11)), this.mat(toon(Hd.court)));
    court.rotation.x = -Math.PI / 2; court.position.y = 0.002; court.receiveShadow = true; s.add(court);
    // court border
    for (const [w, d, x, z] of [[6, 0.05, 0, 5.5], [6, 0.05, 0, -5.5], [0.05, 11, 3, 0], [0.05, 11, -3, 0]] as const) {
      const b = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, d)), this.mat(new THREE.MeshBasicMaterial({ color: '#ffffff' })));
      b.rotation.x = -Math.PI / 2; b.position.set(x, 0.004, z); s.add(b);
    }
    // low barriers with banners around the court
    const wallH = hall === 'arena' ? 0.9 : 0.7;
    for (const z of [-6.2, 6.2]) this.box(7.4, wallH, 0.08, Hd.wall, 0, wallH / 2, z);
    for (const x of [-3.7, 3.7]) this.box(0.08, wallH, 12.4, Hd.wall, x, wallH / 2, 0);
    const rng = new Rng(77);
    const banner = (x: number, z: number, ry: number, i: number) => {
      const c = BANNER_COLORS[i % BANNER_COLORS.length];
      const b = this.box(1.6, 0.42, 0.02, c, x, wallH * 0.55, z);
      b.rotation.y = ry;
      const stripe = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1.4, 0.08)), this.mat(new THREE.MeshBasicMaterial({ color: '#ffffff' })));
      stripe.position.set(0, 0.06 * (rng.next() > 0.5 ? 1 : -1), 0.012);
      b.add(stripe);
    };
    // bleacher steps for the crowd along both long sides
    for (const sx of [-1, 1]) for (let r = 0; r < 3; r++) this.box(0.7, 0.45 * (r + 1), 11, Hd.wall, sx * (4.4 + r * 0.7), 0.225 * (r + 1), 0);
    let i = 0;
    for (const x of [-2.4, 0, 2.4]) { banner(x, -6.15, 0, i++); banner(x, 6.15, Math.PI, i++); }
    for (const z of [-4, -1.4, 1.4, 4]) { banner(-3.65, z, Math.PI / 2, i++); banner(3.65, z, -Math.PI / 2, i++); }

    if (hall === 'island') {
      // open-air: sea on the horizon and a few palm-ish trees
      const sea = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(120, 30)), this.mat(new THREE.MeshBasicMaterial({ color: '#2fb6d6' })));
      sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.01, -26); s.add(sea);
      for (const [x, z] of [[-6, -9], [6.5, -8], [-7, 7], [7, 8]] as const) {
        this.box(0.18, 2.4, 0.18, '#9a6b3e', x, 1.2, z);
        const leaves = new THREE.Mesh(this.geo(new THREE.ConeGeometry(1.1, 0.7, 7)), this.mat(toon('#3bb37a')));
        leaves.position.set(x, 2.5, z); leaves.castShadow = true; s.add(leaves);
      }
    } else {
      // indoor arena: tall walls, a roof and hanging light panels
      for (const z of [-11, 11]) this.box(22, 7, 0.3, '#232c44', 0, 3.5, z);
      for (const x of [-11, 11]) this.box(0.3, 7, 22, '#232c44', x, 3.5, 0);
      this.box(22, 0.3, 22, '#1a2236', 0, 7, 0);
      for (const z of [-2, 2]) {
        const panel = glow(this.geo(new THREE.BoxGeometry(2.4, 0.05, 0.6)), '#fff6dc');
        this.disposables.push(panel.material as THREE.Material);
        panel.position.set(0, 4.2, z); s.add(panel);
        const pl = new THREE.PointLight('#fff2d6', 8, 9, 1.6); pl.position.set(0, 4, z); s.add(pl);
      }
    }
  }

  private buildTable(L: typeof LOOKS[TableLook]): void {
    const s = this.scene, H = TABLE.height;
    const top = this.box(TABLE.width, 0.03, TABLE.length, L.top, 0, H - 0.015, 0, 0.012);
    top.receiveShadow = true;
    const lineMat = this.mat(L.glowLines ? new THREE.MeshBasicMaterial({ color: L.line }) : toon(L.line));
    const line = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, 0.002, d)), lineMat);
      m.position.set(x, H + 0.001, z); m.receiveShadow = true; s.add(m);
    };
    line(0.02, TABLE.length, TABLE_HALF_WIDTH - 0.01, 0);
    line(0.02, TABLE.length, -TABLE_HALF_WIDTH + 0.01, 0);
    line(TABLE.width, 0.02, 0, TABLE_HALF_LENGTH - 0.01);
    line(TABLE.width, 0.02, 0, -TABLE_HALF_LENGTH + 0.01);
    line(0.003, TABLE.length, 0, 0);
    // legs and frame
    for (const x of [-0.6, 0.6]) for (const z of [-1.1, 1.1]) this.box(0.05, H - 0.03, 0.05, '#2b2f38', x, (H - 0.03) / 2, z);
    this.box(1.3, 0.04, 0.05, '#2b2f38', 0, H - 0.12, 0);
    // net: a canvas grid so it reads as mesh
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    let netMat: THREE.Material = new THREE.MeshBasicMaterial({ color: '#1d2a3a', transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    if (c) {
      c.width = 128; c.height = 16;
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, 128, 16); g.strokeStyle = 'rgba(20,30,45,.85)'; g.lineWidth = 1;
      for (let x = 0; x <= 128; x += 4) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, 16); g.stroke(); }
      for (let y = 0; y <= 16; y += 4) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(128, y + 0.5); g.stroke(); }
      const tex = new THREE.CanvasTexture(c); tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(6, 1);
      this.disposables.push(tex);
      netMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    }
    this.disposables.push(netMat);
    const net = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(TABLE.netHalfWidth * 2, TABLE.netHeight)), netMat);
    net.position.set(0, H + TABLE.netHeight / 2, 0);
    s.add(net);
    this.box(TABLE.netHalfWidth * 2, 0.012, 0.012, '#ffffff', 0, H + TABLE.netHeight - 0.006, 0);
    for (const x of [-TABLE.netHalfWidth, TABLE.netHalfWidth]) {
      const p = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(TABLE.postRadius, TABLE.postRadius, TABLE.netHeight + 0.02, 10)), this.mat(toon('#2b2f38')));
      p.position.set(x, H + TABLE.netHeight / 2, 0); p.castShadow = true; s.add(p);
    }
  }

  private buildCrowd(count: number): void {
    if (this.crowd) { this.crowd.removeFromParent(); this.heads?.removeFromParent(); }
    if (count <= 0) { this.crowd = null; this.heads = null; this.crowdBase = []; return; }
    const body = this.geo(new THREE.CapsuleGeometry(0.16, 0.32, 3, 8));
    const head = this.geo(new THREE.SphereGeometry(0.13, 10, 8));
    this.crowd = new THREE.InstancedMesh(body, this.mat(toon('#ffffff')), count);
    this.heads = new THREE.InstancedMesh(head, this.mat(toon('#f2c9a0')), count);
    const rng = new Rng(2024);
    this.crowdBase = [];
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // bleachers along both long sides, 3 rows rising away from the court
      const sideX = i % 2 ? 1 : -1, row = Math.floor(rng.next() * 3);
      const x = sideX * (4.4 + row * 0.7 + rng.next() * 0.2);
      const z = (rng.next() * 2 - 1) * 5.2;
      const y = 0.45 + row * 0.45;
      this.crowdBase.push({ x, y, z, phase: rng.next() * Math.PI * 2, speed: 5 + rng.next() * 4 });
      this.crowd.setColorAt(i, color.set(BANNER_COLORS[Math.floor(rng.next() * BANNER_COLORS.length)]));
    }
    this.scene.add(this.crowd, this.heads);
    this.updateCrowd(0);
  }

  private updateCrowd(dt: number): void {
    if (!this.crowd || !this.heads) return;
    this.excitementT = Math.max(0, this.excitementT - dt);
    const ex = this.calm ? Math.min(0.3, this.excitement) : this.excitement;
    for (let i = 0; i < this.crowdBase.length; i++) {
      const c = this.crowdBase[i];
      const jump = Math.abs(Math.sin(this.t * c.speed + c.phase)) * (0.02 + 0.18 * ex);
      this.mat4.makeTranslation(c.x, c.y + 0.32 + jump, c.z);
      this.crowd.setMatrixAt(i, this.mat4);
      this.mat4.makeTranslation(c.x, c.y + 0.72 + jump, c.z);
      this.heads.setMatrixAt(i, this.mat4);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- per-shot visuals ---------------- */

  /** Ball, its shadow and the trail. rpm drives how strong the trail is. */
  setBall(p: V3, rpm: number, visible: boolean): void {
    this.ball.visible = visible;
    this.ball.position.set(p.x, p.y, p.z);
    this.ball.rotation.x += rpm * 0.0004;
    // shadow on the table (when over it) or the floor; bigger and lighter the higher the ball is
    const overTable = Math.abs(p.x) <= TABLE_HALF_WIDTH && Math.abs(p.z) <= TABLE_HALF_LENGTH && p.y >= TABLE.height;
    const ground = overTable ? TABLE.height + 0.002 : 0.006;
    const hgt = Math.max(0, p.y - ground);
    this.shadow.visible = visible && hgt < 3;
    this.shadow.position.set(p.x, ground, p.z);
    this.shadow.scale.setScalar(1 + hgt * 1.6);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.5 - hgt * 0.35);
    this.trailStrength += (Math.min(1, 0.25 + rpm / 2200) - this.trailStrength) * 0.2;
    if (visible) {
      this.trailPts.unshift(new THREE.Vector3(p.x, p.y, p.z));
      if (this.trailPts.length > TRAIL_N) this.trailPts.pop();
    } else if (this.trailPts.length) this.trailPts.pop();
    this.rebuildTrail();
  }

  clearTrail(): void { this.trailPts.length = 0; this.rebuildTrail(); }

  private rebuildTrail(): void {
    const n = this.trailPts.length, cam = this.camera.position;
    const w0 = 0.012 + 0.012 * this.trailStrength;
    for (let i = 0; i < TRAIL_N; i++) {
      const p = this.trailPts[Math.min(i, Math.max(0, n - 1))];
      const q = this.trailPts[Math.min(i + 1, Math.max(0, n - 1))] ?? p;
      let ox = 0, oy = w0, oz = 0;
      if (p && q) {
        // ribbon perpendicular to both the motion and the view direction
        const tx = p.x - q.x, ty = p.y - q.y, tz = p.z - q.z;
        const vx = cam.x - p.x, vy = cam.y - p.y, vz = cam.z - p.z;
        ox = ty * vz - tz * vy; oy = tz * vx - tx * vz; oz = tx * vy - ty * vx;
        const l = Math.hypot(ox, oy, oz) || 1;
        const w = w0 * (1 - i / TRAIL_N);
        ox = ox / l * w; oy = oy / l * w; oz = oz / l * w;
      }
      const fade = n > 1 && i < n ? (1 - i / n) * (0.25 + 0.5 * this.trailStrength) : 0;
      for (let sgn = 0; sgn < 2; sgn++) {
        const v = i * 2 + sgn, k = sgn ? 1 : -1;
        this.trailPos[v * 3] = p ? p.x + ox * k : 0;
        this.trailPos[v * 3 + 1] = p ? p.y + oy * k : -10;
        this.trailPos[v * 3 + 2] = p ? p.z + oz * k : 0;
        this.trailCol[v * 4] = 1; this.trailCol[v * 4 + 1] = 1; this.trailCol[v * 4 + 2] = 1 - 0.35 * this.trailStrength;
        this.trailCol[v * 4 + 3] = fade;
      }
    }
    const g = this.trail.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** "Dust ring" where the ball hit the table. */
  dust(p: V3, strength = 1): void {
    const r = this.rings.find(x => x.t <= 0) ?? this.rings[0];
    r.t = 0.35;
    r.mesh.visible = true;
    r.mesh.position.set(p.x, TABLE.height + 0.003, p.z);
    r.mesh.scale.setScalar(0.6 + 0.6 * Math.min(1, strength));
  }

  setTargets(list: readonly Target[]): void {
    for (const t of this.targets) { t.mesh.removeFromParent(); t.inner.removeFromParent(); }
    this.targets = list.map(tg => {
      const ring = new THREE.Mesh(this.geo(new THREE.RingGeometry(tg.r * 0.82, tg.r, 32)), this.mat(new THREE.MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0.9, depthWrite: false })));
      const inner = new THREE.Mesh(this.geo(new THREE.CircleGeometry(tg.r * 0.82, 32)), this.mat(new THREE.MeshBasicMaterial({ color: '#fff3a0', transparent: true, opacity: 0.25, depthWrite: false })));
      for (const m of [ring, inner]) { m.rotation.x = -Math.PI / 2; m.position.set(tg.x, TABLE.height + 0.004, tg.z); this.targetGroup.add(m); }
      return { mesh: ring, inner, hitT: 0 };
    });
  }

  hitTarget(i: number): void { const t = this.targets[i]; if (t) t.hitT = 0.5; }

  /** Crowd excitement 0..1 (it decays by itself after `hold` seconds). */
  excite(level: number, hold = 1.5): void { this.excitement = Math.max(this.excitement, Math.min(1, level)); this.excitementT = hold; }

  /* ---------------- camera ---------------- */

  setCamera(m: CamMode, snap = false): void {
    this.mode = m;
    if (snap) { this.targetsFor(this.ball.position); this.pos.copy(this.wantPos); this.look.copy(this.wantLook); }
  }

  shake(a: number): void { if (!this.calm) this.shakeAmp = Math.max(this.shakeAmp, a); }

  private targetsFor(ball: THREE.Vector3): void {
    const H = TABLE.height;
    switch (this.mode) {
      case 'intro': {
        const a = this.t * 0.18;
        this.wantPos.set(Math.sin(a) * 3.6, H + 1.6, 3.4 + Math.cos(a) * 1.2);
        this.wantLook.set(0, H, 0);
        break;
      }
      case 'play': {
        // behind player 1, slightly high, following the ball sideways a little
        const bx = THREE.MathUtils.clamp(ball.x, -1.2, 1.2);
        this.wantPos.set(bx * 0.25, H + 0.85, TABLE_HALF_LENGTH + 2.35);
        this.wantLook.set(bx * 0.35, H + 0.05, -0.5);
        break;
      }
      case 'pushIn': {
        const bx = THREE.MathUtils.clamp(ball.x, -1.2, 1.2);
        this.wantPos.set(bx * 0.25, H + 0.62, TABLE_HALF_LENGTH + 1.6);
        this.wantLook.set(bx * 0.3, H + 0.08, -0.4);
        break;
      }
      case 'side':
        this.wantPos.set(3.3, H + 0.75, 0.2);
        this.wantLook.set(0, H + 0.12, 0);
        break;
    }
  }

  resize(w: number, h: number): void { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  update(dt: number): void {
    this.t += dt;
    if (this.excitementT <= 0) this.excitement = Math.max(0, this.excitement - dt * 0.6);
    this.updateCrowd(dt);
    this.targetsFor(this.tmp.copy(this.ball.position));
    const k = 1 - Math.exp(-dt * (this.mode === 'side' ? 6 : this.calm ? 2.5 : 4));
    this.pos.lerp(this.wantPos, k);
    this.look.lerp(this.wantLook, k);
    this.camera.position.copy(this.pos);
    if (this.shakeAmp > 0.0005) {
      this.camera.position.x += (Math.random() * 2 - 1) * this.shakeAmp;
      this.camera.position.y += (Math.random() * 2 - 1) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-dt * 9);
    }
    this.camera.lookAt(this.look);

    for (const r of this.rings) {
      if (r.t <= 0) continue;
      r.t -= dt;
      const k2 = 1 - r.t / 0.35;
      r.mesh.scale.multiplyScalar(1 + dt * 5);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.75 * (1 - k2));
      if (r.t <= 0) r.mesh.visible = false;
    }
    for (const tg of this.targets) {
      const pulse = 0.75 + 0.25 * Math.sin(this.t * 4);
      const hit = Math.max(0, tg.hitT);
      tg.hitT -= dt;
      (tg.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 0.6 * pulse + hit * 2);
      (tg.inner.material as THREE.MeshBasicMaterial).opacity = 0.18 + hit * 1.4;
      tg.mesh.scale.setScalar(1 + hit * 0.8);
    }
  }

  setQuality(level: QualityLevel): void {
    const q = QUALITY[level];
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowMap) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const want = level === 'low' ? 60 : level === 'med' ? 140 : 240;
    if (!this.crowd || this.crowd.count !== want || level !== this.quality) this.buildCrowd(want);
    this.quality = level;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.crowd?.dispose(); this.heads?.dispose();
    this.sun.shadow.map?.dispose();
  }
}

import * as THREE from 'three';
import { addOutline, glow, toon } from '../render/Toon';
import { QUALITY, type QualityLevel } from '../core/Quality';
import { Rng } from '../tabletennis/BallPhysics';
import { BALL, COURT, CORNER_JOIN_Z, HOOP } from './bbTuning';
import { HoopView } from './Hoop';
import type { NetStyle } from './Net';
import { HOOP_CENTER, type V3 } from './ShotSolver';

export type CourtLook = 'gym' | 'street';
export type BallSkin = 'classic' | 'street' | 'glow' | 'gold' | 'galaxy' | 'money';
export type CamMode = 'intro' | 'shoot' | 'pickup' | 'hoopCam' | 'replay';

const LOOKS: Record<CourtLook, {
  sky: string; fog: string; fogNear: number; fogFar: number; floor: string; court: string; paint: string; line: string;
  hemi: number; sun: string; sunI: number; sunPos: [number, number, number]; wood: boolean
}> = {
  gym: { sky: '#2a3550', fog: '#2a3550', fogNear: 22, fogFar: 46, floor: '#7a5636', court: '#d9a066', paint: '#2f8fd8', line: '#ffffff', hemi: 1.5, sun: '#fff4e0', sunI: 2.2, sunPos: [3, 14, 6], wood: true },
  street: { sky: '#ffb36b', fog: '#f7a868', fogNear: 18, fogFar: 60, floor: '#4c4f5c', court: '#3b6f9e', paint: '#e2574c', line: '#fff3d6', hemi: 1.35, sun: '#ffb070', sunI: 2.8, sunPos: [-9, 5.5, -6], wood: false }
};

const BANNER = ['#ff5a5f', '#ffd23a', '#3bb37a', '#2f8fd8', '#ff8a3c', '#7a5cff'];
const TRAIL_N = 28;
const FLAMES = 40;

/** Equirectangular basketball texture: base colour, the 8 black seams, a pebbled grain. */
function ballTexture(skin: BallSkin): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const W = 256, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const base: Record<BallSkin, string> = { classic: '#e8742a', street: '#2b2d36', glow: '#14e0c8', gold: '#e9b52e', galaxy: '#3a1f8a', money: '#f4f1ec' };
  g.fillStyle = base[skin]; g.fillRect(0, 0, W, H);
  if (skin === 'galaxy') {
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + (i % 5) / 8})`; g.fillRect((i * 97) % W, (i * 53) % H, 1 + (i % 7 === 0 ? 1 : 0), 1); }
  } else if (skin === 'money') {
    // red / white / blue panels
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#d8263a' : '#2b4fd8'; g.fillRect(i * W / 4, 0, W / 8, H); }
  } else {
    // pebble grain
    for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect((i * 37) % W, (i * 71) % H, 1, 1); }
  }
  const seam = skin === 'street' ? '#ff8a3c' : skin === 'glow' ? '#0b2a35' : '#1a1416';
  g.strokeStyle = seam; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();                       // equator
  for (const x of [W / 4, (3 * W) / 4]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }   // two meridians
  for (const off of [0, W / 2]) {                                                            // the curved side seams
    g.beginPath();
    for (let x = 0; x <= W / 2; x += 4) {
      const y = H / 2 + Math.sin((x / (W / 2)) * Math.PI) * H * 0.36 * (off ? -1 : 1);
      if (x === 0) g.moveTo(off + x, y); else g.lineTo(off + x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Court floor texture with the lines painted on. */
function courtTexture(L: typeof LOOKS[CourtLook]): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const W = 1024, Hc = Math.round(1024 * 14 / 15);
  const c = document.createElement('canvas'); c.width = W; c.height = Hc;
  const g = c.getContext('2d')!;
  const sx = (x: number) => (x + COURT.halfWidth) / (2 * COURT.halfWidth) * W;
  const sz = (z: number) => (z - COURT.baselineZ) / 14 * Hc;
  const m = W / (2 * COURT.halfWidth);
  g.fillStyle = L.court; g.fillRect(0, 0, W, Hc);
  if (L.wood) {
    // planks
    for (let x = 0; x < W; x += 18) {
      g.fillStyle = (x / 18) % 3 === 0 ? 'rgba(120,70,30,0.12)' : (x / 18) % 3 === 1 ? 'rgba(255,230,190,0.08)' : 'rgba(0,0,0,0.04)';
      g.fillRect(x, 0, 18, Hc);
      g.fillStyle = 'rgba(80,45,20,0.18)';
      for (let y = ((x * 7) % 140); y < Hc; y += 140) g.fillRect(x, y, 18, 1.5);
    }
  } else {
    for (let i = 0; i < 2500; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)'; g.fillRect((i * 131) % W, (i * 89) % Hc, 2, 2); }
  }
  // the key (painted)
  g.fillStyle = L.paint;
  g.fillRect(sx(-COURT.keyHalfWidth), sz(COURT.baselineZ), COURT.keyHalfWidth * 2 * m, (COURT.freeThrowZ - COURT.baselineZ) * m);
  // lines
  g.strokeStyle = L.line; g.lineWidth = 0.05 * m;
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, Hc - g.lineWidth);
  g.strokeRect(sx(-COURT.keyHalfWidth), sz(COURT.baselineZ), COURT.keyHalfWidth * 2 * m, (COURT.freeThrowZ - COURT.baselineZ) * m);
  g.beginPath(); g.arc(sx(0), sz(COURT.freeThrowZ), 1.8 * m, 0, Math.PI); g.stroke();
  g.setLineDash([0.3 * m, 0.25 * m]);
  g.beginPath(); g.arc(sx(0), sz(COURT.freeThrowZ), 1.8 * m, Math.PI, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  // 3-point line: straight corners, then the arc
  const a0 = Math.atan2(CORNER_JOIN_Z, COURT.cornerX);
  g.beginPath();
  g.moveTo(sx(-COURT.cornerX), sz(COURT.baselineZ));
  g.lineTo(sx(-COURT.cornerX), sz(CORNER_JOIN_Z));
  g.arc(sx(0), sz(0), COURT.threeRadius * m, Math.PI - a0, a0, true);
  g.lineTo(sx(COURT.cornerX), sz(COURT.baselineZ));
  g.stroke();
  // restricted-area arc and the half-court circle
  g.beginPath(); g.arc(sx(0), sz(0), 1.25 * m, 0, Math.PI); g.stroke();
  g.beginPath(); g.arc(sx(0), sz(COURT.halfCourtZ), 1.8 * m, Math.PI, Math.PI * 2); g.stroke();
  // check spot at the top of the arc
  g.fillStyle = L.line; g.beginPath(); g.arc(sx(0), sz(COURT.checkZ), 0.12 * m, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Everything you see on the basketball court except the players: the look (Indoor Gym or Street Court),
 * floor with lines, hoop and net, a pool of ball meshes with shadows, the shot trail (with flames when a
 * player is On Fire), the arc preview and aim arrow, an instanced crowd, and the camera rig.
 */
export class CourtScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 140);
  readonly hoop: HoopView;
  calm = false;
  mode: CamMode = 'intro';
  /** Where the 'shoot' camera stands behind (the shooter) and where 'pickup' follows (the ball). */
  readonly focus = new THREE.Vector3(0, 0, 7);
  readonly ballFocus = new THREE.Vector3(0, 1, 5);

  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly sun: THREE.DirectionalLight;
  private readonly ballMeshes: THREE.Mesh[] = [];
  private readonly shadows: THREE.Mesh[] = [];
  private readonly ballMats: THREE.MeshToonMaterial[] = [];
  private readonly skinTex = new Map<BallSkin, THREE.Texture | null>();
  private readonly trail: THREE.Mesh;
  private readonly trailPts: THREE.Vector3[] = [];
  private readonly trailPos: Float32Array;
  private readonly trailCol: Float32Array;
  private trailBall = -1;
  private fire = false;
  private readonly flames: THREE.Points;
  private readonly flamePos: Float32Array;
  private readonly flameLife: Float32Array;
  private flameNext = 0;
  private readonly arc: THREE.Points;
  private readonly arcPos: Float32Array;
  private readonly arrow: THREE.Mesh;
  private crowd: THREE.InstancedMesh | null = null;
  private heads: THREE.InstancedMesh | null = null;
  private crowdBase: Array<{ x: number; y: number; z: number; phase: number; speed: number }> = [];
  private crowdSpots: Array<{ x: number; y: number; z: number }> = [];
  private excitement = 0;
  private excitementT = 0;
  private t = 0;
  private shakeAmp = 0;
  private readonly pos = new THREE.Vector3(0, 4, 14);
  private readonly look = new THREE.Vector3(0, 2, 0);
  private readonly wantPos = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private readonly mat4 = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private quality: QualityLevel;

  constructor(readonly look: CourtLook, netStyle: NetStyle, ballSkin: BallSkin, ballCount: number, quality: QualityLevel) {
    const L = LOOKS[look] ?? LOOKS.gym;
    const s = this.scene;
    this.quality = quality;
    s.background = new THREE.Color(L.sky);
    s.fog = new THREE.Fog(L.fog, L.fogNear, L.fogFar);
    s.add(new THREE.HemisphereLight('#ffffff', look === 'gym' ? '#a8865f' : '#5a4a66', L.hemi));
    this.sun = new THREE.DirectionalLight(L.sun, L.sunI);
    this.sun.position.set(...L.sunPos);
    this.sun.target.position.set(0, 0, 4);
    Object.assign(this.sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);

    this.buildFloor(L);
    if (look === 'gym') this.buildGym(); else this.buildStreet();

    this.hoop = new HoopView(HOOP_CENTER, netStyle, look === 'gym' ? '#ff8a3c' : '#e2574c');
    s.add(this.hoop.group);

    // balls + blob shadows
    const bg = this.geo(new THREE.SphereGeometry(BALL.radius, 24, 16));
    const sg = this.geo(new THREE.CircleGeometry(BALL.radius * 1.1, 18));
    for (let i = 0; i < ballCount; i++) {
      const m = this.mat(toon('#ffffff'));
      this.ballMats.push(m);
      const mesh = new THREE.Mesh(bg, m);
      mesh.castShadow = true;
      addOutline(mesh, 0.05);
      mesh.visible = false;
      s.add(mesh);
      this.ballMeshes.push(mesh);
      const sh = new THREE.Mesh(sg, this.mat(new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false })));
      sh.rotation.x = -Math.PI / 2; sh.renderOrder = 1; sh.visible = false;
      s.add(sh);
      this.shadows.push(sh);
      this.setBallSkin(i, ballSkin);
    }

    // trail ribbon
    const tg = this.geo(new THREE.BufferGeometry());
    this.trailPos = new Float32Array(TRAIL_N * 2 * 3);
    this.trailCol = new Float32Array(TRAIL_N * 2 * 4);
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 4));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    tg.setIndex(idx);
    this.trail = new THREE.Mesh(tg, this.mat(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })));
    this.trail.frustumCulled = false;
    s.add(this.trail);

    // flame particles (On Fire)
    const fg = this.geo(new THREE.BufferGeometry());
    this.flamePos = new Float32Array(FLAMES * 3).fill(-50);
    this.flameLife = new Float32Array(FLAMES);
    fg.setAttribute('position', new THREE.BufferAttribute(this.flamePos, 3));
    this.flames = new THREE.Points(fg, this.mat(new THREE.PointsMaterial({ color: '#ff8a1f', size: 0.16, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })));
    this.flames.frustumCulled = false;
    s.add(this.flames);

    // arc preview dots + aim arrow
    const ag = this.geo(new THREE.BufferGeometry());
    this.arcPos = new Float32Array(40 * 3).fill(-50);
    ag.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3));
    this.arc = new THREE.Points(ag, this.mat(new THREE.PointsMaterial({ color: '#3ff2ff', size: 0.07, transparent: true, opacity: 0.85, depthWrite: false })));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    s.add(this.arc);
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.1); shape.lineTo(0.18, 0.75); shape.lineTo(0.06, 0.75); shape.lineTo(0.06, 0);
    shape.lineTo(-0.06, 0); shape.lineTo(-0.06, 0.75); shape.lineTo(-0.18, 0.75); shape.closePath();
    this.arrow = new THREE.Mesh(this.geo(new THREE.ShapeGeometry(shape)), this.mat(new THREE.MeshBasicMaterial({ color: '#3ff2ff', transparent: true, opacity: 0.8, depthWrite: false })));
    this.arrow.rotation.order = 'YXZ';
    this.arrow.visible = false;
    s.add(this.arrow);

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

  private buildFloor(L: typeof LOOKS[CourtLook]): void {
    const s = this.scene;
    const ground = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(80, 80)), this.mat(toon(L.floor)));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.002, 6); ground.receiveShadow = true;
    s.add(ground);
    const tex = courtTexture(L);
    if (tex) this.disposables.push(tex);
    const court = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(COURT.halfWidth * 2, 14)), this.mat(toon('#ffffff', tex ? { map: tex } : { color: L.court })));
    court.rotation.x = -Math.PI / 2;
    court.position.set(0, 0.001, COURT.baselineZ + 7);
    court.receiveShadow = true;
    s.add(court);
  }

  private buildGym(): void {
    const rng = new Rng(31);
    // walls, roof beams and light panels
    this.box(34, 9, 0.4, '#3a4766', 0, 4.5, COURT.baselineZ - 4);
    for (const x of [-15, 15]) this.box(0.4, 9, 30, '#33405e', x, 4.5, 8);
    this.box(34, 0.4, 30, '#232c44', 0, 9.2, 8);
    for (const z of [0, 6, 12]) {
      const panel = glow(this.geo(new THREE.BoxGeometry(5, 0.08, 0.9)), '#fff6dc');
      this.disposables.push(panel.material as THREE.Material);
      panel.position.set(0, 8.8, z); this.scene.add(panel);
    }
    // banners on the back wall
    for (let i = 0; i < 6; i++) {
      const b = this.box(1.6, 2.6, 0.05, BANNER[i % BANNER.length], -8 + i * 3.2, 6.2, COURT.baselineZ - 3.75);
      const stripe = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1.2, 0.22)), this.mat(new THREE.MeshBasicMaterial({ color: '#ffffff' })));
      stripe.position.set(0, 0.6 * (rng.next() > 0.5 ? 1 : -1), 0.03);
      b.add(stripe);
    }
    // bleachers along both sidelines
    for (const sx of [-1, 1]) for (let r = 0; r < 4; r++) this.box(0.9, 0.5 * (r + 1), 15, '#8b98ad', sx * (9 + r * 0.9), 0.25 * (r + 1), 5.5);
    for (const sx of [-1, 1]) for (let r = 0; r < 4; r++) for (let k = 0; k < 14; k++) {
      this.crowdSpots.push({ x: sx * (9 + r * 0.9), y: 0.5 * (r + 1), z: -1.5 + k * 1.05 + (r % 2) * 0.5 });
    }
    // scorer's table
    this.box(3, 0.8, 0.7, '#ff8a3c', 0, 0.4, COURT.halfCourtZ + 1.4, 0.02);
  }

  private buildStreet(): void {
    const s = this.scene, rng = new Rng(57);
    // chain-link fence: a canvas grid on transparent planes around the court
    let fenceMat: THREE.Material = this.mat(new THREE.MeshBasicMaterial({ color: '#9aa3b2', transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const g = c.getContext('2d')!;
      g.strokeStyle = 'rgba(200,205,215,0.85)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(64, 64); g.moveTo(64, 0); g.lineTo(0, 64); g.stroke();
      const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(30, 4);
      this.disposables.push(tex);
      fenceMat = this.mat(new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    }
    const fence = (w: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, 3.6)), fenceMat);
      m.position.set(x, 1.8, z); m.rotation.y = ry; s.add(m);
      for (let i = 0; i <= Math.round(w / 3); i++) {
        const off = -w / 2 + i * (w / Math.round(w / 3));
        this.box(0.08, 3.7, 0.08, '#6b7280', x + Math.cos(ry) * off, 1.85, z - Math.sin(ry) * off);
      }
    };
    fence(22, 0, COURT.baselineZ - 2.6, 0);
    fence(20, -10, 7, Math.PI / 2);
    fence(20, 10, 7, Math.PI / 2);
    // skyline silhouettes against the sunset, with a few lit windows
    const winTex = (() => {
      if (typeof document === 'undefined') return null;
      const c = document.createElement('canvas'); c.width = 32; c.height = 64;
      const g = c.getContext('2d')!;
      g.fillStyle = '#3a2d4f'; g.fillRect(0, 0, 32, 64);
      for (let y = 4; y < 64; y += 8) for (let x = 3; x < 32; x += 8) if (rng.next() < 0.35) { g.fillStyle = '#ffd98a'; g.fillRect(x, y, 4, 4); }
      const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace;
      this.disposables.push(tx);
      return tx;
    })();
    for (let i = 0; i < 18; i++) {
      const w = 3 + rng.next() * 5, h = 8 + rng.next() * 22;
      const map = winTex ? winTex.clone() : null;
      if (map) { map.repeat.set(w / 3, h / 6); map.needsUpdate = true; this.disposables.push(map); }
      const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, 4)), this.mat(new THREE.MeshBasicMaterial({ color: map ? '#ffffff' : '#3a2d4f', map })));
      m.position.set(-40 + i * 4.8 + rng.next() * 2, h / 2, COURT.baselineZ - 26 - rng.next() * 8);
      s.add(m);
    }
    // the low sun as a glowing disc
    const sunDisc = glow(this.geo(new THREE.CircleGeometry(4, 32)), '#ffe0a0');
    this.disposables.push(sunDisc.material as THREE.Material);
    sunDisc.position.set(-22, 9, COURT.baselineZ - 45); s.add(sunDisc);
    // benches, a few spectators along the fence
    this.box(4, 0.45, 0.5, '#9a6b3e', -9, 0.23, 4, 0.02);
    this.box(4, 0.45, 0.5, '#9a6b3e', 9, 0.23, 4, 0.02);
    for (let k = 0; k < 24; k++) this.crowdSpots.push({ x: (k % 2 ? 1 : -1) * (9 + rng.next() * 0.6), y: 0, z: -1 + (k >> 1) * 1.1 });
  }

  private buildCrowd(count: number): void {
    if (this.crowd) { this.crowd.removeFromParent(); this.heads?.removeFromParent(); }
    const n = Math.min(count, this.crowdSpots.length);
    if (n <= 0) { this.crowd = null; this.heads = null; this.crowdBase = []; return; }
    const body = this.geo(new THREE.CapsuleGeometry(0.2, 0.42, 3, 8));
    const head = this.geo(new THREE.SphereGeometry(0.16, 10, 8));
    this.crowd = new THREE.InstancedMesh(body, this.mat(toon('#ffffff')), n);
    this.heads = new THREE.InstancedMesh(head, this.mat(toon('#f2c9a0')), n);
    const rng = new Rng(808), color = new THREE.Color();
    this.crowdBase = [];
    for (let i = 0; i < n; i++) {
      const sp = this.crowdSpots[Math.floor(i * this.crowdSpots.length / n)];
      this.crowdBase.push({ ...sp, phase: rng.next() * Math.PI * 2, speed: 5 + rng.next() * 4 });
      this.crowd.setColorAt(i, color.set(BANNER[Math.floor(rng.next() * BANNER.length)]));
    }
    this.scene.add(this.crowd, this.heads);
    this.updateCrowd();
  }

  private updateCrowd(): void {
    if (!this.crowd || !this.heads) return;
    const ex = this.calm ? Math.min(0.3, this.excitement) : this.excitement;
    for (let i = 0; i < this.crowdBase.length; i++) {
      const c = this.crowdBase[i];
      const jump = Math.abs(Math.sin(this.t * c.speed + c.phase)) * (0.02 + 0.22 * ex);
      this.mat4.makeTranslation(c.x, c.y + 0.42 + jump, c.z);
      this.crowd.setMatrixAt(i, this.mat4);
      this.mat4.makeTranslation(c.x, c.y + 0.93 + jump, c.z);
      this.heads.setMatrixAt(i, this.mat4);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- balls ---------------- */

  setBallSkin(i: number, skin: BallSkin): void {
    if (!this.skinTex.has(skin)) { const tx = ballTexture(skin); this.skinTex.set(skin, tx); if (tx) this.disposables.push(tx); }
    const m = this.ballMats[i];
    if (!m) return;
    m.map = this.skinTex.get(skin) ?? null;
    m.color.set(m.map ? '#ffffff' : '#e8742a');
    m.emissive.set(skin === 'glow' ? '#0a6a5e' : skin === 'gold' ? '#3a2a00' : '#000000');
    m.needsUpdate = true;
  }

  /** Place ball mesh i (world position + rotation). */
  setBall(i: number, p: V3 | null, q?: THREE.Quaternion): void {
    const m = this.ballMeshes[i], sh = this.shadows[i];
    if (!m || !sh) return;
    m.visible = !!p; sh.visible = !!p;
    if (!p) return;
    m.position.set(p.x, p.y, p.z);
    if (q) m.quaternion.copy(q);
    const hgt = Math.max(0, p.y - BALL.radius);
    sh.position.set(p.x, 0.008, p.z);
    sh.scale.setScalar(1 + hgt * 0.35);
    (sh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.45 - hgt * 0.08);
  }

  /** Spin the mesh a little (held balls, dribbles). */
  spinBall(i: number, ax: number, ay: number): void { const m = this.ballMeshes[i]; if (m) { m.rotation.x += ax; m.rotation.y += ay; } }

  ballMesh(i: number): THREE.Mesh | undefined { return this.ballMeshes[i]; }

  private readonly extraMats = new Map<BallSkin, THREE.MeshToonMaterial>();
  private extraGeo: THREE.SphereGeometry | null = null;

  /** A static ball mesh with a skin (rack balls, the ball in the shooter's hands). Disposed with the court. */
  makeBallMesh(skin: BallSkin): THREE.Mesh {
    this.extraGeo ??= this.geo(new THREE.SphereGeometry(BALL.radius, 20, 14));
    let m = this.extraMats.get(skin);
    if (!m) {
      if (!this.skinTex.has(skin)) { const tx = ballTexture(skin); this.skinTex.set(skin, tx); if (tx) this.disposables.push(tx); }
      const map = this.skinTex.get(skin) ?? null;
      m = this.mat(toon(map ? '#ffffff' : '#e8742a', map ? { map } : {}));
      this.extraMats.set(skin, m);
    }
    const mesh = new THREE.Mesh(this.extraGeo, m);
    mesh.castShadow = true;
    addOutline(mesh, 0.05);
    return mesh;
  }

  /** Which ball the trail follows (-1 = none). */
  followTrail(i: number): void { if (i !== this.trailBall) { this.trailBall = i; this.trailPts.length = 0; } }
  setOnFire(on: boolean): void { this.fire = on; }

  private updateTrail(dt: number): void {
    const m = this.trailBall >= 0 ? this.ballMeshes[this.trailBall] : null;
    if (m?.visible) {
      this.trailPts.unshift(m.position.clone());
      if (this.trailPts.length > TRAIL_N) this.trailPts.pop();
    } else if (this.trailPts.length) this.trailPts.pop();
    const n = this.trailPts.length, cam = this.camera.position;
    const w0 = this.fire ? 0.09 : 0.045;
    for (let i = 0; i < TRAIL_N; i++) {
      const p = this.trailPts[Math.min(i, Math.max(0, n - 1))];
      const q = this.trailPts[Math.min(i + 1, Math.max(0, n - 1))] ?? p;
      let ox = 0, oy = w0, oz = 0;
      if (p && q) {
        const tx = p.x - q.x, ty = p.y - q.y, tz = p.z - q.z;
        const vx = cam.x - p.x, vy = cam.y - p.y, vz = cam.z - p.z;
        ox = ty * vz - tz * vy; oy = tz * vx - tx * vz; oz = tx * vy - ty * vx;
        const l = Math.hypot(ox, oy, oz) || 1, w = w0 * (1 - i / TRAIL_N);
        ox = ox / l * w; oy = oy / l * w; oz = oz / l * w;
      }
      const fade = n > 1 && i < n ? (1 - i / n) * (this.fire ? 0.9 : 0.35) : 0;
      const k = i / TRAIL_N;
      for (let sgn = 0; sgn < 2; sgn++) {
        const v = i * 2 + sgn, sg = sgn ? 1 : -1;
        this.trailPos[v * 3] = p ? p.x + ox * sg : 0;
        this.trailPos[v * 3 + 1] = p ? p.y + oy * sg : -10;
        this.trailPos[v * 3 + 2] = p ? p.z + oz * sg : 0;
        if (this.fire) { this.trailCol[v * 4] = 1; this.trailCol[v * 4 + 1] = 0.85 - 0.6 * k; this.trailCol[v * 4 + 2] = 0.25 - 0.25 * k; }
        else { this.trailCol[v * 4] = 1; this.trailCol[v * 4 + 1] = 1; this.trailCol[v * 4 + 2] = 1; }
        this.trailCol[v * 4 + 3] = fade;
      }
    }
    const g = this.trail.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    // flames: spawn at the ball, rise and fade
    this.flameNext -= dt;
    if (this.fire && m?.visible && !this.calm && this.flameNext <= 0) {
      this.flameNext = 0.012;
      let j = 0, oldest = 0;
      for (let i = 0; i < FLAMES; i++) if (this.flameLife[i] < this.flameLife[oldest]) oldest = i;
      j = oldest;
      this.flameLife[j] = 0.35;
      this.flamePos[j * 3] = m.position.x + (Math.random() - 0.5) * 0.12;
      this.flamePos[j * 3 + 1] = m.position.y + (Math.random() - 0.5) * 0.12;
      this.flamePos[j * 3 + 2] = m.position.z + (Math.random() - 0.5) * 0.12;
    }
    for (let i = 0; i < FLAMES; i++) {
      if (this.flameLife[i] <= 0) { this.flamePos[i * 3 + 1] = -50; continue; }
      this.flameLife[i] -= dt;
      this.flamePos[i * 3 + 1] += dt * 0.9;
    }
    (this.flames.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /* ---------------- shot aids ---------------- */

  /** Dotted ideal arc (or null to hide). */
  showArc(path: readonly V3[] | null): void {
    this.arc.visible = !!path && path.length > 1;
    if (!path) return;
    const n = 40, P = this.arcPos;
    for (let i = 0; i < n; i++) {
      const p = path[Math.min(path.length - 1, Math.floor(i / (n - 1) * (path.length - 1)))];
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
    }
    (this.arc.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Aim arrow on the floor at `at`, pointing toward the hoop turned by `yawDeg` (+ = right). */
  showArrow(at: V3 | null, yawDeg = 0, good = true): void {
    this.arrow.visible = !!at;
    if (!at) return;
    const dir = Math.atan2(HOOP_CENTER.x - at.x, HOOP_CENTER.z - at.z);
    this.arrow.position.set(at.x, 0.012, at.z);
    // the shape points along +y; flat on the floor that is −z, so turn by dir + π, then by the aim (+ = right)
    this.arrow.rotation.set(-Math.PI / 2, dir + Math.PI - yawDeg * Math.PI / 180, 0);
    (this.arrow.material as THREE.MeshBasicMaterial).color.set(good ? '#3ff2ff' : '#ffb03a');
  }

  /** Crowd excitement 0..1 (decays after `hold` seconds). */
  excite(level: number, hold = 1.5): void { this.excitement = Math.max(this.excitement, Math.min(1, level)); this.excitementT = hold; }

  /* ---------------- camera ---------------- */

  setCamera(m: CamMode, snap = false): void {
    this.mode = m;
    if (snap) { this.targetsFor(); this.pos.copy(this.wantPos); this.look.copy(this.wantLook); }
  }

  shake(a: number): void { if (!this.calm) this.shakeAmp = Math.max(this.shakeAmp, a); }

  private targetsFor(): void {
    const H = HOOP_CENTER;
    switch (this.mode) {
      case 'intro': {
        const a = this.t * 0.15;
        this.wantPos.set(Math.sin(a) * 9, 4.2, 6 + Math.cos(a) * 5);
        this.wantLook.set(0, 2, 1.5);
        break;
      }
      case 'shoot': {
        // behind the shooter, looking past them at the hoop
        const f = this.focus;
        const dx = f.x - H.x, dz = f.z - H.z, d = Math.hypot(dx, dz) || 1;
        this.wantPos.set(f.x + dx / d * 3.4, 2.5, f.z + dz / d * 3.4);
        this.wantLook.set(H.x + (f.x - H.x) * 0.12, H.y - 0.5, H.z + (f.z - H.z) * 0.12);
        break;
      }
      case 'pickup': {
        const b = this.ballFocus;
        this.wantPos.set(THREE.MathUtils.clamp(b.x * 0.45, -3, 3), 6.4, COURT.halfCourtZ + 2.2);
        this.wantLook.set(b.x * 0.55, 0.9, THREE.MathUtils.clamp(b.z * 0.55, 1.5, 6));
        break;
      }
      case 'hoopCam':
        this.wantPos.set(H.x + 1.15, H.y + 0.15, H.z + 1.25);
        this.wantLook.set(H.x, H.y - 0.15, H.z);
        break;
      case 'replay':
        this.wantPos.set(10.5, 3.2, 4.2);
        this.wantLook.set(0, 1.8, 3.2);
        break;
    }
  }

  resize(w: number, h: number): void { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  update(dt: number, balls: readonly V3[]): void {
    this.t += dt;
    this.excitementT = Math.max(0, this.excitementT - dt);
    if (this.excitementT <= 0) this.excitement = Math.max(0, this.excitement - dt * 0.5);
    this.updateCrowd();
    this.targetsFor();
    const fast = this.mode === 'hoopCam' ? 14 : this.mode === 'replay' ? 8 : this.calm ? 2.5 : 4;
    const k = 1 - Math.exp(-dt * fast);
    this.pos.lerp(this.wantPos, k);
    this.look.lerp(this.wantLook, k);
    this.camera.position.copy(this.pos);
    if (this.shakeAmp > 0.0005) {
      this.camera.position.x += (Math.random() * 2 - 1) * this.shakeAmp;
      this.camera.position.y += (Math.random() * 2 - 1) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-dt * 9);
    }
    this.camera.lookAt(this.look);
    this.hoop.update(dt, balls);
    this.updateTrail(dt);
  }

  setQuality(level: QualityLevel): void {
    const q = QUALITY[level];
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowMap) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const want = level === 'low' ? 40 : level === 'med' ? 80 : 120;
    if (!this.crowd || this.crowd.count !== Math.min(want, this.crowdSpots.length) || level !== this.quality) this.buildCrowd(want);
    this.quality = level;
  }

  /** World position projected to screen pixels (for HUD labels). */
  toScreen(p: V3): { x: number; y: number } {
    this.tmp.set(p.x, p.y, p.z).project(this.camera);
    return { x: (this.tmp.x + 1) / 2 * innerWidth, y: (1 - this.tmp.y) / 2 * innerHeight };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.crowd?.dispose(); this.heads?.dispose();
    this.sun.shadow.map?.dispose();
    this.hoop.dispose();
  }
}

/** Height of the rim, for HUD and camera code. */
export const RIM_Y = HOOP.height;

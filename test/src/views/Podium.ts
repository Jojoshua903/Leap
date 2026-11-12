import * as THREE from 'three';
import { toon, toonMesh } from '../render/Toon';
import { buildBuddy, type BuddyRig } from '../buddy/BuddyBuilder';
import { BuddyAnimator } from '../buddy/BuddyAnimator';
import type { BuddyConfig } from '../buddy/BuddyConfig';
import type { View } from '../screens/ScreenManager';

export interface PodiumEntry { buddy: BuddyConfig; place: number; color: string }

/**
 * Results podium on the beach: 1st in the middle (tallest), 2nd left, 3rd right, 4th on the sand.
 * The winner cheers, second and third clap, last place is a little sad. Confetti rains on the winner.
 */
export class Podium implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  private readonly rigs: Array<{ rig: BuddyRig; anim: BuddyAnimator }> = [];
  private confetti: THREE.Points | null = null;
  private confettiVel: Float32Array | null = null;
  private t = 0;
  calm = false;

  constructor(entries: PodiumEntry[]) {
    const s = this.scene;
    s.background = new THREE.Color('#8fd6ff');
    s.fog = new THREE.Fog('#bfe9ff', 14, 40);
    s.add(new THREE.HemisphereLight('#ffffff', '#f0d8a0', 2));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    sun.position.set(3, 6, 5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2 });
    s.add(sun);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), toon('#fff3d4'));
    sand.rotation.x = -Math.PI / 2; sand.receiveShadow = true; s.add(sand);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(120, 40), new THREE.MeshBasicMaterial({ color: '#2fb6d6' }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.01, -26); s.add(sea);

    const n = entries.length;
    const spots: Record<number, { x: number; h: number; c: string }> = {
      1: { x: 0, h: 0.75, c: '#ffd23a' },
      2: { x: -1.15, h: 0.5, c: '#d9e6ee' },
      3: { x: 1.15, h: 0.32, c: '#e8a457' },
      4: { x: 2.3, h: 0, c: '#ffffff' }
    };
    for (const p of [1, 2, 3]) {
      if (p > Math.max(1, n)) continue;
      const sp = spots[p];
      const block = toonMesh(new THREE.BoxGeometry(1.05, sp.h, 0.9), sp.c, 0.02);
      block.position.set(sp.x, sp.h / 2, 0); block.receiveShadow = true; s.add(block);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: numberTexture(p), transparent: true }));
      num.position.set(sp.x, sp.h / 2, 0.452); s.add(num);
    }
    entries.forEach(e => {
      const sp = spots[Math.min(4, e.place)] ?? spots[4];
      const rig = buildBuddy(e.buddy);
      rig.root.position.set(sp.x, sp.h, e.place >= 4 ? 0.6 : 0);
      rig.root.rotation.y = e.place === 2 ? 0.25 : e.place === 3 ? -0.25 : 0;
      rig.root.traverse(o => { (o as THREE.Mesh).castShadow = true; });
      s.add(rig.root);
      const anim = new BuddyAnimator(rig);
      const state = n === 1 ? (e.place === 1 ? 'cheer' : 'idle') : e.place === 1 ? 'cheer' : e.place === n ? 'sad' : 'clap';
      anim.play(state, { blend: 0 });
      this.rigs.push({ rig, anim });
    });
    this.camera.position.set(0, 1.9, 6.2);
    this.camera.lookAt(0, 1.05, 0);
    this.spawnConfetti();
  }

  private spawnConfetti(): void {
    const N = 260;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    this.confettiVel = new Float32Array(N * 3);
    const cols = ['#ff5a5f', '#ffd23a', '#3bb37a', '#3ff2ff', '#ff4fd8', '#2f8fd8'].map(c => new THREE.Color(c));
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 3; pos[i * 3 + 1] = 3 + Math.random() * 3; pos[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
      const c = cols[i % cols.length]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      this.confettiVel[i * 3] = (Math.random() - 0.5) * 0.3; this.confettiVel[i * 3 + 1] = -0.4 - Math.random() * 0.5; this.confettiVel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.confetti = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.05, vertexColors: true }));
    this.scene.add(this.confetti);
  }

  update(dt: number): void {
    this.t += dt;
    for (const r of this.rigs) r.anim.update(dt);
    if (!this.calm) this.camera.position.x = Math.sin(this.t * 0.25) * 0.35;
    this.camera.lookAt(0, 1.05, 0);
    if (this.confetti && this.confettiVel) {
      const a = this.confetti.geometry.getAttribute('position') as THREE.BufferAttribute;
      const p = a.array as Float32Array, v = this.confettiVel;
      for (let i = 0; i < p.length; i += 3) {
        p[i] += (v[i] + Math.sin(this.t * 3 + i) * 0.15) * dt; p[i + 1] += v[i + 1] * dt; p[i + 2] += v[i + 2] * dt;
        if (p[i + 1] < 0) { p[i + 1] = 4 + Math.random() * 2; p[i] = (Math.random() - 0.5) * 3; }
      }
      a.needsUpdate = true;
      this.confetti.visible = !this.calm;
    }
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    for (const r of this.rigs) r.rig.dispose();
    this.confetti?.geometry.dispose();
  }
}

function numberTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1d3a52'; g.font = '900 84px "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

import * as THREE from 'three';
import { addOutline, toon } from '../render/Toon';
import type { BuddyRig } from '../buddy/BuddyBuilder';
import { Rng } from '../tabletennis/BallPhysics';

/**
 * The look of swordplay, all made in code: practice blades (6 skins), the blade trail ribbon (4 styles)
 * with a motion-blur smear, and outfits that clip onto a Buddy's joints.
 */
export type BladeSkin = 'wood' | 'foam' | 'neon' | 'crystal' | 'candy' | 'galaxy';
export type BladeTrail = 'classic' | 'sparkle' | 'rainbow' | 'comet';
export type Outfit = 'none' | 'ninja' | 'knight' | 'samurai' | 'pirate';

export const BLADE_SKINS: readonly BladeSkin[] = ['wood', 'foam', 'neon', 'crystal', 'candy', 'galaxy'];
export const OUTFITS: readonly Outfit[] = ['none', 'ninja', 'knight', 'samurai', 'pirate'];

const SKIN: Record<BladeSkin, { blade: string; hilt: string; guard: string; glow: string | null; opacity?: number; width: number }> = {
  wood: { blade: '#c9935a', hilt: '#6b4226', guard: '#8a5a32', glow: null, width: 1 },
  foam: { blade: '#4fc3f7', hilt: '#ffcf3a', guard: '#ff7a59', glow: null, width: 1.35 },
  neon: { blade: '#1b1f2e', hilt: '#2b2f38', guard: '#3cff9a', glow: '#3cff9a', width: 1 },
  crystal: { blade: '#c9f6ff', hilt: '#6c7a99', guard: '#e6fbff', glow: '#bff6ff', opacity: 0.78, width: 1 },
  candy: { blade: '#ffffff', hilt: '#ff5fa2', guard: '#ffd23a', glow: null, width: 1.1 },
  galaxy: { blade: '#241a4a', hilt: '#1d2a3a', guard: '#7a5cff', glow: '#9b7dff', width: 1 }
};

function stripes(c1: string, c2: string, stars = false): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 32; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = c1; g.fillRect(0, 0, 32, 256);
  if (stars) {
    const r = new Rng(11);
    for (let i = 0; i < 60; i++) { g.fillStyle = i % 5 ? '#ffffff' : '#9b7dff'; g.globalAlpha = 0.4 + r.next() * 0.6; g.fillRect(r.next() * 32, r.next() * 256, 2, 2); }
    g.globalAlpha = 1;
  } else {
    g.fillStyle = c2;
    for (let y = -32; y < 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(32, y + 16); g.lineTo(32, y + 30); g.lineTo(0, y + 14); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A practice sword: rounded flat blade (+y along the blade, hilt at the origin), cross-guard and grip,
 * plus a soft additive halo that glows in the skin's colour (or the player's colour).
 */
export class BladeMesh {
  readonly group = new THREE.Group();
  private readonly halo: THREE.Mesh;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly tmp = new THREE.Vector3();

  constructor(skin: BladeSkin, player: string, readonly len: number) {
    const k = SKIN[skin] ?? SKIN.wood;
    const w = 0.03 * k.width;
    const bg = new THREE.CapsuleGeometry(w, len - w * 2, 4, 10);
    bg.translate(0, len / 2, 0);
    const tex = skin === 'candy' ? stripes('#ffffff', '#ff4f5e') : skin === 'galaxy' ? stripes('#241a4a', '', true) : null;
    const bm = toon(tex ? '#ffffff' : k.blade, { ...(tex ? { map: tex } : {}), ...(k.opacity ? { transparent: true, opacity: k.opacity } : {}) });
    const blade = new THREE.Mesh(bg, bm);
    blade.scale.set(1, 1, 0.55);
    blade.castShadow = true;
    addOutline(blade, 0.06);
    const gg = new THREE.BoxGeometry(0.16, 0.028, 0.05);
    const gm = toon(k.guard);
    const guard = new THREE.Mesh(gg, gm); guard.castShadow = true;
    addOutline(guard, 0.08);
    const hg = new THREE.CylinderGeometry(0.02, 0.022, 0.2, 10); hg.translate(0, -0.1, 0);
    const hm = toon(k.hilt);
    const hilt = new THREE.Mesh(hg, hm);
    const pg = new THREE.SphereGeometry(0.03, 10, 8); pg.translate(0, -0.21, 0);
    const pommel = new THREE.Mesh(pg, gm);
    // the glow halo: a bigger, softer copy of the blade drawn additively
    const halo = new THREE.CapsuleGeometry(w * 2.4, len - w * 2, 4, 10); halo.translate(0, len / 2, 0);
    this.haloMat = new THREE.MeshBasicMaterial({ color: k.glow ?? player, transparent: true, opacity: k.glow ? 0.35 : 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
    this.halo = new THREE.Mesh(halo, this.haloMat);
    this.halo.scale.set(1, 1, 0.6);
    this.group.add(blade, guard, hilt, pommel, this.halo);
    this.disposables.push(bg, bm, gg, gm, hg, hm, pg, halo, this.haloMat);
    if (tex) this.disposables.push(tex);
  }

  /** Place the hilt at `hilt` (world) pointing along `dir` (world, unit); `glow` 0..1 brightens the halo. */
  place(hilt: THREE.Vector3, dir: THREE.Vector3, glow = 0): void {
    this.group.position.copy(hilt);
    this.group.quaternion.setFromUnitVectors(this.up, this.tmp.copy(dir).normalize());
    this.haloMat.opacity = 0.14 + 0.4 * Math.min(1, glow);
  }

  dispose(): void { for (const d of this.disposables) d.dispose(); this.group.removeFromParent(); }
}

/**
 * The blade's trail: a ribbon between the tip and a point along the blade over the last `n` frames, fading
 * out; plus a motion-blur smear (the area swept since last frame) that shows only on fast swings.
 */
export class BladeTrailRibbon {
  readonly mesh: THREE.Mesh;
  private readonly smear: THREE.Mesh;
  private readonly sparks: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly smearPos: Float32Array;
  private readonly sparkPos: Float32Array;
  private readonly smearMat: THREE.MeshBasicMaterial;
  private readonly pts: Array<{ a: THREE.Vector3; b: THREE.Vector3 }> = [];
  private readonly base = new THREE.Color();
  private readonly c = new THREE.Color();
  private readonly prevA = new THREE.Vector3();
  private readonly prevB = new THREE.Vector3();
  private hasPrev = false;
  private hue = 0;
  private readonly N = 32;
  /** Frames kept (quality). */
  length = 22;
  smearOn = true;

  constructor(scene: THREE.Scene, color: string, public style: BladeTrail) {
    this.base.set(color);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.N * 2 * 3).fill(0);
    this.col = new Float32Array(this.N * 2 * 4).fill(0);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    const idx: number[] = [];
    for (let i = 0; i < this.N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.mesh.frustumCulled = false;
    const sg = new THREE.BufferGeometry();
    this.smearPos = new Float32Array(4 * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.smearPos, 3));
    sg.setIndex([0, 1, 2, 0, 2, 3]);
    this.smearMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.smear = new THREE.Mesh(sg, this.smearMat);
    this.smear.frustumCulled = false;
    const pg = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(this.N * 3).fill(-99);
    pg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(pg, new THREE.PointsMaterial({ color: '#fff6c4', size: 0.05, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false;
    scene.add(this.mesh, this.smear, this.sparks);
  }

  clear(): void { this.pts.length = 0; this.hasPrev = false; this.write(0); }

  /** Push this frame's blade (hilt and tip, world). `speed` (m/s) fades the trail in on fast motion. */
  push(hilt: THREE.Vector3, tip: THREE.Vector3, speed: number, dt: number): void {
    const a = tip.clone(), b = hilt.clone().lerp(tip, 0.45);
    this.pts.unshift({ a, b });
    while (this.pts.length > Math.min(this.N, this.length)) this.pts.pop();
    const k = Math.max(0, Math.min(1, (speed - 2) / 8));
    if (this.style === 'rainbow') this.hue = (this.hue + dt * 0.8) % 1;
    this.write(k);
    // smear: the quad swept since last frame
    if (this.hasPrev && this.smearOn) {
      this.smearPos.set([this.prevB.x, this.prevB.y, this.prevB.z, this.prevA.x, this.prevA.y, this.prevA.z, a.x, a.y, a.z, b.x, b.y, b.z]);
      (this.smear.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      this.smear.geometry.computeBoundingSphere();
      this.smearMat.opacity = 0.35 * Math.max(0, Math.min(1, (speed - 5) / 8));
    } else this.smearMat.opacity = 0;
    this.prevA.copy(a); this.prevB.copy(b); this.hasPrev = true;
  }

  private colourAt(i: number, n: number): THREE.Color {
    const f = i / Math.max(1, n);
    switch (this.style) {
      case 'rainbow': return this.c.setHSL((this.hue + f * 0.7) % 1, 0.9, 0.6);
      case 'comet': return this.c.setRGB(1, Math.max(0.2, 0.95 - f), Math.max(0, 0.6 - f));
      case 'sparkle': return this.c.copy(this.base).lerp(new THREE.Color('#ffffff'), 0.5);
      default: return this.c.copy(this.base);
    }
  }

  private write(k: number): void {
    const n = this.pts.length;
    for (let i = 0; i < this.N; i++) {
      const p = this.pts[Math.min(i, Math.max(0, n - 1))];
      const alpha = i < n && n > 1 ? (1 - i / n) * 0.7 * k : 0;
      const c = this.colourAt(i, n);
      const ax = p ? p.a.x : 0, ay = p ? p.a.y : -99, az = p ? p.a.z : 0;
      const bx = p ? p.b.x : 0, by = p ? p.b.y : -99, bz = p ? p.b.z : 0;
      this.pos.set([ax, ay, az, bx, by, bz], i * 6);
      this.col.set([c.r, c.g, c.b, alpha, c.r, c.g, c.b, alpha * 0.2], i * 8);
      if (this.style === 'sparkle' && i < n && i % 3 === 0 && k > 0.2) this.sparkPos.set([ax + Math.sin(i * 12.9) * 0.04, ay + Math.cos(i * 7.1) * 0.04, az], i * 3);
      else this.sparkPos.set([0, -99, 0], i * 3);
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.mesh, this.smear]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.removeFromParent(); }
    this.sparks.geometry.dispose(); (this.sparks.material as THREE.Material).dispose(); this.sparks.removeFromParent();
  }
}

/* ---------------- outfits ---------------- */

/**
 * Dress a Buddy: meshes parented to its joints (head, spine, hips, shoulders), all original and simple.
 * Returns the disposables; they go away with the rig's own dispose (removeFromParent) too.
 */
export function dressBuddy(rig: BuddyRig, outfit: Outfit, accent = '#ff7a59'): Array<{ dispose(): void }> {
  const out: Array<{ dispose(): void }> = [];
  if (outfit === 'none') return out;
  const J = rig.joints;
  const part = (geo: THREE.BufferGeometry, color: string, parent: THREE.Object3D, outline = 0.05): THREE.Mesh => {
    const m = new THREE.Mesh(geo, toon(color));
    m.castShadow = true;
    if (outline) addOutline(m, outline);
    parent.add(m);
    out.push(geo, m.material as THREE.Material);
    return m;
  };
  const R = 0.22; // head radius
  switch (outfit) {
    case 'ninja': {
      const band = part(new THREE.TorusGeometry(R * 1.03, 0.03, 8, 26), '#2b2f38', J.head);
      band.rotation.x = Math.PI / 2 - 0.1; band.position.y = R * 0.3;
      for (const s of [-1, 1]) {
        const tail = part(new THREE.BoxGeometry(0.03, 0.2, 0.012), '#2b2f38', J.head, 0);
        tail.position.set(0.04 * s, R * 0.1, -R * 1.05); tail.rotation.set(0.5, 0, 0.25 * s);
      }
      const mask = part(new THREE.SphereGeometry(R * 1.04, 20, 10, Math.PI / 2 - 1.1, 2.2, Math.PI * 0.56, Math.PI * 0.3), '#2b2f38', J.head, 0);
      mask.position.y = 0.005;
      const sash = part(new THREE.TorusGeometry(0.19, 0.035, 8, 22), accent, J.hips);
      sash.rotation.x = Math.PI / 2; sash.scale.set(1.08, 0.82, 1); sash.position.y = 0.04;
      break;
    }
    case 'knight': {
      const helm = part(new THREE.SphereGeometry(R * 1.12, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), '#b8c2cc', J.head);
      helm.position.y = 0.01;
      const visor = part(new THREE.BoxGeometry(R * 1.4, 0.035, 0.06), '#1d2a3a', J.head, 0);
      visor.position.set(0, 0.04, R * 0.98);
      const plume = part(new THREE.ConeGeometry(0.05, 0.2, 8), accent, J.head);
      plume.position.set(0, R * 1.25, -0.03); plume.rotation.x = -0.3;
      const chest = part(new THREE.CylinderGeometry(0.19, 0.17, 0.3, 16, 1, false, -Math.PI * 0.45, Math.PI * 0.9), '#b8c2cc', J.spine);
      chest.position.y = 0.26; chest.scale.set(1.08, 1, 0.9);
      (chest.material as THREE.Material).side = THREE.DoubleSide;
      for (const sh of [J.shoulderL, J.shoulderR]) {
        const p = part(new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#9aa6b2', sh);
        p.position.y = 0.01;
      }
      break;
    }
    case 'samurai': {
      const helm = part(new THREE.SphereGeometry(R * 1.12, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), '#3a3f58', J.head);
      helm.position.y = 0.03;
      const brim = part(new THREE.CylinderGeometry(R * 1.35, R * 1.5, 0.05, 22, 1, true), '#3a3f58', J.head);
      brim.position.y = 0.01; (brim.material as THREE.Material).side = THREE.DoubleSide;
      const crest = part(new THREE.TorusGeometry(0.09, 0.016, 6, 16, Math.PI), '#ffd23a', J.head, 0);
      crest.position.set(0, R * 0.95, R * 0.75); crest.rotation.z = 0;
      for (const sh of [J.shoulderL, J.shoulderR]) {
        for (let i = 0; i < 3; i++) {
          const pl = part(new THREE.BoxGeometry(0.14, 0.035, 0.12), i % 2 ? accent : '#3a3f58', sh, 0.04);
          pl.position.set(0, -0.02 - i * 0.04, 0);
        }
      }
      break;
    }
    case 'pirate': {
      const brim = part(new THREE.CylinderGeometry(R * 1.55, R * 1.55, 0.025, 3), '#2b2f38', J.head);
      brim.position.y = R * 0.62; brim.rotation.y = Math.PI / 6;
      const crown = part(new THREE.CylinderGeometry(R * 0.8, R * 1.0, R * 0.55, 18), '#2b2f38', J.head);
      crown.position.y = R * 0.9;
      const skull = part(new THREE.CircleGeometry(0.035, 12), '#f4f4f4', J.head, 0);
      skull.position.set(0, R * 0.92, R * 0.86);
      const patch = part(new THREE.CircleGeometry(0.045, 14), '#1d2a3a', J.head, 0);
      patch.position.set(0.075, 0.04, R * 0.99);
      const strap = part(new THREE.TorusGeometry(R * 1.01, 0.008, 4, 28, Math.PI), '#1d2a3a', J.head, 0);
      strap.rotation.set(0, Math.PI / 2, 0.5); strap.position.y = 0.04;
      const sash = part(new THREE.TorusGeometry(0.19, 0.04, 8, 22), '#d0393f', J.hips);
      sash.rotation.x = Math.PI / 2; sash.scale.set(1.08, 0.82, 1); sash.position.y = 0.04;
      break;
    }
  }
  return out;
}

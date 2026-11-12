import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../tuning';
import { toon, toonMesh, glow } from '../render/Toon';
import type { LaneSpec } from './dims';
import { makePinMesh } from './Pins';
import { tenPinLayout } from '../sports/pinLayouts';

const smooth = (a: number, b: number, t: number): number => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

export type LaneLook = 'classic' | 'neon' | 'sunset';

/** Colours and lighting for each unlockable lane look. The scene reads `sky`, `fog` and the light colours. */
export interface LookDef {
  sky: string; fog: string; fogNear: number; fogFar: number;
  hemiSky: string; hemiGround: string; hemi: number; sun: string; sunI: number; deck: string;
  wood: number; woodSat: number; approach: string; floor: string; wall: string; ceil: string | null;
  neonA: string; neonB: string; kick: string; cap: string; sign: [string, string, string];
}

export const LOOKS: Record<LaneLook, LookDef> = {
  classic: {
    sky: '#2a2f5c', fog: '#2a2f5c', fogNear: 16, fogFar: 36, hemiSky: '#fff1e0', hemiGround: '#5b3f9a', hemi: 1.6, sun: '#fffaf0', sunI: 2.2, deck: '#fff2cc',
    wood: 74, woodSat: 62, approach: '#fff3dc', floor: '#5b3f9a', wall: '#bfe9e0', ceil: '#2a2f5c',
    neonA: '#ff4fd8', neonB: '#3ff2ff', kick: '#3b5bb5', cap: '#2b3f7a', sign: ['#ff5fa2', '#ffb347', '#3fd2ff']
  },
  neon: {
    sky: '#0b0820', fog: '#0b0820', fogNear: 10, fogFar: 30, hemiSky: '#b9a6ff', hemiGround: '#1a0f3a', hemi: 0.9, sun: '#c8b6ff', sunI: 1.2, deck: '#ff9cf0',
    wood: 38, woodSat: 40, approach: '#2a2350', floor: '#140d33', wall: '#1d1450', ceil: '#080616',
    neonA: '#ff2fd0', neonB: '#2ff6ff', kick: '#26145e', cap: '#120a33', sign: ['#ff2fd0', '#7a3cff', '#2ff6ff']
  },
  sunset: {
    sky: '#ff9a6b', fog: '#ffb28a', fogNear: 18, fogFar: 48, hemiSky: '#ffe0c0', hemiGround: '#f0a070', hemi: 1.8, sun: '#ffd2a0', sunI: 2.4, deck: '#ffe6b0',
    wood: 72, woodSat: 55, approach: '#fff0d0', floor: '#f6dfa8', wall: '#ffd6b0', ceil: null,
    neonA: '#ffd23a', neonB: '#ff6b8a', kick: '#2f8fd8', cap: '#1f6fae', sign: ['#ff7a3c', '#ffd23a', '#ff5fa2']
  }
};

/** Static lane: Rapier colliders (oil / dry sections, gutters, pit, kickbacks, optional bumpers) plus the alley visuals. */
export class Lane {
  readonly group = new THREE.Group();
  readonly look: LookDef;
  private oil!: RAPIER.Collider;
  private dry!: RAPIER.Collider;
  private bumperColliders: RAPIER.Collider[] = [];
  private bumperMeshes = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(scene: THREE.Scene, world: RAPIER.World, private readonly spec: LaneSpec, lookId: LaneLook = 'classic', private lowDetail = false) {
    this.look = LOOKS[lookId] ?? LOOKS.classic;
    this.buildPhysics(world);
    this.buildLane(this.group, true);
    if (!lowDetail) {
      for (const x of [-spec.neighbourX, spec.neighbourX]) {      // neighbour lanes for atmosphere (visual only)
        const g = new THREE.Group(); g.position.x = x; this.buildLane(g, false); this.group.add(g);
      }
    }
    if (lookId === 'sunset') this.buildBeach(); else this.buildRoom(lookId === 'neon');
    this.group.add(this.bumperMeshes);
    this.bumperMeshes.visible = false;
    scene.add(this.group);
  }

  /** 0 on the oil, 1 on the dry back end, with a 3 m blend. Used by the hook force. */
  static dryness(z: number): number {
    const d = -z;
    return smooth(TUNING.oilLength - 1.5, TUNING.oilLength + 1.5, d);
  }

  /** Apply live DebugPanel friction changes. */
  syncTuning(): void {
    this.oil.setFriction(TUNING.oilFriction);
    this.dry.setFriction(TUNING.dryFriction);
  }

  /** Gutter assist: rails over both gutters that bounce the ball back onto the lane. */
  setBumpers(on: boolean): void {
    for (const c of this.bumperColliders) c.setEnabled(on);
    this.bumperMeshes.visible = on;
  }

  /* ---------------- physics ---------------- */
  private buildPhysics(world: RAPIER.World): void {
    const S = this.spec;
    const fixed = (hx: number, hy: number, hz: number, x: number, y: number, z: number, friction: number, restitution = 0.1): RAPIER.Collider =>
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction).setRestitution(restitution));

    const oilLen = TUNING.oilLength;
    this.oil = fixed(S.halfW, 0.05, oilLen / 2, 0, -0.05, -oilLen / 2, TUNING.oilFriction);
    const dryLen = -S.deckEndZ - oilLen;
    this.dry = fixed(S.halfW, 0.05, dryLen / 2, 0, -0.05, -oilLen - dryLen / 2, TUNING.dryFriction);
    fixed(S.halfW + S.gutterW + 0.6, 0.05, S.approachLen / 2, 0, -0.05, S.approachLen / 2, 0.6);   // approach

    const laneLen = -S.deckEndZ;
    for (const s of [-1, 1]) {
      // gutter floor and outer lip
      fixed(S.gutterW / 2, 0.02, laneLen / 2, s * (S.halfW + S.gutterW / 2), -S.gutterDepth - 0.02, -laneLen / 2, 0.3);
      fixed(0.03, 0.12, laneLen / 2, s * (S.halfW + S.gutterW + 0.03), 0, -laneLen / 2, 0.3);
      // kickbacks (side walls of the pin deck and pit)
      const kz0 = S.headZ + 0.8, kz1 = S.pitEndZ;
      fixed(0.04, 0.45, (kz0 - kz1) / 2, s * S.kickbackX, 0.35, (kz0 + kz1) / 2, 0.3, 0.3);
      // bumper rail sitting over the gutter, from just past the foul line to the pin deck
      const bz0 = -0.6, bz1 = S.headZ + 0.6;
      const b = fixed(0.05, 0.09, (bz0 - bz1) / 2, s * (S.halfW + 0.05), 0.09, (bz0 + bz1) / 2, 0.05, 0.55);
      b.setEnabled(false);
      this.bumperColliders.push(b);
    }
    // pit floor and back wall: soft and grippy so things stop there
    const pitLen = S.deckEndZ - S.pitEndZ;
    fixed(S.kickbackX, 0.05, pitLen / 2, 0, -0.4, S.deckEndZ - pitLen / 2, 0.9, 0.05);
    fixed(S.kickbackX, 0.7, 0.05, 0, 0.3, S.pitEndZ, 0.9, 0.05);
  }

  /* ---------------- visuals ---------------- */
  private track<T extends { dispose(): void }>(x: T): T { this.disposables.push(x); return x; }

  private boardTexture(): THREE.CanvasTexture {
    const boards = Math.round(39 * this.spec.halfW / 0.525);
    const c = document.createElement('canvas'); c.width = boards * 10; c.height = 8;
    const x = c.getContext('2d') as CanvasRenderingContext2D;
    const L = this.look;
    for (let i = 0; i < boards; i++) {
      const l = L.wood + (i % 3) * 3 + Math.random() * 3;
      x.fillStyle = `hsl(33, ${L.woodSat}%, ${l}%)`; x.fillRect(i * 10, 0, 10, 8);
      x.fillStyle = 'rgba(120,70,30,.25)'; x.fillRect(i * 10, 0, 1, 8);
    }
    const t = this.track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  }

  private buildLane(g: THREE.Group, main: boolean): void {
    const S = this.spec, L = this.look;
    const laneLen = -S.deckEndZ;
    const tex = this.boardTexture(); tex.repeat.set(1, laneLen);
    const wood = new THREE.Mesh(new THREE.BoxGeometry(S.halfW * 2, 0.1, laneLen), toon('#ffffff', { map: tex }));
    wood.position.set(0, -0.05, -laneLen / 2); wood.receiveShadow = true; g.add(wood);

    const atex = this.boardTexture(); atex.repeat.set(1.4, S.approachLen);
    const approach = new THREE.Mesh(new THREE.BoxGeometry(S.halfW * 2 + S.gutterW * 2 + 0.2, 0.1, S.approachLen), toon(L.approach, { map: atex }));
    approach.position.set(0, -0.05, S.approachLen / 2); approach.receiveShadow = true; g.add(approach);

    const foul = new THREE.Mesh(new THREE.BoxGeometry(S.halfW * 2 + S.gutterW * 2 + 0.2, 0.002, 0.02), new THREE.MeshBasicMaterial({ color: '#d62839' }));
    foul.position.set(0, 0.001, 0); g.add(foul);

    // target arrows (V shape) and guide dots, spaced by board
    const boards = Math.round(39 * S.halfW / 0.525);
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.12); arrowShape.lineTo(0.025, 0); arrowShape.lineTo(-0.025, 0); arrowShape.closePath();
    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    const markMat = new THREE.MeshBasicMaterial({ color: L.wood < 50 ? '#2ff6ff' : '#7a3e1a' });
    const board = (b: number): number => -S.halfW + (b - 0.5) * (S.halfW * 2 / boards);
    const arrowBoards = [5, 10, 15, 20, 25, 30, 35].map(b => Math.round(b * boards / 39));
    arrowBoards.forEach((b, i) => {
      const a = new THREE.Mesh(arrowGeo, markMat);
      a.rotation.x = -Math.PI / 2;
      a.position.set(board(b), 0.002, -4.3 - (3 - Math.abs(i - 3)) * 0.3);
      g.add(a);
    });
    for (const b of [3, 5, 8, 11, 14, 26, 29, 32, 35, 37].map(v => Math.round(v * boards / 39))) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.012, 10), markMat);
      d.rotation.x = -Math.PI / 2; d.position.set(board(b), 0.002, -2.1); g.add(d);
    }

    if (main) {
      // faint sheen so players can see where the oil ends
      const sheen = new THREE.Mesh(new THREE.PlaneGeometry(S.halfW * 2, TUNING.oilLength), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.07, depthWrite: false }));
      sheen.rotation.x = -Math.PI / 2; sheen.position.set(0, 0.003, -TUNING.oilLength / 2); g.add(sheen);
      if (L.wood < 50) {
        // Neon Night: glowing edge lines down the lane
        for (const s of [-1, 1]) {
          const line = glow(new THREE.BoxGeometry(0.012, 0.004, laneLen), s < 0 ? L.neonA : L.neonB);
          line.position.set(s * (S.halfW - 0.01), 0.003, -laneLen / 2); g.add(line);
        }
      }
      // bumper rails (shown when gutter assist is on)
      for (const s of [-1, 1]) {
        const len = -0.6 - (S.headZ + 0.6);
        const rail = toonMesh(new THREE.CapsuleGeometry(0.05, len, 4, 10), '#ffd23a', 0.03);
        rail.rotation.x = Math.PI / 2;
        rail.position.set(s * (S.halfW + 0.05), 0.09, (-0.6 + S.headZ + 0.6) / 2);
        this.bumperMeshes.add(rail);
      }
    }

    // gutters: half pipes
    const gutterGeo = new THREE.CylinderGeometry(S.gutterW / 2, S.gutterW / 2, laneLen, 14, 1, true, -Math.PI / 2, Math.PI);
    gutterGeo.rotateX(Math.PI / 2);
    const gutterMat = toon(L.wood < 50 ? '#3a2f70' : '#b9c4d6', { side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const gm = new THREE.Mesh(gutterGeo, gutterMat);
      gm.position.set(s * (S.halfW + S.gutterW / 2), -0.0, -laneLen / 2); gm.receiveShadow = true; g.add(gm);
      const cap = toonMesh(new THREE.BoxGeometry(0.08, 0.1, laneLen + S.approachLen), L.cap, 0.02);
      cap.position.set(s * (S.kickbackX + 0.02), 0.02, (-laneLen + S.approachLen) / 2); g.add(cap);
      const kick = toonMesh(new THREE.BoxGeometry(0.08, 0.9, S.headZ + 0.8 - S.pitEndZ), L.kick, 0.02);
      kick.position.set(s * S.kickbackX, 0.35, (S.headZ + 0.8 + S.pitEndZ) / 2); g.add(kick);
      const neon = glow(new THREE.BoxGeometry(0.03, 0.03, S.headZ + 0.8 - S.pitEndZ), s < 0 ? L.neonA : L.neonB);
      neon.position.set(s * S.kickbackX, 0.82, (S.headZ + 0.8 + S.pitEndZ) / 2); g.add(neon);
    }

    // pin deck: slightly lighter wood, pit, curtain, masking unit
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(S.halfW * 2, S.headZ + 0.3 - S.deckEndZ), toon(L.wood < 50 ? '#3a2f70' : '#ffe7bf'));
    deck.rotation.x = -Math.PI / 2; deck.position.set(0, 0.0015, (S.headZ + 0.3 + S.deckEndZ) / 2); deck.receiveShadow = true; g.add(deck);
    const pit = new THREE.Mesh(new THREE.BoxGeometry(S.kickbackX * 2, 0.05, S.deckEndZ - S.pitEndZ), toon('#1c1f3a'));
    pit.position.set(0, -0.4, (S.deckEndZ + S.pitEndZ) / 2); g.add(pit);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(S.kickbackX * 2, 1.4), toon('#151a36'));
    curtain.position.set(0, 0.3, S.pitEndZ + 0.06); g.add(curtain);
    const maskH = this.spec.kind === 'hundred' ? 1.0 : 0.8;
    const mask = new THREE.Mesh(new THREE.BoxGeometry(S.kickbackX * 2 + 0.3, maskH, 0.1), new THREE.MeshBasicMaterial({ map: this.signTexture(main) }));
    mask.position.set(0, 1.25 + (maskH - 0.8) / 2 + (this.spec.kind === 'hundred' ? 0.25 : 0), S.headZ - 0.6); g.add(mask);
    const maskLight = glow(new THREE.BoxGeometry(S.kickbackX * 2 + 0.3, 0.04, 0.04), '#fff6c8');
    maskLight.position.set(0, mask.position.y - maskH / 2 - 0.01, S.headZ - 0.55); g.add(maskLight);

    if (!main) {
      for (const [x, z] of tenPinLayout(S.headZ)) { const p = makePinMesh(); p.position.set(x, 0, z); g.add(p); }
    }
  }

  private signTexture(main: boolean): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = 512; c.height = 160;
    const x = c.getContext('2d') as CanvasRenderingContext2D;
    const grad = x.createLinearGradient(0, 0, 512, 0);
    const [a, b, d] = this.look.sign;
    grad.addColorStop(0, a); grad.addColorStop(0.5, b); grad.addColorStop(1, d);
    x.fillStyle = grad; x.fillRect(0, 0, 512, 160);
    x.fillStyle = 'rgba(255,255,255,.25)';
    for (let i = 0; i < 14; i++) { x.beginPath(); x.arc(Math.random() * 512, Math.random() * 160, 6 + Math.random() * 20, 0, 7); x.fill(); }
    x.fillStyle = '#ffffff'; x.strokeStyle = '#1d2a3a'; x.lineWidth = 10; x.lineJoin = 'round';
    x.font = '900 72px "Trebuchet MS", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const label = main ? (this.spec.kind === 'hundred' ? '100 PINS!' : 'BREEZY BOWL') : 'LANE ' + (2 + Math.floor(Math.random() * 6));
    x.strokeText(label, 256, 84); x.fillText(label, 256, 84);
    const t = this.track(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  private buildRoom(neon: boolean): void {
    const g = this.group, S = this.spec, L = this.look;
    const width = Math.max(9, S.neighbourX * 2 + 4.6);
    const len = -S.pitEndZ + S.approachLen + 6;
    const midZ = (S.approachLen + 6 + S.pitEndZ) / 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width + 5, len), toon(L.floor));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.12, midZ); floor.receiveShadow = true; g.add(floor);
    // carpet confetti dots
    const dotA = new THREE.MeshBasicMaterial({ color: neon ? L.neonA : '#ffd23a' }), dotB = new THREE.MeshBasicMaterial({ color: L.neonB });
    for (let i = 0; i < (this.lowDetail ? 30 : 80); i++) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.05 + Math.random() * 0.06, 6), i % 2 ? dotA : dotB);
      d.rotation.x = -Math.PI / 2; d.position.set((Math.random() - 0.5) * (width + 3), -0.115, S.approachLen + Math.random() * 5.5); g.add(d);
    }
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, 4.2), toon(L.wall, { side: THREE.DoubleSide }));
      wall.rotation.y = s * -Math.PI / 2; wall.position.set(s * width / 2, 1.9, midZ); g.add(wall);
      const strip = glow(new THREE.BoxGeometry(0.04, 0.05, len), s < 0 ? L.neonA : L.neonB);
      strip.position.set(s * (width / 2 - 0.05), 2.6, midZ); g.add(strip);
      const strip2 = strip.clone(); strip2.position.y = 0.4; g.add(strip2);
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(width, 4.2), toon(neon ? '#1a0f40' : '#ffd6e0'));
    back.position.set(0, 1.9, S.pitEndZ - 0.4); g.add(back);
    if (L.ceil) {
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(width, len), toon(L.ceil, { side: THREE.DoubleSide }));
      ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 4, midZ); g.add(ceil);
      for (let z = 2; z > S.pitEndZ; z -= 3) {
        const panel = glow(new THREE.BoxGeometry(1.2, 0.03, 0.4), neon ? L.neonA : '#fff8e0');
        panel.position.set(0, 3.98, z); g.add(panel);
      }
    }
    if (neon) {
      // floating neon stars on the back wall
      for (let i = 0; i < 12; i++) {
        const st = glow(new THREE.OctahedronGeometry(0.08 + Math.random() * 0.08), i % 2 ? L.neonA : L.neonB);
        st.position.set((Math.random() - 0.5) * (width - 1), 1.6 + Math.random() * 2.2, S.pitEndZ - 0.3); g.add(st);
      }
    }
    this.buildSeats();
  }

  /** Sunset Beach: an open-air lane on the sand with the sea, a big sun and palms. */
  private buildBeach(): void {
    const g = this.group, S = this.spec, L = this.look;
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), toon(L.floor));
    sand.rotation.x = -Math.PI / 2; sand.position.set(0, -0.12, -8); sand.receiveShadow = true; g.add(sand);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(200, 120), new THREE.MeshBasicMaterial({ color: '#3cb8c8' }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.2, S.pitEndZ - 70); g.add(sea);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(6, 40), new THREE.MeshBasicMaterial({ color: '#fff0b0', fog: false }));
    sun.position.set(-6, 4, S.pitEndZ - 60); g.add(sun);
    const glowRing = new THREE.Mesh(new THREE.CircleGeometry(10, 40), new THREE.MeshBasicMaterial({ color: '#ffd080', transparent: true, opacity: 0.35, fog: false }));
    glowRing.position.copy(sun.position).add(new THREE.Vector3(0, 0, -0.1)); g.add(glowRing);
    // wooden frame over the deck instead of a room
    for (const s of [-1, 1]) {
      const post = toonMesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), '#a86b3c', 0.03);
      post.position.set(s * (S.kickbackX + 0.4), 1.1, S.headZ - 0.6); g.add(post);
    }
    const lintel = toonMesh(new THREE.BoxGeometry(S.kickbackX * 2 + 1.0, 0.16, 0.2), '#a86b3c', 0.03);
    lintel.position.set(0, 2.3, S.headZ - 0.6); g.add(lintel);
    // palms
    const trunkMat = toon('#9a6233'), leafMat = toon('#2f9c48');
    const palm = (x: number, z: number, h: number) => {
      const p = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.09 - i * 0.008, 0.1 - i * 0.008, h / 6, 8), trunkMat);
        seg.position.set(Math.sin(i * 0.3) * 0.15 * i * 0.3, h / 12 + (i * h) / 6, 0); seg.castShadow = true; p.add(seg);
      }
      for (let i = 0; i < 7; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 4), leafMat);
        leaf.scale.set(1.6, 0.12, 0.45);
        const a = (i / 7) * Math.PI * 2;
        leaf.position.set(Math.cos(a) * 0.7, h + 0.05, Math.sin(a) * 0.7);
        leaf.rotation.set(0, -a, -0.35);
        leaf.castShadow = true;
        p.add(leaf);
      }
      p.position.set(x, -0.1, z);
      g.add(p);
    };
    const side = S.neighbourX + 1.8;
    for (const [x, z, h] of [[-side, 2, 3.4], [side, -3, 3.8], [-side - 1.2, -10, 4.2], [side + 0.8, -14, 3.6], [-side, -19, 4.0], [side + 1.5, 4.5, 3.2]] as const) palm(x, z, h);
    this.buildSeats();
  }

  private buildSeats(): void {
    const g = this.group, S = this.spec;
    // seating area behind the approach
    for (const s of [-1, 1]) {
      const sofa = toonMesh(new THREE.BoxGeometry(1.6, 0.45, 0.7), s < 0 ? '#ff7a8a' : '#3bb3ff', 0.02);
      sofa.position.set(s * 1.4, 0.1, S.approachLen + 1.6); g.add(sofa);
      const backrest = toonMesh(new THREE.BoxGeometry(1.6, 0.6, 0.18), s < 0 ? '#ff5a72' : '#2f8fd8', 0.02);
      backrest.position.set(s * 1.4, 0.45, S.approachLen + 1.95); g.add(backrest);
    }
    const ret = toonMesh(new THREE.BoxGeometry(0.5, 0.7, 1.0), '#2b3f7a', 0.02);
    ret.position.set(S.halfW + S.gutterW + 0.55, 0.23, S.approachLen - 0.9); g.add(ret);
    const retTop = toonMesh(new THREE.SphereGeometry(0.22, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#3ff2ff', 0.02);
    retTop.position.set(S.halfW + S.gutterW + 0.55, 0.58, S.approachLen - 0.9); g.add(retTop);
  }

  dispose(): void {
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}

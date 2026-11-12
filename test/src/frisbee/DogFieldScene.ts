import * as THREE from 'three';
import { addOutline, toon } from '../render/Toon';
import type { QualityLevel } from '../core/Quality';
import { Terrain, plantTrees, placeRocks, type TreeSpot } from './Terrain';
import { DOG_ZONES } from './dogScoring';
import type { DogBreed, DogState } from './DogAI';

/**
 * "Beach Park": a 70 m grass field running toward −z with sand on both sides, palms, a sea along the
 * right edge, the three coloured bonus rings and distance flags every 10 m. All primitives and a
 * heightmap; trees are instanced. Golden-hour light is set by the mode.
 */
export const BEACH_LOOK = {
  sky: '#ffcf8f', fog: '#ffd9a8', fogNear: 60, fogFar: 190, hemiSky: '#fff1d6', hemiGround: '#6f8f5a', hemi: 1.25,
  sun: '#ffc27a', sunI: 2.5, sunDir: [-30, 22, 18] as [number, number, number]
};

export class DogField {
  readonly ground: Terrain;
  private readonly group = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly sea: THREE.Mesh;
  private readonly rings: THREE.Mesh[] = [];
  private t = 0;

  constructor(readonly scene: THREE.Scene, quality: QualityLevel, seed: number) {
    this.ground = new Terrain({
      cx: 0, cz: -28, w: 120, d: 130, seed, hills: 0.9, scale: 22,
      pads: [{ x: 0, z: -28, r: 30, h: 0 }],
      // sand dunes either side, the sea beyond the right one
      sand: [{ x: 26, z: -28, rx: 12, rz: 80 }, { x: -30, z: -28, rx: 9, rz: 80 }, { x: 0, z: 14, rx: 30, rz: 6 }],
      ponds: [{ x: 58, z: -28, rx: 24, rz: 160 }],
      waterLevel: -0.25
    });
    const seg = quality === 'low' ? 60 : quality === 'med' ? 90 : 130;
    const terrain = this.ground.buildMesh({ grass: '#7cc45a', fairway: '#8fd06a', rough: '#5f9d48', sand: '#f2d7a0', rock: '#9a9a9a', bed: '#2f7fa8' }, seg);
    this.own(terrain.geometry, terrain.material as THREE.Material);
    this.group.add(terrain);

    // the sea: a big flat plane plus the shallow pond surface
    const seaGeo = new THREE.PlaneGeometry(140, 340, 1, 1); seaGeo.rotateX(-Math.PI / 2);
    const seaMat = toon('#3aa6d8', { transparent: true, opacity: 0.9 });
    this.own(seaGeo, seaMat);
    this.sea = new THREE.Mesh(seaGeo, seaMat);
    this.sea.position.set(110, -0.31, -28);
    this.sea.receiveShadow = true;
    this.group.add(this.sea);
    const water = this.ground.buildWater('#4cb8e0');
    if (water) { this.own(water.geometry, water.material as THREE.Material); this.group.add(water); }

    // bonus rings on the ground
    for (const z of DOG_ZONES) {
      const g = new THREE.RingGeometry(z.r - 0.35, z.r, 48); g.rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.85, depthWrite: false });
      this.own(g, m);
      const ring = new THREE.Mesh(g, m);
      ring.position.set(z.x, this.ground.height(z.x, z.z) + 0.03, z.z);
      ring.renderOrder = 2;
      this.rings.push(ring);
      this.group.add(ring);
      const fg = new THREE.CircleGeometry(z.r - 0.35, 40); fg.rotateX(-Math.PI / 2);
      const fm = new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.16, depthWrite: false });
      this.own(fg, fm);
      const fill = new THREE.Mesh(fg, fm); fill.position.copy(ring.position); fill.position.y -= 0.005;
      this.group.add(fill);
    }
    // distance flags every 10 m down the left side
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6); poleGeo.translate(0, 0.7, 0);
    const flagGeo = new THREE.PlaneGeometry(0.6, 0.38); flagGeo.translate(0.3, 1.2, 0);
    const poleMat = toon('#f4f1ec'), flagMat = toon('#ff5a5f', { side: THREE.DoubleSide });
    this.own(poleGeo, flagGeo, poleMat, flagMat);
    for (let d = 10; d <= 60; d += 10) {
      for (const sx of [-1, 1]) {
        const x = sx * 13, z = -d;
        const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.set(x, this.ground.height(x, z), z); pole.castShadow = true;
        const flag = new THREE.Mesh(flagGeo, flagMat); pole.add(flag);
        if (sx > 0) flag.rotation.y = Math.PI;
        this.group.add(pole);
      }
      this.group.add(this.label(String(d), -13.8, this.ground.height(-13, -d) + 1.85, -d));
    }
    // the throwing spot: a little mat
    const mat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 1.6), toon('#ff8a3c'));
    this.own(mat.geometry, mat.material as THREE.Material);
    mat.position.set(0, 0.02, 0.6); mat.receiveShadow = true;
    this.group.add(mat);

    // palms along both sides, a few rocks on the dunes
    const palms: TreeSpot[] = [];
    for (let z = 8; z > -70; z -= 7) {
      palms.push({ x: 19 + Math.sin(z) * 2, z: z + Math.cos(z * 1.3) * 2, s: 1 + Math.sin(z * 0.7) * 0.15 });
      palms.push({ x: -21 - Math.cos(z * 0.8) * 2.5, z: z - 2 + Math.sin(z) * 2, s: 0.95 + Math.cos(z) * 0.15 });
    }
    const trees = plantTrees(this.ground, palms, 'palm', { trunk: '#a87447', leaf: '#3f9d3a' }, seed + 1);
    this.disposables.push(trees); this.group.add(trees.group);
    const rocks = placeRocks(this.ground, [{ x: -26, z: -10, s: 1.2 }, { x: -25, z: -44, s: 1 }, { x: 24, z: 4, s: 0.8 }], '#a7a196', seed + 2);
    this.disposables.push(rocks); this.group.add(rocks.group);
    // a beach hut and a few umbrellas for scale (cosmetic, behind the thrower)
    this.hut(-9, 10);
    for (const [x, z, c] of [[9, 9, '#ff5fa2'], [14, 6, '#3cc8f0'], [-15, 6, '#ffd84a']] as const) this.umbrella(x, z, c);
    scene.add(this.group);
  }

  private own(...d: Array<{ dispose(): void }>): void { this.disposables.push(...d); }

  private label(text: string, x: number, y: number, z: number): THREE.Sprite {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d')!;
    g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = '#1d2a3a'; g.strokeText(`${text} m`, 64, 34);
    g.fillStyle = '#ffffff'; g.fillText(`${text} m`, 64, 34);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.SpriteMaterial({ map: tex, depthWrite: false });
    this.own(tex, m);
    const s = new THREE.Sprite(m); s.position.set(x, y, z); s.scale.set(2, 1, 1);
    return s;
  }

  private hut(x: number, z: number): void {
    const base = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 3), toon('#f4e3c1'));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.6, 4), toon('#c9974e'));
    this.own(base.geometry, base.material as THREE.Material, roof.geometry, roof.material as THREE.Material);
    base.position.set(x, 1.2, z); roof.position.set(x, 3.2, z); roof.rotation.y = Math.PI / 4;
    for (const m of [base, roof]) { m.castShadow = true; m.receiveShadow = true; addOutline(m, 0.03); this.group.add(m); }
  }

  private umbrella(x: number, z: number, color: string): void {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), toon('#ffffff'));
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.6, 10), toon(color));
    this.own(pole.geometry, pole.material as THREE.Material, top.geometry, top.material as THREE.Material);
    pole.position.set(x, 1.2, z); top.position.set(x, 2.5, z);
    for (const m of [pole, top]) { m.castShadow = true; addOutline(m, 0.04); this.group.add(m); }
  }

  update(dt: number): void {
    this.t += dt;
    this.sea.position.y = -0.31 + Math.sin(this.t * 0.8) * 0.03;
    for (const [i, r] of this.rings.entries()) (r.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.2 * Math.sin(this.t * 2 + i);
  }

  dispose(): void { for (const d of this.disposables) d.dispose(); this.group.removeFromParent(); }
}

/* ---------------- the dog ---------------- */

/**
 * A procedural dog from primitives: body, chest, head with snout and nose, floppy ears, a wagging tail
 * and four legs with a run cycle. It follows the DogAI (position, heading, speed, jump height).
 */
export class DogModel {
  readonly root = new THREE.Group();
  private readonly body: THREE.Group;
  private readonly head: THREE.Group;
  private readonly tail: THREE.Group;
  private readonly ears: THREE.Mesh[] = [];
  private readonly legs: THREE.Group[] = [];
  private readonly mouth = new THREE.Object3D();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private phase = 0;
  private wag = 0;

  constructor(scene: THREE.Scene, readonly breed: DogBreed) {
    const [coat, patch, collar] = breed.coat;
    const m = (c: string) => { const x = toon(c); this.disposables.push(x); return x; };
    const g = <G extends THREE.BufferGeometry>(x: G): G => { this.disposables.push(x); return x; };
    const coatM = m(coat), patchM = m(patch), darkM = m('#1d1a1a'), collarM = m(collar), tongueM = m('#ff7a8a');
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, outline = 0.06): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true;
      if (outline) addOutline(mesh, outline);
      parent.add(mesh);
      return mesh;
    };
    this.body = new THREE.Group();
    this.body.position.y = 0.42;
    this.root.add(this.body);
    const torso = part(g(new THREE.CapsuleGeometry(0.17, 0.42, 4, 12)), coatM, this.body);
    torso.rotation.x = Math.PI / 2;
    const chest = part(g(new THREE.SphereGeometry(0.19, 14, 10)), patchM, this.body, 0.04);
    chest.position.set(0, -0.02, -0.24);
    // head (faces −z, the dog's forward)
    this.head = new THREE.Group();
    this.head.position.set(0, 0.17, -0.36);
    this.body.add(this.head);
    part(g(new THREE.SphereGeometry(0.15, 16, 12)), coatM, this.head);
    const snout = part(g(new THREE.BoxGeometry(0.12, 0.1, 0.16)), patchM, this.head, 0.05);
    snout.position.set(0, -0.04, -0.15);
    const nose = part(g(new THREE.SphereGeometry(0.035, 8, 6)), darkM, this.head, 0);
    nose.position.set(0, -0.005, -0.235);
    const tongue = part(g(new THREE.BoxGeometry(0.05, 0.012, 0.08)), tongueM, this.head, 0);
    tongue.position.set(0, -0.1, -0.2);
    for (const s of [-1, 1]) {
      const eye = part(g(new THREE.SphereGeometry(0.024, 8, 6)), darkM, this.head, 0);
      eye.position.set(0.06 * s, 0.04, -0.12);
      const ear = part(g(new THREE.BoxGeometry(0.07, 0.16, 0.03)), patchM, this.head, 0.05);
      ear.geometry.translate(0, -0.07, 0);
      ear.position.set(0.11 * s, 0.1, 0.0);
      ear.rotation.z = 0.5 * s;
      this.ears.push(ear);
    }
    const ring = part(g(new THREE.TorusGeometry(0.12, 0.022, 6, 16)), collarM, this.body, 0);
    ring.position.set(0, 0.1, -0.3); ring.rotation.x = Math.PI / 2 - 0.4;
    this.mouth.position.set(0, -0.06, -0.26);
    this.head.add(this.mouth);
    // tail
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.07, 0.33);
    this.body.add(this.tail);
    const tl = part(g(new THREE.CylinderGeometry(0.02, 0.035, 0.28, 6)), coatM, this.tail, 0.05);
    tl.geometry.translate(0, 0.14, 0);
    this.tail.rotation.x = 0.7;
    // legs: hips at the corners
    for (const [x, z] of [[-0.1, -0.22], [0.1, -0.22], [-0.1, 0.22], [0.1, 0.22]] as const) {
      const hip = new THREE.Group();
      hip.position.set(x, -0.05, z);
      this.body.add(hip);
      const leg = part(g(new THREE.CylinderGeometry(0.04, 0.035, 0.36, 6)), coatM, hip, 0.05);
      leg.geometry.translate(0, -0.18, 0);
      const paw = part(g(new THREE.SphereGeometry(0.045, 8, 6)), patchM, hip, 0);
      paw.position.y = -0.37;
      this.legs.push(hip);
    }
    this.root.scale.setScalar(breed.size * 1.25);
    scene.add(this.root);
  }

  /** Where the disc sits when carried. */
  mouthPos(out: THREE.Vector3): THREE.Vector3 { this.root.updateMatrixWorld(true); return this.mouth.getWorldPosition(out); }

  update(dt: number, x: number, z: number, heading: number, speed: number, jumpY: number, state: DogState, groundY: number): void {
    this.root.position.set(x, groundY + jumpY, z);
    this.root.rotation.y = -heading;
    const run = Math.min(1, speed / 6);
    this.phase += dt * (4 + speed * 2.2);
    const s = Math.sin(this.phase);
    const airborne = jumpY > 0.05;
    // gallop: front and back pairs in opposite phase; tuck the legs in a jump
    this.legs.forEach((leg, i) => {
      const front = i < 2;
      leg.rotation.x = airborne ? (front ? -0.9 : 0.8) : s * 0.8 * run * (front ? 1 : -1) * (i % 2 ? 1 : 0.85);
    });
    this.body.position.y = 0.42 + Math.abs(Math.cos(this.phase)) * 0.04 * run;
    this.body.rotation.x = airborne ? -0.25 : Math.sin(this.phase) * 0.06 * run;
    // ears flap with the run, tail wags faster when happy (returning) or idle
    const happy = state === 'return' || state === 'drop' || state === 'idle';
    this.wag += dt * (happy ? 16 : 9);
    this.tail.rotation.z = Math.sin(this.wag) * (happy ? 0.7 : 0.3);
    this.tail.rotation.x = happy ? 0.4 : 1.0;
    for (const [i, e] of this.ears.entries()) e.rotation.x = Math.sin(this.phase * 1.3 + i) * 0.35 * run - (airborne ? 0.5 : 0);
    this.head.rotation.x = airborne ? -0.4 : -0.05 + Math.sin(this.phase * 2) * 0.03 * run;
  }

  dispose(): void { for (const d of this.disposables) d.dispose(); this.root.removeFromParent(); }
}

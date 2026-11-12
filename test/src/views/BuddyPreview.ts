import * as THREE from 'three';
import { toon } from '../render/Toon';
import { buildBuddy, type BuddyRig } from '../buddy/BuddyBuilder';
import { BuddyAnimator } from '../buddy/BuddyAnimator';
import type { BuddyConfig } from '../buddy/BuddyConfig';
import type { View } from '../screens/ScreenManager';

/**
 * Live 3D preview for the Buddy creator: the Buddy on a little island turntable.
 * Drag (mouse or touch) to spin; it eases back to facing the camera after a while.
 */
export class BuddyPreview implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private readonly turntable = new THREE.Group();
  private rig: BuddyRig | null = null;
  private anim: BuddyAnimator | null = null;
  private yaw = 0.35;
  private yawVel = 0;
  private dragging = false;
  private idleT = 0;
  private lastX = 0;
  private offs: Array<() => void> = [];
  /** Horizontal screen offset of the Buddy (-1..1), so the options panel can sit beside it. */
  shift = -0.45;

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color('#bfe9ff');
    s.add(new THREE.HemisphereLight('#ffffff', '#88b0c8', 2.2));
    const key = new THREE.DirectionalLight('#fff6e8', 2);
    key.position.set(2, 4, 3); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    s.add(key);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.25, 40), toon('#fff3d4'));
    base.position.y = -0.125; base.receiveShadow = true;
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.04, 40), toon('#7fdc6a'));
    grass.position.y = 0.02; grass.receiveShadow = true;
    this.turntable.add(base, grass);
    s.add(this.turntable);
    const sea = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.MeshBasicMaterial({ color: '#4fc3e8' }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.2; s.add(sea);
    this.camera.position.set(0, 1.2, 4.6);
    this.camera.lookAt(0, 0.75, 0);
  }

  setBuddy(cfg: BuddyConfig, wave = false): void {
    this.rig?.dispose();
    this.rig = buildBuddy(cfg);
    this.rig.root.traverse(o => { (o as THREE.Mesh).castShadow = true; });
    this.turntable.add(this.rig.root);
    const prev = this.anim?.current;
    this.anim = new BuddyAnimator(this.rig);
    this.anim.play(wave ? 'wave' : prev && prev !== 'wave' ? prev : 'idle', { blend: 0 });
    if (wave) setTimeout(() => this.anim?.play('idle'), 1400);
  }

  /** Attach drag-to-rotate to an element (the creator's preview area). */
  bindDrag(el: HTMLElement): void {
    const down = (e: PointerEvent) => { this.dragging = true; this.lastX = e.clientX; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX; this.lastX = e.clientX;
      this.yaw += dx * 0.012; this.yawVel = dx * 0.6; this.idleT = 0;
    };
    const up = () => { this.dragging = false; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    this.offs.push(() => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    });
  }

  /** Keyboard / motion pointer rotation (Q/E or shoulder buttons in the creator). */
  nudge(rad: number): void { this.yaw += rad; this.idleT = 0; }

  play(state: string): void { this.anim?.play(state, { restart: true }); }

  update(dt: number): void {
    if (!this.dragging) {
      this.yaw += this.yawVel * dt;
      this.yawVel *= Math.exp(-dt * 4);
      this.idleT += dt;
      if (this.idleT > 4) this.yaw += (0.35 - this.yaw) * Math.min(1, dt * 1.5);
    }
    this.turntable.rotation.y = this.yaw;
    this.anim?.update(dt);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Shift the view so the Buddy sits left of centre (the options panel is on the right).
    const fullW = w, fullH = h;
    const off = -this.shift * fullW * 0.5;
    this.camera.setViewOffset(fullW, fullH, off, 0, fullW, fullH);
  }

  dispose(): void {
    this.offs.forEach(f => f());
    this.rig?.dispose();
  }
}

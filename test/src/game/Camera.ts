import * as THREE from 'three';
import type { LaneSpec } from './dims';

export type CamMode = 'intro' | 'aim' | 'follow' | 'deck';

/** Smooth camera with modes, impact shake and a zoom "punch". Distances come from the lane spec. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 'intro';
  /** Reduced motion: no shake, no zoom punch, gentler moves. */
  calm = false;
  private readonly pos = new THREE.Vector3(1.4, 1.5, 3.6);
  private readonly look = new THREE.Vector3(0, 0.3, -9);
  private readonly wantPos = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private shakeAmp = 0;
  private punch = 0;
  private t = 0;
  private readonly baseFov: number;

  constructor(private readonly spec: LaneSpec) {
    this.baseFov = spec.cam.fov;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.03, 160);
    this.camera.position.copy(this.pos);
  }

  resize(w: number, h: number): void { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  /** snap = hard cut (used for the pin-deck shot at impact). */
  setMode(m: CamMode, snap = false): void {
    this.mode = m;
    if (snap) { this.targets(new THREE.Vector3(), 0); this.pos.copy(this.wantPos); this.look.copy(this.wantLook); }
  }

  shake(amount: number): void { if (!this.calm) this.shakeAmp = Math.max(this.shakeAmp, amount); }
  zoomPunch(amount: number): void { if (!this.calm) this.punch = Math.max(this.punch, amount); }

  private targets(ball: THREE.Vector3, aimX: number): void {
    const S = this.spec, C = S.cam;
    switch (this.mode) {
      case 'intro': {
        const a = this.t * 0.12;
        this.wantPos.set(Math.sin(a) * 1.6, 1.4 + C.aim.height * 0.2 + Math.sin(this.t * 0.3) * 0.1, 3.4 + C.aim.back * 0.2);
        this.wantLook.set(0, 0.2, S.headZ * 0.6);
        break;
      }
      case 'aim':
        this.wantPos.set(aimX * S.aimHalfWidth * 0.5, C.aim.height, C.aim.back);
        this.wantLook.set(aimX * S.aimHalfWidth * 0.3, 0.15, -9);
        break;
      case 'follow': {
        const z = Math.max(ball.z + C.follow.back, S.headZ + C.follow.stopBeforeHead);
        this.wantPos.set(ball.x * 0.5, C.follow.height, z);
        this.wantLook.set(ball.x * 0.7, 0.12, Math.max(ball.z - 4, S.headZ - 0.4));
        break;
      }
      case 'deck':
        this.wantPos.set(C.deck.x, C.deck.height, S.headZ + C.deck.back);
        this.wantLook.set(-0.05, 0.18, S.headZ - (S.headZ - S.deckEndZ) * 0.35);
        break;
    }
  }

  update(dt: number, ball: THREE.Vector3, aimX: number): void {
    this.t += dt;
    this.targets(ball, aimX);
    const k = (this.mode === 'follow' ? 7 : this.mode === 'deck' ? 3 : 4) * (this.calm ? 0.6 : 1);
    const f = 1 - Math.exp(-dt * k);
    this.pos.lerp(this.wantPos, f);
    this.look.lerp(this.wantLook, f);

    this.camera.position.copy(this.pos);
    if (this.shakeAmp > 0.0005) {
      this.camera.position.x += (Math.random() * 2 - 1) * this.shakeAmp;
      this.camera.position.y += (Math.random() * 2 - 1) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-dt * 7);
    }
    this.camera.lookAt(this.look);
    this.punch *= Math.exp(-dt * 6);
    const fov = this.baseFov - this.punch * 9;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
}

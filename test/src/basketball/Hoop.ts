import * as THREE from 'three';
import { addOutline, toon } from '../render/Toon';
import { COURT, HOOP } from './bbTuning';
import { Net, type NetStyle } from './Net';
import type { V3 } from './ShotSolver';

/**
 * The hoop you see: pole with padding, arm, backboard with its shooter's square, an orange rim that shakes
 * when it's hit, and the Verlet net. Positions match the colliders in BallPhysics.ts.
 */
export class HoopView {
  readonly group = new THREE.Group();
  readonly net: Net;
  private readonly rimGroup = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private shakeA = 0;
  private shakeT = 0;
  private readonly offset = new THREE.Vector3();

  constructor(readonly hoop: V3, netStyle: NetStyle, accent = '#ff8a3c') {
    const g = this.group, H = HOOP;
    const mat = <M extends THREE.Material>(m: M): M => { this.disposables.push(m); return m; };
    const geo = <G extends THREE.BufferGeometry>(x: G): G => { this.disposables.push(x); return x; };

    // pole + padding + arm
    const poleZ = COURT.baselineZ - 0.6;
    const pole = new THREE.Mesh(geo(new THREE.BoxGeometry(0.22, H.boardBottom + 0.6, 0.22)), mat(toon('#3a4252')));
    pole.position.set(0, (H.boardBottom + 0.6) / 2, poleZ);
    const pad = new THREE.Mesh(geo(new THREE.BoxGeometry(0.4, 1.6, 0.4)), mat(toon(accent)));
    pad.position.set(0, 0.8, poleZ);
    const armLen = H.boardZ - H.boardThickness - poleZ;
    const arm = new THREE.Mesh(geo(new THREE.BoxGeometry(0.14, 0.14, armLen)), mat(toon('#3a4252')));
    arm.position.set(0, H.boardBottom + 0.45, poleZ + armLen / 2);
    for (const m of [pole, pad, arm]) { m.castShadow = true; addOutline(m, 0.03); g.add(m); }

    // backboard: white with an orange border and the shooter's square
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    let boardMat: THREE.Material = mat(toon('#ffffff'));
    if (c) {
      c.width = 256; c.height = 150;
      const x = c.getContext('2d')!;
      x.fillStyle = '#f7fbff'; x.fillRect(0, 0, 256, 150);
      x.strokeStyle = accent; x.lineWidth = 8; x.strokeRect(4, 4, 248, 142);
      x.lineWidth = 6; x.strokeRect(128 - 42, 150 - 18 - 62, 84, 62);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      this.disposables.push(tex);
      boardMat = mat(toon('#ffffff', { map: tex }));
    }
    const board = new THREE.Mesh(geo(new THREE.BoxGeometry(H.boardWidth, H.boardHeight, H.boardThickness)), [
      mat(toon('#e8eef5')), mat(toon('#e8eef5')), mat(toon('#e8eef5')), mat(toon('#e8eef5')), boardMat, mat(toon('#e8eef5'))
    ]);
    board.position.set(hoop.x, H.boardBottom + H.boardHeight / 2, H.boardZ - H.boardThickness / 2);
    board.castShadow = true;
    addOutline(board, 0.015);
    g.add(board);

    // rim + bracket (in their own group so they can shake)
    const rim = new THREE.Mesh(geo(new THREE.TorusGeometry(H.rimRadius + H.tube, H.tube * 1.6, 8, 40)), mat(toon('#ff5a1f', { emissive: '#3a1000' })));
    rim.rotation.x = Math.PI / 2;
    rim.castShadow = true;
    const bracket = new THREE.Mesh(geo(new THREE.BoxGeometry(0.12, 0.05, hoop.z - H.rimRadius - H.boardZ)), mat(toon('#ff5a1f')));
    bracket.position.set(0, -0.02, (H.boardZ - hoop.z - H.rimRadius) / 2);
    this.rimGroup.add(rim, bracket);
    this.rimGroup.position.set(hoop.x, hoop.y, hoop.z);
    g.add(this.rimGroup);

    this.net = new Net(hoop, netStyle);
    g.add(this.net.lines);
  }

  /** The rim was hit: a short shake, bigger for harder hits. */
  shake(speed: number): void {
    this.shakeA = Math.max(this.shakeA, Math.min(0.02, 0.003 + speed * 0.0022));
    this.shakeT = 0;
  }

  update(dt: number, balls: readonly V3[]): void {
    this.shakeT += dt;
    this.shakeA *= Math.exp(-dt * 7);
    const s = this.shakeA * Math.sin(this.shakeT * 70);
    this.offset.set(0, s, s * 0.4);
    this.rimGroup.position.set(this.hoop.x, this.hoop.y + this.offset.y, this.hoop.z + this.offset.z);
    this.net.setRimOffset(this.offset);
    this.net.update(Math.min(dt, 1 / 30), balls);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.net.dispose();
    this.group.removeFromParent();
  }
}

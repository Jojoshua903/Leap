import * as THREE from 'three';
import { BALL, HOOP } from './bbTuning';
import type { V3 } from './ShotSolver';

export type NetStyle = 'white' | 'chain' | 'rainbow';

const COLS = 12;
const ROWS = 5;

/**
 * Cosmetic Verlet net: 12 × 5 points hanging from the rim, tapering toward the bottom. The top row is
 * pinned to the rim; the rest falls under gravity, keeps its knots with distance constraints and is gently
 * pulled back to its rest shape. Balls push the points out of the way, so a make bulges and whips the net.
 * (The drag that slows a ball inside the net is applied to the physics ball in BallPhysics.ts.)
 */
export class Net {
  readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly prev: Float32Array;
  private readonly rest: Float32Array;
  private readonly links: Array<[number, number, number]> = [];
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.LineBasicMaterial;
  private readonly heavy: boolean;
  private rimOffset = new THREE.Vector3();

  constructor(private readonly hoop: V3, style: NetStyle = 'white') {
    const n = COLS * ROWS;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.rest = new Float32Array(n * 3);
    this.heavy = style === 'chain';
    for (let r = 0; r < ROWS; r++) {
      const k = r / (ROWS - 1);
      const rad = (HOOP.rimRadius + HOOP.tube * 0.5) * (1 - 0.38 * k);
      const y = hoop.y - HOOP.netDepth * k;
      for (let c = 0; c < COLS; c++) {
        // every other row is offset half a cell, which gives the diamond mesh
        const a = (c + (r % 2) * 0.5) / COLS * Math.PI * 2;
        const i = (r * COLS + c) * 3;
        this.rest[i] = hoop.x + Math.cos(a) * rad;
        this.rest[i + 1] = y;
        this.rest[i + 2] = hoop.z + Math.sin(a) * rad;
      }
    }
    this.pos.set(this.rest); this.prev.set(this.rest);
    const idx: number[] = [];
    const link = (a: number, b: number) => {
      const dx = this.rest[a * 3] - this.rest[b * 3], dy = this.rest[a * 3 + 1] - this.rest[b * 3 + 1], dz = this.rest[a * 3 + 2] - this.rest[b * 3 + 2];
      this.links.push([a, b, Math.hypot(dx, dy, dz)]);
      idx.push(a, b);
    };
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r * COLS + c;
        // diamonds: each knot links to the two knots below it
        const b1 = (r + 1) * COLS + c;
        const b2 = (r + 1) * COLS + ((c + (r % 2 ? 1 : COLS - 1)) % COLS);
        link(a, b1); link(a, b2);
      }
    }
    // bottom ring keeps the opening round
    for (let c = 0; c < COLS; c++) link((ROWS - 1) * COLS + c, (ROWS - 1) * COLS + ((c + 1) % COLS));

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setIndex(idx);
    if (style === 'rainbow') {
      const col = new Float32Array(n * 3), cc = new THREE.Color();
      for (let i = 0; i < n; i++) { cc.setHSL(((i % COLS) / COLS + Math.floor(i / COLS) * 0.08) % 1, 0.85, 0.6); col.set([cc.r, cc.g, cc.b], i * 3); }
      this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.mat = new THREE.LineBasicMaterial({ vertexColors: true });
    } else {
      this.mat = new THREE.LineBasicMaterial({ color: style === 'chain' ? '#c9d2dc' : '#ffffff' });
    }
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
  }

  /** The rim shakes: the top row follows it. */
  setRimOffset(o: THREE.Vector3): void { this.rimOffset.copy(o); }

  /** A whip of the net (big makes), strength 0..1. */
  kick(strength: number): void {
    for (let i = COLS; i < COLS * ROWS; i++) this.prev[i * 3 + 1] += 0.012 * strength * (i / COLS);
  }

  update(dt: number, balls: readonly V3[]): void {
    const g = -9.81 * dt * dt;
    const damp = this.heavy ? 0.985 : 0.96;
    const back = (this.heavy ? 2 : 4) * dt;
    const n = COLS * ROWS, P = this.pos, Q = this.prev, Rr = this.rest;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      if (i < COLS) {
        P[j] = Rr[j] + this.rimOffset.x; P[j + 1] = Rr[j + 1] + this.rimOffset.y; P[j + 2] = Rr[j + 2] + this.rimOffset.z;
        Q[j] = P[j]; Q[j + 1] = P[j + 1]; Q[j + 2] = P[j + 2];
        continue;
      }
      for (let a = 0; a < 3; a++) {
        const cur = P[j + a];
        let next = cur + (cur - Q[j + a]) * damp + (a === 1 ? g : 0);
        next += (Rr[j + a] - next) * back;
        Q[j + a] = cur; P[j + a] = next;
      }
    }
    for (let it = 0; it < 3; it++) {
      for (const [a, b, L] of this.links) {
        const ia = a * 3, ib = b * 3;
        const dx = P[ib] - P[ia], dy = P[ib + 1] - P[ia + 1], dz = P[ib + 2] - P[ia + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = (d - L) / d * 0.5;
        const pa = a >= COLS, pb = b >= COLS;
        const wa = pa && pb ? 1 : pa ? 2 : 0, wb = pa && pb ? 1 : pb ? 2 : 0;
        P[ia] += dx * diff * wa; P[ia + 1] += dy * diff * wa; P[ia + 2] += dz * diff * wa;
        P[ib] -= dx * diff * wb; P[ib + 1] -= dy * diff * wb; P[ib + 2] -= dz * diff * wb;
      }
      // balls push the knots aside
      const rr = BALL.radius + 0.012;
      for (const b of balls) {
        if (Math.abs(b.y - (this.hoop.y - HOOP.netDepth / 2)) > HOOP.netDepth / 2 + rr) continue;
        for (let i = COLS; i < n; i++) {
          const j = i * 3;
          const dx = P[j] - b.x, dy = P[j + 1] - b.y, dz = P[j + 2] - b.z;
          const d = Math.hypot(dx, dy, dz);
          if (d < rr && d > 1e-6) { const k = (rr - d) / d; P[j] += dx * k; P[j + 1] += dy * k; P[j + 2] += dz * k; }
        }
      }
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); this.lines.removeFromParent(); }
}

import * as THREE from 'three';
import { addOutline, toon } from '../../render/Toon';
import type { EnemyId } from './types';

/**
 * Enemy looks, made in code: wooden puppets, a plush bear, felt bats and the straw boss. Soft and silly,
 * nothing sharp. Each model faces +z (the scene turns it toward the player) and exposes the parts the
 * Showdown animates.
 */
export interface EnemyModel {
  group: THREE.Group;
  /** The arm / weapon that swings (rotated about x for a swing). */
  arm: THREE.Object3D | null;
  /** Puppet knight / bear shield. */
  shield: THREE.Object3D | null;
  /** Bat wings. */
  wings: THREE.Object3D[];
  /** Boss weak point (a glowing patch with an arrow), hidden until shown. */
  weak: THREE.Mesh | null;
  weakArrow: THREE.Mesh | null;
  height: number;
  dispose(): void;
}

class Parts {
  readonly list: Array<{ dispose(): void }> = [];
  mesh(geo: THREE.BufferGeometry, color: string, parent: THREE.Object3D, x = 0, y = 0, z = 0, outline = 0.05, basic = false): THREE.Mesh {
    const m = new THREE.Mesh(geo, basic ? new THREE.MeshBasicMaterial({ color, transparent: true }) : toon(color));
    m.position.set(x, y, z);
    m.castShadow = !basic;
    if (outline) addOutline(m, outline);
    parent.add(m);
    this.list.push(geo, m.material as THREE.Material);
    return m;
  }
  dispose(): void { for (const d of this.list) d.dispose(); }
}

function eyes(p: Parts, head: THREE.Object3D, r: number, color = '#1d2a3a'): void {
  for (const s of [-1, 1]) p.mesh(new THREE.SphereGeometry(r * 0.16, 8, 6), color, head, s * r * 0.38, r * 0.15, r * 0.9, 0);
}

function arrowGeo(): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.12, -0.025); s.lineTo(0.03, -0.025); s.lineTo(0.03, -0.065); s.lineTo(0.13, 0); s.lineTo(0.03, 0.065); s.lineTo(0.03, 0.025); s.lineTo(-0.12, 0.025); s.closePath();
  return new THREE.ShapeGeometry(s);
}

export function buildEnemy(id: EnemyId): EnemyModel {
  const p = new Parts();
  const g = new THREE.Group();
  const base: Omit<EnemyModel, 'dispose'> = { group: g, arm: null, shield: null, wings: [], weak: null, weakArrow: null, height: 1.5 };
  switch (id) {
    case 'dummy': {
      p.mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.0, 8), '#7a5233', g, 0, 0.5, 0);
      p.mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.6, 12), '#e9cf7a', g, 0, 0.95, 0);
      p.mesh(new THREE.TorusGeometry(0.25, 0.025, 4, 16), '#b8402e', g, 0, 1.05, 0).rotation.x = Math.PI / 2;
      p.mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), '#7a5233', g, 0, 1.15, 0);
      const head = p.mesh(new THREE.SphereGeometry(0.2, 14, 10), '#f2dc9c', g, 0, 1.45, 0);
      eyes(p, head, 0.2);
      base.height = 1.6;
      break;
    }
    case 'puppetKnight': {
      p.mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8), '#8a5a32', g, 0.1, 0.35, 0);
      p.mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8), '#8a5a32', g, -0.1, 0.35, 0);
      p.mesh(new THREE.CapsuleGeometry(0.22, 0.4, 4, 10), '#c9935a', g, 0, 1.0, 0);
      const head = p.mesh(new THREE.SphereGeometry(0.19, 14, 10), '#e8c690', g, 0, 1.5, 0);
      eyes(p, head, 0.19);
      p.mesh(new THREE.SphereGeometry(0.21, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), '#9aa6b2', head, 0, 0.02, 0);
      const arm = new THREE.Group(); arm.position.set(-0.28, 1.2, 0); g.add(arm);
      p.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 6), '#c9935a', arm, 0, 0.3, 0.15).rotation.x = 0.4;
      base.arm = arm;
      const sh = new THREE.Group(); sh.position.set(0.32, 1.05, 0.2); g.add(sh);
      p.mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 18), '#3c8cff', sh, 0, 0, 0).rotation.x = Math.PI / 2;
      p.mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12), '#ffd23a', sh, 0, 0, 0.01).rotation.x = Math.PI / 2;
      base.shield = sh;
      base.height = 1.75;
      break;
    }
    case 'shieldBear': {
      p.mesh(new THREE.SphereGeometry(0.5, 16, 12), '#a8754a', g, 0, 0.75, 0).scale.set(1, 1.1, 0.9);
      p.mesh(new THREE.SphereGeometry(0.3, 14, 10), '#f2dcc0', g, 0, 0.7, 0.32).scale.set(1, 1.2, 0.5);
      const head = p.mesh(new THREE.SphereGeometry(0.3, 16, 12), '#a8754a', g, 0, 1.5, 0);
      eyes(p, head, 0.3);
      p.mesh(new THREE.SphereGeometry(0.11, 10, 8), '#f2dcc0', head, 0, -0.06, 0.27);
      for (const s of [-1, 1]) p.mesh(new THREE.SphereGeometry(0.1, 10, 8), '#a8754a', head, s * 0.22, 0.22, 0);
      const arm = new THREE.Group(); arm.position.set(-0.45, 1.1, 0); g.add(arm);
      p.mesh(new THREE.CapsuleGeometry(0.11, 0.35, 4, 8), '#a8754a', arm, 0, -0.15, 0.1);
      base.arm = arm;
      const sh = new THREE.Group(); sh.position.set(0, 0.95, 0.55); g.add(sh);
      p.mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 22), '#b98a5a', sh, 0, 0, 0).rotation.x = Math.PI / 2;
      for (const y of [-0.25, 0, 0.25]) p.mesh(new THREE.BoxGeometry(1.0, 0.03, 0.02), '#8a5a32', sh, 0, y, 0.05, 0);
      p.mesh(new THREE.TorusGeometry(0.55, 0.035, 6, 24), '#ffd23a', sh, 0, 0, 0.02, 0);
      base.shield = sh;
      base.height = 1.95;
      break;
    }
    case 'batSwarm': {
      const body = p.mesh(new THREE.SphereGeometry(0.12, 12, 8), '#5a4a7a', g, 0, 0, 0);
      eyes(p, body, 0.12, '#ffd23a');
      for (const s of [-1, 1]) {
        const w = new THREE.Group(); w.position.set(s * 0.1, 0, 0); g.add(w);
        const shape = new THREE.Shape();
        shape.moveTo(0, 0); shape.lineTo(s * 0.28, 0.08); shape.lineTo(s * 0.22, -0.04); shape.lineTo(s * 0.12, 0.0); shape.lineTo(s * 0.06, -0.06); shape.closePath();
        const wing = p.mesh(new THREE.ShapeGeometry(shape), '#3a2f58', w, 0, 0, 0, 0);
        (wing.material as THREE.Material).side = THREE.DoubleSide;
        base.wings.push(w);
      }
      for (const s of [-1, 1]) p.mesh(new THREE.ConeGeometry(0.035, 0.08, 4), '#5a4a7a', body, s * 0.06, 0.12, 0, 0);
      base.height = 0.3;
      break;
    }
    case 'archer': {
      p.mesh(new THREE.CylinderGeometry(0.16, 0.26, 1.0, 12), '#3bb37a', g, 0, 0.6, 0);
      const head = p.mesh(new THREE.SphereGeometry(0.18, 14, 10), '#e8c690', g, 0, 1.3, 0);
      eyes(p, head, 0.18);
      p.mesh(new THREE.ConeGeometry(0.24, 0.4, 12), '#2a8a58', head, 0, 0.15, -0.03);
      const arm = new THREE.Group(); arm.position.set(0.2, 1.0, 0.15); g.add(arm);
      p.mesh(new THREE.TorusGeometry(0.3, 0.02, 6, 16, Math.PI), '#8a5a32', arm, 0, 0, 0).rotation.set(0, Math.PI / 2, Math.PI / 2);
      base.arm = arm;
      base.height = 1.5;
      break;
    }
    case 'bomber': {
      const body = p.mesh(new THREE.SphereGeometry(0.42, 16, 12), '#ff8a3c', g, 0, 0.6, 0);
      eyes(p, body, 0.42);
      p.mesh(new THREE.ConeGeometry(0.2, 0.3, 10), '#7a5cff', g, 0, 1.12, 0);
      const arm = new THREE.Group(); arm.position.set(-0.4, 0.75, 0); g.add(arm);
      p.mesh(new THREE.SphereGeometry(0.15, 10, 8), '#2b2f38', arm, 0, 0.12, 0.1);
      base.arm = arm;
      base.height = 1.3;
      break;
    }
    case 'scarecrow': {
      p.mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8), '#7a5233', g, 0, 0.7, 0);
      p.mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.1, 14), '#e9cf7a', g, 0, 1.6, 0, 0.03);
      p.mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.5, 14), '#9aa6b2', g, 0, 1.85, 0, 0.03);
      p.mesh(new THREE.BoxGeometry(1.8, 0.12, 0.12), '#7a5233', g, 0, 2.05, 0);
      for (const s of [-1, 1]) p.mesh(new THREE.ConeGeometry(0.16, 0.3, 8), '#e9cf7a', g, s * 0.95, 1.95, 0, 0).rotation.z = s * Math.PI / 2;
      const head = p.mesh(new THREE.SphereGeometry(0.34, 16, 12), '#f2dc9c', g, 0, 2.5, 0);
      eyes(p, head, 0.34);
      p.mesh(new THREE.SphereGeometry(0.37, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), '#6c7a99', head, 0, 0.04, 0);
      p.mesh(new THREE.BoxGeometry(0.5, 0.05, 0.08), '#1d2a3a', head, 0, 0.12, 0.3, 0);
      p.mesh(new THREE.ConeGeometry(0.1, 0.4, 8), '#ff5a5f', head, 0, 0.5, -0.05);
      const arm = new THREE.Group(); arm.position.set(-0.6, 2.0, 0.1); g.add(arm);
      // a broom-handle lance with a soft straw end
      p.mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8), '#c9935a', arm, 0, -0.1, 0.6).rotation.x = Math.PI / 2 - 0.3;
      p.mesh(new THREE.SphereGeometry(0.12, 10, 8), '#e9cf7a', arm, 0, 0.15, 1.35);
      base.arm = arm;
      const weak = p.mesh(new THREE.SphereGeometry(0.16, 14, 10), '#ff4fd8', g, 0, 1.6, 0.5, 0, true);
      (weak.material as THREE.MeshBasicMaterial).opacity = 0.85;
      weak.visible = false;
      base.weak = weak;
      const wa = p.mesh(arrowGeo(), '#ffffff', weak, 0, 0, 0.18, 0, true);
      (wa.material as THREE.Material).side = THREE.DoubleSide;
      (wa.material as THREE.Material).depthTest = false;
      wa.renderOrder = 6;
      base.weakArrow = wa;
      base.height = 2.9;
      break;
    }
  }
  return { ...base, dispose: () => { p.dispose(); g.removeFromParent(); } };
}

/** Projectiles and pickups. */
export function buildProjectile(kind: 'arrow' | 'bomb' | 'heart'): { group: THREE.Group; dispose(): void } {
  const p = new Parts();
  const g = new THREE.Group();
  if (kind === 'arrow') {
    // a foam-tipped practice arrow, pointing +z
    p.mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6), '#c9935a', g, 0, 0, 0).rotation.x = Math.PI / 2;
    p.mesh(new THREE.SphereGeometry(0.05, 10, 8), '#ff5fa2', g, 0, 0, 0.32);
    for (const s of [-1, 1]) p.mesh(new THREE.BoxGeometry(0.08, 0.005, 0.1), '#ffffff', g, s * 0.03, 0, -0.27, 0);
  } else if (kind === 'bomb') {
    p.mesh(new THREE.SphereGeometry(0.15, 14, 10), '#2b2f38', g, 0, 0, 0);
    p.mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 5), '#c9935a', g, 0, 0.18, 0, 0);
    p.mesh(new THREE.SphereGeometry(0.03, 8, 6), '#ffb020', g, 0, 0.24, 0, 0, true);
  } else {
    const s = new THREE.Shape();
    s.moveTo(0, -0.12); s.bezierCurveTo(-0.2, 0, -0.14, 0.14, 0, 0.06); s.bezierCurveTo(0.14, 0.14, 0.2, 0, 0, -0.12);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
    geo.center();
    p.mesh(geo, '#ff4f5e', g, 0, 0, 0, 0.06);
  }
  return { group: g, dispose: () => { p.dispose(); g.removeFromParent(); } };
}

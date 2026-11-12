import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

/** 3-step toon ramp built in code (dark, mid, lit). */
export function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  const tex = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradient = tex;
  return tex;
}

export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...extra });
}

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1d2a3a, side: THREE.BackSide });

/**
 * Inverted-hull outline: a slightly larger copy of the mesh drawn with back faces only.
 * `pivotY` is the geometry's vertical centre, so geometries whose origin sits at their base
 * (like pins) grow evenly instead of only upward.
 */
export function addOutline(mesh: THREE.Mesh, thickness = 0.04, pivotY = 0): THREE.Mesh {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  const s = 1 + thickness;
  o.scale.setScalar(s);
  o.position.y = -pivotY * (s - 1);
  o.castShadow = false;
  o.receiveShadow = false;
  mesh.add(o);
  return o;
}

export function toonMesh(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, outline = 0.04, extra: THREE.MeshToonMaterialParameters = {}): THREE.Mesh {
  const m = new THREE.Mesh(geo, toon(color, extra));
  m.castShadow = true;
  m.receiveShadow = true;
  if (outline > 0) addOutline(m, outline);
  return m;
}

/** Glowing strip that ignores lighting (neon tubes, light panels). */
export function glow(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.Mesh {
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
}

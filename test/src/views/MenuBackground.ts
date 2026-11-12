import * as THREE from 'three';
import { buildTerrain } from '../island/terrain.js';
import { buildWorld } from '../island/world.js';
import type { View } from '../screens/ScreenManager';

/**
 * Slow cinematic orbit around Breezy Isle, drawn behind the title, profile and main menu screens.
 * Same island and camera path as the original menu page.
 */
export class MenuBackground implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 1, 9000);
  private readonly sky: THREE.Mesh;
  private readonly world: { update(t: number, dt: number): void };
  private readonly look = new THREE.Vector3(0, 70, 120);
  private t = 0;
  /** Slower, steadier orbit for reduced motion. */
  calm = false;

  constructor() {
    const scene = this.scene;
    scene.fog = new THREE.Fog(0xcdeeff, 900, 3600);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 16), new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color('#3d9bff') }, bottom: { value: new THREE.Color('#cdeeff') } },
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform vec3 top;uniform vec3 bottom;varying vec3 vP;void main(){float t=clamp(vP.y*1.7+.12,0.,1.);gl_FragColor=vec4(mix(bottom,top,t),1.);\n#include <colorspace_fragment>\n}'
    }));
    scene.add(this.sky);
    scene.add(new THREE.HemisphereLight(0xbfe6ff, 0x7a9a5a, 1.2));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.4); sun.position.set(500, 700, 250); scene.add(sun);
    const sunBall = new THREE.Mesh(new THREE.SphereGeometry(110, 20, 12), new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }));
    sunBall.position.set(500, 700, 250).normalize().multiplyScalar(3600); scene.add(sunBall);
    scene.add(buildTerrain());
    const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshPhongMaterial({ color: 0x2fb6d6, shininess: 90, specular: 0x88ddff, transparent: true, opacity: 0.88 }));
    water.rotation.x = -Math.PI / 2; scene.add(water);
    this.world = buildWorld(scene);
    this.update(0);
  }

  update(dt: number): void {
    this.t += dt * (this.calm ? 0.4 : 1);
    const t = this.t;
    const a = 1.35 + t * 0.025;                       // start looking at town from the sea
    this.camera.position.set(Math.sin(a) * 1250, 300 + Math.sin(t * 0.12) * (this.calm ? 8 : 30), Math.cos(a) * 1250);
    this.camera.lookAt(this.look);
    this.sky.position.copy(this.camera.position);
    this.world.update(t, dt);
  }

  resize(w: number, h: number): void { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
}

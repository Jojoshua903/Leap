import * as THREE from 'three';
import { addOutline, toon } from '../render/Toon';
import { BOTTOM_COLORS, FAV_COLORS, HAIR_COLORS, SKIN_TONES, type BuddyConfig } from './BuddyConfig';

/**
 * Builds a toon Buddy from a config. The result is a rig of named joints that BuddyAnimator poses.
 * Coordinates: feet at y = 0, the Buddy faces +z, about 1.5 m tall with a big friendly head.
 *
 * Joint rotation conventions (radians):
 *   shoulderR/L.rotation.x  > 0 swings the arm backward, < 0 forward/up
 *   shoulderR/L.rotation.z  raises the arm sideways (R: positive, L: negative)
 *   hipR/L.rotation.x       > 0 swings the leg backward
 *   spine.rotation.x        > 0 leans forward
 */
export type JointName = 'root' | 'hips' | 'spine' | 'neck' | 'head' | 'shoulderL' | 'shoulderR' | 'handL' | 'handR' | 'hipL' | 'hipR';
export type Expression = 'normal' | 'happy' | 'shocked' | 'sad' | 'focus';

export interface BuddyRig {
  root: THREE.Group;
  joints: Record<JointName, THREE.Object3D>;
  config: BuddyConfig;
  /** Base y of the hips, so animations can bounce relative to it. */
  hipsY: number;
  setExpression(e: Expression): void;
  dispose(): void;
}

export const BUDDY_DIMS = {
  legLen: 0.66, hipsY: 0.7, torsoH: 0.46, torsoR: 0.17, headR: 0.22, armLen: 0.5, armR: 0.052, legR: 0.07, shoulderX: 0.215
};

/* ---------------- face texture ---------------- */

function drawFace(ctx: CanvasRenderingContext2D, eyes: number, mouth: number, expr: Expression): void {
  const W = 256, H = 192;
  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const ink = '#1d1d24';
  const eyeY = 78, lx = 88, rx = 168;

  // Eyebrows (only for strong expressions, keeps the default look calm)
  if (expr === 'shocked' || expr === 'sad' || expr === 'focus') {
    ctx.strokeStyle = '#3a2a22'; ctx.lineWidth = 7;
    const tilt = expr === 'sad' ? -8 : expr === 'focus' ? 8 : 0;
    const up = expr === 'shocked' ? -14 : 0;
    ctx.beginPath(); ctx.moveTo(lx - 20, eyeY - 30 + up - tilt); ctx.lineTo(lx + 18, eyeY - 30 + up + tilt); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx - 18, eyeY - 30 + up + tilt); ctx.lineTo(rx + 20, eyeY - 30 + up - tilt); ctx.stroke();
  }

  const eye = (x: number, wink = false) => {
    ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = 8;
    if (expr === 'happy' || wink) { ctx.beginPath(); ctx.arc(x, eyeY + 8, 15, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); return; }
    if (expr === 'shocked') { ctx.beginPath(); ctx.arc(x, eyeY, 17, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(x, eyeY, 6, 0, Math.PI * 2); ctx.fill(); return; }
    if (expr === 'sad') { ctx.beginPath(); ctx.ellipse(x, eyeY + 4, 9, 11, 0, 0, Math.PI * 2); ctx.fill(); return; }
    switch (eyes) {
      case 1: ctx.beginPath(); ctx.arc(x, eyeY + 8, 15, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); break;            // happy arcs
      case 2: ctx.beginPath(); ctx.moveTo(x - 14, eyeY + 2); ctx.lineTo(x + 14, eyeY + 2); ctx.stroke();               // sleepy
        ctx.beginPath(); ctx.ellipse(x, eyeY + 7, 10, 6, 0, 0, Math.PI); ctx.fill(); break;
      case 3: ctx.beginPath(); ctx.ellipse(x, eyeY, 15, 19, 0, 0, Math.PI * 2); ctx.fill();                           // big
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + 5, eyeY - 7, 5, 0, Math.PI * 2); ctx.fill(); break;
      case 5: ctx.beginPath(); ctx.ellipse(x, eyeY, 11, 15, 0, 0, Math.PI * 2); ctx.fill();                            // sparkle
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + 4, eyeY - 5, 4, 0, Math.PI * 2); ctx.arc(x - 4, eyeY + 6, 2, 0, Math.PI * 2); ctx.fill(); break;
      default: ctx.beginPath(); ctx.ellipse(x, eyeY, 9, 12, 0, 0, Math.PI * 2); ctx.fill();                           // round (0) and wink's open eye
    }
  };
  eye(lx);
  eye(rx, eyes === 4 && expr === 'normal');

  // Cheeks
  ctx.fillStyle = 'rgba(255,120,120,.35)';
  ctx.beginPath(); ctx.ellipse(56, 118, 18, 10, 0, 0, Math.PI * 2); ctx.ellipse(200, 118, 18, 10, 0, 0, Math.PI * 2); ctx.fill();

  // Mouth
  const my = 132, mx = 128;
  ctx.strokeStyle = '#8a3a36'; ctx.fillStyle = '#8a3a36'; ctx.lineWidth = 7;
  const m = expr === 'happy' ? 2 : expr === 'shocked' ? 5 : expr === 'sad' ? -1 : expr === 'focus' ? 3 : mouth;
  ctx.beginPath();
  switch (m) {
    case -1: ctx.arc(mx, my + 22, 20, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke(); break;                                  // frown
    case 1: ctx.arc(mx, my - 6, 26, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke(); break;                                 // grin
    case 2: ctx.moveTo(mx - 24, my - 4); ctx.quadraticCurveTo(mx, my + 34, mx + 24, my - 4); ctx.closePath(); ctx.fill();  // open smile
      ctx.fillStyle = '#ff8c8c'; ctx.beginPath(); ctx.ellipse(mx, my + 12, 10, 5, 0, 0, Math.PI * 2); ctx.fill(); break;
    case 3: ctx.moveTo(mx - 16, my + 4); ctx.lineTo(mx + 16, my + 4); ctx.stroke(); break;                                // flat
    case 4: ctx.arc(mx, my - 4, 20, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();                                        // tongue
      ctx.fillStyle = '#ff7a8a'; ctx.beginPath(); ctx.ellipse(mx + 6, my + 18, 8, 9, 0, 0, Math.PI * 2); ctx.fill(); break;
    case 5: ctx.ellipse(mx, my + 8, 11, 14, 0, 0, Math.PI * 2); ctx.fill(); break;                                       // "o"
    default: ctx.arc(mx, my - 8, 22, Math.PI * 0.2, Math.PI * 0.8); ctx.stroke();                                          // smile
  }
}

/* ---------------- helpers ---------------- */

const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 12);

function part(geo: THREE.BufferGeometry, mat: THREE.Material, outline = 0, parent?: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  if (outline > 0) addOutline(m, outline);
  parent?.add(m);
  return m;
}

function patternTexture(kind: 'stripes' | 'stars' | 'jersey', base: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  if (kind === 'stripes') {
    g.fillStyle = 'rgba(255,255,255,.85)';
    for (let y = 8; y < 128; y += 28) g.fillRect(0, y, 128, 11);
  } else if (kind === 'stars') {
    g.fillStyle = '#fff6a8';
    const star = (cx: number, cy: number, r: number) => {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
        g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
    };
    star(32, 64, 18); star(96, 40, 12); star(98, 96, 9);
  } else {
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.fillRect(0, 0, 10, 128); g.fillRect(118, 0, 10, 128);
    g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('7', 32, 70);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

/* ---------------- builder ---------------- */

export function buildBuddy(cfg: BuddyConfig): BuddyRig {
  const D = BUDDY_DIMS;
  const disposables: Array<{ dispose(): void }> = [];
  const mat = (color: string, extra: THREE.MeshToonMaterialParameters = {}) => {
    const m = toon(color, extra);
    disposables.push(m);
    return m;
  };
  const geo = <G extends THREE.BufferGeometry>(g: G): G => { disposables.push(g); return g; };

  const skinC = SKIN_TONES[cfg.skin] ?? SKIN_TONES[0];
  const hairC = HAIR_COLORS[cfg.hairColor] ?? HAIR_COLORS[0];
  const favC = FAV_COLORS[cfg.color] ?? FAV_COLORS[0];
  const botC = BOTTOM_COLORS[cfg.bottom] ?? BOTTOM_COLORS[0];
  const skin = mat(skinC), hair = mat(hairC), shirt = mat(favC), pants = mat(botC);
  const shoe = mat('#2b2f38'), white = mat('#f4f4f4'), dark = mat(shade(favC, 0.6));

  const root = new THREE.Group();
  root.name = `buddy:${cfg.name}`;
  const hips = new THREE.Group(); hips.position.y = D.hipsY; root.add(hips);
  const spine = new THREE.Group(); spine.position.y = 0.02; hips.add(spine);
  const neck = new THREE.Group(); neck.position.y = D.torsoH + 0.04; spine.add(neck);
  const head = new THREE.Group(); head.position.y = D.headR * 0.95; neck.add(head);

  /* torso */
  const top = cfg.top;
  const torsoMat = top === 3 ? mat('#ffffff', { map: track(patternTexture('stripes', favC)) })
    : top === 7 ? mat('#ffffff', { map: track(patternTexture('stars', favC)) })
    : top === 5 ? mat('#ffffff', { map: track(patternTexture('jersey', favC)) })
    : shirt;
  function track(t: THREE.Texture): THREE.Texture { disposables.push(t); return t; }

  const torso = part(geo(capsule(D.torsoR, D.torsoH - D.torsoR * 2 + 0.12)), torsoMat, 0.05, spine);
  torso.position.y = D.torsoH / 2;
  torso.scale.set(1.08, 1, 0.82);
  // Belt line / bottoms top band so shirts and trousers meet cleanly
  const waist = part(geo(new THREE.CylinderGeometry(D.torsoR * 1.04, D.torsoR * 1.08, 0.1, 16)), pants, 0, hips);
  waist.scale.set(1.08, 1, 0.82);

  if (top === 2) { // hoodie: hood ring + pocket
    const hood = part(geo(new THREE.TorusGeometry(0.12, 0.045, 8, 16)), shirt, 0.06, spine);
    hood.position.set(0, D.torsoH - 0.02, -0.06); hood.rotation.x = Math.PI / 2.4;
    const pocket = part(geo(new THREE.BoxGeometry(0.2, 0.08, 0.02)), dark, 0, spine);
    pocket.position.set(0, 0.14, D.torsoR * 0.82);
  } else if (top === 4) { // polo collar
    const collar = part(geo(new THREE.TorusGeometry(0.085, 0.025, 6, 16)), white, 0, spine);
    collar.position.y = D.torsoH - 0.01; collar.rotation.x = Math.PI / 2;
  } else if (top === 6) { // jacket: zip strip and collar
    const zip = part(geo(new THREE.BoxGeometry(0.035, D.torsoH * 0.8, 0.02)), white, 0, spine);
    zip.position.set(0, D.torsoH * 0.48, D.torsoR * 0.84);
    const collar = part(geo(new THREE.TorusGeometry(0.095, 0.03, 6, 16)), dark, 0, spine);
    collar.position.y = D.torsoH - 0.02; collar.rotation.x = Math.PI / 2;
  }

  /* bottoms extras */
  if (cfg.bottom === 2) { // skirt
    const skirt = part(geo(new THREE.CylinderGeometry(D.torsoR * 1.05, D.torsoR * 1.55, 0.26, 18, 1, true)), pants, 0.04, hips);
    skirt.position.y = -0.1;
    (skirt.material as THREE.Material).side = THREE.DoubleSide;
  } else if (cfg.bottom === 4) { // overalls bib + straps
    const bib = part(geo(new THREE.BoxGeometry(0.2, 0.18, 0.03)), pants, 0, spine);
    bib.position.set(0, 0.14, D.torsoR * 0.82);
    for (const s of [-1, 1]) {
      const strap = part(geo(new THREE.BoxGeometry(0.035, D.torsoH * 0.7, 0.02)), pants, 0, spine);
      strap.position.set(0.07 * s, D.torsoH * 0.55, D.torsoR * 0.8);
    }
  }

  /* legs */
  const legCovered = cfg.bottom === 1 || cfg.bottom === 3 || cfg.bottom === 4;
  const shorts = cfg.bottom === 0 || cfg.bottom === 5;
  const makeLeg = (side: 1 | -1) => {
    const hip = new THREE.Group();
    hip.position.set(0.085 * side, 0, 0);
    hips.add(hip);
    const legLen = D.legLen - 0.06;
    const leg = part(geo(capsule(D.legR, legLen - D.legR * 2)), legCovered ? pants : skin, 0.06, hip);
    leg.position.y = -legLen / 2;
    if (shorts) {
      const sh = part(geo(new THREE.CylinderGeometry(D.legR * 1.35, D.legR * 1.3, 0.22, 12)), pants, 0.04, hip);
      sh.position.y = -0.1;
      if (cfg.bottom === 5) { const pk = part(geo(new THREE.BoxGeometry(0.06, 0.07, 0.04)), dark, 0, hip); pk.position.set(0.09 * side, -0.14, 0); }
    }
    if (cfg.bottom === 3) { const cuff = part(geo(new THREE.CylinderGeometry(D.legR * 1.1, D.legR * 1.1, 0.05, 12)), white, 0, hip); cuff.position.y = -legLen + 0.06; }
    const foot = part(geo(new THREE.BoxGeometry(0.11, 0.07, 0.19)), shoe, 0.06, hip);
    foot.position.set(0, -D.legLen + 0.04, 0.035);
    return hip;
  };
  const hipL = makeLeg(-1), hipR = makeLeg(1);

  /* arms */
  const sleeveLen = top === 1 ? 0 : top === 2 || top === 6 ? D.armLen - 0.04 : 0.17;
  const makeArm = (side: 1 | -1) => {
    const sh = new THREE.Group();
    sh.position.set(D.shoulderX * side, D.torsoH - 0.06, 0);
    spine.add(sh);
    const arm = part(geo(capsule(D.armR, D.armLen - D.armR * 2)), skin, 0.08, sh);
    arm.position.y = -D.armLen / 2;
    if (sleeveLen > 0) {
      const sl = part(geo(new THREE.CylinderGeometry(D.armR * 1.45, D.armR * 1.35, sleeveLen, 12)), shirt, 0.05, sh);
      sl.position.y = -sleeveLen / 2 + 0.02;
    }
    const handJ = new THREE.Group(); handJ.position.y = -D.armLen; sh.add(handJ);
    part(geo(new THREE.SphereGeometry(D.armR * 1.45, 12, 10)), skin, 0.08, handJ);
    return { sh, handJ };
  };
  const L = makeArm(-1), R = makeArm(1);

  /* head */
  const R0 = D.headR;
  const skull = part(geo(new THREE.SphereGeometry(R0, 28, 20)), skin, 0.045, head);
  skull.scale.set(1, 0.98, 0.94);
  for (const s of [-1, 1]) { // ears
    const ear = part(geo(new THREE.SphereGeometry(R0 * 0.2, 10, 8)), skin, 0, head);
    ear.position.set(R0 * 0.97 * s, -0.01, 0); ear.scale.set(0.6, 1, 0.8);
  }
  const nose = part(geo(new THREE.SphereGeometry(R0 * 0.11, 10, 8)), skin, 0, head);
  nose.position.set(0, -0.01, R0 * 0.94);

  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = 256; faceCanvas.height = 192;
  const fctx = faceCanvas.getContext('2d')!;
  const faceTex = track(new THREE.CanvasTexture(faceCanvas));
  faceTex.colorSpace = THREE.SRGBColorSpace;
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false });
  disposables.push(faceMat);
  // A front slice of a slightly larger sphere carries the face, so it wraps instead of looking pasted on.
  const face = new THREE.Mesh(geo(new THREE.SphereGeometry(R0 * 1.005, 24, 16, Math.PI / 2 - 0.95, 1.9, 0.95, 1.25)), faceMat);
  face.scale.copy(skull.scale);
  face.renderOrder = 2;
  head.add(face);
  let expr: Expression | null = null;
  const setExpression = (e: Expression) => {
    if (e === expr) return;
    expr = e;
    drawFace(fctx, cfg.eyes, cfg.mouth, e);
    faceTex.needsUpdate = true;
  };
  setExpression('normal');

  /* hair */
  const capGeo = (thetaLen: number, scale = 1.06) => geo(new THREE.SphereGeometry(R0 * scale, 24, 14, 0, Math.PI * 2, 0, thetaLen));
  const cap = (thetaLen = 1.25, scale = 1.06) => {
    const c = part(capGeo(thetaLen, scale), hair, 0.04, head);
    c.scale.set(1, 0.98, 0.96);
    c.rotation.x = -0.18; // sits further down at the back
    return c;
  };
  switch (cfg.hair) {
    case 0: cap(); break;
    case 1: { cap(); const fr = part(geo(new THREE.SphereGeometry(R0 * 0.62, 14, 10)), hair, 0.04, head); fr.position.set(-0.04, R0 * 0.6, R0 * 0.6); fr.scale.set(1.3, 0.5, 0.6); fr.rotation.z = 0.25; break; }
    case 2: { cap(1.1); for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const sp = part(geo(new THREE.ConeGeometry(0.05, 0.14, 6)), hair, 0.05, head);
      sp.position.set(Math.cos(a) * R0 * 0.55, R0 * 0.88, Math.sin(a) * R0 * 0.55); sp.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    } const top0 = part(geo(new THREE.ConeGeometry(0.055, 0.16, 6)), hair, 0.05, head); top0.position.y = R0 * 1.05; break; }
    case 3: { cap(); const tail = part(geo(capsule(0.055, 0.2)), hair, 0.05, head); tail.position.set(0, -0.02, -R0 * 1.05); tail.rotation.x = 0.35;
      const tie = part(geo(new THREE.SphereGeometry(0.06, 10, 8)), hair, 0.05, head); tie.position.set(0, R0 * 0.35, -R0 * 0.98); break; }
    case 4: { cap(); const bun = part(geo(new THREE.SphereGeometry(R0 * 0.42, 14, 10)), hair, 0.05, head); bun.position.set(0, R0 * 0.95, -R0 * 0.45); break; }
    case 5: { cap(1.35, 1.07); const back = part(geo(new THREE.CylinderGeometry(R0 * 1.0, R0 * 0.9, R0 * 1.5, 16, 1, true, 0.6, Math.PI * 2 - 1.2)), hair, 0.04, head);
      back.position.y = -R0 * 0.45; break; }
    case 6: { const afro = part(geo(new THREE.SphereGeometry(R0 * 1.35, 20, 14)), hair, 0.04, head); afro.position.set(0, R0 * 0.38, -R0 * 0.5); // set back so the face stays clear
      break; }
    case 7: { cap(1.0, 1.02); for (let i = 0; i < 5; i++) {
      const fin = part(geo(new THREE.BoxGeometry(0.05, 0.13 - Math.abs(i - 2) * 0.012, 0.08)), hair, 0.05, head);
      fin.position.set(0, R0 * 1.02, R0 * (0.55 - i * 0.28)); fin.rotation.x = -0.2 + i * 0.12;
    } break; }
  }

  /* accessory */
  const accMat = mat(shade(favC, 0.85));
  switch (cfg.accessory) {
    case 'hat': {
      const brim = part(geo(new THREE.CylinderGeometry(R0 * 1.75, R0 * 1.75, 0.02, 24)), mat('#f2dc9c'), 0.04, head); brim.position.y = R0 * 0.62;
      const crown = part(geo(new THREE.CylinderGeometry(R0 * 0.85, R0 * 1.0, R0 * 0.6, 20)), mat('#f2dc9c'), 0.04, head); crown.position.y = R0 * 0.9;
      const band = part(geo(new THREE.CylinderGeometry(R0 * 1.0, R0 * 1.0, 0.04, 20)), accMat, 0, head); band.position.y = R0 * 0.7;
      break;
    }
    case 'cap': {
      const c = part(geo(new THREE.SphereGeometry(R0 * 1.09, 20, 12, 0, Math.PI * 2, 0, 1.25)), accMat, 0.04, head); c.rotation.x = -0.1;
      const bill = part(geo(new THREE.CylinderGeometry(R0 * 0.75, R0 * 0.75, 0.025, 20, 1, false, -Math.PI / 2, Math.PI)), accMat, 0.04, head);
      bill.position.set(0, R0 * 0.42, R0 * 0.78); bill.rotation.x = 0.15;
      break;
    }
    case 'glasses': {
      const frame = mat('#222831');
      for (const s of [-1, 1]) {
        const ring = part(geo(new THREE.TorusGeometry(0.05, 0.011, 6, 18)), frame, 0, head);
        ring.position.set(0.075 * s, 0.035, R0 * 0.97);
      }
      const bridge = part(geo(new THREE.BoxGeometry(0.05, 0.012, 0.012)), frame, 0, head); bridge.position.set(0, 0.045, R0 * 0.99);
      break;
    }
    case 'headband': {
      const hb = part(geo(new THREE.TorusGeometry(R0 * 1.04, 0.03, 8, 28)), accMat, 0.04, head);
      hb.rotation.x = Math.PI / 2 - 0.15; hb.position.y = R0 * 0.38;
      break;
    }
    case 'visor': {
      const hb = part(geo(new THREE.TorusGeometry(R0 * 1.04, 0.028, 8, 28)), accMat, 0.04, head);
      hb.rotation.x = Math.PI / 2 - 0.12; hb.position.y = R0 * 0.42;
      const bill = part(geo(new THREE.CylinderGeometry(R0 * 0.85, R0 * 0.85, 0.022, 20, 1, false, -Math.PI / 2, Math.PI)), mat('#ffffff'), 0.04, head);
      bill.position.set(0, R0 * 0.36, R0 * 0.8); bill.rotation.x = 0.18;
      break;
    }
    case 'bucket': {
      const crown = part(geo(new THREE.CylinderGeometry(R0 * 0.95, R0 * 1.1, R0 * 0.62, 20)), accMat, 0.04, head); crown.position.y = R0 * 0.82;
      const brim = part(geo(new THREE.CylinderGeometry(R0 * 1.15, R0 * 1.5, R0 * 0.22, 24, 1, true)), accMat, 0.04, head); brim.position.y = R0 * 0.48;
      break;
    }
    default: break;
  }

  const joints: Record<JointName, THREE.Object3D> = {
    root, hips, spine, neck, head, shoulderL: L.sh, shoulderR: R.sh, handL: L.handJ, handR: R.handJ, hipL, hipR
  };
  for (const [n, j] of Object.entries(joints)) j.name = n;

  return {
    root, joints, config: cfg, hipsY: D.hipsY, setExpression,
    dispose: () => { for (const d of disposables) d.dispose(); root.removeFromParent(); }
  };
}

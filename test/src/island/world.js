import * as THREE from 'three';
import { H, ss, PEAK, TOWN, LAKE, LAKE_LEVEL, HEAD, GOLF, ISLET, HERMIT, findCoast } from './terrain.js';

/* ---------- helpers ---------- */
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = mulberry32(7);
const pick = a => a[Math.floor(rand() * a.length)];
const matCache = {};
const M = c => matCache[c] || (matCache[c] = new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
const mesh = (geo, c) => new THREE.Mesh(geo, typeof c === 'string' ? M(c) : c);
const box = (w, h, d, c) => mesh(new THREE.BoxGeometry(w, h, d), c);
const cyl = (rt, rb, h, seg, c, open = false) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), c);
const cone = (r, h, seg, c) => mesh(new THREE.ConeGeometry(r, h, seg), c);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const STONE = '#e9e0cf', WHITE = '#fffaf0';

export function buildWorld(scene) {
  const root = new THREE.Group(); scene.add(root);
  const updaters = [];
  const windows = [];               // world matrices for lit windows
  const tmp = new THREE.Matrix4();

  function place(obj, x, z, yoff = 0, ground) {
    obj.position.set(x, (ground ?? H(x, z)) + yoff, z);
    root.add(obj); obj.updateMatrixWorld(true);
    return obj;
  }
  function addWindows(group, w, h, d, floorH = 7) {
    group.updateMatrixWorld(true);
    const floors = Math.max(1, Math.floor((h - 3) / floorH)), cols = Math.max(1, Math.floor(w / 6));
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
      const lx = -w / 2 + (c + 0.5) * (w / cols), ly = 4 + f * floorH;
      for (const s of [1, -1]) windows.push(tmp.clone().makeTranslation(lx, ly, s * (d / 2 + 0.15)).premultiply(group.matrixWorld));
    }
  }
  function house(x, z, w, d, h, wall, roof, rotY = 0) {
    const g = new THREE.Group();
    const b = box(w, h, d, wall); b.position.y = h / 2; g.add(b);
    const m = Math.max(w, d), r = cone(m * 0.75, Math.min(h * 0.5, 10), 4, roof);
    r.rotation.y = Math.PI / 4; r.scale.set(w / m, 1, d / m); r.position.y = h + Math.min(h * 0.5, 10) / 2; g.add(r);
    g.rotation.y = rotY;
    place(g, x, z);
    addWindows(g, w, h, d);
    return g;
  }

  /* ================= TOWN ================= */
  const V_HOTEL = { x: TOWN.x + 120, z: TOWN.z + 10 }, V_POOL = { x: TOWN.x + 125, z: TOWN.z + 70 },
        V_BOWL = { x: TOWN.x - 95, z: TOWN.z - 15 }, V_ARENA = { x: TOWN.x - 150, z: TOWN.z + 70 },
        V_COURT = { x: TOWN.x + 25, z: TOWN.z - 75 }, V_SQUARE = { x: TOWN.x, z: TOWN.z + 20 };
  const venues = [V_HOTEL, V_POOL, V_BOWL, V_ARENA, V_COURT, V_SQUARE];

  // houses
  const walls = ['#ffd9c2', '#fff1b8', '#cdeffd', '#ffe0ec', '#e2f7d4', '#fffaf0', '#ffe6b3'];
  const roofs = ['#ff6b4a', '#2f8fd8', '#ff9a3c', '#3bb37a', '#e2463f'];
  for (let i = -6; i <= 6; i++) for (let j = -5; j <= 5; j++) {
    const x = TOWN.x + i * 30 + (rand() - 0.5) * 8, z = TOWN.z + j * 28 + (rand() - 0.5) * 8;
    if (Math.hypot(x - TOWN.x, z - TOWN.z) > 175) continue;
    if (venues.some(v => Math.hypot(x - v.x, z - v.z) < 52)) continue;
    const g = H(x, z); if (g < 4 || g > 20) continue;
    if (rand() < 0.18) continue;
    house(x, z, 12 + rand() * 9, 11 + rand() * 7, 9 + rand() * 14, pick(walls), pick(roofs), Math.floor(rand() * 4) * Math.PI / 2);
  }

  // town square + fountain
  const sq = new THREE.Group();
  const plaza = cyl(30, 30, 0.8, 24, '#f3e7cf'); sq.add(plaza);
  const basin = cyl(9, 10, 3, 16, STONE); basin.position.y = 2; sq.add(basin);
  const water = cyl(8, 8, 0.6, 16, '#56c8ef'); water.position.y = 3.4; sq.add(water);
  const spout = cyl(1.2, 1.6, 9, 8, STONE); spout.position.y = 6; sq.add(spout);
  const spray = mesh(new THREE.SphereGeometry(3.2, 10, 8), new THREE.MeshLambertMaterial({ color: '#bdeeff', transparent: true, opacity: 0.75 }));
  spray.position.y = 11; sq.add(spray);
  place(sq, V_SQUARE.x, V_SQUARE.z, 0.3);
  updaters.push(t => spray.scale.setScalar(1 + Math.sin(t * 6) * 0.12));
  // clock tower beside the square
  const ct = new THREE.Group();
  const ctb = box(9, 34, 9, '#f6d7a8'); ctb.position.y = 17; ct.add(ctb);
  const face = cyl(3.4, 3.4, 0.6, 16, WHITE); face.rotation.x = Math.PI / 2; face.position.set(0, 28, 4.8); ct.add(face);
  const hand = box(0.5, 3, 0.3, '#333'); hand.position.set(0, 29.2, 5.2); ct.add(hand);
  const ctr = cone(7.5, 9, 4, '#2f8fd8'); ctr.rotation.y = Math.PI / 4; ctr.position.y = 38.5; ct.add(ctr);
  place(ct, V_SQUARE.x + 38, V_SQUARE.z - 18);

  // hotel tower
  const hotel = new THREE.Group();
  const hb = box(48, 82, 30, WHITE); hb.position.y = 41; hotel.add(hb);
  for (let y = 10; y < 82; y += 14) { const s = box(49, 1.6, 31, '#4fb5e6'); s.position.y = y; hotel.add(s); }
  const sign = box(30, 7, 2, '#ff6b8a'); sign.position.set(0, 86, 0); hotel.add(sign);
  const roofTop = box(50, 2, 32, '#4fb5e6'); roofTop.position.y = 83; hotel.add(roofTop);
  place(hotel, V_HOTEL.x, V_HOTEL.z);
  addWindows(hotel, 48, 82, 30, 7);

  // pool + table tennis
  const pool = new THREE.Group();
  const deck = box(64, 1.2, 40, '#fff1d6'); deck.position.y = 0.6; pool.add(deck);
  const pw = box(40, 1, 18, '#4fd6f2'); pw.position.set(-8, 1.3, -5); pool.add(pw);
  const tt = new THREE.Group();
  const top = box(9, 0.5, 5, '#2f6fd6'); top.position.y = 4; tt.add(top);
  const net = box(0.2, 0.9, 5.2, WHITE); net.position.y = 4.7; tt.add(net);
  for (const [lx, lz] of [[-4, -2], [4, -2], [-4, 2], [4, 2]]) { const l = box(0.4, 4, 0.4, '#555'); l.position.set(lx, 2, lz); tt.add(l); }
  tt.position.set(18, 1.2, 12); pool.add(tt);
  for (const ux of [-22, -10, 2]) { const u = umbrella(pick(['#ff6b4a', '#ffd23a', '#3bb37a'])); u.position.set(ux, 1.2, 12); pool.add(u); }
  place(pool, V_POOL.x, V_POOL.z);

  // bowling alley with the giant pin
  const bowl = new THREE.Group();
  const bb = box(72, 16, 34, '#ff8fa3'); bb.position.y = 8; bowl.add(bb);
  const bstripe = box(73, 3, 35, '#ffffff'); bstripe.position.y = 13; bowl.add(bstripe);
  const pinPts = [[0, 0], [4, 0], [5.6, 3], [5.2, 8], [3.2, 11.5], [2.2, 13.5], [2.9, 16.5], [3.1, 18.5], [2, 20.6], [0, 21.2]].map(([a, b]) => new THREE.Vector2(a, b));
  const pin = mesh(new THREE.LatheGeometry(pinPts, 14), WHITE); pin.scale.setScalar(1.5); pin.position.set(0, 16, 0); bowl.add(pin);
  const ring = mesh(new THREE.TorusGeometry(3.4, 0.6, 6, 14), '#e2463f'); ring.rotation.x = Math.PI / 2; ring.position.set(0, 16 + 13.5 * 1.5, 0); bowl.add(ring);
  place(bowl, V_BOWL.x, V_BOWL.z);
  addWindows(bowl, 72, 16, 34, 8);

  // swordplay arena
  const arena = new THREE.Group();
  const wallA = cyl(36, 38, 13, 28, new THREE.MeshLambertMaterial({ color: '#e6d3a3', flatShading: true, side: THREE.DoubleSide }), true); wallA.position.y = 6.5; arena.add(wallA);
  const sand = cyl(34, 34, 1, 28, '#f3e1b0'); sand.position.y = 0.5; arena.add(sand);
  const stage = cyl(13, 14, 4, 8, '#c9a46a'); stage.position.y = 2; arena.add(stage);
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * Math.PI * 2, pl = cyl(1.8, 2.2, 20, 6, STONE); pl.position.set(Math.cos(a) * 37, 10, Math.sin(a) * 37); arena.add(pl);
    const fl = box(0.3, 5, 4, k % 2 ? '#ff6b4a' : '#2f8fd8'); fl.position.set(Math.cos(a) * 37, 22, Math.sin(a) * 37 + 2); arena.add(fl);
  }
  place(arena, V_ARENA.x, V_ARENA.z);

  // basketball court
  const court = new THREE.Group();
  const cf = box(38, 0.6, 22, '#ec9a4f'); cf.position.y = 0.3; court.add(cf);
  const cl = box(0.6, 0.65, 22, WHITE); cl.position.y = 0.32; court.add(cl);
  for (const s of [1, -1]) {
    const pole = box(0.8, 12, 0.8, '#666'); pole.position.set(s * 20, 6, 0); court.add(pole);
    const board = box(0.4, 4.5, 7, WHITE); board.position.set(s * 19.4, 12, 0); court.add(board);
    const hoop = mesh(new THREE.TorusGeometry(1.4, 0.2, 6, 12), '#ff6a2b'); hoop.rotation.x = Math.PI / 2; hoop.position.set(s * 17.8, 10.5, 0); court.add(hoop);
  }
  place(court, V_COURT.x, V_COURT.z);

  /* ================= BEACH ================= */
  const beachTh = 2.5;   // radians, facing away from the headland
  const beach = findCoast(beachTh);
  const bIn = { x: beach.x - Math.cos(beachTh) * 22, z: beach.z - Math.sin(beachTh) * 22 };
  for (let k = -5; k <= 5; k++) {
    const th = beachTh + k * 0.045, c = findCoast(th);
    const u = umbrella(pick(['#ff6b4a', '#ffd23a', '#3bb37a', '#2f8fd8', '#ff8fa3']));
    place(u, c.x - Math.cos(th) * 12, c.z - Math.sin(th) * 12);
  }
  // dog park: flags, disc targets, dog house
  const park = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const tr = mesh(new THREE.TorusGeometry(5 + k * 4, 0.5, 4, 24), k % 2 ? '#ffffff' : '#ff6b4a'); tr.rotation.x = Math.PI / 2; tr.position.y = 0.3; park.add(tr);
  }
  const dhb = box(6, 4, 6, '#c58a4e'); dhb.position.set(-16, 2, 6); park.add(dhb);
  const dhr = cone(5, 3, 4, '#e2463f'); dhr.rotation.y = Math.PI / 4; dhr.position.set(-16, 5.5, 6); park.add(dhr);
  for (const fx of [-14, 14]) { const p = box(0.4, 8, 0.4, '#888'); p.position.set(fx, 4, -10); park.add(p); const f = box(0.2, 2.5, 4, '#ffd23a'); f.position.set(fx, 7, -8); park.add(f); }
  const bp = findCoast(beachTh + 0.35);
  const parkPos = { x: bp.x - Math.cos(beachTh + 0.35) * 26, z: bp.z - Math.sin(beachTh + 0.35) * 26 };
  place(park, parkPos.x, parkPos.z, 0.2);
  // beach dog that runs laps
  const dog = new THREE.Group();
  const db = box(4, 2.4, 2, '#c58a4e'); db.position.y = 2; dog.add(db);
  const dhd = box(2, 2, 2, '#c58a4e'); dhd.position.set(2.6, 3.4, 0); dog.add(dhd);
  root.add(dog);
  updaters.push(t => {
    const a = t * 0.9, x = parkPos.x + Math.cos(a) * 12, z = parkPos.z + Math.sin(a) * 12;
    dog.position.set(x, H(x, z) + Math.abs(Math.sin(t * 9)) * 0.8, z); dog.rotation.y = -a - Math.PI / 2;
  });

  /* ================= HEADLAND + LIGHTHOUSE ================= */
  let lx = HEAD.x; while (H(lx, HEAD.z) > 3 && lx < 900) lx += 4;
  const LH = { x: lx - 30, z: HEAD.z };
  const light = new THREE.Group();
  for (let k = 0; k < 6; k++) { const s = cyl(7 - k * 0.35, 7.3 - k * 0.35, 8, 10, k % 2 ? '#ff4f4f' : WHITE); s.position.y = 4 + k * 8; light.add(s); }
  const lamp = mesh(new THREE.CylinderGeometry(4.2, 4.2, 6, 10), new THREE.MeshLambertMaterial({ color: '#fff3b0', emissive: '#ffd24a', emissiveIntensity: 0.4 }));
  lamp.position.y = 51; light.add(lamp);
  const lroof = cone(5.5, 6, 10, '#ff4f4f'); lroof.position.y = 57; light.add(lroof);
  const beamPivot = new THREE.Group(); beamPivot.position.y = 51; light.add(beamPivot);
  const beamMat = new THREE.MeshBasicMaterial({ color: '#fff4b8', transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  for (const s of [1, -1]) {
    const beam = mesh(new THREE.ConeGeometry(26, 260, 16, 1, true), beamMat);
    beam.rotation.z = s * Math.PI / 2; beam.position.x = s * 130; beamPivot.add(beam);
  }
  place(light, LH.x, LH.z);
  updaters.push((t, dt) => { beamPivot.rotation.y += dt * 0.8; });

  // windmills on the hill between town and headland
  const mills = [];
  for (const [mx, mz] of [[230, 170], [270, 140], [250, 205], [300, 180]]) {
    const g = new THREE.Group();
    const tw = cyl(2, 4, 28, 6, WHITE); tw.position.y = 14; g.add(tw);
    const hd = box(4, 4, 6, '#ff6b4a'); hd.position.y = 29; g.add(hd);
    const blades = new THREE.Group(); blades.position.set(0, 29, 3.4);
    for (let k = 0; k < 4; k++) { const bl = box(1.8, 14, 0.4, WHITE); bl.position.y = 7; const arm = new THREE.Group(); arm.rotation.z = k * Math.PI / 2; arm.add(bl); blades.add(arm); }
    g.add(blades); g.rotation.y = -0.6;
    place(g, mx, mz); mills.push(blades);
  }
  updaters.push((t, dt) => mills.forEach((b, i) => b.rotation.z += dt * (1.2 + i * 0.15)));

  /* ================= VOLCANO ================= */
  const lavaY = H(PEAK.x, PEAK.z) + 3;
  const lavaMat = new THREE.MeshBasicMaterial({ color: '#ff7a22' });
  const lava = mesh(new THREE.CircleGeometry(34, 20), lavaMat); lava.rotation.x = -Math.PI / 2; lava.position.set(PEAK.x, lavaY, PEAK.z); root.add(lava);
  updaters.push(t => lavaMat.color.setHSL(0.06 + Math.sin(t * 1.7) * 0.012, 1, 0.55 + Math.sin(t * 2.3) * 0.04));
  // smoke puffs
  const puffs = [];
  const puffMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, flatShading: true });
  for (let k = 0; k < 8; k++) { const p = mesh(new THREE.IcosahedronGeometry(10, 0), puffMat); root.add(p); puffs.push({ p, o: k / 8 }); }
  updaters.push(t => puffs.forEach(({ p, o }) => {
    const k = (t * 0.06 + o) % 1; p.position.set(PEAK.x + Math.sin(o * 20) * 12 + k * 60, lavaY + 30 + k * 160, PEAK.z + Math.cos(o * 20) * 12);
    p.scale.setScalar(0.6 + k * 2.2);
  }));

  /* ================= LAKE, FALLS, CASTLE ================= */
  const lakeMesh = mesh(new THREE.CircleGeometry(LAKE.r + 8, 32), new THREE.MeshPhongMaterial({ color: '#5cc9ee', shininess: 90, transparent: true, opacity: 0.9 }));
  lakeMesh.rotation.x = -Math.PI / 2; lakeMesh.position.set(LAKE.x, LAKE_LEVEL, LAKE.z); root.add(lakeMesh);
  // ducks
  const ducks = [];
  for (let k = 0; k < 5; k++) { const d = new THREE.Group(); const b = box(2.2, 1.4, 1.4, '#fff7d0'); d.add(b); const hh = box(1, 1, 1, '#3bb37a'); hh.position.set(1, 1, 0); d.add(hh); root.add(d); ducks.push(d); }
  updaters.push(t => ducks.forEach((d, i) => { const a = t * 0.2 + i * 0.9; d.position.set(LAKE.x + Math.cos(a) * (18 + i * 5), LAKE_LEVEL + 0.6, LAKE.z + Math.sin(a) * (18 + i * 5)); d.rotation.y = -a; }));

  const down = V(LAKE.x - PEAK.x, 0, LAKE.z - PEAK.z).normalize();
  const fallTop = V(LAKE.x + down.x * (LAKE.r + 10), LAKE_LEVEL + 3, LAKE.z + down.z * (LAKE.r + 10));
  const fallBotY = Math.max(0, H(LAKE.x + down.x * (LAKE.r + 55), LAKE.z + down.z * (LAKE.r + 55)));
  const fallH = Math.max(14, fallTop.y - fallBotY + 6);
  const fcv = document.createElement('canvas'); fcv.width = 32; fcv.height = 128;
  const fctx = fcv.getContext('2d'); fctx.fillStyle = '#8fdcff'; fctx.fillRect(0, 0, 32, 128);
  for (let k = 0; k < 40; k++) { fctx.fillStyle = 'rgba(255,255,255,' + (0.4 + rand() * 0.5) + ')'; fctx.fillRect(rand() * 32, rand() * 128, 2, 12 + rand() * 30); }
  const ftex = new THREE.CanvasTexture(fcv); ftex.wrapS = ftex.wrapT = THREE.RepeatWrapping; ftex.repeat.set(2, 2); ftex.colorSpace = THREE.SRGBColorSpace;
  const falls = mesh(new THREE.PlaneGeometry(24, fallH), new THREE.MeshBasicMaterial({ map: ftex, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  falls.position.set(fallTop.x + down.x * 6, fallTop.y - fallH / 2, fallTop.z + down.z * 6);
  falls.lookAt(falls.position.clone().add(down)); root.add(falls);
  updaters.push((t, dt) => { ftex.offset.y += dt * 1.4; });
  const mist = mesh(new THREE.SphereGeometry(14, 10, 8), new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }));
  mist.position.set(falls.position.x + down.x * 6, fallBotY + 4, falls.position.z + down.z * 6); root.add(mist);

  const up = down.clone().negate();
  const CA = { x: LAKE.x + up.x * (LAKE.r + 42), z: LAKE.z + up.z * (LAKE.r + 42) };
  const castle = new THREE.Group();
  const keep = box(18, 34, 18, STONE); keep.position.y = 17; castle.add(keep);
  const keepRoof = cone(14, 14, 4, '#4f7bd6'); keepRoof.rotation.y = Math.PI / 4; keepRoof.position.y = 41; castle.add(keepRoof);
  for (const [cx, cz] of [[-20, -20], [20, -20], [-20, 20], [20, 20]]) {
    const tw = cyl(6, 6.5, 28, 10, STONE); tw.position.set(cx, 14, cz); castle.add(tw);
    const tr = cone(7.5, 12, 10, '#4f7bd6'); tr.position.set(cx, 34, cz); castle.add(tr);
  }
  for (const [wx, wz, ww, wd] of [[0, -20, 40, 3], [0, 20, 40, 3], [-20, 0, 3, 40], [20, 0, 3, 40]]) { const w = box(ww, 16, wd, STONE); w.position.set(wx, 8, wz); castle.add(w); }
  const flag = box(0.3, 4, 6, '#ff6b4a'); flag.position.set(0, 52, 3); castle.add(flag);
  const fpole = box(0.5, 10, 0.5, '#666'); fpole.position.y = 50; castle.add(fpole);
  castle.rotation.y = Math.atan2(up.x, up.z);
  place(castle, CA.x, CA.z, -1);

  /* ================= RUINS (back of the island) ================= */
  const ruTh = -Math.PI / 2 - 0.25, ruC = findCoast(ruTh);
  const RU = { x: ruC.x * 0.78, z: ruC.z * 0.78 };
  const ruins = new THREE.Group();
  for (let k = 0; k < 3; k++) { const st = box(56 - k * 14, 5, 56 - k * 14, '#cdbb95'); st.position.y = 2.5 + k * 5; ruins.add(st); }
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * Math.PI * 2, c = cyl(2.4, 2.8, 22, 7, '#d8c9a6');
    if (k % 4 === 1) { c.rotation.z = Math.PI / 2; c.rotation.y = a; c.position.set(Math.cos(a) * 40, 3, Math.sin(a) * 40); }
    else { c.position.set(Math.cos(a) * 36, 11, Math.sin(a) * 36); if (k % 3 === 0) c.scale.y = 0.55; }
    ruins.add(c);
  }
  const gate = new THREE.Group();
  for (const s of [-1, 1]) { const p = box(5, 26, 5, '#cdbb95'); p.position.set(s * 9, 13, 0); gate.add(p); }
  const lintel = box(26, 5, 6, '#cdbb95'); lintel.position.y = 28; gate.add(lintel);
  gate.position.set(0, 15, 0); ruins.add(gate);
  place(ruins, RU.x, RU.z, -1);

  /* ================= SEA ARCH ================= */
  const arTh = 3.5, arC = findCoast(arTh);
  const AR = { x: arC.x + Math.cos(arTh) * 95, z: arC.z + Math.sin(arTh) * 95 };
  const arch = mesh(new THREE.TorusGeometry(40, 13, 6, 14, Math.PI), '#b9a58c');
  arch.rotation.y = arTh; place(arch, AR.x, AR.z, -4, 0);

  /* ================= RED BRIDGE to Gull Harbor ================= */
  const brTh = Math.atan2(ISLET.z, ISLET.x), A0 = findCoast(brTh, 250);
  const A = V(A0.x, 0, A0.z), B = V(ISLET.x - Math.cos(brTh) * 45, 0, ISLET.z - Math.sin(brTh) * 45);
  const deckY = 24, L = A.distanceTo(B), mid = A.clone().add(B).multiplyScalar(0.5);
  const bridge = new THREE.Group();
  const deckM = box(14, 2, L + 20, '#e2332e'); deckM.position.y = deckY; bridge.add(deckM);
  const road = box(10, 0.4, L + 20, '#555b66'); road.position.y = deckY + 1.2; bridge.add(road);
  const towers = [-L * 0.25, L * 0.25];
  for (const tz of towers) for (const s of [-1, 1]) {
    const leg = box(2.6, 70, 2.6, '#e2332e'); leg.position.set(s * 7.5, 35, tz); bridge.add(leg);
    const cb = box(17, 2.4, 2.6, '#e2332e'); cb.position.set(0, 66, tz); bridge.add(cb);
    const cb2 = box(17, 2, 2.6, '#e2332e'); cb2.position.set(0, 44, tz); bridge.add(cb2);
  }
  const cableMat = M('#c8241f');
  for (const s of [-1, 1]) {
    const pts = [V(s * 7.5, deckY + 2, -L / 2 - 8), V(s * 7.5, 68, towers[0]), V(s * 7.5, deckY + 14, 0), V(s * 7.5, 68, towers[1]), V(s * 7.5, deckY + 2, L / 2 + 8)];
    bridge.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.6, 5), cableMat));
    for (let k = -8; k <= 8; k++) { const zz = k * L / 18, hy = deckY + 14 + Math.abs(zz) / (L / 2) * 30; const sp = box(0.3, hy - deckY, 0.3, cableMat); sp.position.set(s * 7.5, (hy + deckY) / 2, zz); bridge.add(sp); }
  }
  bridge.rotation.y = Math.atan2(B.x - A.x, B.z - A.z);
  place(bridge, mid.x, mid.z, 0, 0);

  // harbor islet buildings + boats moored
  for (let k = 0; k < 5; k++) {
    const a = k * 1.25, r = 18 + (k % 2) * 14;
    house(ISLET.x + Math.cos(a) * r, ISLET.z + Math.sin(a) * r, 10 + rand() * 6, 9, 8 + rand() * 6, pick(walls), pick(roofs), a);
  }

  /* ================= GOLF ISLE ================= */
  for (let k = 0; k < 4; k++) {
    const a = k * 1.6 + 0.4, r = 55 + k * 20, gx = GOLF.x + Math.cos(a) * r, gz = GOLF.z + Math.sin(a) * r;
    const green = cyl(13, 13, 0.5, 18, '#b5f27f'); place(green, gx, gz, 0.2);
    const pole = box(0.4, 10, 0.4, '#eee'); place(pole, gx, gz, 5);
    const fl = box(0.2, 2.6, 4, '#ff4f4f'); place(fl, gx, gz + 2, 8.5);
    const bunker = cyl(7, 7, 0.4, 12, '#f6e4ac'); place(bunker, gx + 18, gz - 6, 0.25);
  }
  house(GOLF.x - 30, GOLF.z - 20, 26, 16, 12, '#fffaf0', '#3bb37a', 0.4);

  /* ================= HERMIT ISLE ================= */
  const hut = house(HERMIT.x, HERMIT.z, 9, 8, 6, '#c58a4e', '#e8c26a');
  const villa = new THREE.Group();
  const vb = box(30, 12, 20, WHITE); vb.position.y = 6; villa.add(vb);
  const vr = box(34, 2, 24, '#2f8fd8'); vr.position.y = 13; villa.add(vr);
  const vp = box(14, 1, 10, '#4fd6f2'); vp.position.set(0, 0.6, 18); villa.add(vp);
  villa.visible = false; place(villa, HERMIT.x + 22, HERMIT.z + 10);

  /* ================= TREES + ROCKS (instanced) ================= */
  const palmT = [], pineT = [], rockT = [];
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), yAxis = V(0, 1, 0);
  const bridgeLine = (x, z) => { const ab = B.clone().sub(A), ap = V(x - A.x, 0, z - A.z), t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1); return Math.hypot(x - (A.x + ab.x * t), z - (A.z + ab.z * t)); };
  const blocked = (x, z) =>
    Math.hypot(x - TOWN.x, z - TOWN.z) < 150 && rand() < 0.9 ||
    Math.hypot(x - RU.x, z - RU.z) < 50 || Math.hypot(x - CA.x, z - CA.z) < 38 ||
    Math.hypot(x - LH.x, z - LH.z) < 25 || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 8 ||
    Math.hypot(x - parkPos.x, z - parkPos.z) < 30 || bridgeLine(x, z) < 14;
  for (let k = 0; k < 9000 && (palmT.length < 520 || pineT.length < 1100); k++) {
    const x = (rand() * 2 - 1) * 1150, z = (rand() * 2 - 1) * 1150, h = H(x, z);
    if (h < 2.5 || blocked(x, z)) continue;
    const sl = (Math.abs(H(x + 3, z) - H(x - 3, z)) + Math.abs(H(x, z + 3) - H(x, z - 3))) / 6;
    q.setFromAxisAngle(yAxis, rand() * 6.28);
    if (h < 32 && sl < 0.6 && palmT.length < 520) { const s = 0.8 + rand() * 0.6; palmT.push(new THREE.Matrix4().compose(ps.set(x, h, z), q, sc.set(s, s, s))); }
    else if (h >= 32 && h < 165 && sl < 0.9 && pineT.length < 1100) { const s = 0.7 + rand() * 0.7; pineT.push(new THREE.Matrix4().compose(ps.set(x, h, z), q, sc.set(s, s * (0.9 + rand() * 0.4), s))); }
    else if (sl > 0.5 && rockT.length < 220) { const s = 2 + rand() * 6; rockT.push(new THREE.Matrix4().compose(ps.set(x, h, z), q, sc.set(s, s * 0.7, s))); }
  }
  function instanced(geo, color, mats) {
    const im = new THREE.InstancedMesh(geo, M(color), mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true; root.add(im); return im;
  }
  const palmTrunk = new THREE.CylinderGeometry(0.7, 1.2, 15, 5); palmTrunk.translate(0, 7.5, 0); palmTrunk.rotateZ(0.08);
  const palmLeaf = new THREE.ConeGeometry(9, 3.5, 7); palmLeaf.translate(1.2, 15.5, 0);
  const pineTrunk = new THREE.CylinderGeometry(0.8, 1.2, 6, 5); pineTrunk.translate(0, 3, 0);
  const pineTop = new THREE.ConeGeometry(6.5, 20, 7); pineTop.translate(0, 15, 0);
  instanced(palmTrunk, '#b07a4a', palmT); instanced(palmLeaf, '#36a852', palmT);
  instanced(pineTrunk, '#8a5a3a', pineT); instanced(pineTop, '#2f8a48', pineT);
  instanced(new THREE.DodecahedronGeometry(1, 0), '#a59482', rockT);

  /* ================= WINDOWS ================= */
  const windowMat = new THREE.MeshBasicMaterial({ color: '#6f8aa8' });
  const wIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 2.8), windowMat, windows.length);
  windows.forEach((m, i) => wIM.setMatrixAt(i, m));
  wIM.instanceMatrix.needsUpdate = true;
  windowMat.side = THREE.DoubleSide;   // back-side windows face inward, so render both faces
  root.add(wIM);

  /* ================= MOVING LANDMARKS ================= */
  // Sky Whale blimp
  const blimp = new THREE.Group();
  const env = mesh(new THREE.SphereGeometry(10, 16, 10), '#7fd0ff'); env.scale.set(1, 1, 2.8); blimp.add(env);
  const belly = mesh(new THREE.SphereGeometry(10.2, 16, 10, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.4), '#ffffff'); belly.scale.set(1, 1, 2.8); blimp.add(belly);
  const gond = box(5, 3, 10, '#ffd23a'); gond.position.y = -11; blimp.add(gond);
  for (const [r, s] of [[0, 1], [Math.PI / 2, 1]]) { const fin = box(0.6, 10, 7, '#ff6b4a'); fin.rotation.z = r; fin.position.z = -25; blimp.add(fin); }
  for (let k = 0; k < 2; k++) { const eye = mesh(new THREE.SphereGeometry(1.4, 8, 6), '#173047'); eye.position.set(k ? 7 : -7, 3, 22); blimp.add(eye); }
  root.add(blimp);
  updaters.push(t => { const a = t * 0.035; blimp.position.set(Math.cos(a) * 560, 250 + Math.sin(t * 0.3) * 6, Math.sin(a) * 560); blimp.rotation.y = -a; });

  // Captain Pip's guide plane
  const pip = buildPlane('#e2463f', '#ffffff'); pip.scale.setScalar(0.9); root.add(pip);
  const pipProp = pip.userData.prop;
  const pipPath = t => V(620 * Math.sin(t * 0.045), 170 + 50 * Math.sin(t * 0.07), 430 * Math.sin(t * 0.09));
  updaters.push((t, dt) => { const p = pipPath(t), n = pipPath(t + 0.3); pip.position.copy(p); pip.lookAt(n); pipProp.rotation.z += dt * 30; });

  // boats + ferry
  const boats = [];
  for (let k = 0; k < 5; k++) {
    const b = new THREE.Group();
    const hull = box(6, 2.6, 16, pick(['#ffffff', '#ffd23a', '#ff6b4a'])); hull.position.y = 1; b.add(hull);
    const cab = box(4.6, 3, 5, '#2f8fd8'); cab.position.set(0, 3.6, -2); b.add(cab);
    root.add(b); boats.push({ b, r: 640 + k * 45, s: 0.03 + k * 0.006, o: k * 1.3 });
  }
  const ship = new THREE.Group();
  const sh = box(26, 10, 90, '#ffffff'); sh.position.y = 4; ship.add(sh);
  const sd = box(22, 8, 60, '#ffd9e0'); sd.position.y = 13; ship.add(sd);
  const stack = cyl(4, 4, 12, 10, '#ff6b4a'); stack.position.set(0, 23, -10); ship.add(stack);
  root.add(ship);
  updaters.push(t => {
    boats.forEach(({ b, r, s, o }) => { const a = t * s + o; b.position.set(Math.cos(a) * r, 0.2 + Math.sin(t * 2 + o) * 0.3, Math.sin(a) * r); b.rotation.y = -a; });
    const a = -t * 0.012 + 1; ship.position.set(Math.cos(a) * 980, 0.5, Math.sin(a) * 980); ship.rotation.y = -a + Math.PI;
  });
  const ferry = new THREE.Group();
  const fh = box(10, 3, 22, '#3bb37a'); fh.position.y = 1.2; ferry.add(fh);
  const fc = box(8, 4, 10, '#fffaf0'); fc.position.y = 4.5; ferry.add(fc);
  root.add(ferry);
  updaters.push(t => {
    const k = (Math.sin(t * 0.05) + 1) / 2, x = ISLET.x + (GOLF.x - 120 - ISLET.x) * k, z = ISLET.z + 60 + (GOLF.z - ISLET.z - 60) * k;
    ferry.position.set(x, 0.3, z); ferry.rotation.y = Math.atan2(GOLF.x - ISLET.x, GOLF.z - ISLET.z) + (Math.cos(t * 0.05) < 0 ? Math.PI : 0);
  });

  /* ================= DISCOVERY POINTS ================= */
  const P = (name, x, y, z, day, eve, night) => ({ name, pos: V(x, y, z), text: { day, evening: eve, night } });
  const gy = (x, z, o) => Math.max(0, H(x, z)) + o;
  const points = [
    P('Breezy Town Square', V_SQUARE.x, gy(V_SQUARE.x, V_SQUARE.z, 26), V_SQUARE.z, 'The fountain has been splashing since the island opened. Toss a coin, make a wish.', 'Street musicians set up around the fountain when the sun goes down.', 'Someone wished for a pizza here once. The pizza never came.'),
    P('Grand Coral Hotel', V_HOTEL.x, gy(V_HOTEL.x, V_HOTEL.z, 98), V_HOTEL.z, 'Twelve floors of sea views. The elevator plays the menu music on repeat.', 'Guests watch the sunset from the rooftop sign.', 'Every window glows at night. Except room 404. Nobody knows why.'),
    P('Pin Palace Lanes', V_BOWL.x, gy(V_BOWL.x, V_BOWL.z, 52), V_BOWL.z, 'You can spot the giant pin from anywhere in town. Strikes inside, guaranteed fun.', 'League night! The lanes get loud after dinner.', 'The giant pin has never been knocked over. Planes, please do not try.'),
    P('Clash Ring', V_ARENA.x, gy(V_ARENA.x, V_ARENA.z, 32), V_ARENA.z, 'Swordplay duels happen here every day. Losers fall into the sand.', 'The flags flap hardest in the evening breeze.', 'At night the ring is quiet, but you can still hear the echo of a clang.'),
    P('Hoop Court', V_COURT.x, gy(V_COURT.x, V_COURT.z, 26), V_COURT.z, 'Pickup games start the moment three people show up.', 'Shadows get long, and so do the three-pointers.', 'Night is 3-Point Contest time. The crowd counts every shot.'),
    P('Poolside Paddle Deck', V_POOL.x, gy(V_POOL.x, V_POOL.z, 22), V_POOL.z, 'Table tennis by the pool. Stray balls end up floating.', 'The best rallies happen right before dinner.', 'The pool lights turn the table blue. Very dramatic.'),
    P('Sunflare Beach', bIn.x, gy(bIn.x, bIn.z, 22), bIn.z, 'The softest sand on the island. Bring flip-flops, it gets hot.', 'The sand turns gold right before sunset.', 'Some say the waves whisper the high scores.'),
    P('Dog Disc Field', parkPos.x, gy(parkPos.x, parkPos.z, 18), parkPos.z, 'The dogs here catch better than most people throw.', 'Training time. The dogs never seem to get tired.', 'The dogs are asleep. The discs are not. Keep an eye out.'),
    P('Beacon Point Lighthouse', LH.x, gy(LH.x, LH.z, 72), LH.z, 'The striped lighthouse keeps boats off the rocks.', 'The keeper climbs all 300 steps to switch on the lamp.', 'Follow the sweeping beam and you will always find home.'),
    P('Windspin Hill', 262, gy(262, 175, 48), 175, 'Four windmills power the whole town square.', 'The blades spin faster when the evening wind picks up.', 'You can hear the windmills creak in the dark.'),
    P('Mount Ember Summit', PEAK.x + 50, gy(PEAK.x + 50, PEAK.z, 40), PEAK.z, 'The highest point on Breezy Isle. You can see every venue from here.', 'The volcano glows a little brighter as the sky darkens.', 'From the summit, the town looks like a box of fireflies.'),
    P('Ember Crater', PEAK.x, lavaY + 26, PEAK.z, 'Hot! The lava bubbles all year, but it has not erupted in centuries.', 'The smoke turns pink in the sunset light.', 'The crater is the brightest thing on the island at night.'),
    P('Mirror Lake', LAKE.x, LAKE_LEVEL + 14, LAKE.z, 'So still you can see the clouds in it. The ducks are in charge here.', 'The lake turns orange like a glass of juice.', 'Is something big swimming down there? Probably just a duck.'),
    P('Tumble Falls', falls.position.x + down.x * 18, falls.position.y, falls.position.z + down.z * 18, 'The lake spills over the edge in a roaring curtain.', 'Rainbows appear in the mist on calm evenings.', 'The falls sound twice as loud when you cannot see them.'),
    P('Lakeside Keep', CA.x, gy(CA.x, CA.z, 56), CA.z, 'Nobody remembers who built this castle. The view is worth the climb.', 'The castle walls hold the warmth of the day.', 'The best seat on the island for fireworks.'),
    P('Sunken Steps Ruins', RU.x, gy(RU.x, RU.z, 42), RU.z, 'Old stone steps from people who lived here long ago.', 'The columns cast long stripes across the stones.', 'Locals say the ruins hum a tune at midnight.'),
    P('Coral Arch', AR.x, 22, AR.z, 'The sea carved a perfect ring. You know you want to fly through it.', 'The setting sun fits right inside the arch.', 'At night it looks like a giant rocky doughnut.'),
    P('Scarlet Span', mid.x, 11, mid.z, 'The big red bridge links town to Gull Harbor. Brave pilots fly underneath.', 'Cars glow red and gold crossing at sunset.', 'The cables light up like strings on a harp.'),
    P('Gull Harbor', ISLET.x, gy(ISLET.x, ISLET.z, 30), ISLET.z, 'Fishing boats, a ferry, and a lot of very loud gulls.', 'Boats come home with the day\'s catch.', 'The harbor never fully sleeps.'),
    P('Fairway Isle', GOLF.x, gy(GOLF.x, GOLF.z, 32), GOLF.z, 'Golf with ocean on every side. Bring spare balls.', 'The wind off the sea makes every putt a gamble.', 'Even the flags look tired at night.'),
    P('Hermit Isle', HERMIT.x, gy(HERMIT.x, HERMIT.z, 30), HERMIT.z, 'A tiny island with one tiny hut. Perfect for a quiet nap.', 'The quietest sunset on the map.', 'Find every point and something special gets built here.'),
    { name: 'Sky Whale', moving: () => blimp.position.clone().add(V(0, 24, 0)), pos: V(), text: { day: 'The island blimp. It smiles at everyone.', evening: 'The Sky Whale floats home slowly in the evening.', night: 'Its belly lights up like a giant moon.' } },
    { name: 'Captain Pip', moving: () => pip.position.clone().add(V(0, 9, 0)), pos: V(), text: { day: 'Captain Pip flies a tour every day. Catch him if you can!', evening: 'Pip waves from the cockpit. Wave back!', night: 'Even at night, Pip never stops flying his loop.' } },
    P('Pinewood Ridge', 230, gy(230, -170, 55), -170, 'The thickest forest on the island. Hikers get lost on purpose.', 'Birds sing their last songs of the day here.', 'Owls take over the ridge after dark.')
  ];

  return {
    points, windowMat, beamMat, lamp, villa, lavaY,
    update(t, dt) { updaters.forEach(f => f(t, dt)); points.forEach(p => p.moving && p.pos.copy(p.moving())); }
  };
}

/* ---------- shared plane model ---------- */
export function buildPlane(body = '#ffd23a', wing = '#ff6b4a') {
  const g = new THREE.Group();
  const fus = cyl(1.6, 1.1, 12, 8, body); fus.rotation.x = Math.PI / 2; g.add(fus);
  const nose = cone(1.6, 2.4, 8, body); nose.rotation.x = Math.PI / 2; nose.position.z = 7.2; g.add(nose);
  const wingM = box(18, 0.5, 3.4, wing); wingM.position.set(0, 0, 1.5); g.add(wingM);
  const wing2 = box(18, 0.5, 3.4, wing); wing2.position.set(0, 3, 1.5); g.add(wing2);
  for (const s of [-6.5, 6.5]) { const st = box(0.3, 3, 0.3, '#555'); st.position.set(s, 1.5, 1.5); g.add(st); }
  const tail = box(6, 0.4, 2, wing); tail.position.set(0, 0.4, -5.8); g.add(tail);
  const fin = box(0.4, 3, 2.2, wing); fin.position.set(0, 1.8, -5.8); g.add(fin);
  const pilot = mesh(new THREE.SphereGeometry(1, 8, 6), '#ffd9b8'); pilot.position.set(0, 1.6, -1); g.add(pilot);
  const prop = new THREE.Group(); prop.position.z = 8.5;
  const blade = box(0.5, 6, 0.3, '#333'); prop.add(blade);
  const blade2 = blade.clone(); blade2.rotation.z = Math.PI / 2; prop.add(blade2);
  g.add(prop); g.userData.prop = prop;
  return g;
}

function umbrella(color) {
  const g = new THREE.Group();
  const p = box(0.4, 8, 0.4, '#eee'); p.position.y = 4; g.add(p);
  const c = cone(6, 2.4, 8, color); c.position.y = 8.6; g.add(c);
  return g;
}

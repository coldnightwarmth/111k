// B-20's eggs: one big painted egg in most of the open crates round the converter room, each its own colours (a
// deep ground, spots, stars, dots). The eggs are items (src/egg-items.js: picked up, carried, put down): in its
// crate as it started an egg sits as posed here (stood up, lying down or leant against a wall); anywhere else it
// lies on its side. The straw in the crates is just scenery (createEggs).
import * as THREE from 'three';
import {roomFrame, DOOR_X} from './room-frame.js';
import {EGG_ROOM, EGG_CRATES, EGG_COUNT, eggHome} from './egg-items.js';
const FLOOR = .11;                                    // the crate's deck
const STRAW = FLOOR + .2;                             // the top of the straw
const INSIDE_X = .445, INSIDE_Z = .305;               // the crate's inside walls (end, side), from its middle
const EGG_H = .58, EGG_R = .21;
// how each sits: tilt (rad) toward the crate's end wall (z) or side wall (x), turned in the crate, spun on its own
// axis, and pushed up against a wall ('x' an end, 'z' a side) or not. Upright, lying along the crate, leaning
// into a corner of it.
const POSES = [
  {tz: .06, tx: -.08, yaw: 0, spin: 0},                          // stood up in the straw
  {tz: -Math.PI / 2 + .04, tx: 0, yaw: .14, spin: 1.1},          // lying down along the crate
  {tz: -.72, tx: .05, yaw: .06, spin: 2.3, lean: 'x'},           // leant over against the end wall
  {tz: Math.PI / 2 - .05, tx: 0, yaw: -.18, spin: 4.0, dz: -.04}, // lying down the other way
  {tz: .04, tx: .62, yaw: -.1, spin: .5, lean: 'z'},             // leant against the side
];

// ground, spots, stars, dots
const LOOKS = [
  ['#1b1f5c', ['#ff5fae', '#ff8fc8'], ['#ffd84a', '#ffffff'], '#7fd8ff'],
  ['#9ff0d0', ['#7a3cff', '#ff6a3c'], ['#ffffff', '#ffe066'], '#2b2b8f'],
  ['#ff7fb6', ['#2d6cff', '#ffe14a'], ['#ffffff', '#3a1b6b'], '#ffffff'],
  ['#ff9a2e', ['#15c4b8', '#5b2bd1'], ['#fff6d0', '#1b1f5c'], '#ff4a7d'],
  ['#c7a8ff', ['#ffffff', '#ff5fae'], ['#1b1f5c', '#ffd84a'], '#3dd68c'],
];

function star(g, x, y, r, rot) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + i * Math.PI / 5, rr = i % 2 ? r * .45 : r;
    g.lineTo(x + Math.sin(a) * rr, y - Math.cos(a) * rr);
  }
  g.closePath(); g.fill();
}
// the egg's skin as a wrap-around map: u round the egg, v up it (shapes stretched near the ends to stay round)
function eggTexture([ground, spots, stars, dots], seed) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, ground); grad.addColorStop(1, ground);
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);
  // a shape at (u, v) drawn three times across the seam, squeezed by latitude so it stays round on the egg
  const at = (u, v, draw) => {
    const lat = (v - .5) * Math.PI, k = 1 / Math.max(.25, Math.cos(lat));
    for (const du of [-1, 0, 1]) { g.save(); g.translate((u + du) * 1024, v * 512); g.scale(k * .5, 1); draw(); g.restore(); }
  };
  for (let i = 0; i < 26; i++) {                     // spots
    const u = rnd(), v = .12 + rnd() * .76, r = 18 + rnd() * 34;
    g.fillStyle = spots[i % spots.length];
    at(u, v, () => { g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); });
    if (rnd() < .4) { g.fillStyle = ground; at(u, v, () => { g.beginPath(); g.arc(0, 0, r * .45, 0, 7); g.fill(); }); }   // a ring
  }
  for (let i = 0; i < 18; i++) {                     // stars
    const u = rnd(), v = .1 + rnd() * .8, r = 16 + rnd() * 22, rot = rnd() * 6;
    g.fillStyle = stars[i % stars.length];
    at(u, v, () => star(g, 0, 0, r, rot));
  }
  g.fillStyle = dots;                                 // little dots in between
  for (let i = 0; i < 140; i++) { const u = rnd(), v = .08 + rnd() * .84, r = 3 + rnd() * 5; at(u, v, () => { g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); }); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = THREE.RepeatWrapping;
  return t;
}
function strawTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#a8843c'; g.fillRect(0, 0, 256, 256);
  let s = 77; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * 256, y = rnd() * 256, a = rnd() * Math.PI, l = 8 + rnd() * 26;
    g.strokeStyle = `hsl(${40 + rnd() * 12}, ${50 + rnd() * 30}%, ${45 + rnd() * 30}%)`; g.lineWidth = 1 + rnd() * 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// an egg: a lathe, wider low down, with u round it and v up it
function eggGeometry() {
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32, a = t * Math.PI;                  // from the bottom (0) to the top (pi)
    const y = (1 - Math.cos(a)) / 2 * EGG_H;
    const r = Math.sin(a) * EGG_R * (1.08 - .3 * (y / EGG_H));
    pts.push(new THREE.Vector2(Math.max(r, 1e-4), y));
  }
  return new THREE.LatheGeometry(pts, 40);
}

let geo = null, strawMat = null;
const box = new THREE.Box3();
// how a posed egg sits: its transform in its crate's frame (x along it, z across, y up from the floor)
function placed(egg, pose) {
  egg.quaternion.setFromEuler(new THREE.Euler(0, pose.yaw, 0))
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.tx, 0, pose.tz)))
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pose.spin, 0)));
  // where it sits, from its shape as posed: its lowest point a little down into the straw (or on the ground),
  // centred (lying) or against the wall it's leaning on
  egg.position.set(0, 0, 0); egg.updateMatrix();
  box.copy(geo.boundingBox).applyMatrix4(egg.matrix);
  const mid = box.getCenter(new THREE.Vector3());
  if (pose.loose) { egg.position.set(-mid.x, -box.min.y, -mid.z); return; }
  const sink = Math.abs(pose.tz) > 1 ? .05 : .07;
  egg.position.set(
    pose.lean === 'x' ? INSIDE_X - box.max.x : -mid.x,
    STRAW - sink - box.min.y,
    pose.lean === 'z' ? INSIDE_Z - box.max.z : -mid.z + (pose.dz || 0));
}
const LOOSE = {tz: Math.PI / 2, tx: 0, yaw: 0, spin: 0, loose: true};   // on its side, on whatever it's put down on
// an egg item ('egg-1'..): its origin is on the floor at the middle of its crate, turned as the crate is
export function eggModel(id) {
  if (!geo) { geo = eggGeometry(); geo.computeBoundingBox(); }
  const i = Math.max(0, (parseInt(id.slice(4), 10) || 1) - 1);
  const map = eggTexture(LOOKS[i % LOOKS.length], 911 + i * 77);
  const mat = new THREE.MeshStandardMaterial({map, roughness: .32, metalness: 0, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: .14});
  const g = new THREE.Group(), egg = new THREE.Mesh(geo, mat), home = eggHome(id), pose = POSES[i % POSES.length];
  g.add(egg);
  let shown = null;
  // sat in its crate as it started, or loose
  const sit = s => {
    const atHome = !!home && !s.holder && Math.hypot(s.x - home.x, s.z - home.z) < .02 && Math.abs(s.y - home.y) < .02;
    if (atHome === shown) return false;
    shown = atHome; placed(egg, atHome ? pose : LOOSE);
    return true;                                       // (moved: its outline's to go with it)
  };
  sit({x: 1e9, y: 0, z: 0});
  g.userData = {tip: new THREE.Vector3(0, .3, 0), ground: 0, standing: true, piece: true, egg: sit, eggMesh: egg, handScale: .5};
  return g;
}

// the straw in the egg crates
export function createEggs(scene) {
  const f = roomFrame(EGG_ROOM, DOOR_X[EGG_ROOM]), root = new THREE.Group(); root.name = 'egg-straw';
  const strawGeo = new THREE.BoxGeometry(.9, .2, .56);
  strawMat ||= new THREE.MeshStandardMaterial({map: strawTexture(), roughness: 1, color: 0xd8b768});
  EGG_CRATES.slice(0, EGG_COUNT).forEach(([x, z, turn]) => {
    const p = f.toWorld(x, z), bed = new THREE.Mesh(strawGeo, strawMat);
    bed.position.set(p.x, FLOOR + .1, p.z); bed.rotation.y = f.yaw + turn; root.add(bed);
  });
  root.traverse(o => { if (o.isMesh) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
  scene.add(root);
  return root;
}

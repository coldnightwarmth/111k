// B-20's eggs: one big painted egg sitting in most of the open crates round the converter room (the crates are
// tools/crates.py's EGG_CRATES: keep these in step). Each its own colours: a deep ground, spots, stars, dots.
import * as THREE from 'three';
import {roomFrame, DOOR_X} from './room-frame.js';

const ROOM = 19;
// [x, z, turn] as in tools/crates.py, and which of them have an egg (the last stands empty)
const CRATES = [[2.6, 2.25, .25], [2.85, .6, Math.PI / 2 + .1], [-2.85, .55, Math.PI / 2 - .08], [-2.65, -1.05, 1.9],
  [1.75, .95, -.35], [-1.0, -1.75, .5]];
const FILLED = [0, 1, 2, 3, 4];
const FLOOR = .11;                                    // the crate's deck
const EGG_H = .64, EGG_R = .21;

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

export function createEggs(scene) {
  const f = roomFrame(ROOM, DOOR_X[ROOM]), geo = eggGeometry(), root = new THREE.Group(); root.name = 'eggs';
  const strawGeo = new THREE.BoxGeometry(.9, .09, .56), strawMat = new THREE.MeshStandardMaterial({map: strawTexture(), roughness: 1, color: 0xd8b768});
  FILLED.forEach((k, i) => {
    const [x, z, turn] = CRATES[k], p = f.toWorld(x, z);
    const map = eggTexture(LOOKS[i % LOOKS.length], 911 + i * 77);
    const mat = new THREE.MeshStandardMaterial({map, roughness: .32, metalness: 0, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: .14});
    const egg = new THREE.Mesh(geo, mat);
    // sat in the straw a little off upright, turned any which way
    egg.position.set(p.x, FLOOR - .02, p.z);
    egg.rotation.set((i % 2 ? 1 : -1) * (.08 + .04 * i), f.yaw + turn + i * 1.7, (i % 3 - 1) * .07, 'YXZ');
    root.add(egg);
    // a bed of straw filling the crate's floor
    const bed = new THREE.Mesh(strawGeo, strawMat);
    bed.position.set(p.x, FLOOR + .045, p.z); bed.rotation.y = f.yaw + turn; root.add(bed);
  });
  root.traverse(o => { if (o.isMesh) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
  scene.add(root);
  return root;
}

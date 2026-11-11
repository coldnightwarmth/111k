// The supply room: B-02, the empty room next to the start room, fitted out at runtime with
// steel shelving stocked with spray cans, markers, paintball guns, flashlights and cleaning buckets.
// Shared by the server (where the stock starts) and the client (which builds the shelves).
// (SHELF_ITEMS also carries what's scattered about the tunnel and rooms: src/scatter.js.)
import {SCATTERED} from './scatter.js';
import {PIECE_ITEMS} from './pieces.js';
import {EGG_ITEMS} from './egg-items.js';
const RL = 38, XF = Math.sqrt(3.3 ** 2 - 2 ** 2), VD = XF + 1.15, ROOM_C = VD + 3.2;
const ROOM = 1, DOOR_X = 1.6;                 // the level builder's room 1 and its door offset
const A = 2 * Math.PI * ROOM / 20;
const C = Math.cos(A), S = Math.sin(A);
// the room's frame, as the level builder lays rooms out: x across, z from the door wall (-3) to the back (3)
export const ROOM_YAW = Math.atan2(C, -S);
const cy = Math.cos(ROOM_YAW), sy = Math.sin(ROOM_YAW);
const OX = (RL + ROOM_C) * C + DOOR_X * S, OZ = -(RL + ROOM_C) * S + DOOR_X * C;
export const roomToWorld = (x, z) => ({x: OX + cy * x + sy * z, z: OZ - sy * x + cy * z});

// shelving units: centre (room coords), turned along the back wall (0) or a side wall (pi/2)
export const SHELF_LEVELS = [.12, .55, 1.0, 1.45, 1.9];      // board heights
export const SHELF_W = 1.8, SHELF_D = .5, SHELF_H = 2.0;
export const UNITS = [
  {x: -1.5, z: 3 - SHELF_D / 2 - .03, turn: 0},
  {x: .55, z: 3 - SHELF_D / 2 - .03, turn: 0},
  {x: -3.5 + SHELF_D / 2 + .03, z: .2, turn: Math.PI / 2},
  {x: 3.5 - SHELF_D / 2 - .03, z: .3, turn: -Math.PI / 2},      // the right-hand wall
  {x: -3.5 + SHELF_D / 2 + .03, z: -1.95, turn: Math.PI / 2},   // the left wall, by the front
];
// a unit's local (along, across) to room coords
const onUnit = (u, along, across = 0) => ({
  x: u.x + Math.cos(u.turn) * along + Math.sin(u.turn) * across,
  z: u.z - Math.sin(u.turn) * along + Math.cos(u.turn) * across,
});
export const SHELF_COLLIDERS = UNITS.map(u => {
  const c = roomToWorld(u.x, u.z);
  return {x: c.x, z: c.z, hx: SHELF_W / 2, hz: SHELF_D / 2, yaw: ROOM_YAW - u.turn, y0: 0, y1: SHELF_H};
});

// the stock: [unit, shelf, along, type]; items lie along the shelf
const STOCK = [
  [0, 1, -.6, 'spray'], [0, 1, -.3, 'spray'], [0, 1, .05, 'spray'], [0, 1, .4, 'spray'],
  [0, 2, -.4, 'paintball'], [0, 2, .4, 'paintball'],
  [0, 3, -.45, 'flashlight'], [0, 3, .1, 'flashlight'],
  [1, 1, -.4, 'paintball'], [1, 1, .4, 'paintball'],
  [1, 2, -.6, 'spray'], [1, 2, -.25, 'spray'], [1, 2, .1, 'spray'], [1, 2, .45, 'spray'],
  [1, 3, -.3, 'flashlight'], [1, 3, .35, 'flashlight'],
  [2, 0, -.55, 'bucket'], [2, 0, 0, 'bucket'], [2, 0, .55, 'bucket'],
  [2, 1, -.4, 'spray'], [2, 1, .3, 'spray'],
  [2, 2, 0, 'flashlight'],
  // markers alongside the cans
  [0, 1, .72, 'marker'], [1, 2, .76, 'marker'], [2, 1, .65, 'marker'],
  // the right-hand wall: mostly paintball guns and markers
  [3, 1, -.5, 'paintball'], [3, 1, .1, 'paintball'], [3, 1, .62, 'paintball'],
  [3, 2, -.6, 'marker'], [3, 2, -.3, 'marker'], [3, 2, 0, 'marker'], [3, 2, .3, 'marker'], [3, 2, .6, 'marker'],
  [3, 3, -.45, 'paintball'], [3, 3, .45, 'paintball'],
  [3, 0, -.5, 'spray'], [3, 0, -.15, 'spray'], [3, 0, .2, 'spray'], [3, 0, .55, 'spray'],
  // the left wall by the front
  [4, 1, -.45, 'paintball'], [4, 1, .45, 'paintball'],
  [4, 2, -.5, 'spray'], [4, 2, -.15, 'spray'], [4, 2, .2, 'spray'], [4, 2, .55, 'spray'],
  [4, 3, -.4, 'marker'], [4, 3, 0, 'marker'], [4, 3, .4, 'marker'],
  [4, 0, 0, 'flashlight'],
  // more buckets: the bottom shelves of the two units on the back wall (last, so nothing above changes its id)
  [0, 0, -.45, 'bucket'], [0, 0, .45, 'bucket'], [1, 0, -.45, 'bucket'], [1, 0, .45, 'bucket'],
];
const PREFIX = {flashlight: 'fls', paintball: 'pbs', spray: 'sps', bucket: 'bks', marker: 'mks'};
export const SHELF_ITEMS = (() => {
  const count = {};
  return STOCK.map(([k, level, along, type], i) => {
    const u = UNITS[k], p = onUnit(u, along, type === 'bucket' ? .02 : (i % 3 - 1) * .05), w = roomToWorld(p.x, p.z);
    count[type] = (count[type] || 0) + 1;
    // lying along the shelf (head toward its along axis), with a little jitter
    const dirYaw = ROOM_YAW - u.turn, jitter = ((i * 37) % 9 - 4) * .04;
    const yaw = type === 'bucket' ? dirYaw + i : Math.atan2(-Math.cos(dirYaw), Math.sin(dirYaw)) + (i % 2 ? Math.PI : 0) + jitter;
    return {id: `${PREFIX[type]}${count[type]}`, type, x: Math.round(w.x * 1000) / 1000, y: SHELF_LEVELS[level] + .02,
      z: Math.round(w.z * 1000) / 1000, yaw: Math.round(yaw * 1000) / 1000};
  }).concat(SCATTERED, PIECE_ITEMS, EGG_ITEMS);
})();
// where the work lantern sits (top of the first unit)
export const LANTERN = (() => { const p = onUnit(UNITS[0], .55, 0); return {...roomToWorld(p.x, p.z), y: SHELF_LEVELS[4] + .02}; })();

// ------------------------------------------------------------------ building
// (client only: three is passed in so the server never loads it)
// merge (optional): BufferGeometryUtils.mergeGeometries. Each unit's boxes are built one by one and then
// merged into one mesh per material: the same triangles in the same places, a few draws instead of hundreds.
export function createShelves(THREE, scene, merge = null) {
  const group = new THREE.Group(); group.name = 'supply-shelves';
  scene.add(group);
  const steel = new THREE.MeshStandardMaterial({color: 0x5c6670, roughness: .55, metalness: .7});
  const paint = new THREE.MeshStandardMaterial({color: 0x34506a, roughness: .7, metalness: .45, emissive: 0x0c1218});   // blue-grey enamel posts
  const board = new THREE.MeshStandardMaterial({color: 0x8a8f8a, roughness: .5, metalness: .65, emissive: 0x111311});
  const box = (parent, w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; };
  for (const u of UNITS) {
    const unit = new THREE.Group();
    const c = roomToWorld(u.x, u.z);
    unit.position.set(c.x, 0, c.z); unit.rotation.y = ROOM_YAW - u.turn;
    group.add(unit);
    // slotted angle posts with holes, boards with a folded lip, cross bracing at the back
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(unit, .04, SHELF_H, .04, paint, sx * (SHELF_W / 2 - .02), SHELF_H / 2, sz * (SHELF_D / 2 - .02));
      for (let y = .1; y < SHELF_H - .05; y += .12) box(unit, .012, .03, .002, steel, sx * (SHELF_W / 2 - .02), y, sz * (SHELF_D / 2 + .001));
    }
    for (const y of SHELF_LEVELS) {
      box(unit, SHELF_W - .02, .02, SHELF_D - .02, board, 0, y, 0);
      box(unit, SHELF_W - .02, .045, .015, board, 0, y - .012, SHELF_D / 2 - .012);
      box(unit, SHELF_W - .02, .045, .015, board, 0, y - .012, -SHELF_D / 2 + .012);
    }
    const brace = Math.atan2(SHELF_LEVELS[4] - SHELF_LEVELS[1], SHELF_W - .1);
    for (const s of [-1, 1]) {
      const b = box(unit, Math.hypot(SHELF_W - .1, SHELF_LEVELS[4] - SHELF_LEVELS[1]), .02, .006, steel, 0, (SHELF_LEVELS[1] + SHELF_LEVELS[4]) / 2, -SHELF_D / 2 + .01);
      b.rotation.z = s * brace;
    }
    if (merge) {
      const byMat = new Map();
      for (const m of unit.children) {
        m.updateMatrix();
        const g = m.geometry.clone().applyMatrix4(m.matrix);
        (byMat.get(m.material) || byMat.set(m.material, []).get(m.material)).push(g);
        m.geometry.dispose();
      }
      unit.clear();
      for (const [mat, geos] of byMat) { unit.add(new THREE.Mesh(merge(geos), mat)); for (const g of geos) g.dispose(); }
    }
  }
  // a caged work lantern on top, lighting the stock
  const lantern = new THREE.Group(); lantern.position.set(LANTERN.x, LANTERN.y, LANTERN.z); group.add(lantern);
  const glow = new THREE.MeshBasicMaterial({color: 0xffe0a0, toneMapped: false});
  const black = new THREE.MeshStandardMaterial({color: 0x161616, roughness: .6, metalness: .4});
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.07, .08, .05, 20), black); base.position.y = .025; lantern.add(base);
  const bulb = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .14, 16), glow); bulb.position.y = .12; lantern.add(bulb);
  for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(.006, .16, .006), black); const a = i / 6 * Math.PI * 2; r.position.set(Math.cos(a) * .06, .13, Math.sin(a) * .06); lantern.add(r); }
  const top = new THREE.Mesh(new THREE.CylinderGeometry(.05, .07, .03, 20), black); top.position.y = .215; lantern.add(top);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(.05, .006, 6, 16, Math.PI), black); handle.position.y = .23; lantern.add(handle);
  const light = new THREE.PointLight(0xffd29a, 10, 8.5, 1.5); light.position.y = .14; lantern.add(light);
  return group;
}

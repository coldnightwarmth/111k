// B-20's eggs as items (pick one up, carry it, put it down; nothing more): where each starts, in its open crate
// (tools/crates.py's EGG_CRATES: keep these in step). An egg's spawn is the middle of its crate's floor, turned as
// the crate is; how it sits in there (stood up, lying, leant on a wall) is src/eggs.js's, and anywhere else it
// lies on its side. Shared by the server and the client: no three.js here.
import {roomFrame, DOOR_X} from './room-frame.js';

export const EGG_ROOM = 19;
// [x, z, turn] in the room's frame, as in tools/crates.py; the eggs are in the first five (the last stands empty)
export const EGG_CRATES = [[2.6, 2.25, .25], [2.85, .6, Math.PI / 2 + .1], [-2.85, .55, Math.PI / 2 - .08], [-2.65, -1.05, 1.9],
  [1.75, .95, -.35], [-1.0, -1.75, .5]];
export const EGG_COUNT = 5;

const F = roomFrame(EGG_ROOM, DOOR_X[EGG_ROOM]);
const r3 = v => Math.round(v * 1000) / 1000;
export const EGG_ITEMS = EGG_CRATES.slice(0, EGG_COUNT).map(([x, z, turn], i) => {
  const p = F.toWorld(x, z);
  return {id: `egg-${i + 1}`, type: 'piece', x: r3(p.x), y: 0, z: r3(p.z), yaw: r3(F.yaw + turn)};
});
// where an egg starts (to tell whether it's still sat in its crate as it was)
export const eggHome = id => EGG_ITEMS.find(e => e.id === id) || null;

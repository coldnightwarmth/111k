// The converter in B-20: where it stands and what's where on it, shared by the client (src/converter.js, which
// builds and works it) and the server (which checks what's in the chamber and does the converting). No three.js.
// All in B-20's own frame (src/room-frame.js): x across, z toward the back wall (3), y up.
import {roomFrame, DOOR_X} from './room-frame.js';
import {ART_MAX, artDims, PAINTING_LONG} from './collection.js';

export const ROOM = 19;
export const FRAME = roomFrame(ROOM, DOOR_X[ROOM]);
// the machine: against the back wall
export const MX = -.8, MW = 2.6, MD = .85, MH = 2.55, BACK = 3;
export const FRONT = BACK - MD;                      // its front face (z)
// the chamber: an opening on the left of the front, a painting stood in it
export const CH = {x0: MX - 1.15, x1: MX + .15, y0: .8, y1: 2.1, z0: FRONT, z1: BACK - .15};
export const CH_X = (CH.x0 + CH.x1) / 2;
// the control panel on the right: the display, the keypad and the big button
export const PANEL_X = MX + .75;
export const DISPLAY_Y = 1.86, KEYPAD_Y = 1.38, BUTTON_Y = .95;
export const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '<'];
export const KEY_PITCH = .1;
export const ENTRY_MAX = String(ART_MAX).length;      // digits
export const USE_RANGE = 3;                           // metres from the panel (on the floor) to work it
export const HATCH_MS = 750;                          // the hatch coming down (or going up)
export const BUSY_MS = 2600;                          // the painting can't be taken out for this long once it starts

// what you bump into
export const CONVERTER_COLLIDER = (() => { const c = FRAME.toWorld(MX, BACK - MD / 2); return {x: c.x, z: c.z, hx: MW / 2, hz: MD / 2, yaw: FRAME.yaw, y0: 0, y1: MH}; })();
// where the panel is in the world (on the floor in front of it)
export const PANEL = (() => { const p = FRAME.toWorld(PANEL_X, FRONT - .3); return {x: p.x, z: p.z}; })();
// is a point (world) inside the chamber (with a little slack)?
export function inChamber(x, y, z, slack = .08) {
  const p = FRAME.toRoom(x, z);
  return p.x > CH.x0 - slack && p.x < CH.x1 + slack && p.z > CH.z0 - .25 && p.z < CH.z1 + slack && y > CH.y0 - slack && y < CH.y1 + slack;
}
// how a painting of this art stands in the chamber: on its floor, its top leant back on the chamber's back wall
export const STAND_TILT = -.1;
export function standPose(art) {
  const {w, h} = artDims(art), k = PAINTING_LONG / Math.max(w, h), ht = h * k;
  const s = Math.abs(Math.sin(STAND_TILT)), c = Math.cos(STAND_TILT);
  const z = CH.z1 - .012 - ht / 2 * s, p = FRAME.toWorld(CH_X, z);
  return {x: p.x, y: CH.y0 + .004 + ht / 2 * c, z: p.z, yaw: FRAME.yaw + Math.PI, tilt: STAND_TILT, roll: 0};
}
// a keypad entry as typed so far, with one more key: digits up to ENTRY_MAX, C clears, < takes one back
export function keyEntry(entry, key) {
  if (key === 'C') return '';
  if (key === '<') return entry.slice(0, -1);
  if (!/^[0-9]$/.test(key) || entry.length >= ENTRY_MAX || (entry === '' && key === '0')) return entry;
  return entry + key;
}

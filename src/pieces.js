// The Super Metal Mons pieces in and around B-10 (the board sprayed on its floor: src/board.js): the mons
// (figures from tools/mons_pieces.py, assets/mons/pieces.glb), ten mana (five white, five black), the white
// supermana, two bombs and two potions. They're items like any other (picked up, carried, put down), and put
// down on the board they stand in the middle of the square they're over, squared up to it.
// Shared by the server (where they start) and the client (snapping, models). No three.js here.
import {roomFrame, DOOR_X} from './room-frame.js';

export const BOARD_ROOM = 9;
export const BOARD_SIZE = 2.9, BOARD_N = 11, BOARD_CELL = BOARD_SIZE / BOARD_N;
const F = roomFrame(BOARD_ROOM, DOOR_X[BOARD_ROOM]);
const H = BOARD_SIZE / 2;

// the mons, as tools/mons_pieces.py names them (ids are 'mon-' and the name)
export const MONS = ['777', 'armored-gummoskulji', 'degon', 'estalibur', 'gerp', 'gnamnut', 'green-seech', 'gummy-deino',
  'hatchat', 'king-snowbie', 'lord', 'mega-gwazi', 'melmut', 'meow', 'miyggis', 'omen-statue', 'omom', 'prophet', 'scordior',
  'shiwy', 'slxxxr', 'speklmic', 'tripgib', 'zach', 'zwubbi'];

// The board lies with its black side (row 0) to the right as you come in the door (the room's -x) and the white
// (row 10) to the left; columns run from the door end (0) to the back wall's (10). (src/board.js lays it so too.)
// square (row i, column j) to the world, and back
export function squareCentre(i, j) {
  const p = F.toWorld(-H + (i + .5) * BOARD_CELL, -H + (j + .5) * BOARD_CELL);
  return {x: p.x, z: p.z};
}
// the square a world point is over, or null off the board
export function squareAt(x, z) {
  const r = F.toRoom(x, z);
  if (Math.abs(r.x) > H || Math.abs(r.z) > H) return null;
  const i = Math.min(BOARD_N - 1, Math.floor((r.x + H) / BOARD_CELL)), j = Math.min(BOARD_N - 1, Math.floor((r.z + H) / BOARD_CELL));
  return {i, j};
}
// where a piece put down at (x, z) facing yaw goes: on the board, the middle of its square, turned to face along
// the board (the nearest quarter turn); off it, just where it was put
export function snapPiece(x, z, yaw) {
  const sq = squareAt(x, z);
  if (!sq) return null;
  const c = squareCentre(sq.i, sq.j), q = Math.PI / 2;
  return {x: c.x, z: c.z, yaw: F.yaw + Math.round((yaw - F.yaw) / q) * q, ...sq};
}
export const isPiece = id => typeof id === 'string' && /^(mon-|mana-|smana|bomb-|potion-|egg-)/.test(id);
export function pieceName(id) {
  if (id.startsWith('mon-')) return id.slice(4).replace(/-/g, ' ');
  if (id.startsWith('mana-w')) return 'white mana';
  if (id.startsWith('mana-b')) return 'black mana';
  if (id === 'smana') return 'supermana';
  if (id.startsWith('bomb-')) return 'bomb';
  if (id.startsWith('potion-')) return 'potion';
  if (id.startsWith('egg-')) return 'egg';
  return 'piece';
}

// where they start: the game's opening position on the board (black mons on the right-hand row, white on the left,
// the mana in its diamond, the supermana in the middle, a bomb and a potion on the two side squares of the
// middle row), the other bomb and potion beside the board, and the rest of the mons stood about the room and
// just outside its door
const BLACK_SIDE = ['lord', 'degon', 'king-snowbie', 'omen-statue', 'slxxxr'];
const WHITE_SIDE = ['hatchat', 'meow', 'gummy-deino', 'zwubbi', 'gnamnut'];
// the rest: [x, z] in the room's frame (x across, z from the door wall at -3 to the back at 3), facing the board,
// clear of the shelving (tools/rooms.py: along the left wall, and the back wall right of the middle)
const ABOUT = [[2.6, 2.4], [2.95, 1.3], [2.6, .1], [2.9, -1.1], [2.55, -2.4], [-1.7, 2.55], [-.6, 2.6], [-2.15, 1.2],
  [-2.15, -.4], [-2.1, -1.9], [-1.2, -2.55], [1.6, -2.5]];
// and out in the tunnel by the door: [x, z] in the room's frame too (past the door wall, z below about -4.3)
const OUTSIDE = [[-1.0, -4.95], [1.35, -5.05], [.2, -5.5]];
const MANA = [[3, 4], [3, 6], [4, 3], [4, 5], [4, 7], [7, 4], [7, 6], [6, 3], [6, 5], [6, 7]];

const r3 = v => Math.round(v * 1000) / 1000;
export const PIECE_ITEMS = (() => {
  const out = [], put = (id, x, z, yaw) => out.push({id, type: 'piece', x: r3(x), y: 0, z: r3(z), yaw: r3(yaw)});
  const onSquare = (id, i, j, turn) => { const c = squareCentre(i, j); put(id, c.x, c.z, F.yaw + turn); };
  // facing across the board at the other side (a quarter turn from facing the back wall: the room's +x, or -x)
  BLACK_SIDE.forEach((m, k) => onSquare(`mon-${m}`, 0, 3 + k, Math.PI / 2));
  WHITE_SIDE.forEach((m, k) => onSquare(`mon-${m}`, 10, 3 + k, -Math.PI / 2));
  MANA.forEach(([i, j], k) => onSquare(`mana-${i < 5 ? 'b' : 'w'}${k % 5 + 1}`, i, j, 0));
  onSquare('smana', 5, 5, 0);
  onSquare('bomb-1', 5, 0, 0); onSquare('potion-1', 5, 10, 0);
  { const a = F.toWorld(-.25, -H - .35), b = F.toWorld(.25, H + .35); put('bomb-2', a.x, a.z, F.yaw); put('potion-2', b.x, b.z, F.yaw); }
  const rest = MONS.filter(m => !BLACK_SIDE.includes(m) && !WHITE_SIDE.includes(m));
  [...ABOUT, ...OUTSIDE].forEach(([x, z], k) => {
    if (k >= rest.length) return;
    const p = F.toWorld(x, z), toward = F.toWorld(0, 0);
    // facing the board (a figure's front is its +z)
    put(`mon-${rest[k]}`, p.x, p.z, Math.atan2(toward.x - p.x, toward.z - p.z));
  });
  return out;
})();

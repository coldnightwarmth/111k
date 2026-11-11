// B-10's floor: a Super Metal Mons board, 11 by 11, spray-painted in the middle of the room.
// Drawn once into a canvas the way a can would put it down (soft edges, overspray, uneven coats, the odd
// speck), then laid on the floor like a sprayed tag: cut out of the level's floor and lit by its lightmap.
// Just the board's squares, no pieces on it: mana pools in the corners, the bomb-or-potion squares at the ends
// of the middle row, the mana squares in a diamond round the supermana's in the middle.
import * as THREE from 'three';
import {roomFrame, DOOR_X} from './room-frame.js';
import {cutDecal, createBatch, markMaterial} from './decals.js';

export const ROOM = 9;
const SIZE = 2.9;                  // metres across
const N = 11, CELL = 128, PAD = 40, PX = N * CELL + 2 * PAD;

const LIGHT = '#ece7dc', DARK = '#b8b3aa', POOL = '#2f6dff', MANA_SQ = '#9cbcff', CONSUMABLE = '#3b3a44', SUPER = '#1d2a78';

function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function drawBoard() {
  const c = document.createElement('canvas'); c.width = c.height = PX;
  const g = c.getContext('2d'), r = rng(1010);
  const at = (i, j) => [PAD + j * CELL, PAD + i * CELL];          // row i (0 at the top), column j
  // a sprayed patch: a slightly wobbly quad, soft at its edge, the coat uneven
  function patch(x, y, w, h, color, soft = 3) {
    const jit = () => (r() - .5) * 3;
    g.save();
    g.shadowColor = color; g.shadowBlur = soft;
    g.fillStyle = color;
    g.beginPath(); g.moveTo(x + jit(), y + jit()); g.lineTo(x + w + jit(), y + jit()); g.lineTo(x + w + jit(), y + h + jit()); g.lineTo(x + jit(), y + h + jit()); g.closePath();
    g.fill();
    g.restore();
    // uneven coat: lighter and darker mottling inside
    for (let k = 0; k < 26; k++) {
      g.fillStyle = r() < .5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)';
      g.beginPath(); g.ellipse(x + r() * w, y + r() * h, 6 + r() * 18, 4 + r() * 12, r() * 3, 0, 7); g.fill();
    }
  }
  // overspray all round the board first
  g.fillStyle = 'rgba(30,30,40,.12)';
  for (let k = 0; k < 2400; k++) {
    const side = Math.floor(r() * 4), t = r() * (PX - 2 * PAD) + PAD, d = PAD * (.2 + r() * .9);
    const [x, y] = side === 0 ? [t, PAD - d] : side === 1 ? [t, PX - PAD + d] : side === 2 ? [PAD - d, t] : [PX - PAD + d, t];
    g.beginPath(); g.arc(x, y, .6 + r() * 1.6, 0, 7); g.fill();
  }
  // the squares
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const [x, y] = at(i, j);
    let col = (i + j) % 2 ? DARK : LIGHT;
    if ((i === 0 || i === 10) && (j === 0 || j === 10)) col = POOL;
    else if (i === 5 && (j === 0 || j === 10)) col = CONSUMABLE;
    else if (i === 5 && j === 5) col = SUPER;
    else if (isMana(i, j)) col = MANA_SQ;
    patch(x, y, CELL, CELL, col);
  }
  // a bold sprayed border, and a thin line between the squares
  g.save(); g.strokeStyle = '#17171c'; g.lineWidth = 14; g.shadowColor = '#17171c'; g.shadowBlur = 6; g.lineJoin = 'round';
  g.strokeRect(PAD - 4, PAD - 4, N * CELL + 8, N * CELL + 8); g.restore();
  g.strokeStyle = 'rgba(40,40,48,.35)'; g.lineWidth = 2;
  for (let k = 1; k < N; k++) {
    g.beginPath(); g.moveTo(PAD + k * CELL + (r() - .5) * 2, PAD); g.lineTo(PAD + k * CELL + (r() - .5) * 2, PX - PAD); g.stroke();
    g.beginPath(); g.moveTo(PAD, PAD + k * CELL + (r() - .5) * 2); g.lineTo(PX - PAD, PAD + k * CELL + (r() - .5) * 2); g.stroke();
  }
  // worn where people walk: scuffs through to the floor, heavier toward the door (the bottom)
  g.save(); g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 420; k++) {
    const y = PAD + Math.pow(r(), .7) * N * CELL, x = PAD + r() * N * CELL;
    g.fillStyle = `rgba(0,0,0,${.08 + r() * .22})`;
    g.beginPath(); g.ellipse(x, y, 3 + r() * 16, 1 + r() * 4, r() * 3.14, 0, 7); g.fill();
  }
  for (let k = 0; k < 60; k++) {                       // long scrapes
    const x = PAD + r() * N * CELL, y = PAD + r() * N * CELL, a = r() * 6.28, l = 20 + r() * 90;
    g.strokeStyle = `rgba(0,0,0,${.1 + r() * .2})`; g.lineWidth = .8 + r() * 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  g.restore();
  // specks and a little dust over the lot
  for (let k = 0; k < 1500; k++) { g.fillStyle = `rgba(${r() < .5 ? '20,20,26' : '255,255,255'},${.05 + r() * .12})`; g.fillRect(PAD + r() * N * CELL, PAD + r() * N * CELL, 1 + r() * 2, 1 + r() * 2); }
  return c;
}
function manaSquares() { return [[3, 4], [3, 6], [4, 3], [4, 5], [4, 7], [7, 4], [7, 6], [6, 3], [6, 5], [6, 7]]; }
const isMana = (i, j) => manaSquares().some(([a, b]) => a === i && b === j);

export function createBoard(level, hits, scene) {
  const f = roomFrame(ROOM, DOOR_X[ROOM]), c = f.toWorld(0, 0), back = f.toWorld(-1, 0);
  const tex = new THREE.CanvasTexture(drawBoard());
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  // its top (the black side, row 0) to the right as you come in the door: the room's -x (src/pieces.js)
  const up = new THREE.Vector3(back.x - c.x, 0, back.z - c.z).normalize();
  const w = SIZE * PX / (N * CELL);                                                // (the canvas has a margin for the overspray)
  const verts = cutDecal(hits, {point: new THREE.Vector3(c.x, 0, c.z), normal: new THREE.Vector3(0, 1, 0), up, width: w, height: w,
    dir: new THREE.Vector3(0, -1, 0), front: .12, back: .05});
  const batch = createBatch(markMaterial(level, tex, 1), Math.max(64, verts.length));
  batch.mesh.renderOrder = 1.5;
  batch.add(verts);
  scene.add(batch.mesh);
  return batch.mesh;
}

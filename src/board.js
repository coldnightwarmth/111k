// B-10's floor: a Super Metal Mons board, 11 by 11, spray-painted in the middle of the room (half its width).
// Drawn once into a canvas the way a can would put it down (soft edges, overspray, uneven coats, the odd
// speck), then laid on the floor like a sprayed tag: cut out of the level's floor and lit by its lightmap.
// The layout is the game's own starting position: mana pools in the corners, the mons on their bases at the
// top and bottom, bomb-or-potion squares at the ends of the middle row, the mana in a diamond round the
// supermana in the middle.
import * as THREE from 'three';
import {roomFrame, DOOR_X} from './room-frame.js';
import {cutDecal, createBatch, markMaterial} from './decals.js';

export const ROOM = 9;
const SIZE = 3.5;                  // metres across
const N = 11, CELL = 128, PAD = 40, PX = N * CELL + 2 * PAD;

const LIGHT = '#ece7dc', DARK = '#b8b3aa', POOL = '#2f6dff', MANA_SQ = '#9cbcff', CONSUMABLE = '#3b3a44', SUPER = '#1d2a78';
const MONS = {black: ['mystic', 'spirit', 'drainer', 'angel', 'demon'], white: ['demon', 'angel', 'drainer', 'spirit', 'mystic']};

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
  // what stands on them at the start
  const centre = (i, j) => { const [x, y] = at(i, j); return [x + CELL / 2, y + CELL / 2]; };
  for (const [i, j] of manaSquares()) { const [x, y] = centre(i, j); drop(g, x, y, CELL * .32, i < 5 ? '#16161c' : '#f7f5ef', i < 5 ? '#f7f5ef' : '#16161c'); }
  { const [x, y] = centre(5, 5); drop(g, x, y, CELL * .4, '#b04dff', '#ffd84a', true); }
  for (const j of [0, 10]) { const [x, y] = centre(5, j); bombPotion(g, x, y, CELL * .36); }
  MONS.black.forEach((m, k) => { const [x, y] = centre(0, 3 + k); mon(g, m, x, y, CELL * .36, '#1a1a22', '#f4f1e8'); });
  MONS.white.forEach((m, k) => { const [x, y] = centre(10, 3 + k); mon(g, m, x, y, CELL * .36, '#f4f1e8', '#1a1a22'); });
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

// a mana drop (the supermana with a crown of points)
function drop(g, x, y, s, fill, line, crown = false) {
  g.save(); g.translate(x, y);
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 4;
  g.beginPath(); g.moveTo(0, -s * 1.15); g.bezierCurveTo(s * .95, -s * .1, s * .9, s * .95, 0, s * .95); g.bezierCurveTo(-s * .9, s * .95, -s * .95, -s * .1, 0, -s * 1.15);
  g.fillStyle = fill; g.fill(); g.shadowBlur = 0; g.lineWidth = s * .14; g.strokeStyle = line; g.stroke();
  g.beginPath(); g.ellipse(-s * .3, s * .15, s * .14, s * .26, .3, 0, 7); g.fillStyle = 'rgba(255,255,255,.55)'; g.fill();
  if (crown) {
    g.fillStyle = line;
    g.beginPath(); g.moveTo(-s * .55, -s * .95); g.lineTo(-s * .55, -s * 1.35); g.lineTo(-s * .25, -s * 1.12); g.lineTo(0, -s * 1.5); g.lineTo(s * .25, -s * 1.12); g.lineTo(s * .55, -s * 1.35); g.lineTo(s * .55, -s * .95); g.closePath(); g.fill();
  }
  g.restore();
}
// a bomb and a potion side by side (it's one or the other: whoever takes it chooses)
function bombPotion(g, x, y, s) {
  g.save(); g.translate(x, y);
  g.fillStyle = '#121216'; g.strokeStyle = '#f2efe6'; g.lineWidth = s * .1;
  g.beginPath(); g.arc(-s * .45, s * .15, s * .5, 0, 7); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(-s * .2, -s * .3); g.quadraticCurveTo(0, -s * .8, s * -.05, -s * .95); g.stroke();
  g.fillStyle = '#ffb02e'; g.beginPath(); g.arc(-s * .05, -s * 1, s * .14, 0, 7); g.fill();
  // the potion: a round flask with a neck and a cork
  g.fillStyle = '#ff4fa0'; g.beginPath(); g.arc(s * .55, s * .3, s * .42, 0, 7); g.fill(); g.stroke();
  g.fillStyle = '#ff4fa0'; g.fillRect(s * .43, -s * .45, s * .24, s * .45); g.strokeRect(s * .43, -s * .45, s * .24, s * .45);
  g.fillStyle = '#c8955a'; g.fillRect(s * .4, -s * .65, s * .3, s * .2);
  g.restore();
}
// the mons, as quick sprayed characters: a body, eyes, and what marks each out
function mon(g, kind, x, y, s, fill, line) {
  g.save(); g.translate(x, y);
  g.lineWidth = s * .12; g.strokeStyle = line; g.fillStyle = fill; g.lineJoin = 'round';
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 4;
  const body = () => { g.fill(); g.shadowBlur = 0; g.stroke(); };
  if (kind === 'spirit') {                           // a ghost: round top, wavy hem
    g.beginPath(); g.arc(0, -s * .1, s * .75, Math.PI, 0);
    for (let k = 0; k <= 4; k++) g.lineTo(s * .75 - k * s * .375, s * .8 + (k % 2 ? -s * .2 : 0));
    g.closePath(); body();
  } else if (kind === 'mystic') {                    // a hooded cone with a star
    g.beginPath(); g.moveTo(0, -s * 1.05); g.quadraticCurveTo(s * .95, s * .2, s * .8, s * .85); g.lineTo(-s * .8, s * .85); g.quadraticCurveTo(-s * .95, s * .2, 0, -s * 1.05); g.closePath(); body();
  } else { g.beginPath(); g.arc(0, s * .05, s * .8, 0, 7); body(); }
  g.fillStyle = line; g.strokeStyle = line;
  if (kind === 'demon') {                            // horns
    for (const k of [-1, 1]) { g.beginPath(); g.moveTo(k * s * .35, -s * .6); g.quadraticCurveTo(k * s * .75, -s * 1.0, k * s * .7, -s * 1.3); g.quadraticCurveTo(k * s * .5, -s * .95, k * s * .1, -s * .72); g.closePath(); g.fill(); }
  } else if (kind === 'angel') {                     // a halo and wings
    g.lineWidth = s * .12; g.beginPath(); g.ellipse(0, -s * 1.08, s * .45, s * .14, 0, 0, 7); g.stroke();
    for (const k of [-1, 1]) { g.beginPath(); g.moveTo(k * s * .7, -s * .1); g.quadraticCurveTo(k * s * 1.35, -s * .5, k * s * 1.2, s * .3); g.quadraticCurveTo(k * s * 1.0, s * .1, k * s * .75, s * .25); g.closePath(); g.fill(); }
  } else if (kind === 'drainer') {                   // fangs
    for (const k of [-1, 1]) { g.beginPath(); g.moveTo(k * s * .28, s * .3); g.lineTo(k * s * .12, s * .3); g.lineTo(k * s * .2, s * .62); g.closePath(); g.fill(); }
  } else if (kind === 'mystic') {
    g.save(); g.translate(0, -s * .45); g.beginPath();
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, rr = i % 2 ? s * .09 : s * .22; g.lineTo(Math.sin(a) * rr, -Math.cos(a) * rr); }
    g.closePath(); g.fill(); g.restore();
  }
  // eyes
  const ey = kind === 'mystic' ? s * .12 : -s * .05;
  for (const k of [-1, 1]) { g.beginPath(); g.ellipse(k * s * .28, ey, s * .12, s * .17, 0, 0, 7); g.fill(); }
  if (kind === 'demon') { g.lineWidth = s * .1; for (const k of [-1, 1]) { g.beginPath(); g.moveTo(k * s * .5, ey - s * .28); g.lineTo(k * s * .12, ey - s * .14); g.stroke(); } }
  g.restore();
}

export function createBoard(level, hits, scene) {
  const f = roomFrame(ROOM, DOOR_X[ROOM]), c = f.toWorld(0, 0), back = f.toWorld(0, 1);
  const tex = new THREE.CanvasTexture(drawBoard());
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const up = new THREE.Vector3(back.x - c.x, 0, back.z - c.z).normalize();       // its top (the black side) to the back wall
  const w = SIZE * PX / (N * CELL);                                                // (the canvas has a margin for the overspray)
  const verts = cutDecal(hits, {point: new THREE.Vector3(c.x, 0, c.z), normal: new THREE.Vector3(0, 1, 0), up, width: w, height: w,
    dir: new THREE.Vector3(0, -1, 0), front: .12, back: .05});
  const batch = createBatch(markMaterial(level, tex, 1), Math.max(64, verts.length));
  batch.mesh.renderOrder = 1.5;
  batch.add(verts);
  scene.add(batch.mesh);
  return batch.mesh;
}

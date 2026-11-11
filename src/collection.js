// The whole 111k collection, numbered 1 to 111,111, as it's kept on the CDN: the paintings first, then the 3D
// pieces, the animated ones (each has a still) and the eggs. Shared by the client and the server (no three.js).
//   #1-56,329        paintings/1-56,329
//   #56,330-59,329   3d/1-3,000
//   #59,330-59,750   animated/1-421
//   #59,751-111,111  eggs/1-51,361
import {PAINT_SIZES, PAINT_RUNS} from './collection-dims.js';

export const CDN_ROOT = 'https://cdn.lil.org/nft/111k/';
export const ART_MAX = 111111;
export const PAINTING_LONG = .8;     // metres along a painting's longer side
const PARTS = [
  {kind: 'painting', dir: 'paintings', first: 1, count: 56329},
  {kind: '3d', dir: '3d', first: 56330, count: 3000, w: 2048, h: 2048},
  {kind: 'animated', dir: 'animated', first: 59330, count: 421, w: 932, h: 1006},
  {kind: 'egg', dir: 'eggs', first: 59751, count: 51361, w: 1024, h: 1024},
];
export const validArt = n => Number.isInteger(n) && n >= 1 && n <= ART_MAX;
// which part of the collection a number's in, and its number within that folder
export function piece(n) {
  for (const p of PARTS) if (n >= p.first && n < p.first + p.count) return {kind: p.kind, dir: p.dir, k: n - p.first + 1, part: p};
  return null;
}
export function artUrl(n) {
  const p = piece(n);
  return p ? `${CDN_ROOT}${p.dir}/${p.k}.png` : `${CDN_ROOT}paintings/1.png`;
}
// the paintings' pixel sizes, run-length coded: PAINT_RUNS is "<size index><run length in base 36>," for 1, 2, ...
let paintSize = null;
function paintingDims(k) {
  if (!paintSize) {
    paintSize = new Uint8Array(56330);
    let i = 1;
    for (const run of PAINT_RUNS.split(',')) {
      if (!run) continue;
      const s = parseInt(run[0], 36), n = parseInt(run.slice(1), 36);
      paintSize.fill(s, i, i + n); i += n;
    }
  }
  const [w, h] = PAINT_SIZES[paintSize[k] || 0];
  return {w, h};
}
// a piece's picture's pixel size (a painting takes its picture's proportions)
export function artDims(n) {
  const p = piece(n);
  if (!p) return {w: 932, h: 1006};
  return p.kind === 'painting' ? paintingDims(p.k) : {w: p.part.w, h: p.part.h};
}

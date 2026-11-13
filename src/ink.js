// Marker ink: freehand lines drawn with a marker on whatever's in reach (walls, floors, doors, paintings,
// other players). A stroke is a list of points on a surface, [x, y, z, nx, ny, nz, u, v] (where, which way the
// surface faces, and the level's lightmap there), in its host's own space: 'w' the world, 'd<k>' a door, 'p<id>'
// a painting, 'a<id>' a player. It's drawn as a ribbon laid on the surface, a hair off it, with round dots at its
// ends and wherever it turns sharply, so it reads as one line however it was drawn. On the walls it's lit by the
// level's baked light like the paint; anywhere else by the lights, like what it's on.
//
// Built to hold a lot of it:
//  - a stroke's points are kept packed (8 floats a point), and its ribbon is a strip: two corners a point,
//    shared by the pieces either side (indexed), straight into typed arrays, nothing made per point;
//  - the ink on the walls is in chunks by where it is (each room; slices of the tunnel round the loop), so what
//    can't be seen isn't drawn (three's view culling, and the level's own: src/cull.js via cull());
//  - strokes over strokes on the same surface share a batch (the later drawn over the earlier, in the order they
//    went in), so it's one draw a chunk however many cross; only a tag between them puts a stroke on a layer of
//    its own (in among the tags: src/main.js layerFor);
//  - what overlaps what is found through a grid, not by looking at every stroke;
//  - a whole room's worth of ink arriving at once (joining) is built a few milliseconds a frame (tick()).
import * as THREE from 'three';
import {markMaterial, rgbOf} from './decals.js';

export const INK_WIDTH = .026;      // metres across the line (a fat paint marker)
const LIFT = .0025;                 // off the surface
const BEND = Math.cos(55 * Math.PI / 180);   // turning more than this: a dot at the joint (less, the strip's joint holds)
const PICK_NEAR = .04;              // the sponge finds a line aimed this near it
const GRID = .5;                    // the overlap grid's cells (m); a stroke bigger than BIG cells is kept aside
const BIG = 64;
const BUILD_MS = 5;                 // a frame's share of building ink that's come in all at once
const SETTLE_MS = 1500;             // a stroke left this long after being drawn live is rebuilt as one piece
const MIXED = -2;                   // (src/cull.js: in the tunnel and a room both, shown by its angle round the loop)
const _ray = new THREE.Ray(), _inv = new THREE.Matrix4(), _v = new THREE.Vector3(), _w = new THREE.Vector3();

// the line's look: left half its cross-section (soft edges), right half a round dot
function inkTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const g = c.getContext('2d'), img = g.createImageData(64, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    const v = (y + .5) / 32;
    let a;
    if (x < 32) a = Math.min(1, Math.max(0, (.5 - Math.abs(v - .5)) / .12));            // across the line
    else { const dx = (x - 32 + .5) / 32 - .5, dy = v - .5; a = Math.min(1, Math.max(0, (.5 - Math.hypot(dx, dy)) / .12)); }
    const i = (y * 64 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
  return t;
}

// ---------------------------------------------------------------- building a ribbon
// One reusable scratch space the builder writes into (grown as needed): positions, uvs (bytes: the texture's
// quarter points), lightmap uvs (16-bit), and indices local to the piece.
const S = {pos: new Float32Array(3 * 4096), uv: new Uint8Array(2 * 4096), uv1: new Uint16Array(2 * 4096), idx: new Uint32Array(6 * 4096), vc: 0, ic: 0};
function room(verts, idx) {
  if (S.pos.length < verts * 3) {
    const n = Math.max(verts, S.pos.length / 3 * 2);
    S.pos = new Float32Array(n * 3); S.uv = new Uint8Array(n * 2); S.uv1 = new Uint16Array(n * 2);
  }
  if (S.idx.length < idx) S.idx = new Uint32Array(Math.max(idx, S.idx.length * 2));
}
const box = new THREE.Box3();
function put(x, y, z, u, v, lu, lv) {
  const i = S.vc++;
  S.pos[i * 3] = x; S.pos[i * 3 + 1] = y; S.pos[i * 3 + 2] = z;
  S.uv[i * 2] = u; S.uv[i * 2 + 1] = v;
  S.uv1[i * 2] = Math.round(Math.min(1, Math.max(0, lu)) * 65535); S.uv1[i * 2 + 1] = Math.round(Math.min(1, Math.max(0, lv)) * 65535);
  if (x < box.min.x) box.min.x = x; if (y < box.min.y) box.min.y = y; if (z < box.min.z) box.min.z = z;
  if (x > box.max.x) box.max.x = x; if (y > box.max.y) box.max.y = y; if (z > box.max.z) box.max.z = z;
  return i;
}
const quad = (a, b, c, d) => { const k = S.ic; S.idx[k] = a; S.idx[k + 1] = b; S.idx[k + 2] = c; S.idx[k + 3] = b; S.idx[k + 4] = d; S.idx[k + 5] = c; S.ic += 6; };
// (byte uvs: 0, a quarter (64), a half (128), all (255))
const U_LINE = 64, U_DOT = 128, U_ALL = 255;
// the ribbon for points [from, n) of a stroke, joined on to the one before `from` (exactly where the last
// piece ended: st.endSide). Into S; returns false if there's nothing to draw.
// A stroke's points, kept small: 8 Int16 a point (st.q): x, y, z in millimetres from its first point (st.o), the
// surface's facing x100, the lightmap spot x10000. That's exactly as precise as the room keeps them
// (protocol.js packInk), so a stroke's drawn the same from these as from what came in.
const QS = [1000, 1000, 1000, 100, 100, 100, 10000, 10000];
// (a stroke reaching more than 32 m from its first point, which a few odd ones do, keeps 32-bit numbers instead)
function putPoints(st, src, count) {           // src: count points, 8 numbers each (floats, as they are)
  if (!count) return;
  if (!st.o) st.o = [Math.round(src[0] * 1000), Math.round(src[1] * 1000), Math.round(src[2] * 1000)];
  const o = st.o;
  let wide = st.q instanceof Int32Array;
  if (!wide) for (let i = 0; i < count * 8 && !wide; i++) { const k = i & 7, v = Math.round(src[i] * QS[k]) - (k < 3 ? o[k] : 0); if (v > 32767 || v < -32768) wide = true; }
  if (st.q.length < (st.n + count) * 8 || (wide && !(st.q instanceof Int32Array))) {
    const q = new (wide ? Int32Array : Int16Array)(Math.max((st.n + count) * 8, Math.ceil(st.q.length * 1.5)));
    q.set(st.q.subarray(0, st.n * 8)); st.q = q;
  }
  const q = st.q;
  for (let i = 0; i < count; i++) {
    const at = (st.n + i) * 8;
    for (let k = 0; k < 8; k++) q[at + k] = Math.round(src[i * 8 + k] * QS[k]) - (k < 3 ? o[k] : 0);
    st.box.expandByPoint(_v.set((q[at] + o[0]) / 1000, (q[at + 1] + o[1]) / 1000, (q[at + 2] + o[2]) / 1000));
  }
  st.n += count;
}
// as floats again, for building its ribbon (into a scratch array)
let F = new Float32Array(8 * 512);
function floats(st) {
  if (F.length < st.n * 8) F = new Float32Array(Math.max(st.n * 8, F.length * 2));
  const q = st.q, o = st.o;
  for (let i = 0; i < st.n * 8; i++) { const k = i & 7; F[i] = (q[i] + (k < 3 ? o[k] : 0)) / QS[k]; }
  return F;
}
function build(st, from) {
  const p = floats(st), n = st.n, w = INK_WIDTH / 2;
  S.vc = 0; S.ic = 0; box.makeEmpty();
  if (n - from <= 0 && from > 0) return false;
  room((n - from + 1) * 6 + 8, (n - from + 1) * 12 + 12);
  const nx = i => p[i * 8 + 3], ny = i => p[i * 8 + 4], nz = i => p[i * 8 + 5];
  const lx = i => p[i * 8] + nx(i) * LIFT, ly = i => p[i * 8 + 1] + ny(i) * LIFT, lz = i => p[i * 8 + 2] + nz(i) * LIFT;
  // a round dot lying on the surface at point i
  const dot = i => {
    const Nx = nx(i), Ny = ny(i), Nz = nz(i), cx = lx(i), cy = ly(i), cz = lz(i), lu = p[i * 8 + 6], lv = p[i * 8 + 7];
    // a tangent across the surface, and the other way along it
    let tx, ty, tz;
    if (Math.abs(Ny) < .9) { tx = Nz; ty = 0; tz = -Nx; } else { tx = 0; ty = -Nz; tz = Ny; }
    let l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
    const bx = Ny * tz - Nz * ty, by = Nz * tx - Nx * tz, bz = Nx * ty - Ny * tx;
    const v = (sx, sy, u, vv) => put(cx + (tx * sx + bx * sy) * w, cy + (ty * sx + by * sy) * w, cz + (tz * sx + bz * sy) * w, u, vv, lu, lv);
    const a = v(-1, -1, U_DOT, 0), b = v(1, -1, U_ALL, 0), c = v(-1, 1, U_DOT, U_ALL), d = v(1, 1, U_ALL, U_ALL);
    quad(a, b, c, d);
  };
  // the way from point i to j, normalised, into out (false if they're the same place)
  const dir = (i, j, out) => {
    out.set(p[j * 8] - p[i * 8], p[j * 8 + 1] - p[i * 8 + 1], p[j * 8 + 2] - p[i * 8 + 2]);
    const l = out.length(); if (l < 1e-6) return false; out.divideScalar(l); return true;
  };
  // each point's sideways offset, across the line as it runs through it (the way in and the way out averaged),
  // so the pieces either side meet edge to edge round bends (the curved tunnel bends them all)
  const t = new THREE.Vector3(), d = new THREE.Vector3(), side = new THREE.Vector3();
  const sideAt = i => {
    t.set(0, 0, 0);
    if (i > 0 && dir(i - 1, i, d)) t.add(d);
    if (i + 1 < n && dir(i, i + 1, d)) t.add(d);
    if (t.lengthSq() < 1e-8) { if (i > 0) dir(i - 1, i, t); else if (i + 1 < n) dir(i, i + 1, t); }
    side.set(nx(i), ny(i), nz(i)).cross(t.normalize());
    const l = side.length(); if (l > 1e-6) side.multiplyScalar(w / l); else side.set(0, 0, 0);
    return side;
  };
  const pair = (i, s) => [put(lx(i) + s.x, ly(i) + s.y, lz(i) + s.z, U_LINE, U_ALL, p[i * 8 + 6], p[i * 8 + 7]),
    put(lx(i) - s.x, ly(i) - s.y, lz(i) - s.z, U_LINE, 0, p[i * 8 + 6], p[i * 8 + 7])];
  if (from === 0) { dot(0); st.endSide = null; }
  let prev = null, prevI = from > 0 ? from - 1 : 0;
  if (from > 0 && st.endSide) prev = pair(prevI, st.endSide);
  else prev = pair(prevI, sideAt(prevI).clone());
  const seg = new THREE.Vector3(), next = new THREE.Vector3();
  let endSide = st.endSide;
  for (let i = Math.max(1, from); i < n; i++) {
    if (!dir(prevI, i, seg) || Math.hypot(p[i * 8] - p[prevI * 8], p[i * 8 + 1] - p[prevI * 8 + 1], p[i * 8 + 2] - p[prevI * 8 + 2]) < 1e-5) continue;
    const s = sideAt(i).clone();
    const cur = pair(i, s);
    quad(prev[0], prev[1], cur[0], cur[1]);
    prev = cur; prevI = i; endSide = s;
    // a dot where it turns sharply (not at the end of a piece as it comes in: the next one draws on over it)
    if (i + 1 < n && dir(i, i + 1, next) && next.dot(seg) < BEND) dot(i);
  }
  st.endSide = endSide;
  return S.ic > 0;
}

// ---------------------------------------------------------------- a batch: many strokes' ribbons, one draw
function inkBatch(material, vcap = 2048) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.matrixAutoUpdate = false;
  let a = null, vUsed = 0, iUsed = 0, dead = 0, alive = 0;
  const marks = [];
  const bounds = new THREE.Box3();
  function make(vc, ic) {
    const geo = new THREE.BufferGeometry();
    // (16-bit indices while it's no more than 65,536 corners: half the room)
    a = {vc, ic, pos: new Float32Array(vc * 3), uv: new Uint8Array(vc * 2), uv1: new Uint16Array(vc * 2), col: new Uint8Array(vc * 4), idx: vc <= 65536 ? new Uint16Array(ic) : new Uint32Array(ic)};
    geo.setAttribute('position', new THREE.BufferAttribute(a.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2, true).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv1', new THREE.BufferAttribute(a.uv1, 2, true).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(a.col, 4, true).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(a.idx, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(); geo.boundingBox = new THREE.Box3();
    mesh.geometry.dispose(); mesh.geometry = geo;
  }
  make(vcap, vcap * 3);
  function touch(v0, vc, i0, ic) {
    const g = mesh.geometry;
    for (const [name, k] of [['position', 3], ['uv', 2], ['uv1', 2], ['color', 4]]) { const at = g.attributes[name]; at.addUpdateRange(v0 * k, vc * k); at.needsUpdate = true; }
    g.index.addUpdateRange(i0, ic); g.index.needsUpdate = true;
  }
  function fit() {
    const g = mesh.geometry;
    g.setDrawRange(0, iUsed);
    if (bounds.isEmpty()) { g.boundingSphere.set(_v.set(0, -1e4, 0), 0); g.boundingBox.makeEmpty(); }
    else { bounds.getBoundingSphere(g.boundingSphere); g.boundingBox.copy(bounds); }
    mesh.visible = iUsed > 0;
  }
  // everything still there moved up to the front (in the order it went in), in arrays big enough for `extra` more
  function repack(vExtra = 0, iExtra = 0, exact = false) {
    const live = marks.filter(m => !m.dead);
    marks.length = 0; marks.push(...live);
    let vc = 0, ic = 0; for (const m of live) { vc += m.vc; ic += m.ic; }
    const old = a;
    let vcap = old.vc, icap = old.ic;
    if (exact) { vcap = Math.max(2048, vc + vExtra); icap = Math.max(4096, ic + iExtra); }
    else {
      while (vc + vExtra > vcap) vcap = Math.ceil(vcap * 1.5);
      while (ic + iExtra > icap) icap = Math.ceil(icap * 1.5);
      // (just under the 16-bit limit rather than just over it)
      if (vcap > 65536 && vc + vExtra <= 65536) vcap = 65536;
      // (and smaller again if most of it's gone)
      while (vcap > 2048 && (vc + vExtra) * 4 < vcap && (ic + iExtra) * 4 < icap) { vcap = Math.ceil(vcap / 2); icap = Math.ceil(icap / 2); }
    }
    make(vcap, icap);
    let v = 0, i = 0;
    bounds.makeEmpty();
    for (const m of live) {
      a.pos.set(old.pos.subarray(m.v0 * 3, (m.v0 + m.vc) * 3), v * 3);
      a.uv.set(old.uv.subarray(m.v0 * 2, (m.v0 + m.vc) * 2), v * 2);
      a.uv1.set(old.uv1.subarray(m.v0 * 2, (m.v0 + m.vc) * 2), v * 2);
      a.col.set(old.col.subarray(m.v0 * 4, (m.v0 + m.vc) * 4), v * 4);
      const shift = v - m.v0;
      for (let k = 0; k < m.ic; k++) a.idx[i + k] = old.idx[m.i0 + k] + shift;
      m.v0 = v; m.i0 = i; v += m.vc; i += m.ic;
      bounds.union(m.box);
    }
    vUsed = v; iUsed = i; dead = 0; alive = live.length;
    fit();
  }
  return {
    mesh,
    get empty() { return iUsed === 0; },
    get bytes() { return a.pos.byteLength + a.uv.byteLength + a.uv1.byteLength + a.col.byteLength + a.idx.byteLength; },
    // the ribbon in S, in colour rgb
    add(rgb) {
      if (vUsed + S.vc > a.vc || iUsed + S.ic > a.ic) repack(S.vc, S.ic);
      const m = {v0: vUsed, vc: S.vc, i0: iUsed, ic: S.ic, dead: false, box: box.clone()};
      a.pos.set(S.pos.subarray(0, S.vc * 3), vUsed * 3);
      a.uv.set(S.uv.subarray(0, S.vc * 2), vUsed * 2);
      a.uv1.set(S.uv1.subarray(0, S.vc * 2), vUsed * 2);
      for (let k = 0; k < S.vc; k++) { const o = (vUsed + k) * 4; a.col[o] = rgb[0]; a.col[o + 1] = rgb[1]; a.col[o + 2] = rgb[2]; a.col[o + 3] = 255; }
      for (let k = 0; k < S.ic; k++) a.idx[iUsed + k] = S.idx[k] + vUsed;
      touch(vUsed, S.vc, iUsed, S.ic);
      vUsed += S.vc; iUsed += S.ic;
      marks.push(m); alive++;
      bounds.union(m.box);
      fit();
      return m;
    },
    remove(m) {
      if (m.dead) return;
      m.dead = true; dead += m.vc; alive--;
      a.idx.fill(0, m.i0, m.i0 + m.ic);                 // (its triangles, to nothing)
      const g = mesh.geometry; g.index.addUpdateRange(m.i0, m.ic); g.index.needsUpdate = true;
      if (!alive) { marks.length = 0; vUsed = iUsed = dead = 0; bounds.makeEmpty(); fit(); }
    },
    // tidy up once a lot's been rubbed out (and the bounds shrink back to what's left)
    tidy() { if (dead > 4096 && dead * 2 > vUsed) repack(); },
    // no more room kept than a little over what's there (once a lot's come in at once)
    snug() { if (a.vc > 4096 && (vUsed * 1.3 < a.vc || iUsed * 1.3 < a.ic)) repack(Math.ceil(vUsed * .15), Math.ceil(iUsed * .15), true); },
    clear() { marks.length = 0; vUsed = iUsed = dead = alive = 0; bounds.makeEmpty(); fit(); },
    dispose() { mesh.removeFromParent(); mesh.geometry.dispose(); },
  };
}

// hostOf(h) -> the Object3D that a host's ink hangs on (its own space), or null if it isn't here (yet)
// layerFor(host, box, inkTop): the layer a new stroke goes on (over the tags it overlaps; inkTop is the highest of
// the strokes it overlaps: src/main.js); order(layer): that layer's draw order
// zoneOf(box) -> {key, room}: which chunk of the world a stroke on the walls goes in (src/main.js, from src/cull.js)
export function createInk({level, scene, hostOf, layerFor = (h, box, top) => Math.max(0, top), order = () => 3.5, zoneOf = () => ({key: '', room: MIXED})}) {
  const tex = inkTexture();
  const levelMat = markMaterial(level, tex, 3);
  const ownMat = new THREE.MeshStandardMaterial({map: tex, transparent: true, depthWrite: false, vertexColors: true, roughness: .55, metalness: 0,
    flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6});
  const batches = new Map();     // host|layer|zone -> {batch, parent, h, room}
  const strokes = new Map();     // id -> {id, h, c, rgb, p: Float32Array, n, marks: [{batch, m}], drawn, layer, key, box}
  const queue = [];              // strokes with points still to draw, in the order they came (tick())
  let queued = 0, seq = 0;

  // ---- the overlap grid (per host): cell -> strokes; big ones in a list of their own
  const grids = new Map();       // h -> {cells: Map, big: Set}
  const cellKey = (x, y, z) => `${x},${y},${z}`;
  function cellsOf(b, fn) {
    const x0 = Math.floor(b.min.x / GRID), x1 = Math.floor(b.max.x / GRID), y0 = Math.floor(b.min.y / GRID), y1 = Math.floor(b.max.y / GRID);
    const z0 = Math.floor(b.min.z / GRID), z1 = Math.floor(b.max.z / GRID);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > BIG) return false;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) fn(cellKey(x, y, z));
    return true;
  }
  function index(st) {
    let g = grids.get(st.h);
    if (!g) grids.set(st.h, g = {cells: new Map(), big: new Set()});
    if (st.cells) for (const k of st.cells) g.cells.get(k)?.delete(st);
    g.big.delete(st);
    st.cells = [];
    const ok = cellsOf(st.box, k => { let c = g.cells.get(k); if (!c) g.cells.set(k, c = new Set()); c.add(st); st.cells.push(k); });
    if (!ok) { for (const k of st.cells) g.cells.get(k)?.delete(st); st.cells = null; g.big.add(st); }
  }
  function unindex(st) {
    const g = grids.get(st.h);
    if (!g) return;
    if (st.cells) for (const k of st.cells) { const c = g.cells.get(k); c?.delete(st); if (c && !c.size) g.cells.delete(k); }
    g.big.delete(st);
  }
  // the strokes on host h whose bounds overlap b
  function overlapping(h, b, fn) {
    const g = grids.get(h);
    if (!g) return;
    const seen = new Set();
    const visit = st => { if (!seen.has(st)) { seen.add(st); if (st.box.intersectsBox(b)) fn(st); } };
    if (!cellsOf(b, k => { const c = g.cells.get(k); if (c) for (const st of c) visit(st); })) for (const c of g.cells.values()) for (const st of c) visit(st);
    for (const st of g.big) visit(st);
  }

  function batchFor(st) {
    const h = st.h, parent = h === 'w' ? scene : hostOf(h);
    if (!parent) return null;
    const key = `${h}|${st.layer}|${st.zone || ''}`;
    let e = batches.get(key);
    if (e && e.parent !== parent) { e.batch.dispose(); batches.delete(key); e = null; }   // (its host was made again)
    if (!e) {
      const batch = inkBatch(h === 'w' ? levelMat : ownMat, h === 'w' ? 4096 : 512);
      // in among the tags (over the older ones it overlaps, under newer), and among the other chunks on its layer
      // in its place (a millionth apart: well inside a layer's step, for thousands of chunks)
      batch.mesh.renderOrder = order(st.layer) + (h === 'w' ? Math.min(placeOf(st.layer, st.zone), 2000) * 1e-6 : 0);
      parent.add(batch.mesh);
      if (h === 'w') batch.mesh.updateMatrix();
      e = {batch, parent, h, room: st.room ?? MIXED};
      batches.set(key, e);
    }
    // (a chunk with strokes from more than one part of the level is shown by where it is round the loop alone)
    if (h === 'w' && st.room !== e.room) e.room = MIXED;
    return e.batch;
  }
  function draw(st) {
    if (st.drawn >= st.n) return true;
    const batch = batchFor(st);
    if (!batch) return false;                      // its host isn't here yet: drawn when it is (refresh)
    if (build(st, st.drawn)) st.marks.push({batch, m: batch.add(st.rgb), kind: 'ink', id: st.id});
    st.drawn = st.n;
    return true;
  }
  function undraw(st) { for (const k of st.marks) k.batch.remove(k.m); st.marks = []; st.drawn = 0; st.endSide = null; }
  function drawQueued(budget) {
    const until = performance.now() + budget;
    while (queued < queue.length) {
      const st = queue[queued++];
      if (strokes.get(st.id) === st && st.drawn < st.n) draw(st);
      if (performance.now() > until) break;
    }
    if (queued >= queue.length) {
      // (a lot came in at once: the batches made no bigger than they need be)
      if (queue.length > 200) for (const e of batches.values()) e.batch.snug();
      queue.length = 0; queued = 0;
    }
  }
  const pending = () => queued < queue.length;
  // ---- the walls' chunks, in a fixed order. Two overlapping strokes in different chunks are drawn in the order
  // of their chunks; left to three.js, that's by how far away each chunk's middle is, which changes as you move
  // (up close, a later stroke could go under an earlier one). So each chunk on a layer gets a place in the order
  // as it's first used, and a stroke that overlaps others goes in the latest of their chunks, at its end: after
  // everything it's over, from anywhere, and nothing has to be drawn again.
  const zoneSeq = new Map();     // `${layer}|${zone}` -> its place
  const placeOf = (layer, zone) => { const k = `${layer}|${zone}`; let n = zoneSeq.get(k); if (n === undefined) zoneSeq.set(k, n = zoneSeq.size + 1); return n; };
  function remove(id) {
    const st = strokes.get(id);
    if (!st) return;
    undraw(st); unindex(st);
    strokes.delete(id);
  }
  function append(st, pts) {
    const flat = new Float64Array(pts.length * 8);
    pts.forEach((q, i) => { for (let k = 0; k < 8; k++) flat[i * 8 + k] = q[k] || 0; });
    putPoints(st, flat, pts.length);
  }
  return {
    // a stroke, or more of one: {id, h, c, p: points}; live: drawn as it's being drawn (a piece now, one piece
    // once it's settled), otherwise queued with whatever else is coming in
    // (or f: its points already packed as floats, 8 a point, as they come when joining)
    add({id, h, c, p, f}, live = true) {
      if (f && f.length >= 8 && !strokes.has(id)) p = null;
      else if (!Array.isArray(p) || !p.length) return;
      let st = strokes.get(id);
      if (st && st.h !== h) return;
      if (!st) {
        st = {id, h, c, rgb: rgbOf(c), q: new Int16Array(Math.max(1, p ? p.length : f.length >> 3) * 8), o: null, n: 0, marks: [], drawn: 0, box: new THREE.Box3(), at: 0};
        if (p) for (const q of p) st.box.expandByPoint(_v.set(q[0], q[1], q[2]));
        else putPoints(st, f, f.length >> 3);
        st.box.expandByScalar(.02);
        // its layer (over the tags it covers; with the strokes it covers, drawn after them)
        let top = -1;
        overlapping(h, st.box, o => { if (o.layer > top) top = o.layer; });
        st.layer = layerFor(h, st.box, top);
        // and, on the walls, its chunk: if it's over other strokes on its layer, the latest-placed of theirs (so
        // it's drawn after them all), otherwise where it is (src/main.js zoneOf)
        if (h === 'w') {
          const z = zoneOf(st.box);
          st.room = z.room; st.zone = z.key;
          let best = 0;
          overlapping(h, st.box, o => { if (o.layer === st.layer) { const n = placeOf(o.layer, o.zone); if (n > best) { best = n; st.zone = o.zone; } } });
          placeOf(st.layer, st.zone);
        }
        st.seq = ++seq;
        strokes.set(id, st);
      }
      if (p) append(st, p);
      // (a stroke being drawn that's grown over a stroke in a later chunk moves into that one: only it's drawn again)
      if (h === 'w' && live && st.marks.length) {
        let best = placeOf(st.layer, st.zone), to = null;
        overlapping(h, st.box, o => { if (o !== st && o.layer === st.layer) { const n = placeOf(o.layer, o.zone); if (n > best) { best = n; to = o.zone; } } });
        if (to) { undraw(st); st.zone = to; }
      }
      index(st);
      st.at = live ? performance.now() : 0;
      if (live && !pending()) draw(st);
      else queue.push(st);
    },
    remove,
    // everything again (joining the room): the strokes as they were laid, built over the next frames
    reset(list = []) {
      for (const st of strokes.values()) unindex(st);
      strokes.clear(); grids.clear(); zoneSeq.clear(); queue.length = 0; queued = 0;
      for (const e of batches.values()) e.batch.dispose();
      batches.clear();
      for (const s of list) this.add({id: s.id, h: s.h, c: s.c, p: s.pts}, false);
    },
    // once a frame: some of what's queued drawn
    tick() { if (pending()) drawQueued(BUILD_MS); },
    // strokes the room has joined into one drawing (they cross, or they're the same colour and near): nothing to
    // do here. Strokes that cross are already drawn together (the later over the earlier, in one batch), and
    // moving one onto another's layer could lift it over a tag that's over it.
    group() {},
    // the highest layer of the strokes on host h that box overlaps (-1: none)
    overlapLayer(h, b) {
      let top = -1;
      overlapping(h, b, st => { if (st.layer > top) top = st.layer; });
      return top;
    },
    // every half second: a host that's come (a player's avatar made, a painting arrived) gets its waiting ink; one
    // gone loses its batches; strokes drawn live and left alone are made one piece; batches with a lot rubbed out
    // are tidied
    refresh() {
      for (const [key, e] of batches) {
        const h = e.h;
        if (h !== 'w' && hostOf(h) !== e.parent) {
          e.batch.dispose(); batches.delete(key);
          for (const st of strokes.values()) if (st.h === h) { st.marks = []; st.drawn = 0; st.endSide = null; }
        }
      }
      const now = performance.now();
      for (const st of strokes.values()) {
        // (only if nothing since has gone on over it: rebuilt, it'd be drawn after that)
        if (st.at && now - st.at > SETTLE_MS) {
          st.at = 0;
          let over = false;
          if (st.marks.length > 1) overlapping(st.h, st.box, o => { if (o.seq > st.seq && o.layer === st.layer) over = true; });
          if (st.marks.length > 1 && !over) { undraw(st); queue.push(st); }
        }
        else if (st.drawn < st.n && !pending()) queue.push(st);
      }
      if (pending()) drawQueued(BUILD_MS);
      for (const e of batches.values()) e.batch.tidy();
    },
    // which world chunks could be seen (src/cull.js): visible(x, z, radius, room)
    cull(visible) {
      for (const e of batches.values()) {
        if (e.h !== 'w' || e.batch.empty) continue;
        const s = e.batch.mesh.geometry.boundingSphere;
        e.batch.mesh.visible = visible(s.center.x, s.center.z, s.radius, e.room);
      }
    },
    // ink on a player, gone (they left)
    dropHost(h) {
      for (const st of [...strokes.values()]) if (st.h === h) remove(st.id);
      for (const [key, e] of batches) if (e.h === h) { e.batch.dispose(); batches.delete(key); }
      grids.delete(h);
    },
    // the stroke the sponge is aimed at: the ray passing within a few centimetres of one of its points (a line
    // that thin is too fine to hit square on), nearer than `limit`. {kind: 'ink', id, distance, mark} with
    // the whole stroke as one mark (what the sponge's glow outlines), or null
    pick(origin, dir, limit) {
      let best = null;
      for (const st of strokes.values()) {
        if (!st.marks.length) continue;
        const mesh = st.marks[0].batch.mesh;
        mesh.updateWorldMatrix(true, false);
        const inv = _inv.copy(mesh.matrixWorld).invert();
        _ray.origin.copy(origin).applyMatrix4(inv); _ray.direction.copy(dir).transformDirection(inv);
        if (!st.bound || st.boundN !== st.n) { st.bound = st.box.getBoundingSphere(st.bound || new THREE.Sphere()); st.bound.radius += .05; st.boundN = st.n; }
        if (!_ray.intersectsSphere(st.bound)) continue;
        const q = st.q, o = st.o;
        for (let i = 0; i < st.n; i++) {
          _v.set((q[i * 8] + o[0]) / 1000, (q[i * 8 + 1] + o[1]) / 1000, (q[i * 8 + 2] + o[2]) / 1000);
          const t = _w.copy(_v).sub(_ray.origin).dot(_ray.direction);
          if (t < 0 || t > limit || (best && t >= best.distance)) continue;
          if (_ray.distanceSqToPoint(_v) > PICK_NEAR * PICK_NEAR) continue;
          best = {distance: t, st};
        }
      }
      if (!best) return null;
      const st = best.st;
      // the mark the glow's made from: its ribbon as triangles (only made for the one being aimed at)
      return {kind: 'ink', id: st.id, distance: best.distance, mark: {batch: st.marks[0].batch, get verts() {
        const keep = st.endSide; build(st, 0); st.endSide = keep;
        const out = [];
        for (let k = 0; k < S.ic; k++) { const i = S.idx[k]; out.push({p: new THREE.Vector3(S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]), u: S.uv[i * 2] / 255, v: S.uv[i * 2 + 1] / 255}); }
        return out;
      }}};
    },
    // the strokes' drawn pieces (for checks)
    marks() { const out = []; for (const st of strokes.values()) out.push(...st.marks); return out; },
    // how much there is: strokes, points, batches, and vertices drawn
    stats() {
      let pts = 0, verts = 0, shown = 0, bytes = 0;
      for (const st of strokes.values()) { pts += st.n; bytes += st.q.byteLength; }
      for (const e of batches.values()) { const g = e.batch.mesh.geometry; verts += g.drawRange.count; bytes += e.batch.bytes; if (e.batch.mesh.visible) shown++; }
      return {strokes: strokes.size, pts, batches: batches.size, shown, indices: verts, queued: queue.length - queued, MB: Math.round(bytes / 1e6)};
    },
    has: id => strokes.has(id),
    // the batches, for checks: [{key, room, shown, strokes, centre, radius}]
    batches() {
      return [...batches].map(([key, e]) => { const sp = e.batch.mesh.geometry.boundingSphere; return {key, room: e.room, shown: e.batch.mesh.visible, empty: e.batch.empty,
        centre: [+sp.center.x.toFixed(2), +sp.center.y.toFixed(2), +sp.center.z.toFixed(2)], radius: +sp.radius.toFixed(2)}; });
    },
    // (for checks) strokes on the walls drawn before an older stroke they overlap, on their layer (should be none)
    misordered() {
      let n = 0;
      for (const st of strokes.values()) if (st.h === 'w') {
        let x = false;
        overlapping('w', st.box, o => { if (o.seq < st.seq && o.layer === st.layer && placeOf(o.layer, o.zone) > placeOf(st.layer, st.zone)) x = true; });
        if (x) n++;
      }
      return n;
    },
    // which batch a stroke's in
    batchOf(id) { const st = strokes.get(id); return st && {zone: st.zone, room: st.room, layer: st.layer, box: [st.box.min.toArray().map(v => +v.toFixed(2)), st.box.max.toArray().map(v => +v.toFixed(2))]}; },
  };
}

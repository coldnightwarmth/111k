// Marker ink: freehand lines drawn with a marker on whatever's in reach (walls, floors, doors, paintings,
// other players). A stroke is a list of points on a surface, [x, y, z, nx, ny, nz, u, v] (where, which way the
// surface faces, and the level's lightmap there), in its host's own space: 'w' the world, 'd<k>' a door, 'p<id>'
// a painting, 'a<id>' a player. It's drawn as a ribbon laid on the surface, a hair off it, with round dots at its
// ends and wherever it turns sharply, so it reads as one line however it was drawn. Every stroke on one host
// shares a batch (src/decals.js createBatch): one draw for all the ink on the walls, one per door or painting or
// player with any on. On the walls it's lit by the level's baked light like the paint; anywhere else by the
// lights, like what it's on.
import * as THREE from 'three';
import {createBatch, markMaterial, rgbOf} from './decals.js';

export const INK_WIDTH = .026;      // metres across the line (a fat paint marker)
const LIFT = .0025;                 // off the surface
const BEND = Math.cos(25 * Math.PI / 180);   // turning more than this: a dot at the joint
const PICK_NEAR = .04;              // the sponge finds a line aimed this near it
const _ray = new THREE.Ray(), _inv = new THREE.Matrix4();

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

// hostOf(h) -> the Object3D that a host's ink hangs on (its own space), or null if it isn't here (yet)
export function createInk({level, scene, hostOf}) {
  const tex = inkTexture();
  const levelMat = markMaterial(level, tex, 3);
  const ownMat = new THREE.MeshStandardMaterial({map: tex, transparent: true, depthWrite: false, vertexColors: true, roughness: .55, metalness: 0,
    flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6});
  const batches = new Map();     // host -> {batch, parent}
  const strokes = new Map();     // id -> {id, h, c, rgb, pts, marks: [{batch, m, verts}], drawn: number of points drawn}
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _d = new THREE.Vector3(), _s = new THREE.Vector3();

  function batchFor(h) {
    const parent = h === 'w' ? scene : hostOf(h);
    if (!parent) return null;
    let e = batches.get(h);
    if (e && e.parent !== parent) { e.batch.mesh.removeFromParent(); e = null; }   // (its host was made again)
    if (!e) {
      const batch = createBatch(h === 'w' ? levelMat : ownMat, h === 'w' ? 8000 : 1200);
      batch.mesh.renderOrder = 3.5;            // over the tags (2-3), with the splats
      parent.add(batch.mesh);
      e = {batch, parent};
      batches.set(h, e);
    }
    return e.batch;
  }
  const vert = (p, u, v, uv1) => ({p, u, v, uv1});
  // the geometry for points [from, to) of a stroke, joined on to the one before `from`
  function build(st, from) {
    const pts = st.pts, out = [], w = INK_WIDTH / 2;
    const P = i => _a.set(pts[i][0], pts[i][1], pts[i][2]), N = i => new THREE.Vector3(pts[i][3], pts[i][4], pts[i][5]);
    const L = i => new THREE.Vector2(pts[i][6], pts[i][7]);
    const lifted = i => P(i).clone().addScaledVector(N(i), LIFT);
    const dot = i => {                          // a round dot lying on the surface
      const n = N(i), c = lifted(i), uv = L(i);
      const t = Math.abs(n.y) < .9 ? new THREE.Vector3(0, 1, 0).cross(n).normalize() : new THREE.Vector3(1, 0, 0).cross(n).normalize();
      const b = n.clone().cross(t);
      const q = (sx, sy, u, v) => vert(c.clone().addScaledVector(t, sx * w).addScaledVector(b, sy * w), u, v, uv);
      const v00 = q(-1, -1, .5, 0), v10 = q(1, -1, 1, 0), v11 = q(1, 1, 1, 1), v01 = q(-1, 1, .5, 1);
      out.push(v00, v10, v11, v00, v11, v01);
    };
    const start = Math.max(1, from);
    if (from === 0) dot(0);
    for (let i = start; i < pts.length; i++) {
      const p0 = lifted(i - 1), p1 = lifted(i), seg = _d.copy(p1).sub(p0), len = seg.length();
      if (len < 1e-5) continue;
      seg.divideScalar(len);
      const s0 = _s.copy(N(i - 1)).cross(seg).normalize().multiplyScalar(w).clone(), s1 = N(i).cross(seg).normalize().multiplyScalar(w);
      const u0 = L(i - 1), u1 = L(i);
      const a = vert(p0.clone().add(s0), .25, 1, u0), b = vert(p0.clone().sub(s0), .25, 0, u0);
      const c = vert(p1.clone().add(s1), .25, 1, u1), d = vert(p1.clone().sub(s1), .25, 0, u1);
      out.push(a, b, c, b, d, c);
      // a dot where it turns sharply (and at its end, for now: the next points draw on over it)
      const next = i + 1 < pts.length ? _b.set(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]).normalize() : null;
      if (!next || next.dot(seg) < BEND) dot(i);
    }
    return out;
  }
  function draw(st) {
    if (st.drawn >= st.pts.length) return;
    const batch = batchFor(st.h);
    if (!batch) return;                         // its host isn't here yet: drawn when it is (refresh)
    const verts = build(st, st.drawn);
    st.drawn = st.pts.length;
    if (!verts.length) return;
    const m = batch.add(verts, st.rgb, 1);
    st.marks.push({batch, m, verts: m.verts, kind: 'ink', id: st.id});
  }
  function remove(id) {
    const st = strokes.get(id);
    if (!st) return;
    for (const k of st.marks) k.batch.remove(k.m);
    strokes.delete(id);
  }
  return {
    // a stroke, or more of one: {id, h, c, p: points}
    add({id, h, c, p}) {
      let st = strokes.get(id);
      if (!st) { st = {id, h, c, rgb: rgbOf(c), pts: [], marks: [], drawn: 0}; strokes.set(id, st); }
      if (st.h !== h) return;
      st.pts.push(...p);
      draw(st);
    },
    remove,
    // everything again (joining the room)
    reset(list = []) {
      for (const id of [...strokes.keys()]) remove(id);
      for (const e of batches.values()) e.batch.clear();
      for (const s of list) this.add({id: s.id, h: s.h, c: s.c, p: s.pts});
    },
    // a host that's come (a player's avatar made, a painting arrived): its waiting ink goes on; gone: its batch goes
    refresh() {
      for (const [h, e] of batches) if (h !== 'w' && hostOf(h) !== e.parent) { e.batch.mesh.removeFromParent(); batches.delete(h); for (const st of strokes.values()) if (st.h === h) { st.drawn = 0; st.marks = []; } }
      for (const st of strokes.values()) if (st.drawn < st.pts.length) draw(st);
    },
    // ink on a player, gone (they left)
    dropHost(h) { for (const st of [...strokes.values()]) if (st.h === h) remove(st.id); const e = batches.get(h); if (e) { e.batch.mesh.removeFromParent(); batches.delete(h); } },
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
        if (!st.bound || st.boundN !== st.pts.length) {
          st.bound = new THREE.Sphere().setFromPoints(st.pts.map(q => new THREE.Vector3(q[0], q[1], q[2])));
          st.bound.radius += .05; st.boundN = st.pts.length;
        }
        if (!_ray.intersectsSphere(st.bound)) continue;
        for (const q of st.pts) {
          _a.set(q[0], q[1], q[2]);
          const t = _b.copy(_a).sub(_ray.origin).dot(_ray.direction);
          if (t < 0 || t > limit || (best && t >= best.distance)) continue;
          if (_ray.distanceSqToPoint(_a) > PICK_NEAR * PICK_NEAR) continue;
          best = {kind: 'ink', id: st.id, distance: t, st};
        }
      }
      if (!best) return null;
      const st = best.st;
      return {kind: 'ink', id: st.id, distance: best.distance, mark: {verts: st.marks.flatMap(k => k.verts), batch: st.marks[0].batch}};
    },
    // the marks the sponge can scrub (each stroke's pieces)
    marks() { const out = []; for (const st of strokes.values()) out.push(...st.marks); return out; },
    has: id => strokes.has(id),
  };
}

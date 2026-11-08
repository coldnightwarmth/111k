// Paint on the level: paintball splats and sprayed graffiti. Marks are cut out
// of the level geometry around the hit (so they wrap corners and lie flat on
// any surface) and carry the level's lightmap coordinates, so they sit in the
// baked light, dim with flickering lamps and catch flashlight beams.
import * as THREE from 'three';
import {MeshBVH} from '../vendor/three/three-mesh-bvh.module.js';
import {hookShader} from './level.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _ray = new THREE.Ray(), _m = new THREE.Matrix4();

// ------------------------------------------------------------------ raycasts
// One BVH per opaque level mesh. Decals and other see-through surfaces are skipped.
// Swinging doors are kept apart: they move, so they're tested in their own
// (hinge) space, and marks on them are cut in that space and ride along.
export function createWorldHits(level, doors = []) {
  const parts = [];
  const doorMesh = new Set(doors.flatMap(d => d.meshes));
  for (const mesh of level.meshes) {
    const g = mesh.geometry;
    if (mesh.material.transparent || !g.attributes.uv1 || !g.index || doorMesh.has(mesh) || /#10\d\d$/.test(mesh.name)) continue;
    const bvh = new MeshBVH(g, {maxLeafTris: 12});
    mesh.updateMatrixWorld();
    const inv = mesh.matrixWorld.clone().invert();
    g.computeBoundingSphere();
    const sphere = g.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
    parts.push({mesh, g, bvh, inv, sphere});
  }
  // door leaves: BVHs over their hinge-space geometry; matrices are read fresh each time
  const doorParts = new Map();
  for (const d of doors) {
    const list = [];
    for (const mesh of d.meshes) {
      const g = mesh.geometry;
      if (!g.index || mesh.material.transparent) continue;
      g.computeBoundingSphere();
      list.push({mesh, g, bvh: new MeshBVH(g, {maxLeafTris: 12}), inv: new THREE.Matrix4(), sphere: new THREE.Sphere()});
    }
    if (list.length) doorParts.set(d.index, list);
  }
  const refresh = p => {
    p.mesh.updateWorldMatrix(true, false);
    p.inv.copy(p.mesh.matrixWorld).invert();
    p.sphere.copy(p.g.boundingSphere).applyMatrix4(p.mesh.matrixWorld);
  };
  const tri = new THREE.Triangle(), n = new THREE.Vector3();
  function test(p, origin, dir, far, best) {
    _ray.origin.copy(origin); _ray.direction.copy(dir);
    if (_ray.distanceSqToPoint(p.sphere.center) > p.sphere.radius ** 2) return best;
    _ray.applyMatrix4(p.inv);
    const hit = p.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
    if (!hit || hit.distance > far || (best && hit.distance >= best.distance)) return best;
    const i = p.g.index, pos = p.g.attributes.position;
    tri.setFromAttributeAndIndices(pos, i.getX(hit.faceIndex * 3), i.getX(hit.faceIndex * 3 + 1), i.getX(hit.faceIndex * 3 + 2));
    tri.getNormal(n).transformDirection(p.mesh.matrixWorld);
    if (n.dot(dir) > 0) n.negate();
    return {point: hit.point.clone().applyMatrix4(p.mesh.matrixWorld), normal: n.clone(), distance: hit.distance, mesh: p.mesh};
  }
  function gatherFrom(list, center, radius, toWorld) {
    const out = [];
    const sphere = new THREE.Sphere();
    for (const p of list) {
      const lp = p.g.boundingSphere;
      if (toWorld) { if (p.sphere.center.distanceTo(center) > p.sphere.radius + radius) continue; sphere.center.copy(center).applyMatrix4(p.inv); }
      else { if (lp.center.distanceTo(center) > lp.radius + radius) continue; sphere.center.copy(center); }
      sphere.radius = radius;
      const pos = p.g.attributes.position, uv1 = p.g.attributes.uv1, idx = p.g.index, nor = p.g.attributes.normal;
      const lit = p.uv1 || new THREE.Vector2();      // something built at runtime borrows a spot of the level's light
      p.bvh.shapecast({
        intersectsBounds: box => box.intersectsSphere(sphere),
        intersectsTriangle: (t, i) => {
          if (!t.intersectsSphere(sphere)) return false;
          const v = [0, 1, 2].map(k => idx.getX(i * 3 + k));
          out.push({
            p: v.map(j => { const q = new THREE.Vector3().fromBufferAttribute(pos, j); return toWorld ? q.applyMatrix4(p.mesh.matrixWorld) : q; }),
            uv: v.map(j => uv1 ? new THREE.Vector2(uv1.getX(j), uv1.getY(j)) : lit.clone()),
            // which way the surface faces (its own normals, so it doesn't depend on winding)
            n: nor ? (() => { const q = new THREE.Vector3(); for (const j of v) q.x += nor.getX(j), q.y += nor.getY(j), q.z += nor.getZ(j);
              q.normalize(); return toWorld ? q.transformDirection(p.mesh.matrixWorld) : q; })() : null,
          });
          return false;
        },
      });
    }
    return out;
  }
  return {
    // nearest hit along a segment: {point, normal (facing the ray), distance, door?} or null.
    // With doors on, a hit on a leaf also says which door and gives the hit in its hinge space.
    raycast(origin, dir, far, withDoors = false) {
      let best = null;
      for (const p of parts) best = test(p, origin, dir, far, best);
      if (withDoors) for (const [k, list] of doorParts) for (const p of list) {
        refresh(p);
        const h = test(p, origin, dir, far, best);
        if (h !== best) { best = h; best.door = k; }
      }
      if (best?.door !== undefined) {
        const m = best.mesh;
        best.local = {point: m.worldToLocal(best.point.clone()), normal: best.normal.clone().transformDirection(_m.copy(m.matrixWorld).invert())};
      }
      return best;
    },
    // every level triangle within `radius` of a point: world positions + lightmap uvs
    gather(center, radius) { return gatherFrom(parts.filter(p => !p.solidOnly), center, radius, true); },
    // every solid triangle within `radius` of a point (runtime-built things too), as a triangle soup for physics
    solidNear(center, radius) {
      const tris = gatherFrom(parts, center, radius, true);
      const vertices = new Float32Array(tris.length * 9), indices = new Uint32Array(tris.length * 3);
      tris.forEach((t, k) => { t.p.forEach((q, j) => { vertices.set([q.x, q.y, q.z], k * 9 + j * 3); indices[k * 3 + j] = k * 3 + j; }); });
      return {vertices, indices};
    },
    // something built at runtime (the lap timer) that stops balls, beams and drops but takes no paint
    addSolid(object) {
      object.updateMatrixWorld(true);
      object.traverse(mesh => {
        if (!mesh.isMesh || mesh.material.transparent || mesh.userData.noHit) return;
        const g = mesh.geometry;
        g.computeBoundingSphere();
        parts.push({mesh, g, bvh: new MeshBVH(g, {maxLeafTris: 12}), inv: mesh.matrixWorld.clone().invert(),
          sphere: g.boundingSphere.clone().applyMatrix4(mesh.matrixWorld), solidOnly: true});
      });
    },
    // something built at runtime (the lap timer) that takes paint like the level does, all but the parts marked
    // userData.noPaint (which still stop balls and sprays); `light` is the level's lightmap spot its paint borrows
    addPaintable(object, light = null) {
      object.updateMatrixWorld(true);
      object.traverse(mesh => {
        if (!mesh.isMesh || mesh.material.transparent || mesh.userData.noHit) return;
        const g = mesh.geometry;
        g.computeBoundingSphere();
        parts.push({mesh, g, bvh: new MeshBVH(g, {maxLeafTris: 12}), inv: mesh.matrixWorld.clone().invert(),
          sphere: g.boundingSphere.clone().applyMatrix4(mesh.matrixWorld), solidOnly: !!mesh.userData.noPaint, uv1: light});
      });
    },
    // where the level's lightmap is at the first level surface along a ray (its uv1), or null
    lightAt(origin, dir, far) {
      let best = null, bp = null, bh = null;
      for (const p of parts) {
        if (p.solidOnly || p.uv1 !== undefined || !p.g.attributes.uv1) continue;
        _ray.origin.copy(origin); _ray.direction.copy(dir);
        if (_ray.distanceSqToPoint(p.sphere.center) > p.sphere.radius ** 2) continue;
        _ray.applyMatrix4(p.inv);
        const h = p.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
        if (h && (!best || h.distance < best)) { best = h.distance; bp = p; bh = h; }
      }
      if (!bh) return null;
      const i = bp.g.index, pos = bp.g.attributes.position, uv = bp.g.attributes.uv1;
      const [a, b, c] = [0, 1, 2].map(k => i.getX(bh.faceIndex * 3 + k));
      return THREE.Triangle.getInterpolation(bh.point, new THREE.Vector3().fromBufferAttribute(pos, a), new THREE.Vector3().fromBufferAttribute(pos, b),
        new THREE.Vector3().fromBufferAttribute(pos, c), new THREE.Vector2().fromBufferAttribute(uv, a), new THREE.Vector2().fromBufferAttribute(uv, b),
        new THREE.Vector2().fromBufferAttribute(uv, c), new THREE.Vector2());
    },
    // the same for one door, in its hinge space (null if there's no such door)
    door(k) {
      const list = doorParts.get(k);
      return list ? {mesh: list[0].mesh, gather: (center, radius) => gatherFrom(list, center, radius, false)} : null;
    },
  };
}

// ------------------------------------------------------- cutting decal meshes
// A decal is a box (half sizes hx, hy, hz) in the frame (right, up, normal) at a point.
// a point part way along a polygon's edge (its place in the throw's frame, lightmap uv and spot on the decal)
const mix = (a, b, t) => ({l: a.l.clone().lerp(b.l, t), uv: a.uv.clone().lerp(b.uv, t), q: a.q.clone().lerp(b.q, t)});

// keep the part of a polygon where fn(l) <= 0 (fn linear in l)
function clipBy(poly, fn) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = fn(a.l), db = fn(b.l);
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) out.push(mix(a, b, da / (da - db)));
  }
  return out;
}
// keep the part where its spot on the decal is inside the decal's rectangle
function clipToDecal(poly, hx, hy) {
  for (const [axis, lim] of [['x', hx], ['y', hy]]) for (const sign of [1, -1]) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = sign * a.q[axis] - lim, db = sign * b.q[axis] - lim;
      if (da <= 0) out.push(a);
      if ((da <= 0) !== (db <= 0)) out.push(mix(a, b, da / (da - db)));
    }
    poly = out;
    if (poly.length < 3) return poly;
  }
  return poly;
}

// Where each surface near the hit lies on the decal, as if the surface were unfolded flat round the face
// that was hit, like paper smoothed over a corner: the face that was hit gets the piece at its true size and
// shape whatever angle it was thrown at, and faces joined to it (round a corner, along the tunnel's curve)
// carry on from it without stretching. Faces it can't reach by its edges (separate things) are mapped
// straight along the throw onto the hit face's plane. Returns triangle -> its three corners on the decal.
function unfold(tris, point, nh, xh, yh, z, seen) {
  const out = new Map();
  const key = p => `${Math.round(p.x * 500)},${Math.round(p.y * 500)},${Math.round(p.z * 500)}`;
  const edges = new Map(), keys = [], facing = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  tris.forEach((t, i) => {
    keys.push(t.p.map(key));
    n.crossVectors(e1.subVectors(t.p[1], t.p[0]), e2.subVectors(t.p[2], t.p[0]));
    const ok = n.lengthSq() > 1e-14;
    if (ok) { n.normalize(); if (t.n ? n.dot(t.n) < 0 : n.dot(z) < 0) n.negate(); }
    facing.push(ok && seen(n, t) >= .03 ? n.clone() : null);
    for (let e = 0; e < 3; e++) {
      const a = keys[i][e], b = keys[i][(e + 1) % 3], ek = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!edges.has(ek)) edges.set(ek, []);
      edges.get(ek).push(i);
    }
  });
  // the face the hit is on
  const tri = new THREE.Triangle(), cp = new THREE.Vector3();
  let start = -1, best = 1e-4;
  tris.forEach((t, i) => {
    if (!facing[i] || facing[i].dot(nh) < .9) return;
    tri.set(t.p[0], t.p[1], t.p[2]).closestPointToPoint(point, cp);
    const d = cp.distanceToSquared(point);
    if (d < best) { best = d; start = i; }
  });
  if (start < 0) return out;
  const flat = p => { const d = _v.copy(p).sub(point); return new THREE.Vector2(d.dot(xh), d.dot(yh)); };
  // each corner gets one spot on the decal, the first way it's reached: faces sharing a corner always meet
  // there, so a surface curved two ways (the tunnel bends round the loop as well as over your head) can't
  // tear or doubles up a bit of the piece where two ways round arrive at slightly different places
  const spot = new Map();
  tris[start].p.forEach((p, k) => spot.set(keys[start][k], flat(p)));
  out.set(tris[start], keys[start].map(k => spot.get(k)));
  const queue = [start];
  const c3 = new THREE.Vector3(), d3 = new THREE.Vector3();
  while (queue.length) {
    const ai = queue.shift(), A = tris[ai], a2 = out.get(A);
    for (let e = 0; e < 3; e++) {
      const i0 = e, i1 = (e + 1) % 3, i2 = (e + 2) % 3;
      const a = keys[ai][i0], b = keys[ai][i1], ek = a < b ? `${a}|${b}` : `${b}|${a}`;
      for (const bi of edges.get(ek)) {
        const B = tris[bi];
        if (bi === ai || out.has(B) || !facing[bi]) continue;
        const j0 = keys[bi].indexOf(a), j1 = keys[bi].indexOf(b);
        if (j0 < 0 || j1 < 0 || j0 === j1) continue;
        const jc = 3 - j0 - j1;
        // B's third corner, laid flat across the shared edge from A's
        d3.subVectors(B.p[j1], B.p[j0]);
        const len = d3.length();
        if (len < 1e-6) continue;
        d3.divideScalar(len);
        c3.subVectors(B.p[jc], B.p[j0]);
        const along = c3.dot(d3), off = c3.addScaledVector(d3, -along).length();
        const A0 = a2[i0], A1 = a2[i1], ed = A1.clone().sub(A0);
        if (ed.lengthSq() < 1e-12) continue;
        ed.normalize();
        const kc = keys[bi][jc];
        if (!spot.has(kc)) {
          const perp = new THREE.Vector2(-ed.y, ed.x), third = a2[i2];
          const side = perp.dot(third.clone().sub(A0)) > 0 ? -1 : 1;
          spot.set(kc, A0.clone().addScaledVector(ed, along).addScaledVector(perp, off * side));
        }
        out.set(B, keys[bi].map(k => spot.get(k)));
        queue.push(bi);
      }
    }
  }
  return out;
}
const polyArea = poly => {
  let a = 0;
  for (let k = 1; k < poly.length - 1; k++)
    a += (poly[k].l.x - poly[0].l.x) * (poly[k + 1].l.y - poly[0].l.y) - (poly[k + 1].l.x - poly[0].l.x) * (poly[k].l.y - poly[0].l.y);
  return Math.abs(a) / 2;
};
const bounds = poly => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
  for (const q of poly) { minX = Math.min(minX, q.l.x); maxX = Math.max(maxX, q.l.x); minY = Math.min(minY, q.l.y); maxY = Math.max(maxY, q.l.y); minZ = Math.min(minZ, q.l.z); }
  return {minX, maxX, minY, maxY, minZ};
};

// Paint is thrown along `dir` (or straight at the surface when there's no direction): every
// surface facing back up that line within the decal's box takes paint, so it wraps round the
// corner it can reach and lands on whatever's around a small object, but never on faces turned
// away (backs, undersides). Like real paint, the first thing in the way takes it: each painted
// face has the exact outline of everything nearer the thrower cut out of it. `back` is how far
// behind the surface that was hit the paint can still reach (round one corner, onto what's around
// a small thing); `front` is how far in front of it things are still close enough to catch some.
const DEPTH_EPS = .015;
// Which surfaces take paint: those within `front`/`back` of the hit surface's plane (so a long wall
// seen at a slant takes the whole tag), and, when `slab` = [behind, ahead] is given, also anything
// within that distance of the hit point along the throw. The second matters when the aim lands on
// something small that stands out from what's around it (a urinal divider, a pipe, a ledge): the tag
// carries on onto the wall behind and beside it instead of stopping a short way from its plane.
// Only what the throw can see gets paint either way: everything in front casts an exact shadow.
// `thrower`, when known, is how far back along the throw the thrower stood: nothing behind the
// nozzle can take paint or block it.
// `apart`: a separate thing standing clear of the surface that was hit, with a gap all round between it and
// that surface (a box in front of a wall, a pipe on standoffs), takes no paint and casts no shadow: the piece
// goes on the wall behind it, the way a sticker would. Something built against the wall (a pillar, a ledge, a
// door frame), touching it somewhere, is part of the wall as far as paint goes and gets wrapped. null turns
// this off (a painting's own space).
const APART = .04, TOUCH = .08;
export function cutDecal(hits, {point, normal, up, width, height, dir = null, front = .15, back = .3, shade = .3, slab = null, thrower = null, apart = APART}) {
  const z = dir ? dir.clone().negate().normalize() : normal.clone().normalize();
  const y = up.clone().addScaledVector(z, -up.dot(z));
  if (y.lengthSq() < 1e-6) y.set(0, 1, 0).addScaledVector(z, -z.y);
  y.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  const hx = width / 2, hy = height / 2, near = front + shade;
  const reach = slab ? Math.max(near, back, slab[0], slab[1] + shade) : Math.max(near, back);
  // the piece's own frame on the surface that was hit (upright as asked, true size there)
  const nh = normal.clone().normalize();
  const yh = up.clone().addScaledVector(nh, -up.dot(nh));
  if (yh.lengthSq() < 1e-6) yh.copy(y).addScaledVector(nh, -y.dot(nh));
  yh.normalize();
  const xh = new THREE.Vector3().crossVectors(yh, nh);
  // (gathered a little wider: an unfolded corner can reach further than the straight-on box)
  const tris = hits.gather(point, Math.hypot(hx, hy, reach) * 1.25);
  // how squarely a face is turned to the thrower: to where they stood when that's known (so the side of a
  // doorway you can see from there takes paint even if the throw itself runs along it), else to the throw
  const eye = thrower !== null ? point.clone().addScaledVector(z, thrower) : null;
  const seen = (n, t) => {
    if (!eye) return n.dot(z);
    const c = _w.copy(t.p[0]).add(t.p[1]).add(t.p[2]).divideScalar(3);
    return n.dot(c.sub(eye).negate().normalize());
  };
  const flatOn = unfold(tris, point, nh, xh, yh, z, seen);
  // Faces it doesn't reach by unfolding (separate things): each spot takes the piece from the unfolded surface
  // right behind it along the throw, so the piece carries straight across them as the thrower sees it.
  // With no unfolded surface behind, straight along the throw onto the hit face's plane.
  const zn = Math.max(.25, z.dot(nh));
  const flatAlong = p => { const d = _v.copy(p).sub(point), s = d.dot(nh) / zn; d.addScaledVector(z, -s); return new THREE.Vector2(d.dot(xh), d.dot(yh)); };
  const CELL = .1, grid = new Map(), behind = [];
  for (const [t, q] of flatOn) {
    const l = t.p.map(p => { const d = _v.copy(p).sub(point); return new THREE.Vector3(d.dot(x), d.dot(y), d.dot(z)); });
    const e = {l, q, minX: Math.min(l[0].x, l[1].x, l[2].x), maxX: Math.max(l[0].x, l[1].x, l[2].x), minY: Math.min(l[0].y, l[1].y, l[2].y), maxY: Math.max(l[0].y, l[1].y, l[2].y)};
    if (e.maxX - e.minX > 4 || e.maxY - e.minY > 4) { behind.push(e); continue; }       // (huge ones: just checked every time)
    for (let gx = Math.floor(e.minX / CELL); gx <= Math.floor(e.maxX / CELL); gx++)
      for (let gy = Math.floor(e.minY / CELL); gy <= Math.floor(e.maxY / CELL); gy++) {
        const k = gx * 100003 + gy;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(e);
      }
  }
  const along = p => {
    const d = _v.copy(p).sub(point), lx = d.dot(x), ly = d.dot(y), lz = d.dot(z);
    let best = null, bestZ = -Infinity;
    for (const e of [...(grid.get(Math.floor(lx / CELL) * 100003 + Math.floor(ly / CELL)) || []), ...behind]) {
      if (lx < e.minX - 1e-6 || lx > e.maxX + 1e-6 || ly < e.minY - 1e-6 || ly > e.maxY + 1e-6) continue;
      const [a, b, c] = e.l, den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(den) < 1e-12) continue;
      const w0 = ((b.y - c.y) * (lx - c.x) + (c.x - b.x) * (ly - c.y)) / den, w1 = ((c.y - a.y) * (lx - c.x) + (a.x - c.x) * (ly - c.y)) / den, w2 = 1 - w0 - w1;
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
      const tz = w0 * a.z + w1 * b.z + w2 * c.z;
      if (tz > lz + .02 || tz <= bestZ) continue;                 // the nearest surface behind it
      bestZ = tz;
      best = new THREE.Vector2(e.q[0].x * w0 + e.q[1].x * w1 + e.q[2].x * w2, e.q[0].y * w0 + e.q[1].y * w1 + e.q[2].y * w2);
    }
    return best || flatAlong(p);
  };
  const local = p => { _v.copy(p).sub(point); return new THREE.Vector3(_v.dot(x), _v.dot(y), _v.dot(z)); };
  // depth measured from the surface that was hit (its plane), along the throw
  const hn = new THREE.Vector3(normal.dot(x), normal.dot(y), normal.dot(z));
  const fromHit = hn.z > .05 ? l => l.z + (hn.x * l.x + hn.y * l.y) / hn.z : l => l.z;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  // the surface that was hit, as unfolded, in the throw's frame: what a separate thing in front might stand clear of
  // (just the faces turned much the same way as the one hit: the wall, not the floor it meets)
  const primary = apart === null ? [] : [...flatOn.keys()].filter(t => {
    const n = new THREE.Vector3().crossVectors(_w.subVectors(t.p[1], t.p[0]), new THREE.Vector3().subVectors(t.p[2], t.p[0])).normalize();
    return Math.abs(n.dot(nh)) > .7;
  }).map(t => {
    const p = t.p.map(local);
    return {p, minX: Math.min(p[0].x, p[1].x, p[2].x), maxX: Math.max(p[0].x, p[1].x, p[2].x), minY: Math.min(p[0].y, p[1].y, p[2].y), maxY: Math.max(p[0].y, p[1].y, p[2].y)};
  });
  // how far in front of the hit surface this spot (in the throw's frame) stands, where that surface is behind it (or null)
  const standOff = l => {
    let best = null;
    for (const {p: [a, b, c], minX, maxX, minY, maxY} of primary) {
      if (l.x < minX - 1e-6 || l.x > maxX + 1e-6 || l.y < minY - 1e-6 || l.y > maxY + 1e-6) continue;
      const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(d) < 1e-12) continue;
      const w0 = ((b.y - c.y) * (l.x - c.x) + (c.x - b.x) * (l.y - c.y)) / d, w1 = ((c.y - a.y) * (l.x - c.x) + (a.x - c.x) * (l.y - c.y)) / d, w2 = 1 - w0 - w1;
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
      const gap = l.z - (w0 * a.z + w1 * b.z + w2 * c.z);
      if (best === null || Math.abs(gap) < Math.abs(best)) best = gap;
    }
    return best;
  };
  // separate things, each whole piece (its triangles joined by shared corners), and whether it stands clear
  const pieceOf = new Map(), members = new Map();
  if (primary.length) {
    const key = p => `${Math.round(p.x * 500)},${Math.round(p.y * 500)},${Math.round(p.z * 500)}`;
    const root = tris.map((_, i) => i), find = i => { while (root[i] !== i) { root[i] = root[root[i]]; i = root[i]; } return i; };
    const at = new Map();
    tris.forEach((t, i) => { for (const p of t.p) { const k = key(p); if (at.has(k)) root[find(i)] = find(at.get(k)); else at.set(k, i); } });
    tris.forEach((t, i) => { const id = find(i); pieceOf.set(t, id); if (!members.has(id)) members.set(id, []); members.get(id).push(t); });
  }
  const clearOf = new Map();
  function standsClear(t) {
    const id = pieceOf.get(t);
    if (clearOf.has(id)) return clearOf.get(id);
    // clear if some of it is well out in front of the wall and none of it comes near the wall
    let out = false, touching = false;
    for (const u of members.get(id)) {
      for (const p of u.p) {
        const g = standOff(local(p));
        if (g === null) continue;
        if (g <= TOUCH) { touching = true; break; }
        if (g > apart) out = true;
      }
      if (touching) break;
    }
    const clear = out && !touching;
    clearOf.set(id, clear);
    return clear;
  }
  // 1. faces that see the thrower, clipped to the box (a deeper box for the ones that only cast shadows)
  const faces = [], occ = [];
  for (const t of tris) {
    const n = new THREE.Vector3().crossVectors(e1.subVectors(t.p[1], t.p[0]), e2.subVectors(t.p[2], t.p[0]));
    if (n.lengthSq() < 1e-14) continue;
    n.normalize();
    if (t.n ? n.dot(t.n) < 0 : n.dot(z) < 0) n.negate();       // the way the surface faces
    const square = n.dot(z), facing = seen(n, t);
    if (facing < .03 && square < .03) continue;              // edge-on or turned away: no paint, no shadow
    const q = flatOn.get(t);
    let poly = t.p.map((p, k) => ({l: local(p), uv: t.uv[k], q: q ? q[k] : along(p)}));
    // a separate thing standing clear in front of the hit surface: left out (unless it's a painting's outline)
    if (!q && !t.noPaint && primary.length && standsClear(t)) continue;
    poly = clipToDecal(poly, hx, hy);
    if (poly.length >= 3 && thrower !== null) poly = clipBy(poly, l => l.z - (thrower - .05));
    if (poly.length < 3) continue;
    const ln = new THREE.Vector3(n.dot(x), n.dot(y), n.dot(z));
    // the parts of it inside the reach (paint) and the slightly deeper reach that only casts shadows
    if (square >= .03) for (const piece of within(poly, near)) {   // (edge-on to the throw: too thin to shadow anything)
      const id = faces.length + occ.length;
      // as a shadow caster: its plane in the box frame, z = cz + gx*x + gy*y
      const a = piece[0].l;
      occ.push({id, src: poly, poly: piece, ...bounds(piece), maxZ: Math.max(...piece.map(q => q.l.z)), gx: -ln.x / ln.z, gy: -ln.y / ln.z, cz: a.z + (ln.x * a.x + ln.y * a.y) / ln.z});
    }
    // (something only standing in the way, like where a painting hung when the paint went on, takes none itself)
    if (!t.noPaint && facing >= .03) for (const piece of within(poly, front)) faces.push({id: -1, poly: piece, n, facing, src: poly});
  }
  // a painted piece mustn't be cut by the caster pieces of its own triangle
  for (const f of faces) f.own = new Set(occ.filter(o => o.src === f.src).map(o => o.id));
  // the reach as convex pieces: the plane window, plus the slab around the hit point outside it
  function within(poly, ahead) {
    const plane = l => fromHit(l), out = [];
    const keep = q => { if (q.length >= 3 && polyArea(q) > 1e-9) out.push(q); };
    let inPlane = clipBy(poly, l => -back - plane(l));
    if (inPlane.length >= 3) inPlane = clipBy(inPlane, l => plane(l) - ahead);
    if (!slab) { keep(inPlane); return out; }
    const [behind, aheadZ] = [slab[0], slab[1] + (ahead - front)];
    let inSlab = clipBy(poly, l => -behind - l.z);
    if (inSlab.length >= 3) inSlab = clipBy(inSlab, l => l.z - aheadZ);
    keep(inSlab);
    // the plane window's parts beyond the slab, either side
    if (inPlane.length >= 3) { keep(clipBy(inPlane, l => l.z - (-behind))); keep(clipBy(inPlane, l => aheadZ - l.z)); }
    return out;
  }
  // 2. cut each painted face by every caster in front of it: subtract the region where the caster
  //    covers it in the throw's view and is nearer the thrower
  const verts = [];
  // only faces almost exactly edge-on to the thrower thin out (the piece isn't stretched on them any more)
  const fade = f => Math.min(1, (f - .03) / .09);
  for (const f of faces) {
    let pieces = [f.poly];
    for (const o of occ) {
      if (f.own.has(o.id)) continue;
      const next = [];
      for (const q of pieces) {
        const b = bounds(q);
        if (o.maxZ < b.minZ + DEPTH_EPS || o.maxX <= b.minX || o.minX >= b.maxX || o.maxY <= b.minY || o.minY >= b.maxY) { next.push(q); continue; }
        // planes are flat, so if the caster isn't in front at any corner it isn't in front anywhere
        if (!q.some(v => o.cz + o.gx * v.l.x + o.gy * v.l.y > v.l.z + DEPTH_EPS)) { next.push(q); continue; }
        // the caster's region: inside each of its edges, and nearer than the face
        const cuts = [];
        const sgn = Math.sign(polySigned(o.poly)) || 1;
        for (let k = 0; k < o.poly.length; k++) {
          const p0 = o.poly[k].l, p1 = o.poly[(k + 1) % o.poly.length].l;
          const ex = p1.x - p0.x, ey = p1.y - p0.y;
          cuts.push(l => -sgn * (ex * (l.y - p0.y) - ey * (l.x - p0.x)));          // <= 0 inside this edge
        }
        cuts.push(l => l.z + DEPTH_EPS - (o.cz + o.gx * l.x + o.gy * l.y));       // <= 0 where the caster is in front
        // only cut when it really covers some of it (otherwise the cuts just chop it up)
        let hid = q;
        for (const c of cuts) { hid = clipBy(hid, c); if (hid.length < 3) break; }
        if (hid.length < 3 || polyArea(hid) < 1e-6) { next.push(q); continue; }
        let rest = q;
        for (const c of cuts) {
          const out = clipBy(rest, l => -c(l));
          if (out.length >= 3 && polyArea(out) > 1e-7) next.push(out);
          rest = clipBy(rest, c);
          if (rest.length < 3) break;
        }
      }
      pieces = next;
      if (!pieces.length || pieces.length > 400) break;
    }
    const k = fade(f.facing);
    for (const poly of pieces) for (let t = 1; t < poly.length - 1; t++) for (const q of [poly[0], poly[t], poly[t + 1]]) {
      verts.push({
        p: point.clone().addScaledVector(x, q.l.x).addScaledVector(y, q.l.y).addScaledVector(z, q.l.z).addScaledVector(f.n, .005),
        u: q.q.x / width + .5, v: q.q.y / height + .5, uv1: q.uv, k,
      });
    }
  }
  return verts;
}
function polySigned(poly) {
  let a = 0;
  for (let k = 1; k < poly.length - 1; k++)
    a += (poly[k].l.x - poly[0].l.x) * (poly[k + 1].l.y - poly[0].l.y) - (poly[k + 1].l.x - poly[0].l.x) * (poly[k].l.y - poly[0].l.y);
  return a;
}

// --------------------------------------------------- growable decal batches
// All marks sharing a texture go into one mesh. Removing a mark collapses its
// triangles; the buffer is repacked when it runs out of room.
export function createBatch(material, capacity = 30000) {
  const geo = new THREE.BufferGeometry();
  const make = () => ({
    pos: new Float32Array(capacity * 3), uv: new Float32Array(capacity * 2), uv1: new Float32Array(capacity * 2),
    col: new Uint8Array(capacity * 4),
  });
  let a = make(), used = 0;
  const marks = [];
  function bind() {
    geo.setAttribute('position', new THREE.BufferAttribute(a.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv1', new THREE.BufferAttribute(a.uv1, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(a.col, 4, true).setUsage(THREE.DynamicDrawUsage));
  }
  bind();
  geo.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  function touch(start, count) {
    for (const name of ['position', 'uv', 'uv1', 'color']) {
      const attr = geo.attributes[name];
      attr.addUpdateRange(start * attr.itemSize, count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
  function write(m, at) {
    m.start = at;
    for (let i = 0; i < m.count; i++) {
      const o = at + i, q = m.verts[i];
      a.pos.set([q.p.x, q.p.y, q.p.z], o * 3); a.uv.set([q.u, q.v], o * 2); a.uv1.set([q.uv1.x, q.uv1.y], o * 2);
      a.col.set([m.rgb[0], m.rgb[1], m.rgb[2], Math.round(255 * (m.alpha ?? 1) * (q.k ?? 1))], o * 4);
    }
  }
  function repack(extra = 0) {
    const live = marks.filter(m => !m.dead);
    marks.length = 0; marks.push(...live);
    while (live.reduce((s, m) => s + m.count, 0) + extra > capacity) capacity *= 2;
    a = make(); used = 0;
    for (const m of live) { write(m, used); used += m.count; }
    bind(); geo.setDrawRange(0, used);
  }
  return {
    mesh,
    add(verts, rgb = [255, 255, 255], alpha = 1) {
      const m = {verts, count: verts.length, rgb, alpha, start: 0, dead: false};
      if (!m.count) return m;
      if (used + m.count > capacity) repack(m.count);
      marks.push(m);
      write(m, used); touch(used, m.count); used += m.count;
      geo.setDrawRange(0, used);
      return m;
    },
    setAlpha(m, alpha) {
      if (m.dead || !m.count) return;
      m.alpha = alpha;
      for (let i = 0; i < m.count; i++) a.col[(m.start + i) * 4 + 3] = Math.round(255 * alpha * (m.verts[i].k ?? 1));
      const attr = geo.attributes.color; attr.addUpdateRange(m.start * 4, m.count * 4); attr.needsUpdate = true;
    },
    remove(m) {
      if (m.dead) return;
      m.dead = true;
      a.pos.fill(0, m.start * 3, (m.start + m.count) * 3);
      touch(m.start, m.count);
    },
    clear() { marks.length = 0; used = 0; geo.setDrawRange(0, 0); },
  };
}

// A level-lit, see-through material for marks (same lightmap hook as the walls).
export function markMaterial(level, map, order) {
  const m = new THREE.MeshBasicMaterial({map, transparent: true, depthWrite: false, vertexColors: true,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -4 - order});
  m.lightMap = level.lightmap;
  m.lightMapIntensity = level.baseIntensity;
  hookShader(m);
  return m;
}

// ------------------------------------------------------------- paint splats
// Eight splat shapes drawn once into a texture: a wet core, ragged lobes,
// flung droplets and the odd streak.
export function splatAtlas() {
  const cell = 128, c = document.createElement('canvas');
  c.width = cell * 4; c.height = cell * 2;
  const g = c.getContext('2d');
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 8; k++) {
    const cx = (k % 4) * cell + cell / 2, cy = Math.floor(k / 4) * cell + cell / 2;
    g.fillStyle = '#fff';
    const r = cell * (.2 + rnd() * .05);
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 9; i++) {                      // ragged lobes around the core
      const a = rnd() * Math.PI * 2, d = r * (.55 + rnd() * .5), rr = r * (.25 + rnd() * .4);
      g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, 0, Math.PI * 2); g.fill();
    }
    const streaks = rnd() < .6 ? 1 + Math.floor(rnd() * 3) : 0;
    for (let i = 0; i < streaks; i++) {                // spatter flung out in one direction
      const a = rnd() * Math.PI * 2, len = r * (1.3 + rnd() * .8);
      for (let t = .5; t < 1; t += .06) {
        const rr = r * .16 * (1.05 - t);
        g.beginPath(); g.arc(cx + Math.cos(a) * len * t, cy + Math.sin(a) * len * t, rr, 0, Math.PI * 2); g.fill();
      }
    }
    for (let i = 0; i < 18; i++) {                     // droplets
      const a = rnd() * Math.PI * 2, d = r * (1.1 + rnd() * 1.1);
      if (d > cell * .47) continue;
      g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + rnd() * 3.2, 0, Math.PI * 2); g.fill();
    }
  }
  // a little sheen variation inside the paint
  const img = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    if (!img.data[i + 3]) continue;
    const s = 225 + Math.floor(Math.random() * 30);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = s;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
export const SPLAT_CELLS = 8;
export const splatCell = seed => [(seed % 4) / 4, Math.floor((seed % 8) / 4) / 2];

// Paint you can load: the rainbow in a light, a true and a deep shade, plus white, grey and black.
export const PAINT_ROWS = [
  ['red', [0xff8f8f, 0xe8232b, 0x8c0f16]],
  ['orange', [0xffbd80, 0xff7a00, 0xa64600]],
  ['yellow', [0xfff28f, 0xffd400, 0xa88c00]],
  ['green', [0x94f094, 0x22c33a, 0x0d6b1f]],
  ['blue', [0x92c8ff, 0x1e6fff, 0x0c308c]],
  ['indigo', [0xaba6ff, 0x4b3cd6, 0x24196e]],
  ['violet', [0xe2a6ff, 0xa83ce8, 0x5b1680]],
  ['white, grey, black', [0xf5f5f0, 0x8a8a8e, 0x1a1a1c]],
];
export const PAINT_COLORS = PAINT_ROWS.flatMap(([, shades]) => shades);
export const RANDOM_PAINT = -1;   // a different colour from the list for every ball
export const rgbOf = c => {
  const col = new THREE.Color(c);   // sRGB hex -> working (linear) colour for vertex colours
  return [Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255)];
};

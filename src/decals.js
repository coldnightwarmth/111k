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
      const pos = p.g.attributes.position, uv1 = p.g.attributes.uv1, idx = p.g.index;
      p.bvh.shapecast({
        intersectsBounds: box => box.intersectsSphere(sphere),
        intersectsTriangle: (t, i) => {
          if (!t.intersectsSphere(sphere)) return false;
          const v = [0, 1, 2].map(k => idx.getX(i * 3 + k));
          out.push({
            p: v.map(j => { const q = new THREE.Vector3().fromBufferAttribute(pos, j); return toWorld ? q.applyMatrix4(p.mesh.matrixWorld) : q; }),
            uv: v.map(j => uv1 ? new THREE.Vector2(uv1.getX(j), uv1.getY(j)) : new THREE.Vector2()),
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
    // the same for one door, in its hinge space (null if there's no such door)
    door(k) {
      const list = doorParts.get(k);
      return list ? {mesh: list[0].mesh, gather: (center, radius) => gatherFrom(list, center, radius, false)} : null;
    },
  };
}

// ------------------------------------------------------- cutting decal meshes
// A decal is a box (half sizes hx, hy, hz) in the frame (right, up, normal) at a point.
function clipPolygon(poly, axis, limit, sign) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = sign * a.l[axis] - limit, db = sign * b.l[axis] - limit;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      out.push({l: a.l.clone().lerp(b.l, t), uv: a.uv.clone().lerp(b.uv, t)});
    }
  }
  return out;
}

export function cutDecal(hits, {point, normal, up, width, height, depth = .18, minFacing = .25}) {
  const z = normal.clone().normalize();
  const y = up.clone().addScaledVector(z, -up.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  const hx = width / 2, hy = height / 2;
  const tris = hits.gather(point, Math.hypot(hx, hy, depth));
  const verts = [];
  const local = p => { _v.copy(p).sub(point); return new THREE.Vector3(_v.dot(x), _v.dot(y), _v.dot(z)); };
  const tn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const t of tris) {
    tn.crossVectors(e1.subVectors(t.p[1], t.p[0]), e2.subVectors(t.p[2], t.p[0])).normalize();
    if (Math.abs(tn.dot(z)) < minFacing) continue;          // walls seen edge-on would smear the image
    let poly = t.p.map((p, k) => ({l: local(p), uv: t.uv[k]}));
    for (const [axis, lim] of [['x', hx], ['y', hy], ['z', depth]]) {
      poly = clipPolygon(poly, axis, lim, 1); if (poly.length < 3) break;
      poly = clipPolygon(poly, axis, lim, -1); if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;
    for (let k = 1; k < poly.length - 1; k++) for (const q of [poly[0], poly[k], poly[k + 1]]) verts.push(q);
  }
  // back to world space, nudged off the surface, with the decal's own uv
  return verts.map(q => ({
    p: point.clone().addScaledVector(x, q.l.x).addScaledVector(y, q.l.y).addScaledVector(z, q.l.z).addScaledVector(normal, .004),
    u: q.l.x / width + .5, v: q.l.y / height + .5, uv1: q.uv,
  }));
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
      a.col.set([m.rgb[0], m.rgb[1], m.rgb[2], Math.round(255 * (m.alpha ?? 1))], o * 4);
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
      const v = Math.round(255 * alpha);
      for (let i = 0; i < m.count; i++) a.col[(m.start + i) * 4 + 3] = v;
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
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 - order});
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

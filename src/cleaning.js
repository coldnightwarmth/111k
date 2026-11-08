// Scrubbing marks off with the bucket and sponge: paint splats, sprayed tags, and the graffiti
// baked into the level. Finds the mark under the crosshair, makes it glow, and wipes it.
import * as THREE from 'three';
import {MeshBVH} from '../vendor/three/three-mesh-bvh.module.js';

const glowTime = {value: 0};
// one per texture, kept: making a fresh one each time the target changes would build a new shader each time
const glows = new Map();
function glowMaterial(map) {
  if (!glows.has(map)) glows.set(map, makeGlow(map));
  return glows.get(map);
}
function makeGlow(map) {
  const m = new THREE.MeshBasicMaterial({map, color: new THREE.Color(1, .8, .2), transparent: true, opacity: .9,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8});
  m.onBeforeCompile = sh => {
    sh.uniforms.glowTime = glowTime;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float glowTime;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n  gl_FragColor.rgb *= 0.65 + 0.35 * sin(glowTime * 5.0);');
  };
  m.customProgramCacheKey = () => 'mark-glow';
  return m;
}

export function createCleaning({level, scene, hits}) {
  // ------------------------------------------------ the level's own graffiti
  // Each page of baked graffiti is one mesh per chunk of the level; split it into pieces by which
  // triangles touch, then join up the parts of one piece that a chunk or seam cut apart: same
  // piece of the atlas, close together.
  const atlas = level.meta.graffiti || [];
  const pieceAt = (page, u, v) => atlas.find(p => `graffiti_${p.page}` === page && u >= Math.min(p.uv[0], p.uv[2]) - 1e-4 && u <= Math.max(p.uv[0], p.uv[2]) + 1e-4
    && v >= Math.min(p.uv[1], p.uv[3]) - 1e-4 && v <= Math.max(p.uv[1], p.uv[3]) + 1e-4);
  const comps = [];                        // {mesh, tris, center, page, piece}
  const original = new Map();              // mesh -> its index as built
  const parts = [];                        // {mesh, bvh, owner: Int32Array tri -> component, inv}
  for (const mesh of level.meshes) {
    if (!/^graffiti_/.test(mesh.material?.name || '') || !mesh.geometry.index) continue;
    const g = mesh.geometry;
    const bvh = new MeshBVH(g, {maxLeafTris: 8});          // (reorders the index: triangles are read after)
    original.set(mesh, g.index.array.slice());               // to put back a piece that was hidden, then isn't
    const idx = g.index, pos = g.attributes.position, tex = g.attributes.uv, triCount = idx.count / 3;
    const parent = Int32Array.from({length: triCount}, (_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const byPoint = new Map();
    for (let t = 0; t < triCount; t++) for (let k = 0; k < 3; k++) {
      const v = idx.getX(t * 3 + k);
      const key = `${Math.round(pos.getX(v) * 500)},${Math.round(pos.getY(v) * 500)},${Math.round(pos.getZ(v) * 500)}`;
      const other = byPoint.get(key);
      if (other === undefined) byPoint.set(key, t); else parent[find(t)] = find(other);
    }
    const groups = new Map();
    for (let t = 0; t < triCount; t++) { const r = find(t); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); }
    mesh.updateMatrixWorld();
    const owner = new Int32Array(triCount), c = new THREE.Vector3(), v = new THREE.Vector3();
    for (const tris of groups.values()) {
      c.set(0, 0, 0); let u = 0, w = 0;
      for (const t of tris) for (let k = 0; k < 3; k++) { const vi = idx.getX(t * 3 + k); c.add(v.fromBufferAttribute(pos, vi)); if (tex) { u += tex.getX(vi); w += tex.getY(vi); } }
      const n = tris.length * 3;
      c.divideScalar(n).applyMatrix4(mesh.matrixWorld);
      for (const t of tris) owner[t] = comps.length;
      comps.push({mesh, tris, center: c.clone(), page: mesh.material.name, piece: tex ? pieceAt(mesh.material.name, u / n, w / n) : null, weight: tris.length});
    }
    parts.push({mesh, bvh, owner, inv: mesh.matrixWorld.clone().invert()});
  }
  // join the parts of each placed piece
  const root = comps.map((_, i) => i);
  const top = i => { while (root[i] !== i) { root[i] = root[root[i]]; i = root[i]; } return i; };
  const byPiece = new Map();
  comps.forEach((c, i) => { if (!c.piece) return; const key = `${c.page}|${c.piece.name}`; if (!byPiece.has(key)) byPiece.set(key, []); byPiece.get(key).push(i); });
  for (const list of byPiece.values()) {
    const reach = Math.max(comps[list[0]].piece.w, comps[list[0]].piece.h) * 1.05;
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++)
      if (comps[list[a]].center.distanceTo(comps[list[b]].center) < reach) root[top(list[a])] = top(list[b]);
  }
  const baked = new Map();                 // id -> {parts: [{mesh, tris}]}
  const compId = new Array(comps.length);
  const sets = new Map();
  comps.forEach((c, i) => { const r = top(i); if (!sets.has(r)) sets.set(r, []); sets.get(r).push(i); });
  for (const members of sets.values()) {
    const c = new THREE.Vector3(); let wsum = 0;
    for (const i of members) { c.addScaledVector(comps[i].center, comps[i].weight); wsum += comps[i].weight; }
    c.divideScalar(wsum);
    const id = `${comps[members[0]].page}:${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}`;
    const entry = baked.get(id) || {parts: [], piece: comps[members[0]].piece?.name || null};
    for (const i of members) { entry.parts.push({mesh: comps[i].mesh, tris: comps[i].tris}); compId[i] = id; }
    baked.set(id, entry);
  }
  const erased = new Set();
  const hidden = new Set();                // ids of placed pieces whose piece was removed at /graffiti
  const collapse = (id, on) => {
    for (const {mesh, tris} of baked.get(id).parts) {
      const idx = mesh.geometry.index, orig = original.get(mesh);
      for (const t of tris) {
        if (on) { const v = idx.getX(t * 3); idx.setX(t * 3 + 1, v); idx.setX(t * 3 + 2, v); }
        else for (let k = 0; k < 3; k++) idx.setX(t * 3 + k, orig[t * 3 + k]);
      }
      idx.needsUpdate = true;
    }
  };

  // ----------------------------------------------------------- picking
  const ray = new THREE.Ray(), tri = new THREE.Triangle(), a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3(), hit = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  // marks: [{kind, id, verts (in its batch's space), batch}] from the game
  // How opaque a texture is at (u, v): a small copy of each texture's alpha, made the first time it's
  // asked about. Only painted pixels count as hitting a piece, so the clear margins of a big tag
  // don't stand in front of the tag you're actually looking at.
  const alphas = new Map();
  function alphaAt(tex, u, v) {
    if (!tex?.image) return 1;
    let m = alphas.get(tex);
    if (m === undefined) {
      m = null;
      const img = tex.image, w = img.width, h = img.height;
      if (w && h) try {
        const s = Math.min(1, 2048 / Math.max(w, h)), W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d', {willReadFrequently: true}); g.drawImage(img, 0, 0, W, H);
        const d = g.getImageData(0, 0, W, H).data, a = new Uint8Array(W * H);
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
        m = {a, W, H};
      } catch { m = null; }
      alphas.set(tex, m);
    }
    if (!m) return 1;
    const x = u - Math.floor(u); let y = v - Math.floor(v);
    if (tex.flipY) y = 1 - y;                                 // glTF textures aren't flipped; canvases are
    const px = Math.min(m.W - 1, Math.floor(x * m.W)), py = Math.min(m.H - 1, Math.floor(y * m.H));
    return m.a[py * m.W + px] / 255;
  }
  const SOLID = .25;
  const uvA = new THREE.Vector2(), uvB = new THREE.Vector2(), uvC = new THREE.Vector2(), uvAt = new THREE.Vector2(), local = new THREE.Vector3();

  // the nearest painted pixel of any piece along the ray, in front of the wall you're looking at
  function pick(origin, dir, far, marks) {
    let best = null;
    const wall = hits.raycast(origin, dir, far, true);
    const limit = (wall ? wall.distance : far) + .06;      // nothing behind the surface you're looking at
    for (const p of parts) {
      ray.set(origin, dir).applyMatrix4(p.inv);
      const g = p.mesh.geometry, idx = g.index, tex = g.attributes.uv, map = p.mesh.material.map;
      for (const h of p.bvh.raycast(ray, THREE.DoubleSide)) {
        const id = compId[p.owner[h.faceIndex]];
        if (erased.has(id) || hidden.has(id)) continue;
        if (tex && map) {
          const [i0, i1, i2] = [0, 1, 2].map(k => idx.getX(h.faceIndex * 3 + k));
          a.fromBufferAttribute(g.attributes.position, i0); b.fromBufferAttribute(g.attributes.position, i1); cc.fromBufferAttribute(g.attributes.position, i2);
          THREE.Triangle.getInterpolation(local.copy(h.point), a, b, cc, uvA.fromBufferAttribute(tex, i0), uvB.fromBufferAttribute(tex, i1), uvC.fromBufferAttribute(tex, i2), uvAt);
          if (alphaAt(map, uvAt.x, uvAt.y) < SOLID) continue;   // a clear bit of the piece: look past it
        }
        const d = h.point.applyMatrix4(p.mesh.matrixWorld).distanceTo(origin);
        if (d < limit && (!best || d < best.distance)) best = {kind: 'baked', id, distance: d};
      }
    }
    for (const mk of marks) {
      if (!mk.verts.length) continue;
      const mw = mk.batch.mesh.matrixWorld, map = mk.batch.mesh.material.map;
      if (!mk.bound) {                                       // a bounding sphere, once
        const pts = mk.verts.map(q => q.p);
        mk.bound = new THREE.Sphere().setFromPoints(pts);
      }
      sphere.copy(mk.bound).applyMatrix4(mw);
      if (!ray.set(origin, dir).intersectsSphere(sphere)) continue;
      for (let i = 0; i + 2 < mk.verts.length; i += 3) {
        const q0 = mk.verts[i], q1 = mk.verts[i + 1], q2 = mk.verts[i + 2];
        tri.set(a.copy(q0.p).applyMatrix4(mw), b.copy(q1.p).applyMatrix4(mw), cc.copy(q2.p).applyMatrix4(mw));
        if (!ray.intersectTriangle(tri.a, tri.b, tri.c, false, hit)) continue;
        const d = hit.distanceTo(origin);
        // pieces on the same wall sit at the same depth: the later one is drawn on top, so it wins a tie
        if (d >= limit || (best && d >= best.distance + .01)) continue;
        if (map) {
          THREE.Triangle.getInterpolation(hit, tri.a, tri.b, tri.c, uvA.set(q0.u, q0.v), uvB.set(q1.u, q1.v), uvC.set(q2.u, q2.v), uvAt);
          if (alphaAt(map, uvAt.x, uvAt.y) < SOLID) continue;
        }
        best = {kind: mk.kind, id: mk.id, distance: d, mark: mk};
      }
    }
    return best;
  }

  // -------------------------------------------------------- highlight
  let glow = null, glowKey = '';
  function clearGlow() { if (glow) { glow.removeFromParent(); glow.geometry.dispose(); glow = null; } glowKey = ''; }
  function highlight(target) {
    const key = target ? `${target.kind}|${target.id}` : '';
    if (key === glowKey) return;
    clearGlow(); glowKey = key;
    if (!target) return;
    const position = [], uv = [];
    let map = null, parent = scene;
    if (target.kind === 'baked') {
      for (const {mesh, tris} of baked.get(target.id).parts) {
        const g = mesh.geometry, pos = g.attributes.position, tex = g.attributes.uv, idx = g.index;
        for (const t of tris) for (let k = 0; k < 3; k++) {
          const vi = idx.getX(t * 3 + k);
          a.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
          position.push(a.x, a.y, a.z); uv.push(tex.getX(vi), tex.getY(vi));
        }
        map = mesh.material.map;
      }
    } else {
      const mk = target.mark;
      for (const q of mk.verts) { position.push(q.p.x, q.p.y, q.p.z); uv.push(q.u, q.v); }
      map = mk.batch.mesh.material.map;
      parent = mk.batch.mesh;                                // rides along on a door
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    glow = new THREE.Mesh(geo, glowMaterial(map));
    glow.renderOrder = 6; glow.frustumCulled = false;
    parent.add(glow);
  }

  return {
    pick,
    highlight,
    tick(dt) { glowTime.value += dt; },
    // wipe a baked piece (it may already be gone)
    eraseBaked(id) {
      if (erased.has(id) || !baked.has(id)) return;
      erased.add(id);
      if (!hidden.has(id)) collapse(id, true);
      if (glowKey === `baked|${id}`) clearGlow();
    },
    // take every placed copy of these pieces off the walls (and put back any no longer listed)
    setHidden(names) {
      for (const [id, entry] of baked) {
        const hide = !!entry.piece && names.has(entry.piece);
        if (hide === hidden.has(id)) continue;
        if (hide) { hidden.add(id); if (!erased.has(id)) collapse(id, true); if (glowKey === `baked|${id}`) clearGlow(); }
        else { hidden.delete(id); if (!erased.has(id)) collapse(id, false); }
      }
    },
    forget(kind, id) { if (glowKey === `${kind}|${id}`) clearGlow(); },
    get pieces() { return baked.size; },
  };
}

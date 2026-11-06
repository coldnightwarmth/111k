// Scrubbing marks off with the bucket and sponge: paint splats, sprayed tags, and the graffiti
// baked into the level. Finds the mark under the crosshair, makes it glow, and wipes it.
import * as THREE from 'three';
import {MeshBVH} from '../vendor/three/three-mesh-bvh.module.js';

const glowTime = {value: 0};
function glowMaterial(map) {
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
  // Each page of baked graffiti is one mesh; split it into pieces by which triangles touch.
  const baked = new Map();                 // id -> {mesh, tris}
  const parts = [];                        // {mesh, bvh, owner: Int32Array tri -> piece index, pieces: [id]}
  for (const mesh of level.meshes) {
    if (!/^graffiti_/.test(mesh.material?.name || '') || !mesh.geometry.index) continue;
    const g = mesh.geometry;
    const bvh = new MeshBVH(g, {maxLeafTris: 8});          // (reorders the index: triangles are read after)
    const idx = g.index, pos = g.attributes.position, triCount = idx.count / 3;
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
    const owner = new Int32Array(triCount), pieces = [], c = new THREE.Vector3(), v = new THREE.Vector3();
    for (const tris of groups.values()) {
      c.set(0, 0, 0);
      for (const t of tris) for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, idx.getX(t * 3 + k)));
      c.divideScalar(tris.length * 3).applyMatrix4(mesh.matrixWorld);
      const id = `${mesh.material.name}:${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}`;
      if (baked.has(id)) { baked.get(id).tris.push(...tris); for (const t of tris) owner[t] = pieces.indexOf(id); continue; }
      for (const t of tris) owner[t] = pieces.length;
      pieces.push(id);
      baked.set(id, {mesh, tris});
    }
    parts.push({mesh, bvh, owner, pieces, inv: mesh.matrixWorld.clone().invert()});
  }
  const erased = new Set();

  // ----------------------------------------------------------- picking
  const ray = new THREE.Ray(), tri = new THREE.Triangle(), a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3(), hit = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  // marks: [{kind, id, verts (in its batch's space), batch}] from the game
  function pick(origin, dir, far, marks) {
    let best = null;
    const wall = hits.raycast(origin, dir, far, true);
    const limit = (wall ? wall.distance : far) + .06;      // nothing behind the surface you're looking at
    for (const p of parts) {
      ray.set(origin, dir).applyMatrix4(p.inv);
      for (const h of p.bvh.raycast(ray, THREE.DoubleSide)) {
        const id = p.pieces[p.owner[h.faceIndex]];
        if (erased.has(id)) continue;
        const d = h.point.applyMatrix4(p.mesh.matrixWorld).distanceTo(origin);
        if (d < limit && (!best || d < best.distance)) best = {kind: 'baked', id, distance: d};
      }
    }
    for (const mk of marks) {
      if (!mk.verts.length) continue;
      const mw = mk.batch.mesh.matrixWorld;
      if (!mk.bound) {                                       // a bounding sphere, once
        const pts = mk.verts.map(q => q.p);
        mk.bound = new THREE.Sphere().setFromPoints(pts);
      }
      sphere.copy(mk.bound).applyMatrix4(mw);
      if (!ray.set(origin, dir).intersectsSphere(sphere)) continue;
      for (let i = 0; i + 2 < mk.verts.length; i += 3) {
        tri.set(a.copy(mk.verts[i].p).applyMatrix4(mw), b.copy(mk.verts[i + 1].p).applyMatrix4(mw), cc.copy(mk.verts[i + 2].p).applyMatrix4(mw));
        if (!ray.intersectTriangle(tri.a, tri.b, tri.c, false, hit)) continue;
        const d = hit.distanceTo(origin);
        if (d < limit && (!best || d < best.distance)) best = {kind: mk.kind, id: mk.id, distance: d, mark: mk};
        break;
      }
    }
    return best;
  }

  // -------------------------------------------------------- highlight
  let glow = null, glowKey = '';
  function clearGlow() { if (glow) { glow.removeFromParent(); glow.geometry.dispose(); glow.material.dispose(); glow = null; } glowKey = ''; }
  function highlight(target) {
    const key = target ? `${target.kind}|${target.id}` : '';
    if (key === glowKey) return;
    clearGlow(); glowKey = key;
    if (!target) return;
    const position = [], uv = [];
    let map = null, parent = scene;
    if (target.kind === 'baked') {
      const {mesh, tris} = baked.get(target.id);
      const g = mesh.geometry, pos = g.attributes.position, tex = g.attributes.uv, idx = g.index;
      for (const t of tris) for (let k = 0; k < 3; k++) {
        const vi = idx.getX(t * 3 + k);
        a.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
        position.push(a.x, a.y, a.z); uv.push(tex.getX(vi), tex.getY(vi));
      }
      map = mesh.material.map;
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
      const {mesh, tris} = baked.get(id), idx = mesh.geometry.index;
      for (const t of tris) { const v = idx.getX(t * 3); idx.setX(t * 3 + 1, v); idx.setX(t * 3 + 2, v); }
      idx.needsUpdate = true;
      if (glowKey === `baked|${id}`) clearGlow();
    },
    forget(kind, id) { if (glowKey === `${kind}|${id}`) clearGlow(); },
    get pieces() { return baked.size; },
  };
}

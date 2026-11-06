// Room doors that swing on their hinges when anyone walks into them. Each
// client simulates them from everyone's positions, so no network traffic.
// A door is a thin leaf from its hinge; bodies push it open either way and it
// drifts on with a little momentum, slowed by friction and the floor.
const BODY = .3;

export function createDoors(level, collider) {
  const doors = [];
  // each door's leaf parts were exported as meshes named "<material>#<1000 + door number>"
  const parts = new Map();
  level.scene.traverse(o => {
    const m = o.isMesh && /#(\d+)$/.exec(o.name);
    if (m && Number(m[1]) >= 1000) {
      const k = Number(m[1]) - 1000;
      if (!parts.has(k)) parts.set(k, []);
      parts.get(k).push(o);
    }
  });
  const legacy = level.meta.doorStyle !== 2;   // levels baked before the handle and pivot fix
  for (const src of level.meta.doors || []) {
    const meshes = parts.get(src.index) || [];
    if (!meshes.length) continue;
    const d = {...src, hinge: [...src.hinge]};
    // re-centre the leaf on its hinge so it can turn
    for (const mesh of meshes) {
      mesh.matrixAutoUpdate = true;
      mesh.geometry = mesh.geometry.clone();
      mesh.geometry.translate(-d.hinge[0], 0, -d.hinge[1]);
    }
    if (legacy) fixLeaf(d, meshes);
    for (const mesh of meshes) { mesh.position.set(d.hinge[0], 0, d.hinge[1]); mesh.rotation.set(0, 0, 0); }
    doors.push({...d, meshes, angle: 0, w: 0, closing: false, lo: (d.closed || 0) - 1.65, hi: (d.closed || 0) + 1.65});
  }
  // Older bakes put the handle on the hinge side and the pivot on the room face of the wall.
  // Mirror each leaf across its width (the hinge knuckles stay put) and move the pivot to mid-frame.
  function fixLeaf(d, meshes) {
    const dx = Math.cos(d.yaw), dz = -Math.sin(d.yaw), half = d.width / 2;          // the leaf as baked (maybe ajar)
    const ux = Math.cos(d.yaw + d.closed), uz = -Math.sin(d.yaw + d.closed);         // the leaf when shut
    let nx = -uz, nz = ux;                                                            // into the room (away from the loop)
    if (nx * d.hinge[0] + nz * d.hinge[1] < 0) { nx = -nx; nz = -nz; }
    const kx = -.01 * ux - .005 * nx, kz = -.01 * uz - .005 * nz;                     // hinge knuckle axis
    let top = 0;
    for (const mesh of meshes) { const p = mesh.geometry.attributes.position; for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i)); }
    // knuckles hug the hinge axis between the leaf's bottom and top edges (the leaf's own corners sit at the edges)
    const knuckle = (x, y, z) => Math.hypot(x - kx, z - kz) < .0135 && y > .15 && y < top - .15;
    for (const mesh of meshes) {
      const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal;
      const moved = new Uint8Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        if (knuckle(x, pos.getY(i), z)) continue;                                      // a knuckle: stays on the hinge
        const along = x * dx + z * dz - half;
        pos.setXYZ(i, x - 2 * along * dx, pos.getY(i), z - 2 * along * dz);
        if (nor) { const nd = nor.getX(i) * dx + nor.getZ(i) * dz; nor.setXYZ(i, nor.getX(i) - 2 * nd * dx, nor.getY(i), nor.getZ(i) - 2 * nd * dz); }
        moved[i] = 1;
      }
      // a mirror turns triangles inside out: flip the mirrored ones back
      const idx = g.index;
      if (idx) for (let t = 0; t < idx.count; t += 3) if (moved[idx.getX(t)]) { const b = idx.getX(t + 1); idx.setX(t + 1, idx.getX(t + 2)); idx.setX(t + 2, b); }
      pos.needsUpdate = true; if (nor) nor.needsUpdate = true; if (idx) idx.needsUpdate = true;
      g.computeBoundingSphere(); g.computeBoundingBox();
    }
    // pivot from the room face to the middle of the frame (the leaf comes with it)
    d.hinge[0] -= nx * .13; d.hinge[1] -= nz * .13;
  }
  const leafDir = (d, a) => { const t = d.yaw + a; return [Math.cos(t), -Math.sin(t)]; };
  // signed distance of a point from the leaf's plane, and how far along the leaf it is
  function measure(d, x, z) {
    const [ux, uz] = leafDir(d, d.angle);
    const rx = x - d.hinge[0], rz = z - d.hinge[1];
    return {along: rx * ux + rz * uz, side: rx * -uz + rz * ux, ux, uz};
  }
  return {
    doors,
    // a body at (x, z) that just moved by (dx, dz)
    push(x, z, dx = 0, dz = 0) {
      for (const d of doors) {
        const m = measure(d, x, z);
        if (m.along < -.05 || m.along > d.width + BODY) continue;
        const reach = BODY + d.thick / 2;
        if (Math.abs(m.side) >= reach) continue;
        const along = Math.max(.15, Math.min(d.width, m.along));
        // swing the leaf just far enough to clear the body, away from the side it's on
        const s = m.side >= 0 ? 1 : -1;
        const turn = s * Math.asin(Math.min(1, (reach - Math.abs(m.side)) / along));   // turning the leaf up its own angle moves it toward -side
        const next = Math.max(d.lo, Math.min(d.hi, d.angle + turn));
        d.closing = false;                              // a shove beats someone pulling it shut
        d.w += (next - d.angle) * 8;
        d.angle = next;
      }
    },
    // keep bodies out of leaves (only matters once a door is against its stop)
    resolve(x, z) {
      for (const d of doors) {
        const m = measure(d, x, z);
        if (m.along < 0 || m.along > d.width) continue;
        const reach = BODY + d.thick / 2;
        if (Math.abs(m.side) >= reach) continue;
        const s = m.side >= 0 ? 1 : -1, push = reach - Math.abs(m.side);
        x += -m.uz * s * push; z += m.ux * s * push;
      }
      return [x, z];
    },
    // swing a door shut (someone clicked it)
    close(index) { const d = doors.find(d => d.index === index); if (d) d.closing = true; },
    isOpen(index) { const d = doors.find(d => d.index === index); return !!d && Math.abs(d.angle - (d.closed || 0)) > .04; },
    update(dt) {
      for (const d of doors) {
        if (d.closing) {                                // eased in like a door closer
          const diff = (d.closed || 0) - d.angle;
          d.w = diff * 5.5;
          if (Math.abs(diff) < .004) { d.angle = d.closed || 0; d.w = 0; d.closing = false; }
        }
        d.angle += d.w * dt;
        d.w *= Math.exp(-dt * 3.2);                    // hinge friction
        if (d.angle < d.lo || d.angle > d.hi) { d.angle = Math.max(d.lo, Math.min(d.hi, d.angle)); d.w *= -.25; }   // bounce off the stop
        for (const m of d.meshes) m.rotation.y = d.angle;
      }
    },
  };
}

// Room doors that swing on their hinges when anyone walks into them. Each
// client simulates them from everyone's positions, so no network traffic.
// A door is a thin leaf from its hinge; bodies push it open either way and it
// drifts on with a little momentum, slowed by friction and the floor.
const BODY = .3;

export function createDoors(level, collider) {
  const doors = [];
  for (const d of level.meta.doors || []) {
    const mesh = level.scene.getObjectByName(d.mesh);
    if (!mesh) continue;
    // re-centre the leaf on its hinge so it can turn
    mesh.matrixAutoUpdate = true;
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.translate(-d.hinge[0], 0, -d.hinge[1]);
    mesh.position.set(d.hinge[0], 0, d.hinge[1]);
    mesh.rotation.set(0, 0, 0);
    doors.push({...d, mesh, angle: d.open || 0, w: 0});
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
        const turn = -s * Math.asin(Math.min(1, (reach - Math.abs(m.side)) / along));
        const lim = d.limit ?? 1.7;
        const next = Math.max(-lim, Math.min(lim, d.angle + turn));
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
    update(dt) {
      for (const d of doors) {
        const lim = d.limit ?? 1.7;
        d.angle += d.w * dt;
        d.w *= Math.exp(-dt * 3.2);                    // hinge friction
        if (Math.abs(d.angle) > lim) { d.angle = Math.sign(d.angle) * lim; d.w *= -.25; }   // bounce off the stop
        d.mesh.rotation.y = d.angle;
      }
    },
  };
}

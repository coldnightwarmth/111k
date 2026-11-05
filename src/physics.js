// 2D (top-down) collision for walking: the player is a circle, the level is
// a set of oriented boxes and circles from the level JSON. Obstacles shorter
// than the step height are ignored so you can walk over litter.
const STEP = .12;

export function createCollider(meta, radius = .38) {
  const boxes = [], circles = [];
  for (const c of meta.colliders) {
    if (c.y1 !== undefined && c.y1 < STEP) continue;
    if (c.y0 !== undefined && c.y0 > 2.2) continue;
    if (c.r !== undefined) circles.push(c);
    else boxes.push({...c, cos: Math.cos(c.yaw || 0), sin: Math.sin(c.yaw || 0)});
  }
  const b = meta.bounds;

  function resolve(x, z) {
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const c of circles) {
        const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), min = c.r + radius;
        if (d < min) {
          const k = d > 1e-6 ? (min - d) / d : 0;
          x += dx * k + (d > 1e-6 ? 0 : min); z += dz * k; moved = true;
        }
      }
      for (const o of boxes) {
        // into box space (yaw rotates local x toward -z, matching the baker)
        const dx = x - o.x, dz = z - o.z;
        const lx = dx * o.cos - dz * o.sin, lz = dx * o.sin + dz * o.cos;
        const cx = Math.max(-o.hx, Math.min(o.hx, lx)), cz = Math.max(-o.hz, Math.min(o.hz, lz));
        let px = lx - cx, pz = lz - cz, d = Math.hypot(px, pz);
        if (d >= radius) continue;
        let nx, nz;
        if (d > 1e-6) { nx = px / d; nz = pz / d; }
        else {
          // centre inside the box: push out along the shallowest axis
          const ox = o.hx - Math.abs(lx), oz = o.hz - Math.abs(lz);
          if (ox < oz) { nx = Math.sign(lx) || 1; nz = 0; d = -ox; } else { nx = 0; nz = Math.sign(lz) || 1; d = -oz; }
        }
        const push = radius - d;
        const wx = nx * o.cos + nz * o.sin, wz = -nx * o.sin + nz * o.cos;
        x += wx * push; z += wz * push; moved = true;
      }
      if (b) { x = Math.max(b.x0 + radius, Math.min(b.x1 - radius, x)); z = Math.max(b.z0 + radius, Math.min(b.z1 - radius, z)); }
      if (!moved) break;
    }
    return [x, z];
  }
  return {resolve};
}

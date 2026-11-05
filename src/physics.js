// 2D (top-down) collision for walking: the player is a circle, the level is
// a set of oriented boxes and circles from the level JSON. Obstacles shorter
// than the step height are ignored so you can walk over litter. Colliders are
// bucketed into a grid so only the ones nearby are tested.
const STEP = .12;
const CELL = 4;

export function createCollider(meta, radius = .38) {
  const grid = new Map();
  const cellKey = (ix, iz) => `${ix},${iz}`;
  for (const c of meta.colliders) {
    if (c.y1 !== undefined && c.y1 < STEP) continue;
    if (c.y0 !== undefined && c.y0 > 2.2) continue;
    const o = c.r !== undefined ? {...c, circle: true}
      : {...c, cos: Math.cos(c.yaw || 0), sin: Math.sin(c.yaw || 0)};
    const reach = (o.circle ? o.r : Math.hypot(o.hx, o.hz)) + radius + .5;
    for (let ix = Math.floor((o.x - reach) / CELL); ix <= Math.floor((o.x + reach) / CELL); ix++)
      for (let iz = Math.floor((o.z - reach) / CELL); iz <= Math.floor((o.z + reach) / CELL); iz++) {
        const k = cellKey(ix, iz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(o);
      }
  }
  const empty = [];
  const b = meta.bounds;

  function resolve(x, z) {
    const near = grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || empty;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const o of near) {
        if (o.circle) {
          const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), min = o.r + radius;
          if (d < min) {
            const k = d > 1e-6 ? (min - d) / d : 0;
            x += dx * k + (d > 1e-6 ? 0 : min); z += dz * k; moved = true;
          }
          continue;
        }
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
  // Distance along a horizontal ray to the first collider at height y (for the
  // third-person camera). Colliders are inflated by `pad` so the camera keeps clear.
  function raycast(x, z, dx, dz, maxT, y, pad = .2) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return maxT;
    dx /= len; dz /= len;
    const seen = new Set();
    let best = maxT;
    for (let t = 0; t <= maxT + CELL; t += CELL / 2) {
      const cell = grid.get(cellKey(Math.floor((x + dx * t) / CELL), Math.floor((z + dz * t) / CELL)));
      if (!cell) continue;
      for (const o of cell) {
        if (seen.has(o)) continue;
        seen.add(o);
        if (o.y1 !== undefined && (y > o.y1 + .05 || y < (o.y0 ?? 0) - .05)) continue;
        if (o.circle) {
          const ox = x - o.x, oz = z - o.z, r = o.r + pad;
          const b = ox * dx + oz * dz, c = ox * ox + oz * oz - r * r;
          const disc = b * b - c;
          if (disc < 0) continue;
          const t0 = -b - Math.sqrt(disc);
          if (t0 > 0 && t0 < best) best = t0;
          continue;
        }
        const ox = x - o.x, oz = z - o.z;
        const lx = ox * o.cos - oz * o.sin, lz = ox * o.sin + oz * o.cos;
        const ldx = dx * o.cos - dz * o.sin, ldz = dx * o.sin + dz * o.cos;
        const hx = o.hx + pad, hz = o.hz + pad;
        if (Math.abs(lx) < hx && Math.abs(lz) < hz) continue;  // starting inside: ignore (the pivot is checked separately)
        let t0 = -Infinity, t1 = Infinity;
        for (const [p, d, h] of [[lx, ldx, hx], [lz, ldz, hz]]) {
          if (Math.abs(d) < 1e-9) { if (Math.abs(p) > h) { t0 = Infinity; break; } continue; }
          let a = (-h - p) / d, b = (h - p) / d;
          if (a > b) [a, b] = [b, a];
          t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        }
        if (t0 <= t1 && t0 > 0 && t0 < best) best = t0;
      }
    }
    return best;
  }
  return {resolve, raycast};
}

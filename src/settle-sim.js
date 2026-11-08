// The physics of src/settle.js, on its own: plain numbers in, plain numbers out, nothing from three.js, so it
// runs the same in the physics worker (src/settle-worker.js) and, if a worker can't be had, on the page.
// job: {level: {vertices, indices}, bodies: [{id, c: [x, y, z] (its middle), q: [x, y, z, w], half: [x, y, z],
//   d (its depth), kind: 'fixed' | 'asleep' | 'awake', vel?}], wake: [ids woken from the start], step, maxTime,
//   every (steps between path frames), friction, bounce, density}
// Returns, for every body that isn't fixed, {id, path: [[x, y, z, qx, qy, qz, qw] of its origin (the middle of
// its back)], t: [x, y, z] (its middle at the end), q: [x, y, z, w]}.
const r = (v, k = 1000) => Math.round(v * k) / k;
// v turned by the quaternion q
function turn(q, x, y, z) {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
}

export function simulate(R, job) {
  const world = new R.World({x: 0, y: -9.81, z: 0});
  world.timestep = job.step;
  world.integrationParameters.normalizedAllowedLinearError = .0002;
  world.integrationParameters.numSolverIterations = 8;
  try {
    const {vertices, indices} = job.level;
    if (indices.length) world.createCollider(R.ColliderDesc.trimesh(vertices, indices).setFriction(job.friction), world.createRigidBody(R.RigidBodyDesc.fixed()));
    const bodies = [], wake = new Set(job.wake || []);
    for (const b of job.bodies) {
      const desc = (b.kind === 'fixed' ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic().setCcdEnabled(true).setSleeping(b.kind === 'asleep')
        .setLinearDamping(.05).setAngularDamping(.2)).setTranslation(...b.c).setRotation({x: b.q[0], y: b.q[1], z: b.q[2], w: b.q[3]});
      if (b.vel) desc.setLinvel(...b.vel);
      const body = world.createRigidBody(desc);
      world.createCollider(R.ColliderDesc.cuboid(...b.half).setFriction(job.friction).setRestitution(job.bounce).setDensity(job.density), body);
      if (b.kind !== 'fixed') bodies.push({id: b.id, body, d: b.d, path: []});
    }
    for (const b of bodies) if (wake.has(b.id)) b.body.wakeUp();
    const frame = b => {
      const t = b.body.translation(), q = b.body.rotation(), qa = [q.x, q.y, q.z, q.w];
      const o = turn(qa, 0, 0, -b.d / 2);
      return [r(o[0] + t.x), r(o[1] + t.y), r(o[2] + t.z), r(q.x, 1e4), r(q.y, 1e4), r(q.z, 1e4), r(q.w, 1e4)];
    };
    for (const b of bodies) b.path.push(frame(b));
    const steps = Math.round(job.maxTime / job.step);
    for (let k = 1; k <= steps; k++) {
      world.step();
      if (k % job.every === 0) for (const b of bodies) b.path.push(frame(b));
      if (k > 6 && bodies.every(b => b.body.isSleeping())) { if (k % job.every) for (const b of bodies) b.path.push(frame(b)); break; }
    }
    return bodies.map(b => {
      const t = b.body.translation(), q = b.body.rotation();
      return {id: b.id, path: b.path, t: [t.x, t.y, t.z], q: [q.x, q.y, q.z, q.w]};
    });
  } finally {
    world.free();
  }
}

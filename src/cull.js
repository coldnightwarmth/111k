// What can't possibly be seen from where the camera is, so isn't drawn at all (on top of three's own culling of
// what's outside the view). The space is a ring of tunnel with rooms off its outer wall, each reached only
// through its doorway, so two cheap tests cover most of it:
//  - round the ring: the tunnel's inner wall hides anything more than about 66 degrees round the loop from you
//    (from anywhere in the tunnel or a room, nothing further round can be in sight), so beyond ANGLE it goes;
//  - rooms: a room's insides can only be seen through its doorway. From the tunnel, a room whose doorway isn't
//    in the view is skipped; from inside a room, everything outside it is skipped unless its own doorway is in
//    the view (and then other rooms only if their doorways are too).
// Conservative by design: something is only skipped when it can't be seen. (Checked by rendering the same
// views with and without it, pixel for pixel: tools/ notes in README.)
import * as THREE from 'three';

const ANGLE = 80 * Math.PI / 180;        // round the loop from the camera: past this, nothing's in sight
const XF = Math.sqrt(3.3 ** 2 - 2 ** 2), VD = XF + 1.15;   // tunnel floor half-width; the rooms' door walls (tools/build_world.py)
const PORTAL_Y = 1.45, PORTAL_R = 1.9;   // a sphere round each doorway (1.6 m wide, 2.9 m high, through the lining)
const TAU = 2 * Math.PI;
const turn = d => Math.abs(d - TAU * Math.round(d / TAU));   // an angle's size, wrapped to [0, pi]
export const MIXED = -2;                 // a room for things that are partly in the tunnel and partly in rooms

export function createCuller(meta) {
  const RL = meta.loop.radius, angles = meta.loop.doors.map(d => d.angle), n = angles.length;
  const portals = angles.map(a => new THREE.Sphere(new THREE.Vector3((RL + VD) * Math.cos(a), PORTAL_Y, -(RL + VD) * Math.sin(a)), PORTAL_R));
  const inView = new Array(n).fill(true);
  const frustum = new THREE.Frustum(), _m = new THREE.Matrix4(), _p = new THREE.Vector3();
  let camRoom = -1, camAngle = 0, enabled = true;
  const angleOf = (x, z) => Math.atan2(-z, x);
  // the room a point is in (beyond its door wall), or -1 for the tunnel and the passages to the rooms
  function roomOf(x, z, inset = -.05) {
    if (Math.hypot(x, z) - RL < VD + inset) return -1;
    const a = angleOf(x, z);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) { const d = turn(a - angles[i]); if (d < bestD) { best = i; bestD = d; } }
    return best;
  }
  return {
    roomOf,
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; },
    // once a frame, once the camera's placed
    update(camera) {
      camera.updateMatrixWorld();
      camera.getWorldPosition(_p);
      camAngle = angleOf(_p.x, _p.z);
      camRoom = roomOf(_p.x, _p.z, .1);
      frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      for (let i = 0; i < n; i++) inView[i] = frustum.intersectsSphere(portals[i]);
    },
    // could something at (x, z), `radius` across, in `room` (roomOf, worked out once for things that don't move;
    // MIXED for things that span tunnel and rooms, which go by the angle alone) be in sight?
    visible(x, z, radius = 0, room = roomOf(x, z)) {
      if (!enabled) return true;
      const r = Math.hypot(x, z) || 1;
      if (turn(angleOf(x, z) - camAngle) - Math.min(Math.PI, radius / r) > ANGLE) return false;
      if (room === MIXED) return true;
      if (camRoom >= 0) {
        if (room === camRoom) return true;
        if (!inView[camRoom]) return false;
      }
      return room < 0 || inView[room];
    },
  };
}

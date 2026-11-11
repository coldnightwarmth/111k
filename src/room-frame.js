// A room's own frame, as the level builder (tools/build_world.py, room_frame) lays rooms out round the loop:
// x across the room (-3.5..3.5), z from the door wall (-3) to the back wall (3), y up from the floor.
// Shared by the client and the server (no three.js here).
const RL = 38, XF = Math.sqrt(3.3 ** 2 - 2 ** 2), VD = XF + 1.15, ROOM_C = VD + 3.2;

// room i (0-19, sign B-(i+1)) with its door offset (the builder's, rounded: rng(100 + i).uniform(-1.8, 1.8))
export function roomFrame(i, doorX) {
  const a = 2 * Math.PI * i / 20, C = Math.cos(a), S = Math.sin(a);
  const yaw = Math.atan2(C, -S), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ox = (RL + ROOM_C) * C + doorX * S, oz = -(RL + ROOM_C) * S + doorX * C;
  return {
    yaw,
    // room (x, z) to the world's
    toWorld: (x, z) => ({x: ox + cy * x + sy * z, z: oz - sy * x + cy * z}),
    // the world's (x, z) to the room's
    toRoom: (x, z) => { const dx = x - ox, dz = z - oz; return {x: cy * dx - sy * dz, z: sy * dx + cy * dz}; },
  };
}
// the feature rooms' door offsets
export const DOOR_X = {3: -.67, 9: .16, 19: 1.64};

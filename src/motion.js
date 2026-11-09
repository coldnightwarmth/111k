// Locomotion constants and helpers shared by the local player and remote peers.
// Ported from the cards.art showroom so movement feels the same.
export const EYE_HEIGHT = 1.45;
export const CROUCH_DEPTH = .26;
export const JUMP_DURATION = 1.1;
export const JUMP_TAKEOFF = .14;
export const JUMP_FLIGHT = 2 / 3;
export const MAX_HOP_POWER = 1.42;
const LANDED = JUMP_TAKEOFF + JUMP_FLIGHT;
const JUMP_PEAK = 2 / 3;       // the most a power-1 jump lifts the feet (jumpHeight at the top)
const HOP_WINDOW = .13;
const HOP_GAIN = 1.15;         // each clean hop: 15% faster than you already were        // press this close to touchdown (either side) for a clean hop
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function jumpHeight(time, power = 1) {
  const flight = time - JUMP_TAKEOFF;
  return flight > 0 && flight < JUMP_FLIGHT ? (power || 1) * (4 * flight - 6 * flight * flight) : 0;
}

// Jumps can chain the moment you touch down. Pressing right at touchdown (or
// just before it: the press is remembered) skips the wind-up and each clean
// hop carries a little more speed (without limit) and goes a little higher (up to a cap).
export function createVerticalMovement() {
  let crouch = 0, jumpTime = -1, power = 1, chain = 0, queued = -1, grounded = 0, hopped = false;
  let falling = false, pressedAt = -1, clock = 0;   // dropping off a ledge (not part of a jump)
  let room = Infinity;   // how far the feet may rise before the eye meets the ceiling (setHeadroom)
  let aloft = false;     // jumped off an edge: the arc ends in mid-air, so a hop waits for the ground (setAloft)
  function launch(clean) {
    chain = clean ? chain + 1 : 0;                                    // no cap: keep hopping, keep speeding up
    power = clean ? Math.min(MAX_HOP_POWER, 1 + .07 * chain) : 1;     // but the height tops out
    power = Math.min(power, Math.max(.05, room / JUMP_PEAK));             // and stays under the ceiling
    jumpTime = clean ? JUMP_TAKEOFF : 0;     // a clean hop leaves straight away
    grounded = 0; queued = -1; hopped = clean;
  }
  return {
    get pose() { return {crouch, jumpTime, jumpPower: power}; },
    // a low ceiling overhead (on a crate stack): jumps from here rise no further than this
    setHeadroom(lift) { room = lift; },
    setAloft(on) { aloft = on; },
    get chain() { return chain; },
    // horizontal speed multiplier earned by chaining clean hops
    // compounding, so every hop feels as big as the first, however fast you're already going
    get boost() { return HOP_GAIN ** chain; },
    // ran into something at speed: the run is over (even if the next hop is timed perfectly)
    crash() { chain = 0; queued = -1; },
    // seconds since the feet touched down (-1 while in the air)
    get landedFor() { return falling || (jumpTime >= 0 && jumpTime < LANDED) ? -1 : grounded; },
    // how high the jump has lifted the feet right now, and whether they're on the way down
    get lift() { return jumpHeight(jumpTime, power); },
    get descending() { return jumpTime >= JUMP_TAKEOFF + JUMP_FLIGHT / 2 && jumpTime < LANDED; },
    // the feet met something on the way down (a crate, a desk): the jump ends here
    touchdown() { if (jumpTime >= JUMP_TAKEOFF && jumpTime < LANDED) jumpTime = LANDED; },
    // walking off an edge; a press just before the drop ends counts as a hop
    setFalling(on) {
      if (falling && !on && pressedAt >= 0 && clock - pressedAt < HOP_WINDOW) { falling = false; pressedAt = -1; grounded = 0; launch(true); return; }
      falling = on; if (!on) pressedAt = -1;
    },
    // true once per clean hop, so the caller can add a forward shove
    takeHop() { const h = hopped; hopped = false; return h; },
    jump() {
      if (falling && (jumpTime < 0 || jumpTime >= LANDED)) { pressedAt = clock; return true; }
      if (jumpTime < 0) { launch(false); return true; }
      if (jumpTime >= LANDED && aloft) { pressedAt = clock; return true; }
      if (jumpTime >= LANDED) { launch(jumpTime - LANDED < HOP_WINDOW); return true; }
      if (jumpTime >= LANDED - HOP_WINDOW) { queued = jumpTime; return true; }
      return false;
    },
    // a hit: a small involuntary hop that breaks any chain
    bump() { if (jumpTime < 0 || jumpTime >= LANDED) { chain = 0; power = .8; jumpTime = JUMP_TAKEOFF; grounded = 0; } },
    update(dt, duck) {
      dt = clamp(dt, 0, .1);
      clock += dt;
      if (jumpTime >= 0) {
        jumpTime += dt;
        if (queued >= 0 && jumpTime >= LANDED && (aloft || falling)) { pressedAt = clock; queued = -1; }   // hop once down
        else if (queued >= 0 && jumpTime >= LANDED) launch(true);
        else if (jumpTime >= JUMP_DURATION) jumpTime = -1;
      }
      if (!falling && (jumpTime < 0 || jumpTime >= LANDED)) {
        grounded += dt;
        if (grounded > .3 && chain) chain = 0;   // standing around ends the run
      }
      crouch += ((duck && jumpTime < 0 ? 1 : 0) - crouch) * (1 - Math.exp(-dt * 12));
      return this.eye;
    },
    // eye height above the feet's ground right now (read again after a touchdown changes the jump)
    get eye() {
      const anticipation = jumpTime >= 0 && jumpTime < JUMP_TAKEOFF ? .07 * Math.sin(Math.PI * jumpTime / JUMP_TAKEOFF) : 0;
      const landing = jumpTime > LANDED
        ? .09 * Math.sin(Math.PI * (jumpTime - LANDED) / (JUMP_DURATION - LANDED)) : 0;
      return EYE_HEIGHT + jumpHeight(jumpTime, power) - crouch * CROUCH_DEPTH - anticipation - landing;
    },
  };
}

const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// Render a short distance behind the latest stream so normal packet jitter
// does not become visible acceleration/deceleration. Predict at most 80 ms.
export function createPoseBuffer({delay = 85, maxPrediction = 80} = {}) {
  let samples = [], clockOffset = Infinity;
  return {
    push(pose, receivedAt, serverAt = receivedAt) {
      const previous = samples.at(-1);
      if (previous && serverAt <= previous.time) return;
      const jump = previous && Math.hypot(pose.x - previous.pose.x, pose.y - previous.pose.y, pose.z - previous.pose.z) > 4;
      if (jump) { samples = []; clockOffset = Infinity; }
      clockOffset = Math.min(clockOffset, receivedAt - serverAt);
      samples.push({pose: {...pose}, time: serverAt}); if (samples.length > 12) samples.shift();
    },
    sample(now) {
      if (!samples.length) return null;
      const time = now - clockOffset - delay;
      if (samples.length === 1 || time <= samples[0].time) return {...samples[0].pose};
      let a = samples[0], b = samples[1];
      for (let i = 1; i < samples.length; i++) { a = samples[i - 1]; b = samples[i]; if (b.time >= time) break; }
      const duration = Math.max(1, b.time - a.time);
      // A long pause indicates idle motion, not a useful velocity estimate.
      const future = duration > 250 ? 0 : Math.min(maxPrediction, Math.max(0, time - b.time));
      const t = time > b.time ? 1 + future / duration : (time - a.time) / duration;
      const result = {...b.pose};
      for (const key of ['x', 'y', 'z', 'pitch']) result[key] = a.pose[key] + (b.pose[key] - a.pose[key]) * t;
      result.g = (a.pose.g || 0) + ((b.pose.g || 0) - (a.pose.g || 0)) * Math.min(t, 1);
      result.crouch = (a.pose.crouch || 0) + ((b.pose.crouch || 0) - (a.pose.crouch || 0)) * Math.min(t, 1);
      result.jumpTime = b.pose.jumpTime ?? -1;
      result.jumpPower = b.pose.jumpPower || 1;
      // Do not blend unrelated emotes or interpolate backward when one restarts.
      if (b.pose.emote && a.pose.emote === b.pose.emote && b.pose.emoteTime >= a.pose.emoteTime)
        result.emoteTime = a.pose.emoteTime + (b.pose.emoteTime - a.pose.emoteTime) * t;   // (loops run on: no cap)
      if (a.pose.jumpTime >= 0 && b.pose.jumpTime >= a.pose.jumpTime)
        result.jumpTime = Math.min(1.1, a.pose.jumpTime + (b.pose.jumpTime - a.pose.jumpTime) * t);
      result.yaw = a.pose.yaw + angleDelta(a.pose.yaw, b.pose.yaw) * t;
      return result;
    },
  };
}

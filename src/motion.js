// Locomotion constants and helpers shared by the local player and remote peers.
// Ported from the cards.art showroom so movement feels the same.
export const EYE_HEIGHT = 1.65;
export const CROUCH_DEPTH = .29;
export const JUMP_DURATION = 1.1;
export const JUMP_TAKEOFF = .14;
export const JUMP_FLIGHT = 2 / 3;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function jumpHeight(time) {
  const flight = time - JUMP_TAKEOFF;
  return flight > 0 && flight < JUMP_FLIGHT ? 4 * flight - 6 * flight * flight : 0;
}

export function createVerticalMovement() {
  let crouch = 0, jumpTime = -1;
  return {
    get pose() { return {crouch, jumpTime}; },
    jump() { if (jumpTime >= 0) return false; jumpTime = 0; return true; },
    update(dt, duck) {
      dt = clamp(dt, 0, .1);
      if (jumpTime >= 0) { jumpTime += dt; if (jumpTime >= JUMP_DURATION) jumpTime = -1; }
      crouch += ((duck && jumpTime < 0 ? 1 : 0) - crouch) * (1 - Math.exp(-dt * 12));
      const anticipation = jumpTime >= 0 && jumpTime < JUMP_TAKEOFF ? .075 * Math.sin(Math.PI * jumpTime / JUMP_TAKEOFF) : 0;
      const landing = jumpTime > JUMP_TAKEOFF + JUMP_FLIGHT
        ? .10 * Math.sin(Math.PI * (jumpTime - JUMP_TAKEOFF - JUMP_FLIGHT) / (JUMP_DURATION - JUMP_TAKEOFF - JUMP_FLIGHT)) : 0;
      return EYE_HEIGHT + jumpHeight(jumpTime) - crouch * CROUCH_DEPTH - anticipation - landing;
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
      result.crouch = (a.pose.crouch || 0) + ((b.pose.crouch || 0) - (a.pose.crouch || 0)) * Math.min(t, 1);
      result.jumpTime = b.pose.jumpTime ?? -1;
      // Do not blend unrelated emotes or interpolate backward when one restarts.
      if (b.pose.emote && a.pose.emote === b.pose.emote && b.pose.emoteTime >= a.pose.emoteTime)
        result.emoteTime = Math.min(2, a.pose.emoteTime + (b.pose.emoteTime - a.pose.emoteTime) * t);
      if (a.pose.jumpTime >= 0 && b.pose.jumpTime >= a.pose.jumpTime)
        result.jumpTime = Math.min(1.1, a.pose.jumpTime + (b.pose.jumpTime - a.pose.jumpTime) * t);
      result.yaw = a.pose.yaw + angleDelta(a.pose.yaw, b.pose.yaw) * t;
      return result;
    },
  };
}

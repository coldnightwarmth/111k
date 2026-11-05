// Room logic shared by the Cloudflare Durable Object (production) and the
// local dev server. It is deliberately stateless: each player's record lives
// with their socket (a hibernation "attachment" in Cloudflare), so the room
// survives the Durable Object being evicted from memory between messages.
import {CHAT_INTERVAL_MS, CHAT_TTL_MS, POSE_INTERVAL_MS, sanitizeChat, sanitizePose, samePose} from '../src/protocol.js';

export function newPlayer(id, now) {
  return {id, pose: null, lastPose: 0, lastChat: 0, lastActive: now, inactive: false};
}

export function snapshot(players, now) {
  return {type: 'state', now, players: players.filter(p => p && !p.inactive && p.pose).map(p => ({id: p.id, pose: p.pose}))};
}

// Returns a list of outgoing messages: {to: 'all' | 'self', msg} and whether the record changed.
export function handleMessage(player, data, now) {
  const out = [];
  if (typeof data !== 'string' || data.length > 4096) return {out, changed: false, close: 'Message too large'};
  let m;
  try { m = JSON.parse(data); } catch { return {out, changed: false}; }
  if (!m || typeof m !== 'object') return {out, changed: false};

  if (m.type === 'pose') {
    if (now - player.lastPose < POSE_INTERVAL_MS) return {out, changed: false};
    const pose = sanitizePose(m.pose);
    if (!pose) return {out, changed: false};
    const moved = !samePose(pose, player.pose);
    const returning = player.inactive;
    player.pose = pose; player.lastPose = now;
    if (moved) { player.lastActive = now; player.inactive = false; }
    if (player.inactive) return {out, changed: true};
    out.push({to: 'all', msg: {type: 'pose', id: player.id, pose, time: now}});
    return {out, changed: true, returning};
  }
  if (m.type === 'chat') {
    if (now - player.lastChat < CHAT_INTERVAL_MS) return {out, changed: false};
    const text = sanitizeChat(m.text);
    if (!text) return {out, changed: false};
    player.lastChat = now; player.lastActive = now;
    const returning = player.inactive; player.inactive = false;
    out.push({to: 'all', msg: {type: 'chat', id: player.id, text, time: now, expiresAt: now + CHAT_TTL_MS}});
    return {out, changed: true, returning};
  }
  if (m.type === 'activity') {
    const returning = player.inactive;
    player.lastActive = now; player.inactive = false;
    return {out, changed: true, returning};
  }
  return {out, changed: false};
}

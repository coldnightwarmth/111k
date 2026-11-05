// Room logic shared by the Cloudflare Durable Object (production) and the
// local dev server. Each player's record lives with their socket (a
// hibernation "attachment" in Cloudflare), so the room survives the Durable
// Object being evicted between messages. The only shared state is the held
// items, which the caller keeps (Durable Object storage in production).
import {CHAT_INTERVAL_MS, CHAT_TTL_MS, POSE_INTERVAL_MS, PICKUP_RANGE, PUNCH_RANGE, PUNCH_COOLDOWN_MS,
  sanitizeChat, sanitizePose, samePose, cleanItem} from '../src/protocol.js';
import {ITEM_SPAWNS} from '../src/world-items.js';

export function newPlayer(id, now) {
  return {id, pose: null, lastPose: 0, lastChat: 0, lastActive: now, lastPunch: 0, inactive: false};
}

// Items start where the level put them; a stored set from an older level is replaced.
export function freshItems() {
  return Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, cleanItem({...s, holder: null, on: false})]));
}
export function validItems(stored) {
  if (!stored || typeof stored !== 'object') return freshItems();
  const ids = Object.keys(stored).sort().join(), want = ITEM_SPAWNS.map(s => s.id).sort().join();
  return ids === want ? stored : freshItems();
}

export function snapshot(players, now, items = {}) {
  return {type: 'state', now, players: players.filter(p => p && !p.inactive && p.pose).map(p => ({id: p.id, pose: p.pose})),
    items: Object.values(items)};
}

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Put an item down where a player stands (or stood).
function dropAt(item, pose, dx = 0, dz = 0) {
  item.holder = null;
  item.x = pose.x + dx; item.z = pose.z + dz; item.y = .03;
  item.yaw = pose.yaw || 0;
}

// Drop whatever this player holds (they left, went idle, or got punched).
export function releaseItems(items, player) {
  const out = [];
  for (const it of Object.values(items)) {
    if (it.holder !== player.id) continue;
    dropAt(it, player.pose || it, 0, 0);
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(it)}});
  }
  return out;
}

// Returns {out: [{to: 'all' | 'self' | <player id>, msg}], changed, itemsChanged, returning, close}.
// room: {items, players: () => [player records]}
export function handleMessage(player, data, now, room = {items: {}, players: () => []}) {
  const out = [];
  if (typeof data !== 'string' || data.length > 4096) return {out, changed: false, close: 'Message too large'};
  let m;
  try { m = JSON.parse(data); } catch { return {out, changed: false}; }
  if (!m || typeof m !== 'object') return {out, changed: false};
  const items = room.items || {};

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

  // ---------------------------------------------------------------- items
  const item = typeof m.id === 'string' ? items[m.id] : null;
  if (m.type === 'pickup') {
    if (!item || item.holder || !player.pose || player.inactive) return {out, changed: false};
    if (Object.values(items).some(it => it.holder === player.id)) return {out, changed: false};
    if (flat(player.pose, item) > PICKUP_RANGE) return {out, changed: false};
    item.holder = player.id; player.lastActive = now;
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(item)}});
    return {out, changed: true, itemsChanged: true};
  }
  if (m.type === 'drop') {
    if (!item || item.holder !== player.id || !player.pose) return {out, changed: false};
    // dropped in front of the player, never more than a step away
    let dx = Number(m.x) - player.pose.x, dz = Number(m.z) - player.pose.z;
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) { dx = 0; dz = 0; }
    const d = Math.hypot(dx, dz);
    if (d > 1.2) { dx *= 1.2 / d; dz *= 1.2 / d; }
    dropAt(item, player.pose, dx, dz);
    if (Number.isFinite(m.yaw)) item.yaw = Math.round(m.yaw * 1000) / 1000;
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(item)}});
    return {out, changed: true, itemsChanged: true};
  }
  if (m.type === 'toggle') {
    if (!item || item.holder !== player.id) return {out, changed: false};
    item.on = m.on === true;
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(item)}});
    return {out, changed: false, itemsChanged: true};
  }
  if (m.type === 'punch') {
    if (now - player.lastPunch < PUNCH_COOLDOWN_MS || !player.pose) return {out, changed: false};
    player.lastPunch = now; player.lastActive = now;
    const target = room.players().find(p => p && p.id === m.target && p.pose && !p.inactive);
    if (!target || target.id === player.id || flat(player.pose, target.pose) > PUNCH_RANGE) return {out, changed: true};
    const dx = target.pose.x - player.pose.x, dz = target.pose.z - player.pose.z, len = Math.hypot(dx, dz) || 1;
    out.push({to: 'all', msg: {type: 'punch', from: player.id, target: target.id, dir: [dx / len, dz / len], time: now}});
    const dropped = releaseItems(items, target);
    out.push(...dropped);
    return {out, changed: true, itemsChanged: dropped.length > 0};
  }
  return {out, changed: false};
}

// Room logic shared by the Cloudflare Durable Object (production) and the
// local dev server. Each player's record lives with their socket (a
// hibernation "attachment" in Cloudflare), so the room survives the Durable
// Object being evicted between messages. The only shared state is the held
// items, which the caller keeps (Durable Object storage in production).
import {CHAT_INTERVAL_MS, CHAT_TTL_MS, POSE_INTERVAL_MS, PICKUP_RANGE, PUNCH_RANGE, PUNCH_COOLDOWN_MS,
  SHOT_INTERVAL_MS, SPRAY_INTERVAL_MS, SPRAY_RANGE, MAX_SPLATS, MAX_SPRAYS, SPLAT_LIFE_MS,
  sanitizeChat, sanitizePose, samePose, cleanItem, sanitizeLook, sanitizeName, cleanSplat, cleanSpray} from '../src/protocol.js';
import {ITEM_SPAWNS} from '../src/world-items.js';
import {RACE_LAPS, RACE_TIMEOUT_MS, BUTTON, BUTTON_RANGE, MACHINE, LAP_ZONE, LAP_SLACK, loopAngle, freshRace, publicRace} from '../src/race.js';

export function newPlayer(id, now) {
  return {id, pose: null, lastPose: 0, lastChat: 0, lastActive: now, lastPunch: 0, lastShot: 0, lastSpray: 0,
    inactive: false, look: null, name: ''};
}

// Items start where the level put them; a stored set from an older level is replaced.
export function freshItems() {
  return Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, cleanItem({...s, holder: null, on: s.on === true})]));
}
// everything where it started (and lit the way it started)?
export function itemsAtSpawn(items) {
  const fresh = freshItems();
  return Object.keys(fresh).every(id => JSON.stringify(items[id]) === JSON.stringify(fresh[id]));
}
export function validItems(stored) {
  if (!stored || typeof stored !== 'object') return freshItems();
  const ids = Object.keys(stored).sort().join(), want = ITEM_SPAWNS.map(s => s.id).sort().join();
  return ids === want ? stored : freshItems();
}

export function snapshot(players, now, items = {}) {
  return {type: 'state', now, players: players.filter(p => p && !p.inactive && p.pose).map(p => ({id: p.id, pose: p.pose, look: p.look})),
    items: Object.values(items)};
}

// Paint and sprayed pieces stay on the walls; the oldest go when there are too many.
export function freshMarks() { return {splats: [], sprays: []}; }
export function validMarks(stored) {
  if (!stored || !Array.isArray(stored.splats) || !Array.isArray(stored.sprays)) return freshMarks();
  const splats = stored.splats.map(s => { const c = cleanSplat(s); return c && Number.isFinite(s.at) ? {...c, at: s.at} : null; });
  return {splats: splats.filter(Boolean).slice(-MAX_SPLATS),
    sprays: stored.sprays.map(cleanSpray).filter(Boolean).slice(-MAX_SPRAYS)};
}
// paint lasts a minute; sprayed pieces stay
export function pruneSplats(marks, now) {
  const before = marks.splats.length;
  marks.splats = marks.splats.filter(s => now - s.at < SPLAT_LIFE_MS);
  return marks.splats.length !== before;
}
export const marksMessage = (marks, now = Date.now()) => ({type: 'marks',
  splats: marks.splats.filter(s => now - s.at < SPLAT_LIFE_MS).map(({at, ...s}) => ({...s, age: Math.max(0, now - at)})),
  sprays: marks.sprays});

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Put an item down where a player stands (or stood).
function dropAt(item, pose, dx = 0, dz = 0, y = null) {
  item.holder = null;
  item.x = pose.x + dx; item.z = pose.z + dz; item.y = y ?? (pose.g || 0) + .03;   // on whatever they stood on
  item.yaw = pose.yaw || 0;
}

// The runner's way round the loop: unwrapped angle since the start. A lap counts back at the
// machine after a full turn; the first lap can go either way, later ones must keep to it.
function trackRunner(r, player, now, out) {
  if (r.state !== 'running' || player.id !== r.runner || r.laps <= 0) return false;
  const a = loopAngle(player.pose.x, player.pose.z);
  let d = a - (r.lastA ?? a);
  d = Math.atan2(Math.sin(d), Math.cos(d));
  if (Math.abs(d) < .6) r.progress = (r.progress || 0) + d;   // a bigger jump is a teleport (respawn): it earns nothing
  r.lastA = a;
  if (flat(player.pose, MACHINE) > LAP_ZONE) return false;
  const done = RACE_LAPS - r.laps, need = 2 * Math.PI * (done + 1) - LAP_SLACK;
  const along = done === 0 ? Math.abs(r.progress) : r.dir * r.progress;
  if (along < need) return false;
  if (done === 0) r.dir = Math.sign(r.progress);
  r.laps--;
  r.splits = [...(r.splits || []), now - r.startedAt];
  out.push({to: 'all', msg: {type: 'race', race: publicRace(r, now), event: 'lap', by: player.id, byName: player.name || ''}});
  return true;
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
  // voice connection offers carry a session description, so they get more room than everything else
  if (typeof data !== 'string' || data.length > 16384) return {out, changed: false, close: 'Message too large'};
  if (data.length > 4096 && !data.startsWith('{"type":"rtc"')) return {out, changed: false, close: 'Message too large'};
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
    const raceChanged = room.race ? trackRunner(room.race, player, now, out) : false;
    return {out, changed: true, returning, raceChanged};
  }
  if (m.type === 'chat') {
    if (now - player.lastChat < CHAT_INTERVAL_MS) return {out, changed: false};
    const text = sanitizeChat(m.text);
    if (!text) return {out, changed: false};
    player.lastChat = now; player.lastActive = now;
    const returning = player.inactive; player.inactive = false;
    out.push({to: 'all', msg: {type: 'chat', id: player.id, name: player.name || '', text, time: now, expiresAt: now + CHAT_TTL_MS}});
    return {out, changed: true, returning};
  }
  if (m.type === 'look') {
    const look = sanitizeLook(m.look);
    if (!look) return {out, changed: false};
    player.look = look; player.name = sanitizeName(m.name);
    out.push({to: 'all', msg: {type: 'look', id: player.id, look}});
    return {out, changed: true};
  }
  if (m.type === 'activity') {
    const returning = player.inactive;
    player.lastActive = now; player.inactive = false;
    return {out, changed: true, returning};
  }

  // ------------------------------------------------- voice (peer to peer)
  // Browsers set up voice links directly; the room only passes their setup notes along.
  if (m.type === 'rtc') {
    if (typeof m.to !== 'string' || m.to === player.id || !m.d || typeof m.d !== 'object') return {out, changed: false};
    const second = Math.floor(now / 1000);
    if (player.rtcSecond !== second) { player.rtcSecond = second; player.rtcCount = 0; }
    if (++player.rtcCount > 80) return {out, changed: false};
    const to = room.players().find(p => p && p.id === m.to);
    if (!to) return {out, changed: false};
    out.push({to: m.to, msg: {type: 'rtc', from: player.id, d: m.d}});
    return {out, changed: false};
  }

  // ------------------------------------------------ doors pulled shut
  // Doors swing on each client; a click to shut one is passed to everyone so they all close it.
  if (m.type === 'door') {
    if (!Number.isInteger(m.i) || m.i < 0 || m.i > 999 || !player.pose || now - (player.lastDoor || 0) < 250) return {out, changed: false};
    player.lastDoor = now; player.lastActive = now;
    out.push({to: 'all', msg: {type: 'door', i: m.i, by: player.id}});
    return {out, changed: true};
  }

  // ---------------------------------------------------------- lap timer
  if (m.type === 'button') {
    if (!player.pose || player.inactive || !room.race || now - (player.lastButton || 0) < 400) return {out, changed: false};
    if (flat(player.pose, BUTTON) > BUTTON_RANGE) return {out, changed: false};
    player.lastButton = now; player.lastActive = now;
    const r = room.race;
    let event = null;
    if (r.state === 'running') {
      if (player.id === r.runner) event = r.laps <= 0 ? 'finish' : 'cancel';
      else {
        // someone else can only call it off if the runner's gone or it's dragged on too long
        const runnerHere = room.players().some(p => p && p.id === r.runner && !p.inactive);
        if (!runnerHere || now - r.startedAt > RACE_TIMEOUT_MS) event = 'cancel';
      }
    } else event = 'start';
    if (!event) { out.push({to: 'self', msg: {type: 'race', race: publicRace(r, now), busy: true, by: player.id}}); return {out, changed: true}; }
    if (event === 'start') Object.assign(r, freshRace(), {state: 'running', runner: player.id, name: player.name || '', startedAt: now,
      progress: 0, lastA: loopAngle(player.pose.x, player.pose.z), dir: 0});
    else Object.assign(r, {state: event === 'finish' ? 'done' : 'cancelled', time: now - r.startedAt, endedAt: now});
    out.push({to: 'all', msg: {type: 'race', race: publicRace(r, now), event, by: player.id, byName: player.name || ''}});
    return {out, changed: true, raceChanged: true};
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
    // put down where they aimed, or tossed and settled nearby: never far from them
    let dx = Number(m.x) - player.pose.x, dz = Number(m.z) - player.pose.z;
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) { dx = 0; dz = 0; }
    const d = Math.hypot(dx, dz);
    if (d > 4) { dx *= 4 / d; dz *= 4 / d; }
    const y = Number.isFinite(m.y) ? Math.max(-.5, Math.min(4, m.y)) : null;
    dropAt(item, player.pose, dx, dz, y);
    if (Number.isFinite(m.yaw)) item.yaw = Math.round(m.yaw * 1000) / 1000;
    // how it fell (start and velocity): everyone replays the same fall to where it came to rest
    const fp = m.fall && Array.isArray(m.fall.p) && m.fall.p.length === 3 && m.fall.p.every(Number.isFinite) ? m.fall.p : null;
    const fv = m.fall && Array.isArray(m.fall.v) && m.fall.v.length === 3 && m.fall.v.every(Number.isFinite) ? m.fall.v : null;
    const fall = fp && fv && Math.hypot(fp[0] - player.pose.x, fp[2] - player.pose.z) < 4 && Math.hypot(...fv) < 15
      ? {p: fp.map(v => Math.round(v * 1000) / 1000), v: fv.map(v => Math.round(v * 1000) / 1000)} : undefined;
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(item), fall}});
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
  if (m.type === 'shoot') {
    const gun = Object.values(items).find(it => it.holder === player.id && it.type === 'paintball');
    if (!gun || !player.pose || now - player.lastShot < SHOT_INTERVAL_MS) return {out, changed: false};
    const o = cleanSplat({p: m.o, n: [0, 1, 0], c: 0, s: 0})?.p, v = Array.isArray(m.v) && m.v.length === 3 && m.v.every(Number.isFinite) ? m.v.map(x => Math.round(x * 100) / 100) : null;
    const c = Number.isInteger(m.c) && m.c >= 0 && m.c <= 0xffffff ? m.c : null, s = Number.isInteger(m.s) && m.s >= 0 && m.s <= 0xffffff ? m.s : 0;
    if (!o || !v || c === null || Math.hypot(o[0] - player.pose.x, o[2] - player.pose.z) > 3 || Math.hypot(...v) > 80) return {out, changed: false};
    player.lastShot = now; player.lastActive = now;
    const hit = m.hit ? cleanSplat({...m.hit, c, s}) : null;
    let target = null, local = null;
    if (typeof m.target === 'string' && m.target !== player.id) {
      target = room.players().find(p => p && p.id === m.target && p.pose && !p.inactive) || null;
      local = target ? cleanSplat({...(m.local || {}), c, s}) : null;
      if (target && Math.hypot(target.pose.x - player.pose.x, target.pose.z - player.pose.z) > 70) target = null;
    }
    const t = Number.isFinite(m.t) ? Math.round(Math.max(0, Math.min(2.5, m.t)) * 1000) / 1000 : 1;
    out.push({to: 'all', msg: {type: 'shot', from: player.id, o, v, c, s, t, hit: target ? null : hit, target: target?.id || '',
      local: target ? local : null, time: now}});
    let marksChanged = false, itemsChanged = false;
    if (hit && !target && room.marks) {
      pruneSplats(room.marks, now);
      room.marks.splats.push({...hit, at: now});
      if (room.marks.splats.length > MAX_SPLATS) room.marks.splats.splice(0, room.marks.splats.length - MAX_SPLATS);
      marksChanged = true;
    }
    if (target) { const dropped = releaseItems(items, target); out.push(...dropped); itemsChanged = dropped.length > 0; }
    return {out, changed: true, marksChanged, itemsChanged};
  }
  if (m.type === 'spray') {
    const can = Object.values(items).find(it => it.holder === player.id && it.type === 'spray');
    const mark = cleanSpray(m);
    if (!can || !mark || !player.pose || now - player.lastSpray < SPRAY_INTERVAL_MS) return {out, changed: false};
    // door marks are in the door's own space, a door-width from its hinge at most
    if (mark.d !== undefined ? Math.hypot(...mark.p) > 3 : Math.hypot(mark.p[0] - player.pose.x, mark.p[2] - player.pose.z) > SPRAY_RANGE + 1)
      return {out, changed: false};
    player.lastSpray = now; player.lastActive = now;
    out.push({to: 'all', msg: {type: 'spray', from: player.id, mark, time: now}});
    if (room.marks) {
      room.marks.sprays.push(mark);
      if (room.marks.sprays.length > MAX_SPRAYS) room.marks.sprays.splice(0, room.marks.sprays.length - MAX_SPRAYS);
    }
    return {out, changed: true, marksChanged: !!room.marks};
  }
  return {out, changed: false};
}

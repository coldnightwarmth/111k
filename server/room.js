// Room logic shared by the Cloudflare Durable Object (production) and the
// local dev server. Each player's record lives with their socket (a
// hibernation "attachment" in Cloudflare), so the room survives the Durable
// Object being evicted between messages. The only shared state is the held
// items, which the caller keeps (Durable Object storage in production).
import {INK_HOST, INK_PER_S, MAX_INK_STROKES, MAX_STROKE_PTS, MAX_INK_PTS, INK_PART_PTS, packInk, cleanInkPoints, SETTLE_BYTES, SETTLE_MAX, SETTLE_PER_S, MAG_SIZE, RELOAD_MS, CROWN_HITS, CROWN_HIT_WINDOW_MS, CHAT_INTERVAL_MS, CHAT_TTL_MS, POSE_INTERVAL_MS, PICKUP_RANGE, PUNCH_RANGE, PUNCH_COOLDOWN_MS,
  SHOT_INTERVAL_MS, SPRAY_INTERVAL_MS, SPRAY_RANGE, MAX_SPLATS, MAX_SPRAYS, SPLAT_LIFE_MS, ART_MAX,
  sanitizeChat, sanitizePose, radioLink, radioKey, RADIO_MAX_MS, samePose, cleanItem, cleanPath, sanitizeLook, sanitizeName, cleanSplat, cleanSpray, splatId, sprayId} from '../src/protocol.js';
import {ITEM_SPAWNS} from '../src/world-items.js';
import {RACE_LAPS, RACE_TIMEOUT_MS, BUTTON, BUTTON_RANGE, MACHINE_ANGLE, LAP_LINE, BUTTON_LAP, loopAngle, freshRace, publicRace} from '../src/race.js';
import {PANEL, USE_RANGE, BUSY_MS, inChamber, standPose, keyEntry, KEYS} from '../src/converter-spec.js';
import {KOTH_GRACE_MS, KOTH_WIN_MS, KOTH_UNCLAIMED_MS, freshKoth, publicKoth, kothActive, kothTime} from '../src/koth.js';

// paintings settling on their own (a 'settle' message): how far from the player who sends it, and how far each can move
const SETTLE_RANGE = 8, SETTLE_MOVE = 6;
// a pickup's checked against where the server last had the player, which can trail where they were when they clicked
const PICKUP_SLACK = .4;
const ERRORS_PER_PLAYER = 12;

// the error log (GET /errors): the latest kinds, each with how often and when it was last seen
export const ERROR_LOG_MAX = 120;
export function logError(list, e) {
  const key = `${e.msg}|${e.where.split('\n')[0]}`;
  const old = list.find(x => x.key === key);
  if (old) { old.count++; old.last = e.at; old.ua = e.ua; old.page = e.page; }
  else list.push({key, msg: e.msg, where: e.where, ua: e.ua, page: e.page, first: e.at, last: e.at, count: 1});
  list.sort((a, b) => b.last - a.last);
  list.length = Math.min(list.length, ERROR_LOG_MAX);
  return list;
}

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
// A stored set from an older version keeps what it has (paintings where people left them, guns half empty);
// anything new starts where the level puts it, anything gone goes.
export function validItems(stored) {
  if (!stored || typeof stored !== 'object') return freshItems();
  return Object.fromEntries(ITEM_SPAWNS.map(s => {
    const old = stored[s.id];
    return [s.id, old && typeof old === 'object' && old.type === s.type ? old : cleanItem({...s, holder: null, on: s.on === true})];
  }));
}

export function snapshot(players, now, items = {}) {
  return {type: 'state', now, players: players.filter(p => p && !p.inactive && p.pose).map(p => ({id: p.id, pose: p.pose, look: p.look})),
    items: Object.values(items)};
}

// Paint and sprayed pieces stay on the walls; the oldest go when there are too many.
const MAX_ERASED = 600;   // pieces of the level's own graffiti scrubbed off
// how clients name a mark when asking to scrub it
export {sprayId, splatId};
export function freshMarks() { return {splats: [], sprays: [], erased: [], ink: []}; }
export function validMarks(stored) {
  if (!stored || !Array.isArray(stored.splats) || !Array.isArray(stored.sprays)) return freshMarks();
  const splats = stored.splats.map(s => { const c = cleanSplat(s); return c && Number.isFinite(s.at) ? {...c, at: s.at} : null; });
  return {splats: splats.filter(Boolean).slice(-MAX_SPLATS),
    sprays: stored.sprays.map(cleanSpray).filter(Boolean).slice(-MAX_SPRAYS),
    erased: Array.isArray(stored.erased) ? stored.erased.filter(id => typeof id === 'string' && id.length <= 80).slice(-MAX_ERASED) : [],
    ink: Array.isArray(stored.ink) ? stored.ink.filter(s => s && typeof s.id === 'string' && INK_HOST.test(s.h) && Array.isArray(s.pts)).slice(-MAX_INK_STROKES * 20) : []};   // (a drawing counts as one)
}
// paint lasts a minute; sprayed pieces stay
export function pruneSplats(marks, now) {
  const before = marks.splats.length;
  marks.splats = marks.splats.filter(s => now - s.at < SPLAT_LIFE_MS);
  return marks.splats.length !== before;
}
export const marksMessage = (marks, now = Date.now()) => ({type: 'marks',
  splats: marks.splats.filter(s => now - s.at < SPLAT_LIFE_MS).map(({at, ...s}) => ({...s, age: Math.max(0, now - at)})),
  sprays: marks.sprays, erased: marks.erased || [], ink: marks.ink || []});
// the same for someone joining, in messages under a WebSocket's 1 MiB: the marks, then the ink in parts (packed),
// which they put up once they've all come (inkParts: how many)
export function marksMessages(marks, now = Date.now()) {
  const parts = [];
  let part = [], n = 0;
  for (const s of marks.ink || []) {
    if (n + s.pts.length > INK_PART_PTS && part.length) { parts.push(part); part = []; n = 0; }
    part.push({id: s.id, h: s.h, c: s.c, t: s.t, ...(s.g ? {g: s.g} : {}), p: packInk(s.pts)}); n += s.pts.length;
  }
  if (part.length) parts.push(part);
  return [{...marksMessage(marks, now), ink: [], inkParts: parts.length}, ...parts.map((ink, i) => ({type: 'inkpart', i, n: parts.length, ink}))];
}

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// a stroke's bounds (kept with it, made again when it's grown), and the one to let go when there's too much ink:
// among the oldest half, the one with the fewest others near it (within NEAR of its bounds, on the same surface),
// the oldest of those
const inkBounds = new WeakMap();
function boundsOf(s) {
  let b = inkBounds.get(s);
  if (b && b.n === s.pts.length) return b;
  b = {n: s.pts.length, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity]};
  for (const q of s.pts) for (let k = 0; k < 3; k++) { if (q[k] < b.lo[k]) b.lo[k] = q[k]; if (q[k] > b.hi[k]) b.hi[k] = q[k]; }
  inkBounds.set(s, b);
  return b;
}
const NEAR = .35;
// strokes as the room keeps count of them: each on its own, or a drawing of strokes joined (s.g), oldest first
// (by when they were last added to)
// strokes that cross (points within JOIN of each other, on the same surface), each left alone for a minute,
// joined into one drawing: s.g, the id of the drawing's oldest stroke. Returns the drawings that changed:
// [{g, ids}] (everyone's told: they put each on one layer, as one piece)
const JOIN = .025, JOIN_AFTER = 60000;
function crosses(a, b) {
  const A = boundsOf(a), B = boundsOf(b);
  for (let k = 0; k < 3; k++) if (A.lo[k] - JOIN > B.hi[k] || B.lo[k] - JOIN > A.hi[k]) return false;
  const cell = new Map(), key = (x, y, z) => `${Math.floor(x / JOIN)},${Math.floor(y / JOIN)},${Math.floor(z / JOIN)}`;
  for (const q of a.pts) cell.set(key(q[0], q[1], q[2]), q);
  for (const q of b.pts) {
    const cx = Math.floor(q[0] / JOIN), cy = Math.floor(q[1] / JOIN), cz = Math.floor(q[2] / JOIN);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const p = cell.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (p && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < JOIN) return true;
    }
  }
  return false;
}
export function joinInk(ink, now) {
  const ready = ink.filter(s => s.h[0] !== 'a' && now - (s.at || s.t || 0) >= JOIN_AFTER);
  const fresh = ready.filter(s => !s.joined);                  // (not looked at yet: each is, once)
  if (!fresh.length) return [];
  const changed = new Set();
  const groupOf = s => s.g || s.id, oldest = new Map();
  for (const s of ready) { const g = groupOf(s), o = oldest.get(g); if (!o || (s.t || 0) < (o.t || 0)) oldest.set(g, s); }
  for (const s of fresh) {
    s.joined = true;
    for (const o of ready) {
      if (o === s || o.h !== s.h || groupOf(o) === groupOf(s) || !crosses(s, o)) continue;
      // the two drawings become one, named for the older's oldest stroke
      const ga = groupOf(s), gb = groupOf(o), a = oldest.get(ga), b = oldest.get(gb);
      const keep = (a.t || 0) <= (b.t || 0) ? ga : gb, drop = keep === ga ? gb : ga;
      for (const x of ready) if (groupOf(x) === drop) x.g = keep;
      if (keep === s.id || ready.some(x => x.g === keep)) { const k = ready.find(x => x.id === keep); if (k) k.g = keep; }
      oldest.set(keep, (a.t || 0) <= (b.t || 0) ? a : b);
      changed.add(keep); changed.delete(drop);
    }
  }
  return [...changed].map(g => ({g, ids: ready.filter(x => (x.g || x.id) === g).map(x => x.id)})).filter(d => d.ids.length > 1);
}
export function inkUnits(ink) {
  const by = new Map();
  for (const s of ink) { const k = s.g || s.id; let u = by.get(k); if (!u) by.set(k, u = {strokes: [], h: s.h, t: 0}); u.strokes.push(s); u.t = Math.max(u.t, s.at || s.t || 0); }
  return [...by.values()].sort((a, b) => a.t - b.t);
}
const unitBounds = u => {
  if (!u.strokes) return boundsOf(u);
  const b = {lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity]};
  for (const s of u.strokes) { const c = boundsOf(s); for (let k = 0; k < 3; k++) { b.lo[k] = Math.min(b.lo[k], c.lo[k]); b.hi[k] = Math.max(b.hi[k], c.hi[k]); } }
  return b;
};
// the order to let them go in (units), worked out once: of all but the newest tenth, the lowest scores first (the
// others near it and the strokes in it, as loneliest), the oldest first among equals
export function trimOrder(units, keep) {
  const span = Math.max(1, Math.ceil(units.length * .9)), bounds = units.map(unitBounds), scored = [];
  for (let i = 0; i < span; i++) {
    const u = units[i];
    if (u === keep) continue;
    const a = bounds[i];
    let n = u.strokes ? u.strokes.length : 1;
    for (let j = 0; j < units.length; j++) {
      const o = units[j];
      if (o === u || o.h !== u.h) continue;
      const b = bounds[j];
      if (a.lo[0] - NEAR <= b.hi[0] && b.lo[0] - NEAR <= a.hi[0] && a.lo[1] - NEAR <= b.hi[1] && b.lo[1] - NEAR <= a.hi[1]
        && a.lo[2] - NEAR <= b.hi[2] && b.lo[2] - NEAR <= a.hi[2]) n++;
    }
    scored.push({u, n, i});
  }
  return scored.sort((a, b) => a.n - b.n || a.i - b.i).map(x => x.u);
}
// the one to let go (strokes or units): of all but the newest tenth, the one with the fewest others near it and
// the fewest strokes in it (a lone line before a drawing), the oldest of those
export function loneliest(ink, keep) {
  const span = Math.max(1, Math.ceil(ink.length * .9)), bounds = ink.map(unitBounds);
  let best = 0, bestN = Infinity;
  for (let i = 0; i < span; i++) {
    const s = ink[i];
    if (s === keep) continue;
    const a = bounds[i];
    let n = s.strokes ? s.strokes.length : 1;
    for (let j = 0; j < ink.length && n < bestN; j++) {
      const o = ink[j];
      if (o === s || o.h !== s.h) continue;
      const b = bounds[j];
      if (a.lo[0] - NEAR <= b.hi[0] && b.lo[0] - NEAR <= a.hi[0] && a.lo[1] - NEAR <= b.hi[1] && b.lo[1] - NEAR <= a.hi[1]
        && a.lo[2] - NEAR <= b.hi[2] && b.lo[2] - NEAR <= a.hi[2]) n++;
    }
    if (n < bestN) { best = i; bestN = n; }
  }
  return best;
}

// Put an item down where a player stands (or stood).
function dropAt(item, pose, dx = 0, dz = 0, y = null) {
  item.holder = null;
  item.x = pose.x + dx; item.z = pose.z + dz; item.y = y ?? (pose.g || 0) + (item.type === 'painting' ? .002 : .03);   // on whatever they stood on
  item.yaw = pose.yaw || 0;
  if (item.type === 'crown') item.on = false;   // a crown on the ground isn't on anyone's head
  if (item.type === 'painting') { item.tilt = -Math.PI / 2; item.roll = 0; item.hung = false; }   // a painting let go of falls flat, face up
}
// a worn crown sits on its wearer's head, leaving their hands free
const worn = it => it.type === 'crown' && it.on;
const handsFull = (items, id) => Object.values(items).some(it => it.holder === id && !worn(it));

// The runner's way round the loop: how far round they've gone since the start (unwrapped angle), measured
// from the machine. A lap is done the moment they cross a line straight across the tunnel just before the
// machine (LAP_LINE short of it, on whichever side they're coming from): wherever across the tunnel, however
// fast (a quick pass, or one along the far wall, can't slip between two poses). The split is when they crossed
// it, between the two poses either side. Pushing the button counts it too (slack BUTTON_LAP, from anywhere it
// can be reached), so coming round to the button always finishes the run, never calls it off. The first lap
// can go either way, later ones must keep to it.
const wrap = d => Math.atan2(Math.sin(d), Math.cos(d));
function trackRunner(r, player, now, out, slack = LAP_LINE) {
  if (r.state !== 'running' || player.id !== r.runner || r.laps <= 0) return false;
  const a = loopAngle(player.pose.x, player.pose.z);
  r.from ??= wrap(a - MACHINE_ANGLE);                         // where they started, from the line (set at the start)
  const was = r.from + (r.progress || 0), then = r.lastT ?? r.startedAt;
  const d = wrap(a - (r.lastA ?? a));
  if (Math.abs(d) < .6) r.progress = (r.progress || 0) + d;   // a bigger jump is a teleport (respawn): it earns nothing
  r.lastA = a; r.lastT = now;
  const at = r.from + (r.progress || 0);
  const done = RACE_LAPS - r.laps;
  // the line this lap ends on: a whole turn on, less the slack (either way, for the first)
  const dir = done === 0 ? Math.sign(at) || 1 : r.dir, line = dir * (2 * Math.PI * (done + 1) - slack);
  if (dir * at < dir * line - 1e-4 || (at === was && slack === LAP_LINE)) return false;   // (on the line counts, to a few mm)
  if (done === 0) r.dir = dir;
  const when = at === was ? now : then + (now - then) * Math.min(1, Math.max(0, (line - was) / (at - was)));
  r.laps--;
  r.splits = [...(r.splits || []), Math.round(when - r.startedAt)];
  out.push({to: 'all', msg: {type: 'race', race: publicRace(r, now), event: 'lap', by: player.id, byName: player.name || ''}});
  return true;
}

// What someone held when they left or went idle: dropped where they were if anyone else is about (a crown
// mid-game always drops, for the game to go on), otherwise back where it started for whoever comes next.
export function letGo(items, player, {others = false, koth = null} = {}) {
  const out = [], spawn = new Map(ITEM_SPAWNS.map(s => [s.id, s]));
  for (const it of Object.values(items)) {
    if (it.holder !== player.id || others || (it.type === 'crown' && kothActive(koth)) || !spawn.has(it.id)) continue;
    Object.assign(it, cleanItem({...spawn.get(it.id), holder: null, on: spawn.get(it.id).on === true}));
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(it)}});
  }
  return [...out, ...releaseItems(items, player)];
}

// Drop whatever this player holds (they left, went idle, or got punched). A crown pops up off the head;
// with more than one thing (a crown and what's in their hands) they fly apart a little, landing about
// 0.4 m out on different sides (inside the space their body took up, so never in a wall), easy to grab one at a time.
const r3 = v => Math.round(v * 1000) / 1000;
export function releaseItems(items, player) {
  const out = [], mine = Object.values(items).filter(it => it.holder === player.id), pose = player.pose;
  const spread = pose && mine.length > 1 ? .4 : 0, base = (pose?.yaw || 0) + Math.PI / 2;   // first off to their right
  mine.forEach((it, k) => {
    const head = worn(it);
    const a = base + 2 * Math.PI * k / mine.length, dx = Math.cos(a) * spread, dz = -Math.sin(a) * spread;
    dropAt(it, pose || it, dx, dz);
    let fall;
    if (pose && (head || spread)) {
      // from the head or the hand, up a little and out to where it lands
      const y0 = pose.y + (head ? .12 : -.45), vy = head ? 1.4 : 1, drop = Math.max(.05, y0 - it.y);
      const t = (vy + Math.sqrt(vy * vy + 2 * 9.8 * drop)) / 9.8;
      fall = {p: [r3(pose.x), r3(y0), r3(pose.z)], v: [r3(dx / t), vy, r3(dz / t)]};
    }
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(it), fall}});
  });
  return out;
}

// The pieces of a mark that landed on paintings (in each painting's own space): a few at most, each
// on a painting that exists and within its reach.
function paintingParts(list, clean, items) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 4).map(clean).filter(p => p && p.pi && items[p.pi]?.type === 'painting' && Math.hypot(...p.p) < 3);
}

// Returns {out: [{to: 'all' | 'self' | <player id>, msg}], changed, itemsChanged, returning, close}.
// room: {items, players: () => [player records]}
export function handleMessage(player, data, now, room = {items: {}, players: () => []}) {
  const result = handle(player, data, now, room);
  if (!room.koth || result.close) return result;
  const k = kothTick(room, now);
  result.out.push(...k.out);
  if (k.itemsChanged) result.itemsChanged = true;
  if (k.kothChanged) result.kothChanged = true;
  return result;
}
function handle(player, data, now, room) {
  const out = [];
  // voice connection offers carry a session description, so they get more room than everything else
  if (typeof data !== 'string' || data.length > 16384) return {out, changed: false, close: 'Message too large'};
  // (paintings coming down carry how they tumbled: up to SETTLE_BYTES, and only so many a second)
  const bulky = data.startsWith('{"type":"settle"') || data.startsWith('{"type":"drop"');
  if (data.length > (bulky ? SETTLE_BYTES + 512 : 4096) && !data.startsWith('{"type":"rtc"')) return {out, changed: false, close: 'Message too large'};
  if (bulky) {
    if (now - (player.settleAt || 0) >= 1000) { player.settleAt = now; player.settles = 0; }
    if (++player.settles > SETTLE_PER_S) return {out, changed: true};
  }
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
  // something went wrong in someone's browser (src/errors.js): kept for a look later (GET /errors), a few per visit
  if (m.type === 'clientError') {
    player.errors = (player.errors || 0) + 1;
    if (player.errors > ERRORS_PER_PLAYER) return {out, changed: player.errors === ERRORS_PER_PLAYER + 1};
    const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    return {out, changed: true, report: {msg: text(m.msg, 300), where: text(m.where, 1200), ua: text(m.ua, 200), page: text(m.page, 40), at: now}};
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

  // ------------------------------------------------- marker ink
  // A stroke as it's drawn: its first points start it, the rest add on. Only by whoever's holding a marker,
  // only near them (or on something they can reach), only so fast. Ink on a player is passed on, not kept.
  if (m.type === 'ink') {
    const marker = Object.values(items).find(it => it.holder === player.id && it.type === 'marker');
    if (!marker || !player.pose || player.inactive || !room.marks) return {out, changed: false};
    if (now - (player.inkAt || 0) >= 1000) { player.inkAt = now; player.inks = 0; }
    if (++player.inks > INK_PER_S) return {out, changed: false};
    const id = typeof m.id === 'string' && m.id.length <= 40 && m.id.startsWith(player.id + ':') ? m.id : null;
    const h = typeof m.h === 'string' && INK_HOST.test(m.h) ? m.h : null;
    const c = Number.isInteger(m.c) && m.c >= 0 && m.c <= 0xffffff ? m.c : null;
    const pts = h ? cleanInkPoints(m.p, h !== 'w') : null;
    if (!id || !h || c === null || !pts || h[0] === 'a') return {out, changed: false};     // (not on people)
    if (h === 'w' && pts.some(q => Math.hypot(q[0] - player.pose.x, q[2] - player.pose.z) > 4)) return {out, changed: false};
    if (h[0] === 'p' && items[h.slice(1)]?.type !== 'painting') return {out, changed: false};
    const ink = room.marks.ink ||= [];
    let stroke = ink.find(s => s.id === id);
    // a stroke that's done (nothing added for a while) doesn't take more: that's a page from before the stroke ids
    // were made unique reusing one after a refresh (it'd be drawn joined on with a long line)
    if (stroke && h !== stroke.h || stroke && !(now - (stroke.at || 0) < 10000)) return {out, changed: false};
    player.lastActive = now;
    out.push({to: 'all', msg: {type: 'ink', id, h, c, p: pts, by: player.id}});
    if (h[0] === 'a') return {out, changed: true};
    if (!stroke) { stroke = {id, h, c, t: now, pts: []}; ink.push(stroke); }
    stroke.at = now;
    stroke.pts.push(...pts.slice(0, Math.max(0, MAX_STROKE_PTS - stroke.pts.length)));
    // too much ink: a stroke goes (everyone's told): not the newest, and the loneliest of the older ones first
    // (on its own, away from any others: the detailed drawings, lots of strokes together, are kept longest)
    // (a drawing the room's joined from crossing strokes counts as one, and goes whole)
    // (trimmed a little under the limit in one go, so it isn't worked out again for every few points drawn)
    let total = ink.reduce((t, s) => t + s.pts.length, 0);
    const units = inkUnits(ink);
    if (units.length > MAX_INK_STROKES || total > MAX_INK_PTS) {
      const order = trimOrder(units, units.find(u => u.strokes.includes(stroke)));
      let left = units.length;
      for (const gone of order) {
        if (left <= MAX_INK_STROKES * .98 && total <= MAX_INK_PTS * .98) break;
        left--;
        for (const old of gone.strokes) {
          ink.splice(ink.indexOf(old), 1); total -= old.pts.length;
          out.push({to: 'all', msg: {type: 'erase', kind: 'ink', id: old.id, by: ''}});
        }
      }
    }
    return {out, changed: true, marksChanged: true};
  }

  // ------------------------------------------------- scrubbing marks off
  if (m.type === 'erase') {
    const bucket = Object.values(items).find(it => it.holder === player.id && it.type === 'bucket');
    const id = typeof m.id === 'string' && m.id.length <= 80 ? m.id : null;
    if (!bucket || !id || !['splat', 'spray', 'baked', 'ink'].includes(m.kind) || !room.marks || now - (player.lastErase || 0) < 150) return {out, changed: false};
    player.lastErase = now; player.lastActive = now;
    const marks = room.marks;
    if (m.kind === 'splat') marks.splats = marks.splats.filter(s => splatId(s) !== id);
    else if (m.kind === 'ink') marks.ink = (marks.ink || []).filter(s => s.id !== id);
    else if (m.kind === 'spray') marks.sprays = marks.sprays.filter(s => sprayId(s) !== id);
    else if (!(marks.erased ||= []).includes(id)) { marks.erased.push(id); if (marks.erased.length > MAX_ERASED) marks.erased.shift(); }
    out.push({to: 'all', msg: {type: 'erase', kind: m.kind, id, by: player.id}});
    return {out, changed: true, marksChanged: true};
  }

  // ---------------------------------------------------------- lap timer
  if (m.type === 'button') {
    if (!player.pose || player.inactive || !room.race || now - (player.lastButton || 0) < 400) return {out, changed: false};
    if (flat(player.pose, BUTTON) > BUTTON_RANGE) return {out, changed: false};
    player.lastButton = now; player.lastActive = now;
    const r = room.race;
    let event = null;
    if (r.state === 'running') {
      // come round to the button: that lap's done, wherever the line was crossed (the last one finishes the run)
      if (player.id === r.runner) trackRunner(r, player, now, out, BUTTON_LAP);
      if (player.id === r.runner) event = r.laps <= 0 ? 'finish' : 'cancel';
      else {
        // someone else can only call it off if the runner's gone or it's dragged on too long
        const runnerHere = room.players().some(p => p && p.id === r.runner && !p.inactive);
        if (!runnerHere || now - r.startedAt > RACE_TIMEOUT_MS) event = 'cancel';
      }
    } else event = 'start';
    if (!event) { out.push({to: 'self', msg: {type: 'race', race: publicRace(r, now), busy: true, by: player.id}}); return {out, changed: true}; }
    if (event === 'start') Object.assign(r, freshRace(), {state: 'running', runner: player.id, name: player.name || '', startedAt: now,
      progress: 0, lastA: loopAngle(player.pose.x, player.pose.z), lastT: now,
      from: wrap(loopAngle(player.pose.x, player.pose.z) - MACHINE_ANGLE), dir: 0});
    else Object.assign(r, {state: event === 'finish' ? 'done' : 'cancelled', time: now - r.startedAt, endedAt: now});
    out.push({to: 'all', msg: {type: 'race', race: publicRace(r, now), event, by: player.id, byName: player.name || ''}});
    return {out, changed: true, raceChanged: true};
  }

  // ---------------------------------------------------------- the converter (B-20)
  // the keypad: a key at a time, the entry kept for everyone to see
  if (m.type === 'keypad') {
    const c = room.converter;
    if (!c || !player.pose || player.inactive || !KEYS.includes(m.k) || flat(player.pose, PANEL) > USE_RANGE) return {out, changed: false};
    if (now - (player.lastKey || 0) < 60) return {out, changed: false};
    player.lastKey = now; player.lastActive = now;
    c.entry = keyEntry(c.entry || '', m.k);
    out.push({to: 'all', msg: {type: 'keypad', entry: c.entry, k: m.k, by: player.id}});
    return {out, changed: true};
  }
  // the big button: the painting in the chamber becomes the piece the keypad says
  if (m.type === 'convert') {
    const c = room.converter;
    if (!c || !player.pose || player.inactive || flat(player.pose, PANEL) > USE_RANGE) return {out, changed: false};
    player.lastActive = now;
    const n = Number(c.entry);
    const deny = why => { out.push({to: 'self', msg: {type: 'keypad', entry: c.entry || '', denied: why}}); return {out, changed: true}; };
    if (now < (c.busyUntil || 0)) return deny('busy');
    if (!c.entry || !Number.isInteger(n) || n < 1 || n > ART_MAX) return deny('number');
    const inside = Object.values(items).filter(it => it.type === 'painting' && !it.holder && inChamber(it.x, it.y, it.z));
    if (!inside.length) return deny('empty');
    const it = inside[0];
    Object.assign(it, standPose(n), {art: n, hung: true});
    for (const k of ['x', 'y', 'z', 'yaw', 'tilt']) it[k] = r3(it[k]);
    Object.assign(c, {busyUntil: now + BUSY_MS, id: it.id, entry: ''});
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(it), convert: {n, by: player.id, byName: player.name || ''}}});
    out.push({to: 'all', msg: {type: 'keypad', entry: ''}});
    return {out, changed: true, itemsChanged: true};
  }

  // ---------------------------------------------------------- king of the hill
  // clicking with the crown in your hand starts a game: it goes on your head
  if (m.type === 'koth') {
    const k = room.koth, crown = Object.values(items).find(it => it.type === 'crown' && it.holder === player.id && !it.on);
    if (!k || !crown || kothActive(k) || !player.pose || player.inactive) return {out, changed: false};
    player.lastActive = now;
    Object.assign(k, freshKoth(), {state: 'grace', starter: player.id, starterName: player.name || '', startedAt: now,
      graceEnds: now + KOTH_GRACE_MS, wearer: player.id, since: now + KOTH_GRACE_MS, names: {[player.id]: player.name || ''}});
    crown.on = true;
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(crown)}});
    out.push({to: 'all', msg: {type: 'koth', koth: publicKoth(k, now), event: 'start', by: player.id, byName: player.name || ''}});
    return {out, changed: true, itemsChanged: true, kothChanged: true};
  }

  // ---------------------------------------------------------------- items
  const item = typeof m.id === 'string' ? items[m.id] : null;
  // turned down: the one who asked has already been shown it done, so they're told how it really is
  const refuse = () => ({out: item ? [{to: 'self', msg: {type: 'item', item: cleanItem(item), refused: true}}] : out, changed: false});
  if (m.type === 'pickup') {
    if (!item || item.holder || !player.pose || player.inactive) return refuse();
    if (room.converter && item.id === room.converter.id && now < room.converter.busyUntil) return refuse();   // (still being converted)
    // while a game is on, the crown goes straight on your head, whatever's in your hands
    const crowning = item.type === 'crown' && kothActive(room.koth);
    if (!crowning && handsFull(items, player.id)) return refuse();
    if (flat(player.pose, item) > PICKUP_RANGE + PICKUP_SLACK) return refuse();
    item.holder = player.id; player.lastActive = now;
    if (crowning) { item.on = true; room.koth.names[player.id] = player.name || ''; }
    // a Mons mon on the board with the mana, supermana or bomb it's carrying on its square: that goes where it goes
    if (item.type === 'piece' && item.id.startsWith('mon-')) {
      const o = Object.values(items).find(q => q.type === 'piece' && !q.holder && /^(mana-|smana|bomb-)/.test(q.id)
        && Math.abs(q.x - item.x) < .02 && Math.abs(q.z - item.z) < .02 && Math.abs(q.y - item.y) < .05);
      if (o) item.carrying = o.id; else delete item.carrying;
    }
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(item)}});
    return {out, changed: true, itemsChanged: true};
  }
  // the radio: a link to play (only while it's quiet, only from near it, only while it's put down), and how long
  // the track turned out to be (from whoever put it on: it stops then, or at five minutes)
  if (m.type === 'radio') {
    if (!item || item.type !== 'radio' || item.holder || !player.pose || player.inactive) return refuse();
    if (flat(player.pose, item) > PICKUP_RANGE + 1) return refuse();
    if (item.play && now < item.play.until) return refuse();
    const link = radioLink(m.url);
    if (!link) return refuse();
    item.play = {u: radioKey(link), at: now + 1500, until: now + 1500 + RADIO_MAX_MS, by: player.id};
    player.lastActive = now;
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(item)}});
    return {out, changed: true, itemsChanged: true};
  }
  // a track that won't play (an error, or nothing coming out for half a minute): off, so another can go on. Said
  // by whoever put it on, or (if they've gone) anyone, or else by two different people
  if (m.type === 'radio-dead') {
    if (!item || item.type !== 'radio' || !item.play || now >= item.play.until) return refuse();
    const play = item.play, setterHere = room.players().some(p => p && p.id === play.by && !p.inactive);
    play.dead = [...new Set([...(play.dead || []), player.id])];
    if (player.id !== play.by && setterHere && play.dead.length < 2) return {out, changed: true, itemsChanged: true};
    play.until = now;
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(item)}});
    return {out, changed: true, itemsChanged: true};
  }
  if (m.type === 'radio-len') {
    if (!item || item.type !== 'radio' || !item.play || item.play.by !== player.id || !Number.isFinite(m.ms) || m.ms < 1000) return refuse();
    item.play.until = Math.min(item.play.until, item.play.at + Math.round(m.ms) + 500);
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(item)}});
    return {out, changed: true, itemsChanged: true};
  }
  if (m.type === 'drop') {
    if (!item || item.holder !== player.id || !player.pose) return refuse();
    if (worn(item) && kothActive(room.koth)) return refuse();   // no taking it off mid-game
    // put down where they aimed, or tossed and settled nearby: never far from them
    let dx = Number(m.x) - player.pose.x, dz = Number(m.z) - player.pose.z;
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) { dx = 0; dz = 0; }
    const d = Math.hypot(dx, dz);
    if (d > 4) { dx *= 4 / d; dz *= 4 / d; }
    const y = Number.isFinite(m.y) ? Math.max(-.5, Math.min(4, m.y)) : null;
    dropAt(item, player.pose, dx, dz, y);
    if (Number.isFinite(m.yaw)) item.yaw = Math.round(m.yaw * 1000) / 1000;
    // a painting hung on a wall, leant against one or laid down
    if (item.type === 'painting' && Number.isFinite(m.tilt)) item.tilt = Math.round(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, m.tilt)) * 1000) / 1000;
    if (item.type === 'painting') item.roll = Number.isFinite(m.roll) ? Math.round(Math.max(-Math.PI, Math.min(Math.PI, m.roll)) * 1000) / 1000 : 0;
    if (item.type === 'painting') item.hung = m.hung === true;   // on its nail, or wherever it settled
    // a painting's tumble to where it settled (it has to end there, and start near whoever let it go)
    let path = item.type === 'painting' ? cleanPath(m.path) : undefined;
    if (path) {
      const a = path[0], b = path[path.length - 1];
      if (Math.hypot(a[0] - player.pose.x, a[2] - player.pose.z) > 4 || Math.hypot(b[0] - item.x, b[1] - item.y, b[2] - item.z) > .05) path = undefined;
    }
    // how it fell (start and velocity): everyone replays the same fall to where it came to rest
    const fp = m.fall && Array.isArray(m.fall.p) && m.fall.p.length === 3 && m.fall.p.every(Number.isFinite) ? m.fall.p : null;
    const fv = m.fall && Array.isArray(m.fall.v) && m.fall.v.length === 3 && m.fall.v.every(Number.isFinite) ? m.fall.v : null;
    const fall = fp && fv && Math.hypot(fp[0] - player.pose.x, fp[2] - player.pose.z) < 4 && Math.hypot(...fv) < 15
      ? {p: fp.map(v => Math.round(v * 1000) / 1000), v: fv.map(v => Math.round(v * 1000) / 1000)} : undefined;
    out.push({to: 'all', msg: {type: 'item', item: cleanItem(item), ...(path ? {path} : {fall})}});
    // what the mon was carrying comes along to where it's put (if nobody's taken it meanwhile)
    // (unless it's put down with another one: then that's what it has, and the old one stays where it was)
    if (item.carrying) {
      const o = items[item.carrying];
      const taken = Object.values(items).some(q => q !== o && q.type === 'piece' && !q.holder && /^(mana-|smana|bomb-)/.test(q.id)
        && Math.abs(q.x - item.x) < .02 && Math.abs(q.z - item.z) < .02);
      if (o && !o.holder && !taken) { Object.assign(o, {x: item.x, y: item.y, z: item.z, yaw: item.yaw}); out.push({to: 'all', msg: {type: 'item', item: cleanItem(o)}}); }
      delete item.carrying;
    }
    return {out, changed: true, itemsChanged: true};
  }
  // Paintings that moved without anyone holding them: knocked by one being put down, or left with nothing
  // under them when one was picked up. Worked out by the player who did it; only paintings near them, only
  // so far from where they were.
  if (m.type === 'settle') {
    if (!player.pose || player.inactive || !Array.isArray(m.items) || m.items.length > SETTLE_MAX) return {out, changed: false};
    let moved = false;
    for (const s of m.items) {
      const it = s && typeof s.id === 'string' ? items[s.id] : null;
      if (!it || it.type !== 'painting' || it.holder) continue;
      const [x, y, z, yaw, tilt, roll] = ['x', 'y', 'z', 'yaw', 'tilt', 'roll'].map(k => Number(s[k]));
      if (![x, y, z, yaw, tilt, roll].every(Number.isFinite) || y < -.5 || y > 4) continue;
      if (flat(player.pose, it) > SETTLE_RANGE || Math.hypot(x - player.pose.x, z - player.pose.z) > SETTLE_RANGE || Math.hypot(x - it.x, y - it.y, z - it.z) > SETTLE_MOVE) continue;
      Object.assign(it, {x: r3(x), y: r3(y), z: r3(z), yaw: r3(yaw), tilt: r3(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, tilt))), roll: r3(Math.max(-Math.PI, Math.min(Math.PI, roll))), hung: false});
      let path = cleanPath(s.path);
      if (path && Math.hypot(path[path.length - 1][0] - it.x, path[path.length - 1][1] - it.y, path[path.length - 1][2] - it.z) > .05) path = undefined;
      out.push({to: 'all', msg: {type: 'item', item: cleanItem(it), ...(path ? {path} : {})}});
      moved = true;
    }
    return {out, changed: moved, itemsChanged: moved};
  }
  if (m.type === 'toggle') {
    if (!item || item.holder !== player.id || item.type === 'crown') return {out, changed: false};
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
    if (room.koth) { Object.assign(room.koth, {cause: 'punch', causeBy: player.id}); room.koth.names[player.id] = player.name || ''; }
    const dropped = releaseItems(items, target);
    out.push(...dropped);
    return {out, changed: true, itemsChanged: dropped.length > 0};
  }
  // the hopper filled again (it takes RELOAD_MS, everyone sees it done)
  if (m.type === 'reload') {
    const gun = Object.values(items).find(it => it.holder === player.id && it.type === 'paintball');
    if (!gun || now < (gun.reloadUntil || 0) || (Number.isInteger(gun.ammo) ? gun.ammo : MAG_SIZE) >= MAG_SIZE) return {out, changed: false};
    gun.ammo = MAG_SIZE; gun.reloadUntil = now + RELOAD_MS; player.lastActive = now;
    out.push({to: 'all', msg: {type: 'reload', id: gun.id, from: player.id, time: now}});
    return {out, changed: true, itemsChanged: true};
  }
  if (m.type === 'shoot') {
    const gun = Object.values(items).find(it => it.holder === player.id && it.type === 'paintball');
    if (!gun || !player.pose || now - player.lastShot < SHOT_INTERVAL_MS) return {out, changed: false};
    // nothing left in the hopper, or still reloading it
    if (!Number.isInteger(gun.ammo)) gun.ammo = MAG_SIZE;
    if (gun.ammo <= 0 || now < (gun.reloadUntil || 0)) return {out, changed: false};
    const o = cleanSplat({p: m.o, n: [0, 1, 0], c: 0, s: 0})?.p, v = Array.isArray(m.v) && m.v.length === 3 && m.v.every(Number.isFinite) ? m.v.map(x => Math.round(x * 100) / 100) : null;
    const c = Number.isInteger(m.c) && m.c >= 0 && m.c <= 0xffffff ? m.c : null, s = Number.isInteger(m.s) && m.s >= 0 && m.s <= 0xffffff ? m.s : 0;
    if (!o || !v || c === null || Math.hypot(o[0] - player.pose.x, o[2] - player.pose.z) > 3 || Math.hypot(...v) > 80) return {out, changed: false};
    player.lastShot = now; player.lastActive = now; gun.ammo--;
    const hit = m.hit ? cleanSplat({...m.hit, c, s}) : null;
    let target = null, local = null;
    if (typeof m.target === 'string' && m.target !== player.id) {
      target = room.players().find(p => p && p.id === m.target && p.pose && !p.inactive) || null;
      local = target ? cleanSplat({...(m.local || {}), c, s}) : null;
      if (target && Math.hypot(target.pose.x - player.pose.x, target.pose.z - player.pose.z) > 70) target = null;
    }
    const parts = target ? [] : paintingParts(m.parts, p => cleanSplat({...p, c, s}), items);
    const t = Number.isFinite(m.t) ? Math.round(Math.max(0, Math.min(2.5, m.t)) * 1000) / 1000 : 1;
    out.push({to: 'all', msg: {type: 'shot', from: player.id, o, v, c, s, t, hit: target ? null : hit, parts, target: target?.id || '',
      local: target ? local : null, time: now}});
    let marksChanged = false, itemsChanged = false, kothChanged = false;
    // a paintball knocks the crown off when it lands
    if (target && kothActive(room.koth) && Object.values(items).some(it => worn(it) && it.holder === target.id)) {
      const k = room.koth;
      k.hits = [...(k.hits || []), {target: target.id, at: now + Math.round(t * 1000), by: player.id}].slice(-20);
      k.names[player.id] = player.name || '';
      kothChanged = true;
    }
    if ((hit || parts.length) && !target && room.marks) {
      pruneSplats(room.marks, now);
      for (const sp of [hit, ...parts]) if (sp) room.marks.splats.push({...sp, at: now});
      if (room.marks.splats.length > MAX_SPLATS) room.marks.splats.splice(0, room.marks.splats.length - MAX_SPLATS);
      marksChanged = true;
    }
    // a paintball knocks you back (on your own screen) but you keep hold of what you've got (bar a crown)
    return {out, changed: true, marksChanged, itemsChanged, kothChanged};
  }
  if (m.type === 'spray') {
    const can = Object.values(items).find(it => it.holder === player.id && it.type === 'spray');
    const mark = cleanSpray(m);
    if (!can || !mark || !player.pose || now - player.lastSpray < SPRAY_INTERVAL_MS) return {out, changed: false};
    // door marks are in the door's own space, a door-width from its hinge at most
    if (mark.d !== undefined ? Math.hypot(...mark.p) > 3 : Math.hypot(mark.p[0] - player.pose.x, mark.p[2] - player.pose.z) > SPRAY_RANGE + 1)
      return {out, changed: false};
    player.lastSpray = now; player.lastActive = now;
    delete mark.t;
    const parts = paintingParts(m.parts, cleanSpray, items);
    for (const q of parts) delete q.t;
    out.push({to: 'all', msg: {type: 'spray', from: player.id, mark, parts, time: now}});
    if (room.marks) {
      room.marks.sprays.push(...[mark, ...parts].map(s => ({...s, t: now})));     // (stamped: tags and ink in order on a reload)
      if (room.marks.sprays.length > MAX_SPRAYS) room.marks.sprays.splice(0, room.marks.sprays.length - MAX_SPRAYS);
    }
    return {out, changed: true, marksChanged: !!room.marks};
  }
  return {out, changed: false};
}

// ------------------------------------------------------------------ king of the hill
// Moves a game along: the grace period running out, paintballs landing, the crown changing heads,
// someone reaching a minute. Runs after every message and whenever the room's timer goes off.
// room: {items, koth, players: () => [player records]}
export function kothTick(room, now) {
  const out = [], k = room.koth, items = room.items || {};
  if (!kothActive(k)) { if (k) { delete k.cause; delete k.causeBy; delete k.lostAt; } return {out, kothChanged: false, itemsChanged: false}; }
  const crown = Object.values(items).find(it => it.type === 'crown');
  const players = room.players ? room.players() : [];
  const nameOf = id => players.find(p => p && p.id === id)?.name || k.names[id] || '';
  const send = (event, extra = {}) => out.push({to: 'all', msg: {type: 'koth', koth: publicKoth(k, now), event, ...extra}});
  let kothChanged = false, itemsChanged = false;
  // the grace period's over: whoever has it on starts banking from that moment
  if (k.state === 'grace' && now >= k.graceEnds) {
    k.state = 'running'; k.since = k.graceEnds; kothChanged = true;
    send('grace', {by: k.wearer, byName: k.wearer ? nameOf(k.wearer) : ''});
  }
  // the wearer got there (judged before any knock this moment: they had it on until now)
  if (k.state === 'running' && k.wearer && kothTime(k, k.wearer, now) >= KOTH_WIN_MS) {
    k.times[k.wearer] = KOTH_WIN_MS; k.since = now;
    Object.assign(k, {state: 'done', winner: k.wearer, winnerName: nameOf(k.wearer), endedAt: now, hits: []});
    delete k.cause; delete k.causeBy; delete k.lostAt;
    send('win', {by: k.winner, byName: k.winnerName, time: KOTH_WIN_MS});
    return {out, kothChanged: true, itemsChanged};
  }
  // paintballs that have landed knock it off their target
  if (k.hits?.length) {
    const due = k.hits.filter(h => h.at <= now);
    if (due.length) {
      k.hits = k.hits.filter(h => h.at > now); kothChanged = true;
      for (const h of due) {
        if (!crown || crown.holder !== h.target || !crown.on) continue;
        // it takes CROWN_HITS of them, close enough together: the first only counts
        const st = k.struck && k.struck.target === h.target && h.at - k.struck.at < CROWN_HIT_WINDOW_MS ? k.struck : {target: h.target, n: 0};
        k.struck = {target: h.target, n: st.n + 1, at: h.at};
        if (k.struck.n < CROWN_HITS) { send('struck', {by: h.target, byName: nameOf(h.target), from: h.by || '', fromName: h.by ? nameOf(h.by) : '', n: k.struck.n}); continue; }
        delete k.struck;
        const target = players.find(p => p && p.id === h.target);
        k.cause = 'paintball'; k.causeBy = h.by || ''; k.lostAt = h.at;   // it came off when the ball landed
        for (const o of releaseItems({[crown.id]: crown}, target || {id: h.target, pose: null})) out.push(o);
        itemsChanged = true;
      }
    }
  }
  // the crown came off its wearer's head (punched, shot, left, or put back by the room)
  if (k.wearer && (!crown || crown.holder !== k.wearer || !crown.on)) {
    const id = k.wearer;
    const end = Math.min(now, k.lostAt ?? now);
    if (k.state === 'running') k.times[id] = (k.times[id] || 0) + Math.max(0, end - k.since);
    k.wearer = ''; k.droppedAt = now; kothChanged = true; delete k.struck;
    send('lost', {by: id, byName: nameOf(id), time: k.times[id] || 0, how: k.cause || '',
      from: k.causeBy || '', fromName: k.causeBy ? nameOf(k.causeBy) : ''});
  }
  // someone put it on
  if (!k.wearer && crown?.holder && crown.on) {
    k.wearer = crown.holder; k.since = Math.max(now, k.graceEnds); k.names[crown.holder] = nameOf(crown.holder);
    kothChanged = true;
    send('take', {by: crown.holder, byName: k.names[crown.holder], time: k.times[crown.holder] || 0});
  }
  // nobody's picked it up for a minute: the game's off and the crown goes back where it started
  if (!k.wearer && now - k.droppedAt >= KOTH_UNCLAIMED_MS) {
    Object.assign(k, {state: 'cancelled', endedAt: now, hits: []}); kothChanged = true;
    const home = crown && ITEM_SPAWNS.find(s => s.id === crown.id);
    if (home) {
      Object.assign(crown, cleanItem({...home, holder: null, on: false}));
      out.push({to: 'all', msg: {type: 'item', item: cleanItem(crown)}}); itemsChanged = true;
    }
    send('cancel');
  }
  delete k.cause; delete k.causeBy; delete k.lostAt;
  return {out, kothChanged, itemsChanged};
}
// when the game next needs a look even if nobody does anything (ms since epoch), or null
export function kothNext(k) {
  if (!kothActive(k)) return null;
  const at = [];
  if (k.state === 'grace') at.push(k.graceEnds);
  if (k.wearer) at.push(Math.max(k.since, k.graceEnds) + KOTH_WIN_MS - (k.times[k.wearer] || 0));
  else at.push(k.droppedAt + KOTH_UNCLAIMED_MS);
  for (const h of k.hits || []) at.push(h.at);
  return Math.min(...at);
}
export {freshKoth, publicKoth};

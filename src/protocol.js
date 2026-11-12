// Shared by the browser, the Cloudflare Worker and the local dev server.
// Only these small, validated values ever cross the network.
import {EMOTE_LIST, EMOTE_IDS} from './emotes.js';

export const MAX_PLAYERS = 32;
export const CHAT_MAX = 180;
export const CHAT_INTERVAL_MS = 900;
export const CHAT_TTL_MS = 8000;
export const POSE_INTERVAL_MS = 45;
export const INACTIVE_MS = 5 * 60 * 1000;
export const IDLE_RESET_MS = 3 * 60 * 1000;   // nobody's done anything for this long: every item goes back where it started
export const ROOMS = ['office'];
export const PICKUP_RANGE = 2.6;     // metres from a player's feet to an item they can grab
export const PUNCH_RANGE = 3.2;      // server-side check (clients reach PUNCH_REACH, up to PUNCH_REACH_FAST more at speed)
export const PUNCH_REACH = 2.2, PUNCH_REACH_FAST = .55;
export const PUNCH_COOLDOWN_MS = 290;
export const PUNCH_DURATION = .5;
export const PUNCH_COMBO_MS = 800;   // punch again within this and the other hand throws
export const SHOT_INTERVAL_MS = 160;   // paintball rate of fire
export const SPRAY_INTERVAL_MS = 450;
export const SPRAY_RANGE = 3.2;        // metres from a player to the wall they tag
export const SPLAT_LIFE_MS = 180000;   // paint fades away after three minutes
export const MAX_SPLATS = 700;         // paint marks the room remembers (oldest go first; they last 3 minutes now)
export const MAX_SPRAYS = 150;
export const ITEM_TYPES = ['flashlight', 'paintball', 'spray', 'bucket', 'crown', 'painting', 'marker', 'piece', 'radio'];
// The radio plays a YouTube or SoundCloud link, everyone at the same point in it, for five minutes at most.
export const RADIO_MAX_MS = 5 * 60 * 1000;
// one more link can wait its turn (it.next: {u, by}): it goes on this long after the one playing stops
export const RADIO_GAP_MS = 1500;
// what a radio is playing at `now`: its play, or (once that's over) the one queued, starting just after it. The
// server makes that its play when it next hears about the radio (server/room.js promoteRadio); until then every
// page works it out the same way, so it starts on time everywhere.
export function radioNow(it, now) {
  const p = it?.play, q = it?.next;
  if (!q || !p || now < p.until) return p || null;
  const at = p.until + RADIO_GAP_MS;
  return {u: q.u, at, until: at + RADIO_MAX_MS, by: q.by};
}
// what a link is: {kind: 'yt', id} or {kind: 'sc', url}, or null for anything else
export function radioLink(text) {
  if (typeof text !== 'string' || text.length > 400) return null;
  let u;
  try { u = new URL(text.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  const id = v => (/^[A-Za-z0-9_-]{11}$/.test(v || '') ? v : null);
  if (host === 'youtube.com') {
    const v = u.pathname === '/watch' ? u.searchParams.get('v') : (u.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/) || [])[2];
    return id(v) ? {kind: 'yt', id: v} : null;
  }
  if (host === 'youtu.be') { const v = u.pathname.slice(1).split('/')[0]; return id(v) ? {kind: 'yt', id: v} : null; }
  if ((host === 'soundcloud.com' || host === 'on.soundcloud.com') && u.pathname.length > 1 && /^[\w\-/.%~]+$/.test(u.pathname))
    return {kind: 'sc', url: `https://${host}${u.pathname}`};
  return null;
}
// the link as it's kept and sent: a YouTube id as 'yt:ID', SoundCloud as its address
export const radioKey = l => (l.kind === 'yt' ? `yt:${l.id}` : l.url);

// Emotes: every id the game knows (src/emotes.js); which clip plays is the settings' choice.
export const EMOTES = Object.freeze(EMOTE_LIST.map(e => Object.freeze({id: e.id, label: e.label})));
// how far into an emote its clock runs: looping emotes keep going until you move (it then just stays at the end)
export const EMOTE_MAX_TIME = 900;
export const EMOTE_DURATION = EMOTE_MAX_TIME;   // (the old name)

export const normalizeEmote = id => (typeof id === 'string' && EMOTE_IDS.has(id) ? id : '');
export const normalizeEmoteTime = t => (Number.isFinite(t) ? Math.max(0, Math.min(EMOTE_MAX_TIME, t)) : 0);

const num = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// Returns a clean pose object, or null when the packet is unusable.
export function sanitizePose(p) {
  if (!p || typeof p !== 'object') return null;
  const x = num(p.x, -500, 500), y = num(p.y, -5, 20), z = num(p.z, -500, 500);
  const yaw = num(p.yaw, -1e4, 1e4), pitch = num(p.pitch, -2, 2);
  if ([x, y, z, yaw, pitch].includes(null)) return null;
  const room = ROOMS.includes(p.room) ? p.room : ROOMS[0];
  const emote = normalizeEmote(p.emote);
  return {
    x: round(x), y: round(y), z: round(z), yaw: round(yaw), pitch: round(pitch), room,
    g: Number.isFinite(p.g) ? round(Math.max(-2, Math.min(5, p.g))) : 0,     // height of the floor under their feet
    pc: Number.isInteger(p.pc) && p.pc >= -1 && p.pc <= 0xffffff ? p.pc : -1,   // paint loaded in their paintball gun (-1: a mix)
    crouch: Number.isFinite(p.crouch) ? round(Math.max(0, Math.min(1, p.crouch))) : 0,
    jumpTime: Number.isFinite(p.jumpTime) ? round(Math.max(-1, Math.min(1.1, p.jumpTime))) : -1,
    jumpPower: Number.isFinite(p.jumpPower) ? round(Math.max(.5, Math.min(1.5, p.jumpPower)), 2) : 1,
    emote, emoteTime: emote ? round(normalizeEmoteTime(p.emoteTime)) : 0,
    typing: p.typing === true,
    punchTime: Number.isFinite(p.punchTime) ? round(Math.max(-1, Math.min(PUNCH_DURATION, p.punchTime))) : -1,
    punchHand: p.punchHand === 1 ? 1 : 0,        // which fist: combos alternate
    vc: p.vc === 1 ? 1 : 0,                      // in voice chat
  };
}

export function samePose(a, b) {
  if (!a || !b) return false;
  for (const k of ['x', 'y', 'z', 'g', 'pc', 'yaw', 'pitch', 'room', 'crouch', 'jumpTime', 'jumpPower', 'emote', 'emoteTime', 'typing', 'punchTime', 'punchHand', 'vc'])
    if (a[k] !== b[k]) return false;
  return true;
}

export function sanitizeChat(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
}

// A painting's tumble as worked out by whoever let it go (src/settle.js): [x, y, z, qx, qy, qz, qw] frames,
// 30 a second, a few seconds at most, each near the one before. Anything else: none.
export const PATH_MAX = 181;
// Paintings coming down (a 'settle', or a 'drop' with its tumble): each message at most this big and this many
// paintings (a pile coming down goes in several), and at most SETTLE_PER_S of them a second from anyone.
export const SETTLE_BYTES = 14000, SETTLE_MAX = 16, SETTLE_PER_S = 12;
// The paintball gun's hopper: this many balls (the ones you can see in it), one gone each shot; empty, a click
// reloads it, which takes RELOAD_MS. And it takes CROWN_HITS paintballs, landing within CROWN_HIT_WINDOW_MS of
// each other, to knock the crown off.
// Marker ink: a stroke at a time, sent as it's drawn (INK_PTS points a message at most); the room keeps the last
// MAX_INK_STROKES strokes, each up to MAX_STROKE_PTS points, MAX_INK_PTS in all (oldest go first). A point is
// [x, y, z, nx, ny, nz, u, v]: where it is and which way the surface faces (in its host's own space: the world,
// a door 'd<k>', a painting 'p<id>', or a player 'a<id>', whose ink isn't kept), and the level's lightmap there.
export const INK_PTS = 64, MAX_INK_STROKES = 16000, MAX_STROKE_PTS = 500, MAX_INK_PTS = 800000, INK_PER_S = 25;
// a stroke's points packed flat as whole numbers (positions in mm, normals in hundredths, uv in 1e-4), for keeping
// and for sending to someone joining (in parts: a WebSocket message can't be over 1 MiB)
const INK_SCALE = [1000, 1000, 1000, 100, 100, 100, 1e4, 1e4];
export const packInk = pts => { const out = new Array(pts.length * 8); pts.forEach((q, i) => { for (let k = 0; k < 8; k++) out[i * 8 + k] = Math.round(q[k] * INK_SCALE[k]); }); return out; };
export function unpackInk(flat) {
  if (!Array.isArray(flat) && !ArrayBuffer.isView(flat)) return null;
  const out = [];
  for (let i = 0; i + 8 <= flat.length; i += 8) { const q = new Array(8); for (let k = 0; k < 8; k++) q[k] = flat[i + k] / INK_SCALE[k]; out.push(q); }
  return out;
}
export const INK_PART_PTS = 9000;     // points to a part (about 350 KB of JSON)

// Ink packed small, for keeping and for sending to someone joining: each stroke's points as whole numbers
// (packInk's), each one the difference from the point before (zigzagged into a varint: a byte or two each, as a
// line's points are close together and its surface rarely turns). [varint: bytes of meta][meta: JSON, one entry a
// stroke, its n points][the strokes' numbers, in order]. The page asks for it deflated (binary messages:
// src/net.js); without that, it's sent as JSON as before.
export const INK_BIN_PTS = 60000;     // points to a binary part (deflated, a few hundred KB)
function writer(size = 1 << 16) {
  let buf = new Uint8Array(size), n = 0;
  const need = k => { if (n + k > buf.length) { const b = new Uint8Array(Math.max(n + k, buf.length * 2)); b.set(buf.subarray(0, n)); buf = b; } };
  return {
    varint(v) { need(5); v >>>= 0; while (v > 127) { buf[n++] = (v & 127) | 128; v >>>= 7; } buf[n++] = v; },
    bytes(b) { need(b.length); buf.set(b, n); n += b.length; },
    done: () => buf.slice(0, n),
  };
}
const zig = v => ((v << 1) ^ (v >> 31)) >>> 0, unzig = v => (v >>> 1) ^ -(v & 1);
// strokes: [{...fields, q: Int32Array of packInk numbers (8 a point)}] -> Uint8Array. Meta keeps every field but q.
export function encodeInk(strokes) {
  const w = writer(64 + strokes.reduce((t, s) => t + s.q.length * 1.4, 0) | 0);
  const meta = new TextEncoder().encode(JSON.stringify(strokes.map(s => { const {q, ...rest} = s; return {...rest, n: q.length / 8 | 0}; })));
  w.varint(meta.length); w.bytes(meta);
  const prev = new Int32Array(8);
  for (const s of strokes) {
    const q = s.q;
    for (let i = 0; i + 8 <= q.length; i += 8) for (let k = 0; k < 8; k++) { const v = q[i + k]; w.varint(zig(i ? v - prev[k] : v)); prev[k] = v; }
  }
  return w.done();
}
// -> [{...fields, q: Int32Array}] (null if it's not ink)
export function decodeInk(bytes) {
  try {
    let at = 0;
    const varint = () => { let v = 0, shift = 0, b; do { b = bytes[at++]; v |= (b & 127) << shift; shift += 7; } while (b & 128 && shift < 35); return v >>> 0; };
    const len = varint(), meta = JSON.parse(new TextDecoder().decode(bytes.subarray(at, at + len))); at += len;
    if (!Array.isArray(meta)) return null;
    const out = [];
    for (const m of meta) {
      const n = Math.max(0, Math.min(1e6, m.n | 0)), q = new Int32Array(n * 8);
      for (let i = 0; i < n * 8; i += 8) for (let k = 0; k < 8; k++) q[i + k] = unzig(varint()) + (i ? q[i - 8 + k] : 0);
      if (at > bytes.length) return null;
      const {n: _, ...rest} = m;
      out.push({...rest, q});
    }
    return out;
  } catch { return null; }
}
// packed numbers -> floats, 8 a point (what src/ink.js keeps)
export function inkFloats(q) { const f = new Float32Array(q.length); for (let i = 0; i < q.length; i++) f[i] = q[i] / INK_SCALE[i & 7]; return f; }
// deflate/inflate (deflate-raw: CompressionStream, in browsers, Workers and Node alike)
export async function deflate(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); }
export async function inflate(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }

// A finished stroke made lighter: points that sit on the line between their neighbours (within SIMPLIFY_TOL, the
// surface turning hardly at all) dropped. It looks the same; most strokes lose half their points or more.
export const SIMPLIFY_TOL = .0015;
export function simplifyInk(pts, tol = SIMPLIFY_TOL) {
  const n = pts.length;
  if (n < 3) return pts;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const A = pts[a], B = pts[b], dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L2 = dx * dx + dy * dy + dz * dz;
    let far = -1, worst = tol * tol;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i];
      let t = L2 > 0 ? ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy + (P[2] - A[2]) * dz) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = A[0] + dx * t - P[0], ey = A[1] + dy * t - P[1], ez = A[2] + dz * t - P[2];
      let d = ex * ex + ey * ey + ez * ez;
      // (and where the surface turns: a point whose normal is off both ends' stays)
      const turn = 1 - Math.min(P[3] * A[3] + P[4] * A[4] + P[5] * A[5], P[3] * B[3] + P[4] * B[4] + P[5] * B[5]);
      if (turn > .002) d = Math.max(d, worst + 1e-9);
      if (d > worst) { worst = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}
const inkNum = (v, k) => Math.round(v * k) / k;
export function cleanInkPoints(pts, localHost) {
  if (!Array.isArray(pts) || !pts.length || pts.length > INK_PTS) return null;
  const out = [];
  for (const q of pts) {
    if (!Array.isArray(q) || q.length !== 8 || !q.every(Number.isFinite)) return null;
    if (localHost && Math.hypot(q[0], q[1], q[2]) > 4) return null;
    const n = Math.hypot(q[3], q[4], q[5]);
    if (n < .5 || n > 1.5) return null;
    out.push([inkNum(q[0], 1000), inkNum(q[1], 1000), inkNum(q[2], 1000), inkNum(q[3] / n, 100), inkNum(q[4] / n, 100), inkNum(q[5] / n, 100),
      inkNum(Math.max(0, Math.min(1, q[6])), 1e4), inkNum(Math.max(0, Math.min(1, q[7])), 1e4)]);
  }
  return out;
}
export const INK_HOST = /^(w|d\d{1,3}|p[a-z0-9]{1,12}|a[0-9a-f]{16})$/;
export const MAG_SIZE = 33, RELOAD_MS = 1300, CROWN_HITS = 2, CROWN_HIT_WINDOW_MS = 15000;
export function cleanPath(path) {
  if (!Array.isArray(path) || path.length < 2 || path.length > PATH_MAX) return undefined;
  const out = [];
  for (const f of path) {
    if (!Array.isArray(f) || f.length !== 7 || !f.every(Number.isFinite)) return undefined;
    const prev = out[out.length - 1];
    if (prev && Math.hypot(f[0] - prev[0], f[1] - prev[1], f[2] - prev[2]) > 1) return undefined;   // 30 m/s is plenty
    out.push(f.map((v, i) => (i < 3 ? round(v) : Math.round(Math.max(-1, Math.min(1, v)) * 1e4) / 1e4)));
  }
  return out;
}
// the highest painting art id (the whole collection: src/collection.js)
import {ART_MAX} from './collection.js';
export {ART_MAX};
// Held items (flashlights): shared room state. Positions are where they lie when nobody holds them.
export function cleanItem(it) {
  const out = {id: it.id, type: ITEM_TYPES.includes(it.type) ? it.type : 'flashlight', x: round(it.x), y: round(it.y), z: round(it.z), yaw: round(it.yaw),
    holder: it.holder || null, on: it.on === true};
  // a painting: how it tilts (0 hung upright, a little back leaning on a wall, -pi/2 lying face up) and which art
  if (out.type === 'painting') {
    out.tilt = Number.isFinite(it.tilt) ? round(Math.max(-1.571, Math.min(1.571, it.tilt))) : 0;
    out.roll = Number.isFinite(it.roll) ? round(Math.max(-3.142, Math.min(3.142, it.roll))) : 0;
    out.art = Number.isInteger(it.art) && it.art > 0 && it.art <= ART_MAX ? it.art : 1;
    if (typeof it.hung === 'boolean') out.hung = it.hung;     // on its nail (held still), or free to fall
  }
  if (out.type === 'paintball') out.ammo = Number.isInteger(it.ammo) ? Math.max(0, Math.min(MAG_SIZE, it.ammo)) : MAG_SIZE;
  // the radio: what it's playing (the link, when it started and when it stops, by the server's clock)
  if (out.type === 'radio' && it.play && typeof it.play.u === 'string' && it.play.u.length <= 300 && Number.isFinite(it.play.at) && Number.isFinite(it.play.until))
    out.play = {u: it.play.u, at: Math.round(it.play.at), until: Math.round(it.play.until), ...(typeof it.play.by === 'string' ? {by: it.play.by.slice(0, 40)} : {})};
  if (out.type === 'radio' && out.play && it.next && typeof it.next.u === 'string' && it.next.u.length <= 300)
    out.next = {u: it.next.u, ...(typeof it.next.by === 'string' ? {by: it.next.by.slice(0, 40)} : {})};
  return out;
}
// paintings are items pt1, pt2, ...: marks on one are kept in its own space and ride along with it
export const PAINTING_ID = /^pt\d{1,4}$/;
// Where a mark sits relative to paintings: `pi`, on that painting (p, n, up, v in its own space);
// `occ`, the paintings that stood in front of it when it went on ([x, y, z, yaw, tilt, art, roll?] each),
// which keep their shape cut out of it wherever they go afterwards.
function paintingFields(s, out) {
  if (typeof s.pi === 'string' && PAINTING_ID.test(s.pi)) { out.pi = s.pi; delete out.d; return out; }
  if (Array.isArray(s.occ)) {
    const occ = s.occ.slice(0, 6).map(a => Array.isArray(a) && (a.length === 6 || a.length === 7) && a.every(Number.isFinite) && a.slice(0, 3).every(v => Math.abs(v) <= 500)
      ? [...a.slice(0, 5).map(v => round(v)), Math.max(1, Math.min(ART_MAX, Math.round(a[5]))), ...(a.length === 7 ? [round(a[6])] : [])] : null).filter(Boolean);
    if (occ.length) out.occ = occ;
  }
  return out;
}
// how clients and the server name a mark when asking to scrub it
export const splatId = s => s.pi ? `${s.s}@${s.pi}` : String(s.s);
export const sprayId = s => `${s.piece}@${s.p.join(',')}${s.pi ? '#' + s.pi : ''}`;

// Names only ever show in the chat log.
export function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[\u0000-\u001f\u007f\u2028\u2029<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

// Avatar looks: a flat object of short trait ids. Clients normalize it against
// the cards.art catalogs; the server only checks its shape.
export function sanitizeLook(look) {
  if (!look || typeof look !== 'object' || Array.isArray(look)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(look)) {
    if (++n > 24) break;
    if (!/^[a-zA-Z]{1,16}$/.test(k) || typeof v !== 'string' || !/^[#a-zA-Z0-9_-]{1,40}$/.test(v)) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

const vec = (v, lim) => Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(x) && Math.abs(x) <= lim)
  ? v.map(x => round(x)) : null;
const unit = v => { const a = vec(v, 1.01); if (!a) return null; const l = Math.hypot(...a); return l > .9 && l < 1.1 ? a : null; };
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// A paint mark on the level: where, which way the surface faces, colour and shape.
export function cleanSplat(s) {
  if (!s || typeof s !== 'object') return null;
  const p = vec(s.p, 500), n = unit(s.n), c = int(s.c, 0, 0xffffff), seed = int(s.s, 0, 0xffffff);
  if (!p || !n || c === null || seed === null) return null;
  const out = {p, n, c, s: seed};
  const v = s.v !== undefined ? unit(s.v) : null;                 // which way the paint was flying
  if (v) out.v = v;
  if (s.d !== undefined && s.d !== null) {           // on a swinging door: p and n are in that door's hinge space
    const d = int(s.d, 0, 999);
    if (d === null) return null;
    out.d = d;
  }
  if (Number.isFinite(s.t) && s.t > 0) out.t = Math.round(s.t);     // when the room took it (what goes over what, on a reload)
  return paintingFields(s, out);
}

// A sprayed graffiti piece: which piece, where, facing, its up direction and size.
export function cleanSpray(s) {
  if (!s || typeof s !== 'object') return null;
  const p = vec(s.p, 500), n = unit(s.n), up = unit(s.up);
  const piece = typeof s.piece === 'string' && /^[a-zA-Z0-9_.-]{1,48}$/.test(s.piece) ? s.piece : null;
  const size = Number.isFinite(s.size) ? round(Math.max(.1, Math.min(4.5, s.size)), 2) : null;
  if (!p || !n || !up || !piece || size === null) return null;
  const out = {p, n, up, piece, size};
  const v = s.v !== undefined ? unit(s.v) : null;                 // which way it was sprayed
  if (v) out.v = v;
  // how far back along the throw its thrower stood (the paint reaches anything up to just short of them)
  if (Number.isFinite(s.r)) out.r = round(Math.max(.3, Math.min(6, s.r)), 2);
  if (s.d !== undefined && s.d !== null) {           // on a swinging door: in that door's hinge space
    const d = int(s.d, 0, 999);
    if (d === null) return null;
    out.d = d;
  }
  return paintingFields(s, out);
}

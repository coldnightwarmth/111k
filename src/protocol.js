// Shared by the browser, the Cloudflare Worker and the local dev server.
// Only these small, validated values ever cross the network.

export const MAX_PLAYERS = 32;
export const CHAT_MAX = 180;
export const CHAT_INTERVAL_MS = 900;
export const CHAT_TTL_MS = 8000;
export const POSE_INTERVAL_MS = 45;
export const INACTIVE_MS = 5 * 60 * 1000;
export const IDLE_RESET_MS = 3 * 60 * 1000;   // nobody's done anything for this long: every item goes back where it started
export const ROOMS = ['office'];
export const PICKUP_RANGE = 2.6;     // metres from a player's feet to an item they can grab
export const PUNCH_RANGE = 2.4;      // server-side check (clients aim at 1.95)
export const PUNCH_COOLDOWN_MS = 290;
export const PUNCH_DURATION = .5;
export const PUNCH_COMBO_MS = 800;   // punch again within this and the other hand throws
export const SHOT_INTERVAL_MS = 160;   // paintball rate of fire
export const SPRAY_INTERVAL_MS = 450;
export const SPRAY_RANGE = 3.2;        // metres from a player to the wall they tag
export const SPLAT_LIFE_MS = 60000;    // paint fades away after a minute
export const MAX_SPLATS = 400;         // paint marks the room remembers (oldest go first)
export const MAX_SPRAYS = 150;
export const ITEM_TYPES = ['flashlight', 'paintball', 'spray', 'bucket', 'crown', 'painting'];

// Emotes map to Pose_<id> clips in the avatar model.
export const EMOTES = Object.freeze([
  ['wave', 'Wave'], ['dab', 'Dab'], ['heart', 'Heart hands'], ['airguitar', 'Air guitar'], ['victory', 'Victory'],
  ['shrug', 'Shrug'], ['think', 'Thinking'], ['point', 'Point'], ['flex', 'Flex'], ['bow', 'Bow'],
  ['salute', 'Salute'], ['crossarms', 'Arms crossed'], ['highfive', 'High five'], ['fistbump', 'Fist bump'],
  ['micdrop', 'Mic drop'], ['boxer', 'Boxing guard'], ['kneel', 'Kneel'], ['leanback', 'Lean back'],
  ['lookout', 'Lookout'], ['conductor', 'Conductor'], ['curtsey', 'Curtsey'], ['lunge', 'Hero lunge'],
  ['crane', 'Crane balance'], ['summon', 'Spellcast'], ['welcome', 'Welcome'], ['tpose', 'T-pose'],
  ['mnshy', 'Shy'], ['mnreverie', 'Daydream'], ['mncheekrest', 'Cheek rest'], ['mnlistening', 'Listening'],
].map(([id, label]) => Object.freeze({id, label, clip: `Pose_${id}`})));
const EMOTE_IDS = new Set(EMOTES.map(e => e.id));
export const EMOTE_DURATION = 2;

export const normalizeEmote = id => (typeof id === 'string' && EMOTE_IDS.has(id) ? id : '');
export const normalizeEmoteTime = t => (Number.isFinite(t) ? Math.max(0, Math.min(EMOTE_DURATION, t)) : 0);

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
    pc: Number.isInteger(p.pc) && p.pc >= -1 && p.pc <= 0xffffff ? p.pc : -1,   // paint loaded in their marker (-1: a mix)
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

// Held items (flashlights): shared room state. Positions are where they lie when nobody holds them.
export function cleanItem(it) {
  const out = {id: it.id, type: ITEM_TYPES.includes(it.type) ? it.type : 'flashlight', x: round(it.x), y: round(it.y), z: round(it.z), yaw: round(it.yaw),
    holder: it.holder || null, on: it.on === true};
  // a painting: how it tilts (0 hung upright, a little back leaning on a wall, -pi/2 lying face up) and which art
  if (out.type === 'painting') {
    out.tilt = Number.isFinite(it.tilt) ? round(Math.max(-1.571, Math.min(1.571, it.tilt))) : 0;
    out.roll = Number.isFinite(it.roll) ? round(Math.max(-3.142, Math.min(3.142, it.roll))) : 0;
    out.art = Number.isInteger(it.art) && it.art > 0 && it.art < 10000 ? it.art : 1;
  }
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
      ? [...a.slice(0, 5).map(v => round(v)), Math.max(1, Math.min(9999, Math.round(a[5]))), ...(a.length === 7 ? [round(a[6])] : [])] : null).filter(Boolean);
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

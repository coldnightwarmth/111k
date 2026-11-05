// Shared by the browser, the Cloudflare Worker and the local dev server.
// Only these small, validated values ever cross the network.

export const MAX_PLAYERS = 32;
export const CHAT_MAX = 180;
export const CHAT_INTERVAL_MS = 900;
export const CHAT_TTL_MS = 15000;
export const POSE_INTERVAL_MS = 45;
export const INACTIVE_MS = 5 * 60 * 1000;
export const ROOMS = ['office'];

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
    crouch: Number.isFinite(p.crouch) ? round(Math.max(0, Math.min(1, p.crouch))) : 0,
    jumpTime: Number.isFinite(p.jumpTime) ? round(Math.max(-1, Math.min(1.1, p.jumpTime))) : -1,
    emote, emoteTime: emote ? round(normalizeEmoteTime(p.emoteTime)) : 0,
    typing: p.typing === true,
  };
}

export function samePose(a, b) {
  if (!a || !b) return false;
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'room', 'crouch', 'jumpTime', 'emote', 'emoteTime', 'typing'])
    if (a[k] !== b[k]) return false;
  return true;
}

export function sanitizeChat(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
}

// Every emote 111k knows. Shared by the game, the server (which checks ids and keeps the settings) and
// the /anim page (which previews them and changes the settings).
//
// Two sources of clips:
//   - the original poses (cards.art, made for still images): Pose_<id> in each avatar's base.glb, a two
//     second move into the pose that then holds still;
//   - Emote_<id> in assets/avatars/emotes.glb (tools/blender/emotes.py): a redo of each original that
//     moves in properly and then keeps looping, and the new emotes. Their loop timings: emote-clips.js.
// The settings choose, for each original, which version everyone plays (the original or the redo), and
// which emotes the menu offers at all.
import {EMOTE_CLIPS} from './emote-clips.js';

const ORIGINALS = [
  ['wave', 'Wave'], ['dab', 'Dab'], ['heart', 'Heart hands'], ['airguitar', 'Air guitar'], ['victory', 'Victory'],
  ['shrug', 'Shrug'], ['think', 'Thinking'], ['point', 'Point'], ['flex', 'Flex'], ['bow', 'Bow'],
  ['salute', 'Salute'], ['crossarms', 'Arms crossed'], ['highfive', 'High five'], ['fistbump', 'Fist bump'],
  ['micdrop', 'Mic drop'], ['boxer', 'Boxing guard'], ['kneel', 'Kneel'], ['leanback', 'Lean back'],
  ['lookout', 'Lookout'], ['conductor', 'Conductor'], ['curtsey', 'Curtsey'], ['lunge', 'Hero lunge'],
  ['crane', 'Crane balance'], ['summon', 'Spellcast'], ['welcome', 'Welcome'], ['tpose', 'T-pose'],
  ['mnshy', 'Shy'], ['mnreverie', 'Daydream'], ['mncheekrest', 'Cheek rest'], ['mnlistening', 'Listening'],
  // in the avatar files but never in the menu before
  ['balancekick', 'Balance kick'], ['mnangelspread', 'Angel spread'], ['mnartistlean', 'Artist lean'],
  ['mnbehindback', 'Hands behind back'], ['mnprayer', 'Prayer hands'], ['mnstepturn', 'Step turn'],
  ['oath', 'Oath'], ['powerpunch', 'Power punch'], ['present', 'Present'],
];
const UNLISTED = new Set(['balancekick', 'mnangelspread', 'mnartistlean', 'mnbehindback', 'mnprayer', 'mnstepturn', 'oath', 'powerpunch', 'present']);
const NEW = [
  ['groove', 'Dance'], ['herolanding', 'Hero landing'], ['despair', 'Despair'], ['cry', 'Cry'], ['pirouette', 'Ballerina spin'],
  ['collapse', 'Ragdoll'], ['laugh', 'Laugh'], ['clap', 'Clap'], ['facepalm', 'Facepalm'], ['yawn', 'Yawn'],
  ['sit', 'Sit down'], ['headbang', 'Headbang'], ['cheer', 'Cheer'], ['doze', 'Doze off'], ['robot', 'Robot'],
  ['jumpingjacks', 'Jumping jacks'],
];

// {id, label, original: has a Pose_ clip, made: has an Emote_ clip}
export const EMOTE_LIST = Object.freeze([
  ...ORIGINALS.map(([id, label]) => Object.freeze({id, label, original: true, made: !!EMOTE_CLIPS[id]})),
  ...NEW.map(([id, label]) => Object.freeze({id, label, original: false, made: !!EMOTE_CLIPS[id]})),
]);
export const EMOTE_IDS = new Set(EMOTE_LIST.map(e => e.id));
export const emoteById = id => EMOTE_LIST.find(e => e.id === id) || null;

// The settings: {variant: {id: 'original' | 'redo'}, off: [ids not offered]}. Until changed: every
// original as it was (the nine never offered stay off), and the new ones on.
export const DEFAULT_EMOTE_CONFIG = Object.freeze({variant: {}, off: [...UNLISTED]});

export function cleanEmoteConfig(c) {
  const variant = {}, off = [];
  if (c && typeof c === 'object') {
    for (const [id, v] of Object.entries(c.variant || {})) if (EMOTE_IDS.has(id) && emoteById(id).original && (v === 'redo' || v === 'original')) variant[id] = v;
    if (Array.isArray(c.off)) for (const id of c.off) if (EMOTE_IDS.has(id) && !off.includes(id)) off.push(id);
  } else return {variant: {}, off: [...DEFAULT_EMOTE_CONFIG.off]};
  return {variant, off};
}

// which version plays: originals per the settings (a redo only once it's been made), new ones their own
export function variantOf(id, config) {
  const e = emoteById(id);
  if (!e) return null;
  if (!e.original) return e.made ? 'redo' : null;
  return config?.variant?.[id] === 'redo' && e.made ? 'redo' : 'original';
}
export const clipName = (id, variant) => (variant === 'redo' ? `Emote_${id}` : `Pose_${id}`);
// what the menu offers: every emote that's on and has something to play
export const offeredEmotes = config => EMOTE_LIST.filter(e => !(config?.off || []).includes(e.id) && variantOf(e.id, config));

// where in a clip to be, t seconds into the emote: an Emote_ clip plays its intro once and then loops;
// an original moves into its pose and holds it
export function emoteClipTime(id, variant, t, duration) {
  const timing = variant === 'redo' ? EMOTE_CLIPS[id] : null;
  if (!timing) return Math.min(Math.max(0, t), duration);
  const [a, b] = timing;
  if (t <= b) return Math.max(0, t);
  return a + ((t - a) % (b - a));
}

// Paintings under gravity. A painting put down, dropped or knocked doesn't just stay where it's put: whoever
// does it runs a few seconds of rigid-body physics (Rapier) over the level round about and the paintings near
// by, and sends where each one that moved came to rest, with the way it tumbled there for everyone to play
// back (src/items.js). Players aren't in it: paintings only answer to the level and to each other.
// A painting hung on a wall is on its nail: it holds still and things can rest on it or lean against it.
// Everything else (leant, laid, dropped) is free to slide, tip over an edge or be knocked off a pile, but
// starts asleep: it only moves once something touches it, so a pile nobody touches stays exactly as it is.
import {reportError} from './errors.js';
import * as THREE from 'three';
import {paintingSize} from './paintings.js';
import {PATH_HZ} from './items.js';
import {simulate} from './settle-sim.js';

let rapier = null;
// the engine (about 0.8 MB), on the page: only if there's no worker to run it in (below)
export function loadPhysics() {
  return rapier ||= import('../vendor/rapier/rapier.es.js').then(async m => { await m.default.init(); return m.default; })
    .catch(e => { rapier = null; throw e; });
}

// hung on its nail (said so when it was put up; for older ones, upright and off the floor)
export const isHung = s => (typeof s.hung === 'boolean' ? s.hung : Math.abs(s.tilt || 0) < .3 && s.y > .5);

const STEP = 1 / 60, MAX_TIME = 6, NEAR = 3.2, LEVEL_NEAR = 4.5, WAKE_NEAR = 1.4;
// a pile reaching past NEAR is in it all the same: anything touching what's in, up to this many
const BODY_MAX = 64;
const SUPPORT_DEPTH = .6;
const FRICTION = .7, BOUNCE = .05, DENSITY = 60;
const MOVED = .0015, TURNED = .01;    // less than this and it hasn't really moved
// One that was lying still and only shifted by a hair (a tall stack settling into itself when something's
// put on top): left where it was. Sent every time, a tower crept, and every one of them went with each new one.
const DRIFT = .01, DRIFT_TURN = .035;
const GLIDE = .15, GLIDE_TURN = .35, GLIDE_FRAMES = 5;
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
// from one path frame to another, eased, GLIDE_FRAMES long
function glide(a, b) {
  _qa.set(a[3], a[4], a[5], a[6]); _qb.set(b[3], b[4], b[5], b[6]);
  return Array.from({length: GLIDE_FRAMES}, (_, i) => {
    const t = i / (GLIDE_FRAMES - 1), k = t * t * (3 - 2 * t), q = _qa.clone().slerp(_qb, k);
    return [...[0, 1, 2].map(j => r(a[j] + (b[j] - a[j]) * k)), ...[q.x, q.y, q.z, q.w].map(v => r(v, 1e4))];
  });
}
// Resting contacts sink in by a hair (about a millimetre, even held tight): each painting's box for the
// physics is that much bigger than the painting, so the paintings themselves just touch.
const PAD = .001;
const _e = new THREE.Euler(), _v = new THREE.Vector3();

const quatOf = p => new THREE.Quaternion().setFromEuler(_e.set(p.tilt || 0, p.yaw || 0, p.roll || 0, 'YXZ'));
const r = (v, k = 1000) => Math.round(v * k) / k;
// a pose from where a painting's origin (the middle of its back) is and which way it's turned
export function poseOf(x, y, z, q) {
  _e.setFromQuaternion(q, 'YXZ');
  return {x: r(x), y: r(y), z: r(z), yaw: r(_e.y), tilt: r(_e.x), roll: r(_e.z)};
}

// The same box, turned round to face the other way: its front where its back was (on the wall, the floor,
// whatever it's on) and its back facing out. Hung it shows its stretcher; laid down it's face down.
export function reversed(pose, art) {
  const {d} = paintingSize(art), q = quatOf(pose);
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const o = new THREE.Vector3(pose.x, pose.y, pose.z).addScaledVector(n, d);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));   // half a turn about its own up
  return {...pose, ...poseOf(o.x, o.y, o.z, q)};
}

// The level round about, as triangles for the physics: worked out once for each patch of the space (it doesn't
// move) and kept for the next painting put down near there.
const CELL = 1.5, levelCache = new Map();
function levelNear(hits, center) {
  const key = [center.x, center.y, center.z].map(v => Math.round(v / CELL)).join();
  let level = levelCache.get(key);
  if (!level) {
    const mid = new THREE.Vector3(...key.split(',').map(v => v * CELL));
    level = hits.solidNear(mid, LEVEL_NEAR + CELL * .87);    // (reaching every spot in the patch LEVEL_NEAR round)
    if (levelCache.size > 24) levelCache.delete(levelCache.keys().next().value);
    levelCache.set(key, level);
  }
  return level;
}

// The physics runs in a worker (src/settle-worker.js), so however long it takes the frames keep coming; on the
// page itself only if there's no worker to be had.
let worker = null, workerFailed = false, jobs = 0;
const waiting = new Map();
function physicsWorker() {
  if (worker || workerFailed || typeof Worker === 'undefined') return worker;
  try {
    const url = new URL(`./settle-worker.js${new URL(import.meta.url).search}`, import.meta.url);
    worker = new Worker(url, {type: 'module'});
    worker.onmessage = e => {
      const w = waiting.get(e.data.n);
      if (!w) return;
      waiting.delete(e.data.n);
      if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.out);
    };
    worker.onerror = e => {                     // it couldn't start: everything goes on the page from now on
      e.preventDefault?.();
      console.warn('painting physics worker:', e.message || e); reportError(e.message || 'worker failed', 'physics worker');
      workerFailed = true; worker.terminate(); worker = null;
      for (const w of waiting.values()) w.reject(new Error('worker failed'));
      waiting.clear();
    };
  } catch (e) { workerFailed = true; worker = null; }
  return worker;
}
function inWorker(job) {
  const w = physicsWorker();
  if (!w) return Promise.reject(new Error('no worker'));
  const n = ++jobs;
  return new Promise((resolve, reject) => { waiting.set(n, {resolve, reject}); w.postMessage({n, job}); });
}
async function run(job) {
  if (!workerFailed) {
    try { return await inWorker(job); } catch (e) { if (!workerFailed) throw e; }
  }
  return simulate(await loadPhysics(), job);
}
// get the engine going before it's needed (the page loading it, idle, a while after the space is in)
export function warmPhysics() {
  if (physicsWorker()) inWorker(null).catch(() => {});
  else loadPhysics().catch(() => {});
}

// Let things settle. `paintings`: the states of the paintings lying about (not in anyone's hands, not the one
// moving); `moving`: {state, pose, vel?} the one being put down or dropped, starting awake from `pose`;
// `removed`: the state of one just picked up, whatever rested on it waking up to fall.
// Returns [{id, pose, path?}] for each painting that moved (the moving one always, with no path if it
// stayed just as put), path frames being [x, y, z, qx, qy, qz, qw] of its origin at PATH_HZ.
export async function settle({hits, paintings, moving = null, removed = null, tune = undefined}) {
  const at = moving ? moving.pose : removed;
  const center = new THREE.Vector3(at.x, at.y, at.z);
  const bodies = [], starts = new Map(), wake = [];
  const add = (state, pose, kind, vel) => {
    const {w, h, d} = paintingSize(state.art), q = quatOf(pose);
    const c = new THREE.Vector3(0, 0, d / 2).applyQuaternion(q).add(_v.set(pose.x, pose.y, pose.z));
    bodies.push({id: state.id, c: c.toArray(), q: q.toArray(), half: [w / 2 + PAD, h / 2 + PAD, d / 2 + PAD], d, kind, ...(vel ? {vel: [...vel]} : {})});
    if (kind !== 'fixed') starts.set(state.id, {c, q, d, moving: kind === 'awake', pose});
    // whatever was on (or against) the one taken away has nothing under it now
    if (removed && kind === 'asleep' && c.distanceTo(center) < WAKE_NEAR) wake.push(state.id);
  };
  // the ones near, then whatever's touching those (a tall pile, a row leaning on each other), so nothing in a
  // pile is left hanging when what held it up goes
  const pool = paintings.filter(s => !(moving && s.id === moving.state.id));
  const reach = s => { const {w, h} = paintingSize(s.art); return Math.max(w, h) / 2; };
  const inPile = pool.filter(s => Math.hypot(s.x - at.x, s.y - at.y, s.z - at.z) < NEAR).slice(0, BODY_MAX);
  const taken = new Set(inPile.map(s => s.id));
  for (let i = 0; i < inPile.length && inPile.length < BODY_MAX; i++) {
    const a = inPile[i];
    if (isHung(a)) continue;
    for (const b of pool) {
      if (taken.has(b.id) || inPile.length >= BODY_MAX) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < reach(a) + reach(b) + .05) { taken.add(b.id); inPile.push(b); }
    }
  }
  // Well below where it's happening (a painting put on top of a tall pile, one pulled out of it) the pile is as good
  // as the floor: held still, so only what can really move is worked out, and a tall stack doesn't jitter itself
  // over. (Above where one was pulled out, everything's free to come down.)
  const base = at.y - (tune?.depth ?? SUPPORT_DEPTH);
  for (const s of inPile) add(s, s, isHung(s) || s.y < base ? 'fixed' : 'asleep');
  if (moving) add(moving.state, moving.pose, 'awake', moving.vel);
  if (removed && !wake.length && !moving) return [];          // nothing near it to fall: no physics to run
  const raw = await run({level: levelNear(hits, center), bodies, wake, step: STEP, maxTime: MAX_TIME, every: Math.round(1 / STEP / PATH_HZ),
    friction: FRICTION, bounce: BOUNCE, density: DENSITY, tune});
  const out = [];
  for (const b of raw) {
    const s = starts.get(b.id), [tx, ty, tz] = b.t;
    const fq = new THREE.Quaternion(...b.q);
    const lost = ![tx, ty, tz].every(Number.isFinite) || ty < center.y - 8;   // fell out of the world
    const shift = s.c.distanceTo(_v.set(tx, ty, tz)), turned = s.q.angleTo(fq);
    const still = lost || (shift < MOVED && turned < TURNED) || (!s.moving && shift < DRIFT && turned < DRIFT_TURN);
    if (still) { if (s.moving) out.push({id: b.id, pose: s.pose}); continue; }
    // the path up to where it last moved
    let end = b.path.length - 1;
    while (end > 0 && b.path[end - 1].every((v, i) => v === b.path[end][i])) end--;
    const o = new THREE.Vector3(0, 0, -s.d / 2).applyQuaternion(fq).add(_v.set(tx, ty, tz));
    // Lying still and only shifted a little (a pile coming down by one when one's pulled from under it): just a
    // short glide there, a fraction of the size of every jitter on the way (39 paintings coming down at once
    // sent the lot otherwise).
    const path = !s.moving && shift < GLIDE && turned < GLIDE_TURN ? glide(b.path[0], b.path[end]) : b.path.slice(0, end + 1);
    out.push({id: b.id, pose: poseOf(o.x, o.y, o.z, fq), path});
  }
  return out;
}

// Paintings under gravity. A painting put down, dropped or knocked doesn't just stay where it's put: whoever
// does it runs a few seconds of rigid-body physics (Rapier) over the level round about and the paintings near
// by, and sends where each one that moved came to rest, with the way it tumbled there for everyone to play
// back (src/items.js). Players aren't in it: paintings only answer to the level and to each other.
// A painting hung on a wall is on its nail: it holds still and things can rest on it or lean against it.
// Everything else (leant, laid, dropped) is free to slide, tip over an edge or be knocked off a pile, but
// starts asleep: it only moves once something touches it, so a pile nobody touches stays exactly as it is.
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
const FRICTION = .7, BOUNCE = .05, DENSITY = 60;
const MOVED = .0015, TURNED = .01;    // less than this and it hasn't really moved
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
      console.warn('painting physics worker:', e.message || e);
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
export async function settle({hits, paintings, moving = null, removed = null}) {
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
  for (const s of paintings) {
    if (moving && s.id === moving.state.id) continue;
    if (Math.hypot(s.x - at.x, s.y - at.y, s.z - at.z) < NEAR) add(s, s, isHung(s) ? 'fixed' : 'asleep');
  }
  if (moving) add(moving.state, moving.pose, 'awake', moving.vel);
  if (removed && !wake.length && !moving) return [];          // nothing near it to fall: no physics to run
  const raw = await run({level: levelNear(hits, center), bodies, wake, step: STEP, maxTime: MAX_TIME, every: Math.round(1 / STEP / PATH_HZ),
    friction: FRICTION, bounce: BOUNCE, density: DENSITY});
  const out = [];
  for (const b of raw) {
    const s = starts.get(b.id), [tx, ty, tz] = b.t;
    const fq = new THREE.Quaternion(...b.q);
    const lost = ![tx, ty, tz].every(Number.isFinite) || ty < center.y - 8;   // fell out of the world
    const still = lost || (s.c.distanceTo(_v.set(tx, ty, tz)) < MOVED && s.q.angleTo(fq) < TURNED);
    if (still) { if (s.moving) out.push({id: b.id, pose: s.pose}); continue; }
    // the path up to where it last moved
    let end = b.path.length - 1;
    while (end > 0 && b.path[end - 1].every((v, i) => v === b.path[end][i])) end--;
    const o = new THREE.Vector3(0, 0, -s.d / 2).applyQuaternion(fq).add(_v.set(tx, ty, tz));
    out.push({id: b.id, pose: poseOf(o.x, o.y, o.z, fq), path: b.path.slice(0, end + 1)});
  }
  return out;
}

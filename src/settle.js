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

let rapier = null;
// the engine (about 0.8 MB): fetched the first time a painting's in your hands, ready by the time it's put down
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
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();

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

// Let things settle. `paintings`: the states of the paintings lying about (not in anyone's hands, not the one
// moving); `moving`: {state, pose, vel?} the one being put down or dropped, starting awake from `pose`;
// `removed`: the state of one just picked up, whatever rested on it waking up to fall.
// Returns [{id, pose, path?}] for each painting that moved (the moving one always, with no path if it
// stayed just as put), path frames being [x, y, z, qx, qy, qz, qw] of its origin at PATH_HZ.
export async function settle({hits, paintings, moving = null, removed = null}) {
  const R = await loadPhysics();
  const at = moving ? moving.pose : removed;
  const center = new THREE.Vector3(at.x, at.y, at.z);
  const world = new R.World({x: 0, y: -9.81, z: 0});
  world.timestep = STEP;
  world.integrationParameters.normalizedAllowedLinearError = .0002;
  world.integrationParameters.numSolverIterations = 8;
  try {
    const level = hits.solidNear(center, LEVEL_NEAR);
    if (level.indices.length) world.createCollider(R.ColliderDesc.trimesh(level.vertices, level.indices).setFriction(FRICTION), world.createRigidBody(R.RigidBodyDesc.fixed()));
    const bodies = [];
    const add = (state, pose, kind, vel) => {
      const {w, h, d} = paintingSize(state.art), q = quatOf(pose);
      const c = new THREE.Vector3(0, 0, d / 2).applyQuaternion(q).add(_v.set(pose.x, pose.y, pose.z));
      const desc = (kind === 'fixed' ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic().setCcdEnabled(true).setSleeping(kind === 'asleep')
        .setLinearDamping(.05).setAngularDamping(.2)).setTranslation(c.x, c.y, c.z).setRotation({x: q.x, y: q.y, z: q.z, w: q.w});
      if (vel) desc.setLinvel(...vel);
      const body = world.createRigidBody(desc);
      world.createCollider(R.ColliderDesc.cuboid(w / 2 + PAD, h / 2 + PAD, d / 2 + PAD).setFriction(FRICTION).setRestitution(BOUNCE).setDensity(DENSITY), body);
      if (kind !== 'fixed') bodies.push({id: state.id, body, d, start: {c: c.clone(), q: q.clone()}, path: [], moving: kind === 'awake', pose});
    };
    for (const s of paintings) {
      if (moving && s.id === moving.state.id) continue;
      if (Math.hypot(s.x - at.x, s.y - at.y, s.z - at.z) < NEAR) add(s, s, isHung(s) ? 'fixed' : 'asleep');
    }
    if (moving) add(moving.state, moving.pose, 'awake', moving.vel);
    // whatever was on (or against) the one taken away has nothing under it now
    if (removed) for (const b of bodies) if (b.start.c.distanceTo(center) < WAKE_NEAR) b.body.wakeUp();
    const frame = b => {
      const t = b.body.translation(), q = b.body.rotation();
      const o = _v.set(0, 0, -b.d / 2).applyQuaternion(_q.set(q.x, q.y, q.z, q.w)).add(t);
      return [r(o.x), r(o.y), r(o.z), r(q.x, 1e4), r(q.y, 1e4), r(q.z, 1e4), r(q.w, 1e4)];
    };
    for (const b of bodies) b.path.push(frame(b));
    const every = Math.round(1 / STEP / PATH_HZ);
    for (let k = 1; k <= MAX_TIME / STEP; k++) {
      world.step();
      if (k % every === 0) for (const b of bodies) b.path.push(frame(b));
      if (k > 6 && bodies.every(b => b.body.isSleeping())) { if (k % every) for (const b of bodies) b.path.push(frame(b)); break; }
    }
    const out = [];
    for (const b of bodies) {
      const t = b.body.translation(), q = b.body.rotation();
      const fq = new THREE.Quaternion(q.x, q.y, q.z, q.w);
      const lost = ![t.x, t.y, t.z].every(Number.isFinite) || t.y < center.y - 8;   // fell out of the world
      const still = lost || (b.start.c.distanceTo(_v.set(t.x, t.y, t.z)) < MOVED && b.start.q.angleTo(fq) < TURNED);
      if (still) { if (b.moving) out.push({id: b.id, pose: b.pose}); continue; }
      // the path up to where it last moved
      let end = b.path.length - 1;
      while (end > 0 && b.path[end - 1].every((v, i) => v === b.path[end][i])) end--;
      const o = new THREE.Vector3(0, 0, -b.d / 2).applyQuaternion(fq).add(_v.set(t.x, t.y, t.z));
      out.push({id: b.id, pose: poseOf(o.x, o.y, o.z, fq), path: b.path.slice(0, end + 1)});
    }
    return out;
  } finally {
    world.free();
  }
}

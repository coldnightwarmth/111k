// Player characters: Drifellas and Driladies from cards.art, assembled from a
// small base (rig, body, animations) plus one compressed file per worn trait.
// The look logic (which parts show, finishes, head scales) is cards.art's own.
import * as THREE from 'three';
import {GLTFLoader} from '../vendor/three/GLTFLoader.js';
import {MeshoptDecoder} from '../vendor/three/meshopt_decoder.module.js';
import {createAvatarAppearance} from './cards/drifmaker-avatar.mjs';
import {normalizeAppearance, characterId} from './cards/drifmaker-config.mjs';
import {partsFor} from './looks.js';
import {normalizeEmote, normalizeEmoteTime, PUNCH_DURATION} from './protocol.js';
import {jumpHeight} from './motion.js';
import {ghostMaterial} from './level.js';

export const AVATAR_SCALE = .66;
const ROOT = new URL('../assets/avatars/', import.meta.url).href;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
const once = (key, make) => {
  if (!cache.has(key)) cache.set(key, make().catch(error => { cache.delete(key); throw error; }));
  return cache.get(key);
};
const character = name => once(name, async () => {
  const [index, base, extra] = await Promise.all([
    fetch(`${ROOT}${name}/index.json`).then(r => { if (!r.ok) throw Error(`avatar index ${r.status}`); return r.json(); }),
    loader.loadAsync(`${ROOT}${name}/base.glb`),
    loader.loadAsync(`${ROOT}moves.glb`).catch(() => null),   // clips made for 111k (the punch)
  ]);
  const clips = [...base.animations, ...(extra?.animations || [])];
  return {index, scene: base.scene, clips};
});
const part = (name, file) => once(`${name}/${file}`, () => loader.loadAsync(`${ROOT}${name}/${file}`));

// Download everything a look needs (used to warm up the picker and peers).
export async function preloadLook(look) {
  const name = characterId(look), c = await character(name);
  await Promise.all(partsFor(look, c.index).map(p => part(name, c.index.parts[p].file)));
}

// Geometry and textures are shared; each visitor owns their bones.
function cloneRig(source) {
  const clone = source.clone(true), lookup = new Map(), skeletons = new Map();
  (function pair(a, b) { lookup.set(a, b); for (let i = 0; i < a.children.length; i++) pair(a.children[i], b.children[i]); })(source, clone);
  source.traverse(original => {
    if (!original.isSkinnedMesh) return;
    const mesh = lookup.get(original);
    if (!skeletons.has(original.skeleton)) {
      const skeleton = original.skeleton.clone();
      skeleton.bones = original.skeleton.bones.map(bone => lookup.get(bone));
      skeletons.set(original.skeleton, skeleton);
    }
    mesh.bind(skeletons.get(original.skeleton), original.bindMatrix);
    mesh.frustumCulled = false;
  });
  return clone;
}

// A trait file carries its own copy of the rig; rebind its meshes to ours by bone name.
function attachPart(model, gltf, name, parentName) {
  const src = gltf.scene.getObjectByName(name);
  if (!src) return;
  const bones = new Map();
  model.traverse(o => { if (o.isBone) bones.set(o.name, o); });
  const copy = src.clone(true);
  const pairs = [];
  (function pair(a, b) { pairs.push([a, b]); for (let i = 0; i < a.children.length; i++) pair(a.children[i], b.children[i]); })(src, copy);
  for (const [a, b] of pairs) {
    if (!a.isSkinnedMesh) continue;
    const skeleton = new THREE.Skeleton(a.skeleton.bones.map(bone => bones.get(bone.name) || bone), a.skeleton.boneInverses);
    b.bind(skeleton, a.bindMatrix);
    b.frustumCulled = false;
  }
  const parent = (parentName && model.getObjectByName(parentName.replace(/[\s.:/[\]]/g, ''))) || model.children[0] || model;
  parent.add(copy);
}

// A Drifella's body is only a head, a tail and two hands: the arms come with the shirt, as its sleeves.
// Some shirts (the collection's vests, harness, coverall, toga and short-sleeved shirts) were sculpted
// without them, which left hands floating by the body. So every body gets a pair of bare arms in its own
// skin, rigged to the arm bones and tucked inside the sleeves, shown whenever the shirt doesn't cover them.
const ARM_BONES = ['UpperArmL', 'ForearmL', 'HandL', 'UpperArmR', 'ForearmR', 'HandR'];
// which arm segments a mesh has (vertices mostly on the upper arm / forearm bones)
function armCoverage(mesh) {
  const out = {upper: false, fore: false}, j = mesh.geometry?.attributes.skinIndex, w = mesh.geometry?.attributes.skinWeight;
  if (!mesh.isSkinnedMesh || !j || !w) return out;
  const name = i => mesh.skeleton.bones[i]?.name || '';
  for (let v = 0; v < j.count && !(out.upper && out.fore); v++) {
    let best = 0, bone = -1;
    for (let k = 0; k < 4; k++) if (w.getComponent(v, k) > best) { best = w.getComponent(v, k); bone = j.getComponent(v, k); }
    const n = name(bone);
    if (/^UpperArm[LR]$/.test(n)) out.upper = true; else if (/^Forearm[LR]$/.test(n)) out.fore = true;
  }
  return out;
}
function addArms(model) {
  let body = null;
  const part = o => { for (let q = o; q && q !== model; q = q.parent) if (/^Drif_/.test(q.name)) return q.name; return ''; };
  model.traverse(o => { if (!body && o.isSkinnedMesh && part(o) === 'Drif_Body' && !Array.isArray(o.material)
    && /Body_Main|Fur/.test(o.material.name) && o.skeleton.bones.some(b => b.name === 'HandL')) body = o; });
  if (!body) return null;
  const own = armCoverage(body);
  if (own.upper && own.fore) return null;                       // this body has its own arms
  const bones = body.skeleton.bones, at = name => bones.findIndex(b => b.name === name);
  if (ARM_BONES.some(n => at(n) < 0)) return null;
  // bone positions at rest, in the body geometry's own space
  const toGeo = body.bindMatrixInverse, m = new THREE.Matrix4();
  const rest = i => new THREE.Vector3().setFromMatrixPosition(m.copy(body.skeleton.boneInverses[i]).invert().premultiply(toGeo));
  // the skin colour (and texture spot) of the wrist: the hand vertex nearest the forearm
  const g = body.geometry, pos = g.attributes.position, sj = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const handL = at('HandL'), wristL = rest(handL), v = new THREE.Vector3();
  let sample = -1, near = Infinity;
  for (let i = 0; i < pos.count; i++) {
    let main = -1, best = 0;
    for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > best) { best = sw.getComponent(i, k); main = sj.getComponent(i, k); }
    if (main !== handL) continue;
    const d = v.fromBufferAttribute(pos, i).distanceToSquared(wristL);
    if (d < near) { near = d; sample = i; }
  }
  if (sample < 0) return null;
  const SEG = 14, RINGS = 12, positions = [], indices = [], skinIndex = [], skinWeight = [];
  const extra = Object.entries(g.attributes).filter(([k]) => !['position', 'normal', 'skinIndex', 'skinWeight', 'tangent'].includes(k));
  const extras = extra.map(() => []);
  for (const side of ['L', 'R']) {
    const up = at('UpperArm' + side), fore = at('Forearm' + side), hand = at('Hand' + side);
    const shoulder = rest(up), elbow = rest(fore), wrist = rest(hand);
    const len = shoulder.distanceTo(wrist), dir = wrist.clone().sub(shoulder).normalize();
    const start = shoulder.clone().addScaledVector(dir, -.06 * len), end = wrist.clone().addScaledVector(dir, .05 * len);
    const span = start.distanceTo(end), kElbow = start.distanceTo(elbow) / span;
    // a frame round the arm
    const a = Math.abs(dir.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(dir, a).normalize(), w = new THREE.Vector3().crossVectors(u, dir);
    const base = positions.length / 3;
    for (let r = 0; r <= RINGS; r++) {
      const t = r / RINGS;
      // a soft taper, a touch fuller at the shoulder and the elbow, rounded shut at both ends
      const radius = len * (.15 - .03 * t + .006 * Math.exp(-(((t - kElbow) / .08) ** 2))) * Math.sqrt(Math.max(0, 1 - ((2 * t - 1) ** 16)));
      const c = start.clone().addScaledVector(dir, t * span);
      // the upper arm bone to the elbow, the forearm after it, blended across the joint
      const blend = THREE.MathUtils.smoothstep(t, kElbow - .07, kElbow + .07);
      for (let s = 0; s < SEG; s++) {
        const ang = s / SEG * Math.PI * 2;
        const p = c.clone().addScaledVector(u, Math.cos(ang) * radius).addScaledVector(w, Math.sin(ang) * radius);
        positions.push(p.x, p.y, p.z);
        skinIndex.push(up, fore, 0, 0); skinWeight.push(1 - blend, blend, 0, 0);
        extra.forEach(([, attr], e) => { for (let k = 0; k < attr.itemSize; k++) extras[e].push(attr.getComponent(sample, k)); });
      }
    }
    for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) {
      const i0 = base + r * SEG + s, i1 = base + r * SEG + (s + 1) % SEG, j0 = i0 + SEG, j1 = i1 + SEG;
      indices.push(i0, i1, j0, i1, j1, j0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  extra.forEach(([k, attr], e) => geo.setAttribute(k, new THREE.Float32BufferAttribute(extras[e], attr.itemSize)));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // faces wound the same way as the body's? make sure normals point out from the arm's axis
  const n = geo.attributes.normal, p0 = new THREE.Vector3().fromBufferAttribute(geo.attributes.position, RINGS / 2 * SEG);
  const axis = rest(at('UpperArmL')).lerp(rest(at('HandL')), .5);
  if (new THREE.Vector3().fromBufferAttribute(n, RINGS / 2 * SEG).dot(p0.sub(axis)) < 0) { geo.index.array.reverse(); geo.index.needsUpdate = true; geo.computeVertexNormals(); }
  const arms = new THREE.SkinnedMesh(geo, body.material);
  arms.name = 'Drif_Body_Arms';
  arms.position.copy(body.position); arms.quaternion.copy(body.quaternion); arms.scale.copy(body.scale);
  body.parent.add(arms);
  arms.bind(body.skeleton, body.bindMatrix);
  arms.frustumCulled = false;
  return arms;
}

// Apply camera aim to the head after the clip mixer, restoring the untouched
// pose before the next mixer tick so rotations never accumulate.
function createLookPose(model) {
  const head = model.getObjectByName('Head');
  const base = head?.quaternion.clone();
  const axis = new THREE.Vector3(), localAxis = new THREE.Vector3(), parentRotation = new THREE.Quaternion(), turn = new THREE.Quaternion();
  let pitch = 0, applied = false;
  return {
    restore() { if (applied && head) head.quaternion.copy(base); applied = false; },
    apply(dt, target) {
      if (!head) return;
      pitch += (THREE.MathUtils.clamp(Number.isFinite(target) ? target : 0, -1.15, 1.15) - pitch) * (1 - Math.exp(-Math.max(0, dt) * 14));
      model.getWorldQuaternion(parentRotation); axis.set(1, 0, 0).applyQuaternion(parentRotation);
      base.copy(head.quaternion);
      head.parent.getWorldQuaternion(parentRotation).invert();
      localAxis.copy(axis).applyQuaternion(parentRotation).normalize();
      head.quaternion.premultiply(turn.setFromAxisAngle(localAxis, -THREE.MathUtils.clamp(pitch * .72, -.72, .72)));
      applied = true;
    },
  };
}

export async function createAvatar(look) {
  look = normalizeAppearance(look);
  const name = characterId(look), c = await character(name);
  // the hatless look's parts too: a crown takes the place of any hat (and shows the hair under it)
  const needed = [...new Set([...partsFor(look, c.index), ...partsFor({...look, hat: 'none'}, c.index)])];
  const parts = await Promise.all(needed.map(p => part(name, c.index.parts[p].file)));
  const model = cloneRig(c.scene);
  needed.forEach((p, i) => attachPart(model, parts[i], p, c.index.parts[p].parent));
  const arms = addArms(model);
  const wardrobe = createAvatarAppearance(model, look);
  wardrobe.setAppearance(look);
  // bare arms only where the shirt has no sleeves of its own
  if (arms) {
    const covered = {upper: false, fore: false};
    model.traverse(o => {
      let shirt = false, vis = true;
      for (let q = o; q && q !== model; q = q.parent) { if (/^Drif_Shirt_/.test(q.name)) shirt = true; if (q.visible === false) vis = false; }
      if (!shirt || !vis || !o.isSkinnedMesh) return;
      const c = armCoverage(o); covered.upper ||= c.upper; covered.fore ||= c.fore;
    });
    arms.visible = !(covered.upper && covered.fore);
  }
  // seen from a camera pressed up close (third person against a wall), you dissolve rather than clip
  // the camera inside any part of this avatar ghosts all of it (ghostAll), not just the nearby faces
  // and ghostOn: whether faces near the camera dither away (other people always; you only in third person)
  const ghostOwn = {ghostAll: {value: 0}, ghostOn: {value: 0}};
  model.traverse(o => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) o.material = o.material.map(m => m.isShaderMaterial ? m : ghostMaterial(m, ghostOwn));
    else if (!o.material.isShaderMaterial) o.material = ghostMaterial(o.material, ghostOwn);
  });
  model.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  model.scale.setScalar(AVATAR_SCALE); model.rotation.y = Math.PI;
  const root = new THREE.Group(); root.name = 'avatar'; root.add(model);
  // the body's extent (around its root, before it moves), for telling when the camera is inside it
  const bodyBox = new THREE.Box3().setFromObject(root).expandByScalar(.06), camLocal = new THREE.Vector3();
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map(c.clips.map(clip => [clip.name, mixer.clipAction(clip)]));
  // holding something swaps each locomotion clip for its right-hand-holding twin
  const HOLD = {Neutral: 'Hold_Right', Walk: 'Walk_Hold_Right', Crouch: 'Crouch_Hold_Right', Crouch_Walk: 'Crouch_Walk_Hold_Right',
    Jump: 'Jump_Hold_Right'};
  const holdNames = new Set(Object.values(HOLD));
  for (const [clip, action] of actions) {
    action.play().setEffectiveWeight(0);
    if (clip.startsWith('Jump') || clip.startsWith('Pose_') || clip.startsWith('Punch')) action.paused = true;
  }
  const look_ = createLookPose(model);
  const socket = model.getObjectByName('CardSocketR') || model.getObjectByName('CardSocket.R');  // the loader strips the dot
  const punch = actions.get('Punch'), fallbackPunch = actions.get('Pose_powerpunch');
  const punches = [punch, actions.get('PunchL') || punch];   // right, left
  // throwing the other hand mid-punch: the last one keeps playing out its recovery underneath
  let lastPt = -1, lastHand = 0, tail = null;
  const punchCurve = k => Math.max(0, Math.min(1, k / .08, (1 - k) / .3));
  const head = model.getObjectByName('Head');
  let moving = false, speed = 0, walkBlend = 0, holdBlend = 0, hideHead = false, crowned = false;

  return {
    root, model, socket, hand: model.getObjectByName('HandR') || model.getObjectByName('Hand.R'),
    handL: model.getObjectByName('HandL') || model.getObjectByName('Hand.L'), look, scale: AVATAR_SCALE, eye: 1.45, pitch: 0,
    setVisible(v) { model.visible = v; },
    head,
    // wearing the crown: their hat comes off for it
    setCrowned(on) {
      if (on === crowned) return;
      crowned = on;
      wardrobe.setAppearance(on ? {...look, hat: 'none'} : look);
      wardrobe.applyHeadScale();
    },
    // first person: keep the body (so you see your own punch) but fold the head away
    setHeadless(v) { hideHead = v; },
    // velocity: horizontal speed (m/s); motion: {crouch, jumpTime, jumpPower, emote, emoteTime, pitch, punchTime, holding}
    update(dt, velocity, motion = {}) {
      look_.restore(); wardrobe.restoreHeadScale();
      model.position.y = jumpHeight(motion.jumpTime ?? -1, motion.jumpPower);
      const emote = normalizeEmote(motion.emote);
      const pt = motion.punchTime ?? -1, punching = pt >= 0 && pt <= PUNCH_DURATION;
      if (emote && !punching) {
        const clip = `Pose_${emote}`, chosen = actions.get(clip);
        if (chosen) {
          for (const [key, action] of actions) action.setEffectiveWeight(key === clip ? 1 : 0);
          chosen.time = Math.min(normalizeEmoteTime(motion.emoteTime), chosen.getClip().duration);
          mixer.update(0); wardrobe.applyHeadScale(); this.fold();
          return;
        }
      }
      holdBlend += ((motion.holding ? 1 : 0) - holdBlend) * (1 - Math.exp(-dt * 12));
      speed += (Math.min(velocity, 6) - speed) * (1 - Math.exp(-dt * 14));
      moving = speed > (moving ? .045 : .10);
      walkBlend += ((moving ? 1 : 0) - walkBlend) * (1 - Math.exp(-dt * 16));
      const crouch = THREE.MathUtils.clamp(motion.crouch || 0, 0, 1), time = motion.jumpTime ?? -1;
      const airborne = time >= 0 && time <= 1.1;
      const jumpWeight = airborne ? Math.min(1, time / .06, (1.1 - time) / .1) : 0;
      // the punch: a full-body clip, snapped in and eased back out. Hands alternate in a combo.
      const hand = motion.punchHand === 1 ? 1 : 0;
      if (punching && lastPt >= 0 && hand !== lastHand) tail = {hand: lastHand, t: lastPt, age: 0};
      lastPt = punching ? pt : -1; lastHand = hand;
      if (tail) { tail.t += dt; tail.age += dt; if (tail.t > PUNCH_DURATION || tail.age > .25 || !punching) tail = null; }
      const k = punching ? pt / PUNCH_DURATION : 1;
      const mainWeight = punching ? punchCurve(k) : 0;
      // the old fist pulls back over a quarter second while the new one takes over
      const tailWeight = tail ? punchCurve(tail.t / PUNCH_DURATION) * (1 - tail.age / .25) * (1 - mainWeight * .6) : 0;
      const punchWeight = Math.min(1, mainWeight + tailWeight);
      const weights = new Map();
      if (punch) {
        const main = punches[hand];
        main.time = k * main.getClip().duration; weights.set(main, mainWeight);
        if (tail && punches[tail.hand] !== main) { const a = punches[tail.hand]; a.time = tail.t / PUNCH_DURATION * a.getClip().duration; weights.set(a, tailWeight); }
      } else if (fallbackPunch) { fallbackPunch.time = .2; weights.set(fallbackPunch, mainWeight * Math.sin(Math.PI * k)); }
      for (const [clip, action] of actions) {
        if (clip.startsWith('Pose_') || clip.startsWith('Punch')) { action.setEffectiveWeight(weights.get(action) || 0); continue; }
        const base = holdNames.has(clip) ? Object.keys(HOLD).find(n => HOLD[n] === clip) : clip;
        const hw = holdNames.has(clip) ? holdBlend : HOLD[clip] && actions.has(HOLD[clip]) ? 1 - holdBlend : 1;
        const legsOnly = punching ? .35 : 1;   // the punch owns the upper body; keep a little of the stride
        if (base.startsWith('Jump')) { action.time = THREE.MathUtils.clamp(time, 0, 1.1); action.setEffectiveWeight(jumpWeight * hw * (1 - punchWeight * (1 - legsOnly))); continue; }
        const duck = base.startsWith('Crouch'), walk = base.includes('Walk');
        action.setEffectiveWeight((1 - punchWeight * (1 - legsOnly)) * hw * (1 - jumpWeight) * (duck ? crouch : 1 - crouch) * (walk ? walkBlend : 1 - walkBlend));
        action.setEffectiveTimeScale(walk ? THREE.MathUtils.clamp(speed / (duck ? .65 : .85), .55, 2.2) : 1);
      }
      mixer.update(dt);
      wardrobe.applyHeadScale();
      look_.apply(dt, motion.pitch || 0);
      this.fold();
    },
    fold() { if (head && hideHead) head.scale.setScalar(1e-3); },
    // dissolve the whole avatar while the camera is inside it (eased in and out)
    // dither away the faces close to the camera (instead of the near plane slicing through them)
    ghost: ghostOwn,   // its dither uniforms (a crown on its head dissolves with it)
    ghostNear(on) { ghostOwn.ghostOn.value = on ? 1 : 0; },
    ghostFor(cameraPos, dt) {
      root.updateMatrixWorld(); camLocal.copy(cameraPos); root.worldToLocal(camLocal); camLocal.y -= model.position.y;
      const inside = model.visible !== false && root.visible && bodyBox.containsPoint(camLocal) ? 1 : 0;
      const g = ghostOwn.ghostAll;
      g.value += (inside - g.value) * (1 - Math.exp(-dt * 18));
      if (g.value < .002) g.value = 0;
    },
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(model); wardrobe.dispose();
      const skeletons = new Set(); model.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
      for (const s of skeletons) s.dispose();
      root.removeFromParent();
    },
  };
}

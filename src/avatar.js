// Player characters: the default Drifella from cards.art (compressed), with
// the same animation blending as the showroom (walk/crouch/jump/emotes).
import * as THREE from 'three';
import {GLTFLoader} from '../vendor/three/GLTFLoader.js';
import {EMOTES, normalizeEmote, normalizeEmoteTime} from './protocol.js';
import {jumpHeight} from './motion.js';

const AVATAR_URL = new URL('../assets/avatars/drifella-default.glb', import.meta.url).href;
export const AVATAR_SCALE = .75;
let asset;
export function loadAvatarAsset() {
  asset ??= new GLTFLoader().loadAsync(AVATAR_URL).catch(error => { asset = undefined; throw error; });
  return asset;
}

// Geometry and textures are shared; each visitor owns their bones.
function cloneAvatar(source) {
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

export async function createAvatar() {
  const gltf = await loadAvatarAsset();
  const model = cloneAvatar(gltf.scene);
  model.scale.setScalar(AVATAR_SCALE); model.rotation.y = Math.PI;
  const root = new THREE.Group(); root.name = 'avatar'; root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map(gltf.animations.filter(c => !c.name.includes('Hold_Right')).map(clip => [clip.name, mixer.clipAction(clip)]));
  for (const [name, action] of actions) {
    action.play().setEffectiveWeight(0);
    if (name.startsWith('Jump') || name.startsWith('Pose_')) action.paused = true;
  }
  const look = createLookPose(model);
  let moving = false, speed = 0, walkBlend = 0;

  return {
    root, model,
    setVisible(v) { model.visible = v; },
    // velocity: horizontal speed (m/s); motion: {crouch, jumpTime, emote, emoteTime, pitch}
    update(dt, velocity, motion = {}) {
      look.restore();
      model.position.y = jumpHeight(motion.jumpTime ?? -1);
      const emote = normalizeEmote(motion.emote);
      if (emote) {
        const name = `Pose_${emote}`, chosen = actions.get(name);
        if (chosen) {
          for (const [key, action] of actions) action.setEffectiveWeight(key === name ? 1 : 0);
          chosen.time = Math.min(normalizeEmoteTime(motion.emoteTime), chosen.getClip().duration);
          mixer.update(0);
          return;
        }
      }
      speed += (Math.min(velocity, 5) - speed) * (1 - Math.exp(-dt * 14));
      moving = speed > (moving ? .045 : .10);
      walkBlend += ((moving ? 1 : 0) - walkBlend) * (1 - Math.exp(-dt * 16));
      const crouch = THREE.MathUtils.clamp(motion.crouch || 0, 0, 1), time = motion.jumpTime ?? -1;
      const airborne = time >= 0 && time <= 1.1;
      const jumpWeight = airborne ? Math.min(1, time / .06, (1.1 - time) / .1) : 0;
      for (const [name, action] of actions) {
        if (name.startsWith('Pose_')) { action.setEffectiveWeight(0); continue; }
        if (name.startsWith('Jump')) { action.time = THREE.MathUtils.clamp(time, 0, 1.1); action.setEffectiveWeight(jumpWeight); continue; }
        const duck = name.startsWith('Crouch'), walk = name.includes('Walk');
        action.setEffectiveWeight((1 - jumpWeight) * (duck ? crouch : 1 - crouch) * (walk ? walkBlend : 1 - walkBlend));
        action.setEffectiveTimeScale(walk ? THREE.MathUtils.clamp(speed / (duck ? .65 : .85), .55, 1.8) : 1);
      }
      mixer.update(dt);
      look.apply(dt, motion.pitch || 0);
    },
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(model);
      const skeletons = new Set(); model.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
      for (const s of skeletons) s.dispose();
      root.removeFromParent();
    },
  };
}

export {EMOTES};

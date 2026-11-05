// Held items (for now: flashlights). The server owns who holds what and
// where things lie; this module draws them in the world, in other players'
// hands, and in your own hand, and feeds their beams to the level shader.
import * as THREE from 'three';
import {lighting, MAX_FLASHLIGHTS} from './level.js';
import {EYE_HEIGHT} from './motion.js';

const BEAM_COLOR = new THREE.Color(1, .93, .8);

// A chunky rubberised torch, 26 cm, pointing down its local -z.
function flashlightModel() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({color: 0x1c1d20, roughness: .55, metalness: .3});
  const metal = new THREE.MeshStandardMaterial({color: 0x8a8d92, roughness: .35, metalness: .8});
  const lens = new THREE.MeshBasicMaterial({color: 0x333333, toneMapped: false});
  const add = (geo, mat, z) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = Math.PI / 2; m.position.z = z; g.add(m); return m; };
  add(new THREE.CylinderGeometry(.021, .021, .18, 10), body, .03);
  add(new THREE.CylinderGeometry(.034, .023, .06, 12), body, -.09);
  add(new THREE.CylinderGeometry(.036, .036, .012, 12), metal, -.125);
  const glass = add(new THREE.CircleGeometry(.03, 12), lens, -.1315);
  glass.rotation.x = Math.PI;
  const button = new THREE.Mesh(new THREE.BoxGeometry(.012, .008, .02), metal);
  button.position.set(0, .022, -.01); g.add(button);
  g.userData.lens = lens;
  g.traverse(o => { o.castShadow = false; o.frustumCulled = false; });
  return g;
}

export function createItems({scene, camera}) {
  const items = new Map();          // id -> {state, model, slot}
  const spots = [];                 // real spotlights so avatars catch the beams
  for (let i = 0; i < MAX_FLASHLIGHTS; i++) {
    const s = new THREE.SpotLight(BEAM_COLOR, 0, 18, .52, .45, 1.6);
    scene.add(s, s.target);
    spots.push(s);
  }
  // first-person hand: the torch sits low and right, pointing where you look
  const view = new THREE.Group();
  view.position.set(.2, -.2, -.38);
  camera.add(view);
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), fwd = new THREE.Vector3();

  function ensure(state) {
    let it = items.get(state.id);
    if (!it) {
      it = {state, model: flashlightModel(), sway: 0};
      scene.add(it.model);
      items.set(state.id, it);
    }
    it.state = {...state};
    return it;
  }

  return {
    items,
    set(list) { for (const s of list) ensure(s); },
    update(state) { ensure(state); },
    heldBy(id) { for (const it of items.values()) if (it.state.holder === id) return it; return null; },
    // nearest free item within reach that you're roughly looking at
    target(player, yaw, pitch, reach = 2.2) {
      fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      let best = null, bestScore = -Infinity;
      for (const it of items.values()) {
        if (it.state.holder) continue;
        const dx = it.state.x - player.x, dz = it.state.z - player.z;
        const flat = Math.hypot(dx, dz);
        if (flat > reach) continue;
        tmpV.set(dx, it.state.y - player.y, dz).normalize();
        const score = tmpV.dot(fwd) - flat * .15;
        if (tmpV.dot(fwd) > .55 && score > bestScore) { best = it; bestScore = score; }
      }
      return best;
    },
    // place every item: on the ground, in a hand, or in your view
    frame({me, myId, thirdPerson, avatarOf, poseOf, dt}) {
      let n = 0;
      for (const it of items.values()) {
        const s = it.state, m = it.model;
        let origin = null, dir = null;
        if (!s.holder) {
          if (m.parent !== scene) scene.add(m);
          m.visible = true;
          // lying on its side, head toward its yaw
          m.position.set(s.x, s.y + .034, s.z);
          m.rotation.set(0, s.yaw, Math.PI / 2, 'YXZ');
          m.updateMatrixWorld();
          origin = m.localToWorld(tmpV.set(0, 0, -.14)).clone();
          dir = new THREE.Vector3(0, 0, -1).applyQuaternion(m.getWorldQuaternion(tmpQ));
        } else if (s.holder === myId && !thirdPerson) {
          if (m.parent !== view) view.add(m);
          m.visible = true;
          it.sway += dt;
          m.position.set(0, Math.sin(it.sway * 1.7) * .004, 0);
          m.rotation.set(.04, -.06, 0);
          m.updateMatrixWorld();
          origin = camera.localToWorld(tmpV.set(.18, -.16, -.5)).clone();
          dir = camera.getWorldDirection(new THREE.Vector3());
        } else {
          const avatar = s.holder === myId ? me : avatarOf(s.holder);
          const socket = avatar?.socket;
          if (m.parent !== scene) scene.add(m);
          const pose = s.holder === myId ? null : poseOf(s.holder);
          const yaw = pose ? pose.yaw : me.root.rotation.y, pitch = pose ? pose.pitch || 0 : me.pitch || 0;
          dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
          // gripped in the right hand, aimed where its holder is looking
          m.rotation.set(pitch, yaw, 0, 'YXZ');
          if (socket) {
            socket.getWorldPosition(m.position);
            m.position.addScaledVector(dir, .03);
            m.visible = avatar.root.visible && avatar.model.visible !== false;
          } else {
            const px = pose ? pose.x : me.root.position.x, pz = pose ? pose.z : me.root.position.z;
            const py = pose ? (pose.y ?? EYE_HEIGHT) : me.eye;
            m.position.set(px + Math.cos(yaw) * .22, py - .55, pz - Math.sin(yaw) * .22).addScaledVector(dir, .3);
            m.visible = !!avatar;
          }
          m.updateMatrixWorld();
          origin = m.localToWorld(new THREE.Vector3(0, 0, -.14));
        }
        m.userData.lens.color.setScalar(s.on ? 4 : .2);
        if (s.on && n < MAX_FLASHLIGHTS) {
          lighting.flPos.value[n].copy(origin);
          lighting.flDir.value[n].copy(dir).normalize();
          lighting.flOn.value[n] = 1;
          spots[n].position.copy(origin); spots[n].target.position.copy(origin).add(dir); spots[n].intensity = 40;
          n++;
        }
      }
      for (let i = n; i < MAX_FLASHLIGHTS; i++) { lighting.flOn.value[i] = 0; spots[i].intensity = 0; }
    },
  };
}

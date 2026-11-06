// Held items: flashlights, the paintball marker and spray cans. The server owns
// who holds what and where things lie; this module draws them on the ground,
// in other players' hands and in your own view, and feeds torch beams to the
// level shader.
import * as THREE from 'three';
import {lighting, MAX_FLASHLIGHTS} from './level.js';
import {EYE_HEIGHT} from './motion.js';

const BEAM_COLOR = new THREE.Color(1, .93, .8);
export const ITEM_NAMES = {flashlight: 'flashlight', paintball: 'paintball marker', spray: 'spray can'};

const std = (color, roughness = .55, metalness = .2, extra = {}) => new THREE.MeshStandardMaterial({color, roughness, metalness, ...extra});
function part(g, geo, mat, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
}

// A chunky rubberised torch, 26 cm, pointing down its local -z.
function flashlightModel() {
  const g = new THREE.Group();
  const body = std(0x1c1d20, .55, .3), metal = std(0x8a8d92, .35, .8);
  const lens = new THREE.MeshBasicMaterial({color: 0x333333, toneMapped: false});
  const X = [Math.PI / 2, 0, 0];
  part(g, new THREE.CylinderGeometry(.021, .021, .18, 12), body, [0, 0, .03], X);
  part(g, new THREE.CylinderGeometry(.034, .023, .06, 14), body, [0, 0, -.09], X);
  part(g, new THREE.CylinderGeometry(.036, .036, .012, 14), metal, [0, 0, -.125], X);
  for (let i = 0; i < 6; i++) part(g, new THREE.TorusGeometry(.0215, .0025, 4, 12), body, [0, 0, .1 - i * .018]);   // grip rings
  part(g, new THREE.CircleGeometry(.03, 14), lens, [0, 0, -.1315], [Math.PI, 0, 0]);
  part(g, new THREE.BoxGeometry(.012, .008, .02), metal, [0, .022, -.01]);
  part(g, new THREE.TorusGeometry(.012, .003, 4, 10), metal, [0, 0, .125]);                                         // lanyard loop
  g.userData = {lens, tip: new THREE.Vector3(0, 0, -.14), ground: .034, groundRoll: Math.PI / 2};
  return g;
}

// A tournament-style paintball marker, muzzle down its local -z.
function paintballModel() {
  const g = new THREE.Group();
  const black = std(0x16171a, .45, .5), grey = std(0x3a3d44, .4, .6), metal = std(0x9aa0a8, .3, .85);
  const accent = std(0xff2d8a, .4, .3, {emissive: 0x3a0015}), rubber = std(0x101010, .9, 0);
  const smoke = std(0x9fd8ff, .15, 0, {transparent: true, opacity: .38, depthWrite: false});
  const X = [Math.PI / 2, 0, 0];
  part(g, new THREE.BoxGeometry(.044, .075, .22), black, [0, 0, 0]);                       // body
  part(g, new THREE.BoxGeometry(.046, .02, .2), accent, [0, .03, 0]);                     // top rail
  part(g, new THREE.CylinderGeometry(.015, .015, .28, 14), metal, [0, .012, -.24], X);     // barrel
  part(g, new THREE.CylinderGeometry(.019, .019, .05, 14), grey, [0, .012, -.13], X);      // barrel collar
  for (let i = 0; i < 4; i++) part(g, new THREE.CylinderGeometry(.004, .004, .03, 6), black, [0, .028, -.28 - i * .03], [0, 0, Math.PI / 2]);  // ports
  part(g, new THREE.BoxGeometry(.036, .11, .045), rubber, [0, -.085, .055], [-.25, 0, 0]);  // grip
  part(g, new THREE.BoxGeometry(.03, .08, .035), rubber, [0, -.07, -.07], [-.1, 0, 0]);    // fore grip
  part(g, new THREE.TorusGeometry(.024, .004, 4, 12, Math.PI), grey, [0, -.04, -.005], [0, Math.PI / 2, Math.PI]);   // trigger guard
  part(g, new THREE.BoxGeometry(.006, .03, .006), metal, [0, -.05, -.005], [.3, 0, 0]);    // trigger
  part(g, new THREE.CylinderGeometry(.034, .034, .19, 16), grey, [0, -.075, .18], X);      // air tank
  part(g, new THREE.CylinderGeometry(.035, .035, .03, 16), accent, [0, -.075, .27], X);
  const hopper = part(g, new THREE.SphereGeometry(.07, 16, 12), smoke, [0, .1, .015]);     // loader
  hopper.scale.set(.8, .95, 1.25);
  part(g, new THREE.CylinderGeometry(.018, .022, .05, 10), black, [0, .045, .0]);          // feed neck
  const balls = new THREE.Group(); g.add(balls);
  const cols = [0xff2d55, 0xffd60a, 0x32d74b, 0x0a84ff, 0xbf5af2, 0xff9f0a];
  for (let i = 0; i < 9; i++) {
    const b = part(balls, new THREE.SphereGeometry(.012, 8, 6), std(cols[i % cols.length], .3, 0),
      [(i % 3 - 1) * .022, .08 + Math.floor(i / 3) * .022, ((i * 7) % 3 - 1) * .026]);
    b.renderOrder = -1;
  }
  g.userData = {tip: new THREE.Vector3(0, .012, -.39), ground: .045, groundRoll: Math.PI / 2};
  return g;
}

const CAN_COLORS = [0xe8322f, 0x2b6cf0, 0xf2c614, 0x22b45a, 0xf06bc6, 0x111111, 0xf4f1e8, 0xff7a1a, 0x8a4df0, 0x19c2c2];
// A spray can standing on its base (+y up), nozzle facing -z.
function sprayModel(id) {
  const g = new THREE.Group();
  const n = [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  const col = CAN_COLORS[n % CAN_COLORS.length], cap = CAN_COLORS[(n * 7 + 3) % CAN_COLORS.length];
  const body = std(col, .35, .55), label = std(0xf1ede2, .7, 0), metal = std(0xb9bec6, .3, .9), capM = std(cap, .4, .1);
  part(g, new THREE.CylinderGeometry(.033, .033, .17, 20), body, [0, .087, 0]);
  part(g, new THREE.CylinderGeometry(.0335, .0335, .06, 20), label, [0, .075, 0]);
  part(g, new THREE.CylinderGeometry(.026, .033, .02, 20), metal, [0, .182, 0]);     // shoulder
  part(g, new THREE.CylinderGeometry(.033, .031, .006, 20), metal, [0, .003, 0]);    // base rim
  part(g, new THREE.CylinderGeometry(.012, .014, .018, 12), capM, [0, .2, 0]);        // actuator
  part(g, new THREE.CylinderGeometry(.003, .003, .006, 6), metal, [0, .203, -.013], [Math.PI / 2, 0, 0]);  // nozzle
  g.userData = {tip: new THREE.Vector3(0, .203, -.02), ground: .033, groundRoll: Math.PI / 2, upright: true};
  return g;
}

const MODELS = {flashlight: flashlightModel, paintball: paintballModel, spray: sprayModel};

export function createItems({scene, camera}) {
  const items = new Map();          // id -> {state, model, kick}
  const spots = [];                 // real spotlights so avatars catch the beams
  for (let i = 0; i < MAX_FLASHLIGHTS; i++) {
    const s = new THREE.SpotLight(BEAM_COLOR, 0, 18, .52, .45, 1.6);
    scene.add(s, s.target);
    spots.push(s);
  }
  // first-person hand: low and right, pointing where you look
  const view = new THREE.Group();
  view.position.set(.2, -.2, -.38);
  camera.add(view);
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), fwd = new THREE.Vector3();

  function ensure(state) {
    let it = items.get(state.id);
    if (!it || it.state.type !== state.type) {
      if (it) it.model.removeFromParent();
      const model = (MODELS[state.type] || flashlightModel)(state.id);
      model.traverse(o => { o.castShadow = false; o.frustumCulled = false; });
      it = {state, model, sway: 0, kick: 0, shake: 0};
      scene.add(model);
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
    // recoil / shake for your own view model
    kick(id, amount = 1) { const it = items.get(id); if (it) it.kick = amount; },
    shake(id) { const it = items.get(id); if (it) it.shake = .5; },
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
    // world position of an item's business end (muzzle, nozzle, lens)
    tip(it) { it.model.updateMatrixWorld(); return it.model.localToWorld(it.model.userData.tip.clone()); },
    // place every item: on the ground, in a hand, or in your view
    frame({me, myId, thirdPerson, avatarOf, poseOf, dt}) {
      let n = 0;
      for (const it of items.values()) {
        const s = it.state, m = it.model, u = m.userData;
        it.kick *= Math.exp(-dt * 14); it.shake = Math.max(0, it.shake - dt);
        let origin = null, dir = null;
        if (!(s.holder === myId && !thirdPerson)) m.scale.setScalar(1);
        if (!s.holder) {
          if (m.parent !== scene) scene.add(m);
          m.visible = true;
          // lying on its side, head toward its yaw
          m.position.set(s.x, s.y + u.ground, s.z);
          m.rotation.set(0, s.yaw, u.groundRoll, 'YXZ');
          if (u.upright) { m.rotation.set(Math.PI / 2, s.yaw, 0, 'YXZ'); m.position.y = s.y + u.ground; }
          m.updateMatrixWorld();
          origin = m.localToWorld(tmpV.copy(u.tip)).clone();
          dir = new THREE.Vector3(0, 0, -1).applyQuaternion(m.getWorldQuaternion(tmpQ));
        } else if (s.holder === myId && !thirdPerson) {
          if (m.parent !== view) view.add(m);
          m.visible = true;
          it.sway += dt;
          const bob = Math.sin(it.sway * 1.7) * .004;
          if (s.type === 'paintball') {
            m.scale.setScalar(.72);
            m.position.set(.0, -.04 + bob + it.kick * .012, -.02 + it.kick * .05);
            m.rotation.set(.04 + it.kick * .12, -.06, 0);
          } else if (s.type === 'spray') {
            const sh = it.shake > 0 ? Math.sin(it.sway * 70) * .006 : 0;
            m.position.set(.02 + sh, -.07 + bob, .06);
            m.rotation.set(-.15, -.25, sh * 2);
          } else {
            m.position.set(0, bob, 0);
            m.rotation.set(.04, -.06, 0);
          }
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
          if (s.type === 'spray') m.rotation.set(-.35 + pitch * .5, yaw, 0, 'YXZ');
          else m.rotation.set(pitch, yaw, 0, 'YXZ');
          if (socket) {
            socket.getWorldPosition(m.position);
            if (s.type === 'paintball') m.position.addScaledVector(dir, .08).y += .06;
            else if (s.type === 'spray') m.position.y -= .07;
            else m.position.addScaledVector(dir, .03);
            m.visible = avatar.root.visible && avatar.model.visible !== false;
          } else {
            const px = pose ? pose.x : me.root.position.x, pz = pose ? pose.z : me.root.position.z;
            const py = pose ? (pose.y ?? EYE_HEIGHT) : me.eye;
            m.position.set(px + Math.cos(yaw) * .2, py - .5, pz - Math.sin(yaw) * .2).addScaledVector(dir, .3);
            m.visible = !!avatar;
          }
          m.updateMatrixWorld();
          origin = m.localToWorld(tmpV.copy(u.tip)).clone();
        }
        if (s.type !== 'flashlight') continue;
        u.lens.color.setScalar(s.on ? 4 : .2);
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

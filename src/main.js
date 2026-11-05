import * as THREE from 'three';
import {serverUrl, isTouch, lowPower} from './config.js';
import {loadLevel, createAvatarLights} from './level.js';
import {createCollider} from './physics.js';
import {createAvatar, loadAvatarAsset} from './avatar.js';
import {createVerticalMovement, createPoseBuffer, EYE_HEIGHT} from './motion.js';
import {connectRoom} from './net.js';
import {createChatUI, createBubble} from './chat.js';
import {createControls} from './controls.js';
import {EMOTES, EMOTE_DURATION, sanitizePose} from './protocol.js';

const params = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const status = $('status'), loading = $('loading');

// --------------------------------------------------------------- renderer
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({canvas, antialias: !lowPower, powerPreference: 'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(params.get('exposure')) || 1.0;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#050506');
const camera = new THREE.PerspectiveCamera(72, 1, .05, 90);
camera.rotation.order = 'YXZ';
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  // keep a comfortable horizontal field of view on tall (portrait) screens
  const hfov = 78 * Math.PI / 180;
  camera.fov = camera.aspect >= 1.15 ? 72 : Math.min(100, 2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) * 180 / Math.PI);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// player colours: a stable hue per id, used on bubbles and chat lines
const hueOf = id => { let h = 0; for (const c of id || '') h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };

async function start() {
  const [level] = await Promise.all([loadLevel('world', renderer), loadAvatarAsset()]);
  scene.add(level.scene);
  const fog = level.meta.fog;
  if (fog) {
    scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
    scene.background = new THREE.Color(fog.color);
    camera.far = fog.far + 5; camera.updateProjectionMatrix();
  }
  const avatarLights = createAvatarLights(level.meta, scene);
  const collider = createCollider(level.meta);
  // only the party room's surfaces dim with its flickering tube
  const flickering = [...level.materials.values()].filter(m => m.lightMap && m.userData.flicker === 'office');
  const tube = level.materials.get('tube');

  // ------------------------------------------------------------ player
  const spawns = level.meta.spawns;
  const spawn = spawns[Math.floor(Math.random() * spawns.length)];
  const player = {x: spawn.x, z: spawn.z, y: EYE_HEIGHT, vx: 0, vz: 0, emote: '', emoteTime: 0};
  const vertical = createVerticalMovement();
  const me = await createAvatar();
  scene.add(me.root);
  let thirdPerson = params.get('view') === '3p';
  let relock = false;

  const controls = createControls({
    canvas, isTouch,
    onToggleView: () => { thirdPerson = !thirdPerson; },
    onJump: () => { if (!chat.open && vertical.jump()) player.emote = ''; },
    onChat: () => { if (!chat.open) { relock = controls.state.locked; controls.release(); chat.setOpen(true); } },
    onEmotes: () => toggleEmotes(),
    onLockChange: locked => { document.body.classList.toggle('locked', locked); },
  });
  controls.state.yaw = spawn.yaw;
  if (params.get('cam')) {  // debug: ?cam=x,z,yaw,pitch
    const [x, z, yaw, pitch] = params.get('cam').split(',').map(Number);
    Object.assign(player, {x, z}); controls.state.yaw = yaw; controls.state.pitch = pitch || 0;
  }
  if (isTouch) document.body.classList.add('touch');

  // ------------------------------------------------------------ emotes
  const emoteMenu = $('emotes');
  for (const e of EMOTES) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = e.label;
    b.addEventListener('click', () => { player.emote = e.id; player.emoteTime = 0; toggleEmotes(false); });
    emoteMenu.append(b);
  }
  function toggleEmotes(force) {
    const open = force ?? emoteMenu.hidden;
    emoteMenu.hidden = !open;
    if (open) controls.release();
  }
  addEventListener('keydown', e => { if (e.code === 'Escape') toggleEmotes(false); });

  // -------------------------------------------------------------- chat
  const chat = createChatUI({
    onSend: text => { if (!network.online) { chat.record('not connected yet, try again in a sec', {system: true}); return false; } return network.sendChat(text); },
    onOpenChange: open => { if (!open && relock && !controls.state.touch) { relock = false; canvas.requestPointerLock?.()?.catch?.(() => {}); } },
  });
  let myBubble = null, myBubbleExpires = 0;

  // ----------------------------------------------------------- network
  const peers = new Map();
  const online = $('online');
  function updateCount() { online.textContent = `${peers.size + 1} here`; }
  function peer(id) {
    if (!id || id === network.id) return null;
    let p = peers.get(id);
    if (p) return p;
    p = {id, motion: createPoseBuffer(), avatar: null, previous: null, lastUpdate: 0, bubble: null, typing: null, hue: hueOf(id)};
    peers.set(id, p); updateCount();
    createAvatar().then(a => { if (peers.get(id) !== p) { a.dispose(); return; } p.avatar = a; scene.add(a.root); })
      .catch(err => console.warn('avatar failed', err));
    return p;
  }
  function removePeer(id) {
    const p = peers.get(id); if (!p) return;
    p.avatar?.dispose(); p.bubble?.dispose(); p.typing?.dispose(); peers.delete(id); updateCount();
  }
  function applyPose(id, pose, time) {
    const p = peer(id); if (!p) return;
    p.motion.push(pose, performance.now(), time);
    if (pose.typing && !p.typing) { p.typing = createBubble('', {typing: true}); }
    if (!pose.typing && p.typing) { p.typing.dispose(); p.typing = null; }
  }
  const network = connectRoom({
    url: serverUrl(),
    onStatus: s => { status.dataset.state = s; status.title = s; if (s === 'online') lastSent = ''; },
    onState: m => {
      const live = new Set(m.players.map(p => p.id));
      for (const id of [...peers.keys()]) if (!live.has(id)) removePeer(id);
      for (const p of m.players) if (p.id !== network.id) applyPose(p.id, p.pose, m.now);
    },
    onPose: m => applyPose(m.id, m.pose, m.time),
    onLeave: id => removePeer(id),
    onChat: m => {
      const own = m.id === network.id;
      chat.record(m.text, {own, hue: hueOf(m.id)});
      const bubble = createBubble(m.text);
      if (own) { myBubble?.dispose(); myBubble = bubble; myBubbleExpires = m.expiresAt; return; }
      const target = peer(m.id);
      if (!target) { bubble.dispose(); return; }
      target.bubble?.dispose(); target.bubble = bubble; target.bubbleExpires = m.expiresAt;
    },
  });

  // --------------------------------------------------------- flicker
  let flick = 1, nextFlicker = performance.now() + 4000, flickerUntil = 0;
  function updateFlicker(now) {
    if (now > nextFlicker) { flickerUntil = now + 120 + Math.random() * 700; nextFlicker = now + 5000 + Math.random() * 14000; }
    const target = now < flickerUntil ? (Math.random() < .5 ? .45 : .95) : 1;
    flick = target;
    const lantern = .92 + .08 * Math.sin(now * .011) * Math.sin(now * .0037);
    for (const l of avatarLights) l.light.intensity = l.base * (l.flicker === 'fluorescent' ? flick : l.flicker === 'candle' ? lantern : 1);
    // the tube dominates the party room's bake, so dip that room's lightmap a little with it
    const k = .55 + .45 * flick;
    for (const m of flickering) m.lightMapIntensity = level.baseIntensity * k;
  }

  // ------------------------------------------------------------- loop
  const tmp = new THREE.Vector3(), pivot = new THREE.Vector3(), bubbleAnchor = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const levelMeshes = level.meshes.filter(o => !o.material.transparent);
  let last = performance.now(), lastSent = '', sentAt = 0, settle = 0;
  loading.classList.add('done');
  $('hint').hidden = isTouch;

  function project(pos, height) {
    bubbleAnchor.set(pos.x, height, pos.z).project(camera);
    const visible = bubbleAnchor.z > -1 && bubbleAnchor.z < 1 && Math.abs(bubbleAnchor.x) < 1.1 && Math.abs(bubbleAnchor.y) < 1.1;
    return {x: (bubbleAnchor.x + 1) * innerWidth / 2, y: (1 - bubbleAnchor.y) * innerHeight / 2, visible};
  }

  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min(.1, (now - last) / 1000); last = now;
    const input = controls.update();
    const frozen = chat.open || !emoteMenu.hidden;
    // movement in the camera's yaw frame
    const speed = (input.run ? 4.3 : 2.7) * (input.crouch ? .5 : 1);
    const mx = frozen ? 0 : input.moveX, mz = frozen ? 0 : input.moveZ;
    const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
    const tx = (mx * cos + mz * sin) * speed, tz = (-mx * sin + mz * cos) * speed;
    const accel = 1 - Math.exp(-dt * 12);
    player.vx += (tx - player.vx) * accel; player.vz += (tz - player.vz) * accel;
    const px = player.x, pz = player.z;
    [player.x, player.z] = collider.resolve(player.x + player.vx * dt, player.z + player.vz * dt);
    const velocity = Math.hypot(player.x - px, player.z - pz) / Math.max(dt, 1e-4);
    if (velocity > .3) player.emote = '';
    if (player.emote) player.emoteTime = Math.min(EMOTE_DURATION, player.emoteTime + dt);
    player.y = vertical.update(dt, !frozen && input.crouch);
    const motion = {...vertical.pose, emote: player.emote, emoteTime: player.emoteTime, pitch: input.pitch};

    // local avatar
    me.root.position.set(player.x, 0, player.z); me.root.rotation.y = input.yaw;
    me.update(dt, velocity, motion);

    // camera
    if (thirdPerson) {
      // over-the-shoulder: pivot above and right of the head, pulled in when a wall is behind
      const dist = 2.4, sx = Math.cos(input.yaw) * .42, sz = -Math.sin(input.yaw) * .42;
      pivot.set(player.x + sx, Math.min(2.7, player.y + .5), player.z + sz);
      tmp.set(Math.sin(input.yaw) * Math.cos(input.pitch), -Math.sin(input.pitch), Math.cos(input.yaw) * Math.cos(input.pitch));
      ray.set(pivot, tmp); ray.far = dist;
      const hit = ray.intersectObjects(levelMeshes, false)[0];
      const d = hit ? Math.max(.25, hit.distance - .2) : dist;
      camera.position.copy(pivot).addScaledVector(tmp, d);
      me.setVisible(d > .9);  // too close to a wall: hide yourself rather than fill the screen
    } else {
      camera.position.set(player.x, player.y, player.z);
      me.setVisible(false);
    }
    camera.rotation.set(input.pitch, input.yaw, 0);

    // network: 15 Hz while something changes, then 3 settling packets
    if (now - sentAt >= 1000 / 15 && network.online) {
      const pose = sanitizePose({x: player.x, y: player.y, z: player.z, yaw: input.yaw, pitch: input.pitch, room: 'office',
        crouch: motion.crouch, jumpTime: motion.jumpTime, emote: player.emote, emoteTime: player.emoteTime, typing: chat.typing});
      const key = JSON.stringify(pose);
      if (key !== lastSent) settle = 3;
      if (key !== lastSent || settle > 0) { network.sendPose(pose); if (key === lastSent) settle--; lastSent = key; }
      sentAt = now;
    }

    // remote peers
    camera.updateMatrixWorld();
    const serverNow = network.now();
    for (const p of peers.values()) {
      const s = p.motion.sample(now);
      if (!s || !p.avatar) continue;
      const pdt = Math.min(.1, Math.max(0, (now - (p.lastUpdate || now)) / 1000)); p.lastUpdate = now;
      const v = p.previous && pdt > 0 ? Math.hypot(s.x - p.previous.x, s.z - p.previous.z) / pdt : 0;
      p.previous = s;
      p.avatar.root.position.set(s.x, 0, s.z); p.avatar.root.rotation.y = s.yaw;
      p.avatar.update(pdt, v, s);
      if (p.bubble && serverNow > p.bubbleExpires) { p.bubble.dispose(); p.bubble = null; }
      if (p.bubble || p.typing) {
        const at = project(s, 2.25 + (s.jumpTime >= 0 ? .4 : 0));
        const top = p.bubble ? p.bubble.update(at.x, at.y, at.visible) : at.y;
        p.typing?.update(at.x, top, at.visible);
      }
    }
    if (myBubble) {
      if (serverNow > myBubbleExpires) { myBubble.dispose(); myBubble = null; }
      else { const at = project(player, 2.25); myBubble.update(at.x, at.y, at.visible && thirdPerson); }
    }

    avatarLights.update(camera.position.x, camera.position.z);
    updateFlicker(now);
    if (tube) tube.color.setScalar(.3 + .7 * flick);
    renderer.render(scene, camera);
  });
  document.body.classList.add('ready');
  window.__111k = {scene, camera, player, peers, network, renderer, setView: v => { thirdPerson = v; }};
}

start().catch(err => {
  console.error(err);
  loading.querySelector('p').textContent = 'Could not load the space. Refresh to try again.';
});

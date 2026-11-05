import * as THREE from 'three';
import {serverUrl, isTouch, lowPower} from './config.js';
import {loadLevel, createAvatarLights, createFlicker, lighting} from './level.js';
import {createCollider} from './physics.js';
import {createAvatar, loadAvatarAsset} from './avatar.js';
import {createVerticalMovement, createPoseBuffer, EYE_HEIGHT} from './motion.js';
import {connectRoom} from './net.js';
import {createChatUI, createBubble} from './chat.js';
import {createControls} from './controls.js';
import {createItems} from './items.js';
import {EMOTES, EMOTE_DURATION, PUNCH_COOLDOWN_MS, PUNCH_DURATION, sanitizePose} from './protocol.js';

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
scene.add(camera);   // so the first-person hand can ride along
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
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

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
  const bore = level.meta.bore;
  // height of the ceiling over a point: the tunnel's vault, a door passage, or a room
  function ceilingAt(x, z) {
    if (!bore) return 3;
    const r = Math.hypot(x, z) - bore.loop;
    if (Math.abs(r) < bore.floorHalf + .05) return bore.centre + Math.sqrt(Math.max(0, bore.radius ** 2 - r * r));
    if (r > 0 && r < bore.passage) return bore.passageTop;
    return bore.roomCeiling;
  }

  // lamp groups (0 = the party room's tube, 1-3 = lamps around the loop) and blinking LEDs
  const flickers = [createFlicker(Math.random, {calm: [5, 18], first: 2}),
    ...[1, 2, 3].map(() => createFlicker(Math.random, {calm: [14, 55], first: 6}))];
  const lens = [0, 1, 2, 3].map(g => g === 0 ? level.materials.get('tube') : level.materials.get(`lens_g${g}`));
  const leds = ['led_a', 'led_b'].map(n => level.materials.get(n)).filter(Boolean);

  // ------------------------------------------------------------ player
  const spawns = level.meta.spawns;
  const spawn = spawns[Math.floor(Math.random() * spawns.length)];
  const player = {x: spawn.x, z: spawn.z, y: EYE_HEIGHT, vx: 0, vz: 0, kx: 0, kz: 0, emote: '', emoteTime: 0, punchTime: -1};
  const vertical = createVerticalMovement();
  const me = await createAvatar();
  scene.add(me.root);
  let thirdPerson = params.get('view') === '3p';
  let relock = false, lastPunch = 0, shake = 0;

  const controls = createControls({
    canvas, isTouch,
    onToggleView: () => { thirdPerson = !thirdPerson; },
    onJump: () => { if (!chat.open && vertical.jump()) player.emote = ''; },
    onChat: () => { if (!chat.open) { relock = controls.state.locked; controls.release(); chat.setOpen(true); } },
    onEmotes: () => toggleEmotes(),
    onLockChange: locked => { document.body.classList.toggle('locked', locked); },
    onPrimary: () => primary(),
    onSecondary: () => secondary(),
    onUse: () => { held() ? secondary() : grab(); },
  });
  controls.state.yaw = spawn.yaw;
  if (params.get('cam')) {  // debug: ?cam=x,z,yaw,pitch
    const [x, z, yaw, pitch] = params.get('cam').split(',').map(Number);
    Object.assign(player, {x, z}); controls.state.yaw = yaw; controls.state.pitch = pitch || 0;
  }
  if (isTouch) document.body.classList.add('touch');

  // ------------------------------------------------------------ emotes
  const emoteMenu = $('emotes'), emoteLabel = $('emoteLabel');
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
  // clicking back into the world closes the chat box or the emote menu and gives you control again
  document.addEventListener('pointerdown', e => {
    if (!emoteMenu.hidden && !e.target.closest('#emotes, #btnEmote')) toggleEmotes(false);
    if (chat.open && !e.target.closest('#chat form, #btnChat')) { relock = false; chat.setOpen(false); }
  }, true);

  // -------------------------------------------------------------- chat
  const chat = createChatUI({
    onSend: text => { if (!network.online) { chat.record('not connected yet, try again in a sec', {system: true}); return false; } return network.sendChat(text); },
    onOpenChange: open => { if (!open && relock && !controls.state.touch) { relock = false; canvas.requestPointerLock?.()?.catch?.(() => {}); } },
  });
  let myBubble = null, myBubbleExpires = 0;

  // ------------------------------------------------------------- items
  const items = createItems({scene, camera});
  const prompt = $('prompt'), btnAct = $('btnAct');
  const held = () => network.id ? items.heldBy(network.id) : null;
  function grab() {
    const t = items.target(player, controls.state.yaw, controls.state.pitch);
    if (t) { network.send({type: 'pickup', id: t.state.id}); return true; }
    return false;
  }
  function primary() {
    if (chat.open || !emoteMenu.hidden) return;
    const h = held();
    if (h) { network.send({type: 'toggle', id: h.state.id, on: !h.state.on}); return; }
    if (grab()) return;
    punch();
  }
  function secondary() {
    const h = held();
    if (!h) return;
    const yaw = controls.state.yaw;
    network.send({type: 'drop', id: h.state.id, x: player.x - Math.sin(yaw) * .55, z: player.z - Math.cos(yaw) * .55, yaw});
  }
  function punch() {
    const now = performance.now();
    if (now - lastPunch < PUNCH_COOLDOWN_MS) return;
    lastPunch = now; player.punchTime = 0; player.emote = ''; shake = Math.max(shake, .25);
    // whoever is closest in front of you, within reach
    const yaw = controls.state.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestD = 1.6;
    for (const p of peers.values()) {
      const s = p.motion.sample(now); if (!s) continue;
      const dx = s.x - player.x, dz = s.z - player.z, d = Math.hypot(dx, dz);
      if (d < bestD && (dx * fx + dz * fz) / (d || 1) > .55) { best = p; bestD = d; }
    }
    network.send({type: 'punch', target: best ? best.id : ''});
  }

  // ----------------------------------------------------------- network
  const peers = new Map();
  const online = $('online');
  function updateCount() { online.textContent = `${peers.size + 1} here`; }
  function peer(id) {
    if (!id || id === network.id) return null;
    let p = peers.get(id);
    if (p) return p;
    p = {id, motion: createPoseBuffer(), avatar: null, previous: null, lastUpdate: 0, bubble: null, typing: null, hue: hueOf(id), last: null};
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
      if (m.items) items.set(m.items);
    },
    onPose: m => applyPose(m.id, m.pose, m.time),
    onLeave: id => removePeer(id),
    onItem: it => items.update(it),
    onPunch: m => {
      if (m.target === network.id) {
        // knocked back, a little hop, and the screen jolts
        player.kx += m.dir[0] * 7.5; player.kz += m.dir[1] * 7.5;
        vertical.jump(); shake = 1;
      }
    },
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
  function updateLights(now) {
    const k = flickers.map(f => f.update(now));
    lighting.flickerK.value.set(k[0], k[1], k[2], k[3]);
    lens.forEach((m, g) => m?.color.setScalar(.15 + .85 * k[g]));
    const blink = Math.floor(now / 530) % 2, slow = Math.floor(now / 1700) % 3;
    if (leds[0]) leds[0].color.setScalar(blink ? 1 : .15);
    if (leds[1]) leds[1].color.setScalar(slow ? 1 : .2);
    const lantern = .92 + .08 * Math.sin(now * .011) * Math.sin(now * .0037);
    for (const l of avatarLights) {
      const f = l.group !== null && l.group !== undefined ? k[l.group] : l.flicker === 'candle' ? lantern : 1;
      l.light.intensity = l.base * f;
    }
  }

  // ------------------------------------------------------------- loop
  const pivot = new THREE.Vector3(), smoothPivot = new THREE.Vector3(), dir = new THREE.Vector3(), bubbleAnchor = new THREE.Vector3();
  let camDist = 2.5, lastSent = '', sentAt = 0, settle = 0, last = performance.now(), firstFrame = true;
  loading.classList.add('done');
  $('hint').hidden = isTouch;

  function project(pos, height) {
    bubbleAnchor.set(pos.x, height, pos.z).project(camera);
    const visible = bubbleAnchor.z > -1 && bubbleAnchor.z < 1 && Math.abs(bubbleAnchor.x) < 1.1 && Math.abs(bubbleAnchor.y) < 1.1;
    return {x: (bubbleAnchor.x + 1) * innerWidth / 2, y: (1 - bubbleAnchor.y) * innerHeight / 2, visible};
  }
  // speech bubbles hide when a wall is between you and the speaker
  function inSight(pos) {
    const dx = pos.x - camera.position.x, dz = pos.z - camera.position.z, d = Math.hypot(dx, dz);
    return d < .3 || collider.raycast(camera.position.x, camera.position.z, dx, dz, d, Math.min(camera.position.y, 1.8), 0) >= d - .25;
  }

  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min(.1, (now - last) / 1000); last = now;
    const input = controls.update();
    const frozen = chat.open || !emoteMenu.hidden;
    // movement in the camera's yaw frame, plus any knock-back still fading out
    const speed = (input.run ? 4.3 : 2.7) * (input.crouch ? .5 : 1);
    const mx = frozen ? 0 : input.moveX, mz = frozen ? 0 : input.moveZ;
    const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
    const tx = (mx * cos + mz * sin) * speed, tz = (-mx * sin + mz * cos) * speed;
    player.vx += (tx - player.vx) * damp(12, dt); player.vz += (tz - player.vz) * damp(12, dt);
    player.kx *= Math.exp(-dt * 5); player.kz *= Math.exp(-dt * 5);
    const px = player.x, pz = player.z;
    [player.x, player.z] = collider.resolve(player.x + (player.vx + player.kx) * dt, player.z + (player.vz + player.kz) * dt);
    const velocity = Math.hypot(player.x - px, player.z - pz) / Math.max(dt, 1e-4);
    if (velocity > .3) player.emote = '';
    if (player.emote) player.emoteTime = Math.min(EMOTE_DURATION, player.emoteTime + dt);
    if (player.punchTime >= 0) { player.punchTime += dt; if (player.punchTime > PUNCH_DURATION) player.punchTime = -1; }
    player.y = vertical.update(dt, !frozen && input.crouch);
    const holding = !!held();
    const motion = {...vertical.pose, emote: player.emote, emoteTime: player.emoteTime, pitch: input.pitch,
      punchTime: player.punchTime, holding};

    // local avatar
    me.root.position.set(player.x, 0, player.z); me.root.rotation.y = input.yaw;
    me.eye = player.y; me.pitch = input.pitch;
    me.update(dt, velocity, motion);

    // camera
    shake *= Math.exp(-dt * 7);
    const sx = (Math.random() - .5) * .06 * shake, sy = (Math.random() - .5) * .06 * shake;
    if (thirdPerson) {
      // over the shoulder, a little above the head; slides in around walls, ducks under ceilings
      const yaw = input.yaw, pitch = input.pitch;
      const side = .34, rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const sideRoom = collider.raycast(player.x, player.z, rx, rz, side + .25, player.y, .12) - .25;
      const s = Math.max(0, Math.min(side, sideRoom));
      const head = Math.min(player.y + .16, ceilingAt(player.x, player.z) - .3);
      pivot.set(player.x + rx * s, head, player.z + rz * s);
      if (firstFrame) smoothPivot.copy(pivot);
      smoothPivot.lerp(pivot, damp(22, dt));
      smoothPivot.x = pivot.x; smoothPivot.z = pivot.z;    // only ease the height (jumps, crouches)
      dir.set(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const want = 2.6;
      // walls: the horizontal part of the boom, tested from three points across the camera's width
      const flat = Math.hypot(dir.x, dir.z) || 1e-6;
      let free = want;
      for (const off of [-.16, 0, .16]) {
        const ox = smoothPivot.x + rx * off, oz = smoothPivot.z + rz * off;
        free = Math.min(free, collider.raycast(ox, oz, dir.x, dir.z, want * flat, smoothPivot.y, .18) / flat);
      }
      // floor and ceiling along the boom
      if (dir.y > 1e-4) {
        const endX = smoothPivot.x + dir.x * free, endZ = smoothPivot.z + dir.z * free;
        free = Math.min(free, (ceilingAt(endX, endZ) - .2 - smoothPivot.y) / dir.y);
      } else if (dir.y < -1e-4) free = Math.min(free, (smoothPivot.y - .25) / -dir.y);
      free = Math.max(.25, free);
      camDist += (free - camDist) * (free < camDist ? damp(30, dt) : damp(4, dt));
      if (firstFrame) camDist = free;
      camera.position.copy(smoothPivot).addScaledVector(dir, camDist);
      me.setVisible(camDist > .75);  // too close to a wall: hide yourself rather than fill the screen
    } else {
      camera.position.set(player.x, player.y, player.z);
      me.setVisible(false);
    }
    firstFrame = false;
    camera.rotation.set(input.pitch + sy, input.yaw + sx, 0);
    camera.updateMatrixWorld();

    // network: 15 Hz while something changes, then 3 settling packets
    if (now - sentAt >= 1000 / 15 && network.online) {
      const pose = sanitizePose({x: player.x, y: player.y, z: player.z, yaw: input.yaw, pitch: input.pitch, room: 'office',
        crouch: motion.crouch, jumpTime: motion.jumpTime, emote: player.emote, emoteTime: player.emoteTime,
        typing: chat.typing, punchTime: player.punchTime});
      const key = JSON.stringify(pose);
      if (key !== lastSent) settle = 3;
      if (key !== lastSent || settle > 0) { network.sendPose(pose); if (key === lastSent) settle--; lastSent = key; }
      sentAt = now;
    }

    // remote peers
    const serverNow = network.now();
    for (const p of peers.values()) {
      const s = p.motion.sample(now);
      if (!s || !p.avatar) continue;
      p.last = s;
      const pdt = Math.min(.1, Math.max(0, (now - (p.lastUpdate || now)) / 1000)); p.lastUpdate = now;
      const v = p.previous && pdt > 0 ? Math.hypot(s.x - p.previous.x, s.z - p.previous.z) / pdt : 0;
      p.previous = s;
      p.avatar.root.position.set(s.x, 0, s.z); p.avatar.root.rotation.y = s.yaw;
      p.avatar.update(pdt, v, {...s, holding: !!items.heldBy(p.id)});
      if (p.bubble && serverNow > p.bubbleExpires) { p.bubble.dispose(); p.bubble = null; }
      if (p.bubble || p.typing) {
        if (!p.sightAt || now - p.sightAt > 150) { p.seen = inSight(s); p.sightAt = now; }
        const at = project(s, 2.25 + (s.jumpTime >= 0 ? .4 : 0));
        const show = at.visible && p.seen;
        const top = p.bubble ? p.bubble.update(at.x, at.y, show) : at.y;
        p.typing?.update(at.x, top, show);
      }
    }
    if (myBubble) {
      if (serverNow > myBubbleExpires) { myBubble.dispose(); myBubble = null; }
      else { const at = project(player, 2.25); myBubble.update(at.x, at.y, at.visible && thirdPerson); }
    }

    // held items and what you can do right now
    items.frame({me, myId: network.id, thirdPerson, avatarOf: id => peers.get(id)?.avatar, poseOf: id => peers.get(id)?.last, dt});
    const h = held(), t = !h && !frozen ? items.target(player, input.yaw, input.pitch) : null;
    const hint = h ? (isTouch ? '' : `click: ${h.state.on ? 'turn off' : 'turn on'}  ·  right-click: drop`)
      : t ? (isTouch ? '' : 'click: pick up flashlight') : '';
    if (prompt.textContent !== hint) prompt.textContent = hint;
    document.body.classList.toggle('holding', !!h);
    const act = h ? (h.state.on ? 'light off' : 'light on') : t ? 'grab' : 'punch';
    if (btnAct.textContent !== act) btnAct.textContent = act;
    document.body.classList.toggle('can-grab', !!t);
    // first person: say which emote you're doing, since you can't see yourself
    const label = !thirdPerson && player.emote ? EMOTES.find(e => e.id === player.emote)?.label || '' : '';
    if (emoteLabel.textContent !== label) { emoteLabel.textContent = label; emoteLabel.hidden = !label; }

    avatarLights.update(camera.position.x, camera.position.z);
    updateLights(now);
    renderer.render(scene, camera);
  });
  document.body.classList.add('ready');
  window.__111k = {scene, camera, player, peers, network, renderer, items, controls, setView: v => { thirdPerson = v; }, primary, secondary};
}

start().catch(err => {
  console.error(err);
  loading.querySelector('p').textContent = 'Could not load the space. Refresh to try again.';
});

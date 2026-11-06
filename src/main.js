import * as THREE from 'three';
import {serverUrl, isTouch, lowPower} from './config.js';
import {loadLevel, createAvatarLights, createFlicker, lighting} from './level.js';
import {createCollider} from './physics.js';
import {createAvatar, preloadLook, AVATAR_SCALE} from './avatar.js';
import {createVerticalMovement, createPoseBuffer, EYE_HEIGHT} from './motion.js';
import {connectRoom} from './net.js';
import {createChatUI, createBubble} from './chat.js';
import {createControls} from './controls.js';
import {createItems, ITEM_NAMES} from './items.js';
import {createWorldHits, cutDecal, createBatch, markMaterial, splatAtlas, splatCell, PAINT_COLORS, rgbOf} from './decals.js';
import {createDoors} from './doors.js';
import {pickAvatar} from './picker.js';
import {randomLook, cleanLook} from './looks.js';
import {EMOTES, EMOTE_DURATION, PUNCH_COOLDOWN_MS, PUNCH_DURATION, SHOT_INTERVAL_MS, SPRAY_INTERVAL_MS, SPRAY_RANGE,
  MAX_SPLATS, MAX_SPRAYS, sanitizePose, sanitizeName, cleanSplat, cleanSpray} from './protocol.js';

const params = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const status = $('status'), loading = $('loading');
const wait = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------- who you are, per tab
// sessionStorage survives a refresh (you come back where you were); closing
// the tab clears it, so a new visit starts at the picker. localStorage keeps
// your last look so you can wear it again.
const store = (s, key) => ({
  get() { try { return JSON.parse(s.getItem(key) || 'null'); } catch { return null; } },
  set(v) { try { s.setItem(key, JSON.stringify(v)); } catch {} },
});
const tabMe = store(sessionStorage, '111k:me'), lastMe = store(localStorage, '111k:last');

// --------------------------------------------------------------- renderer
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({canvas, antialias: !lowPower, powerPreference: 'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(params.get('exposure')) || 1.0;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#050506');
const camera = new THREE.PerspectiveCamera(72, 1, .06, 90);
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

// A very dim grey room for avatar reflections, so metal and gloss finishes don't go black.
function avatarEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({color: 0x101013, side: THREE.BackSide})));
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 8), new THREE.MeshBasicMaterial({color: 0x6a6a60, side: THREE.DoubleSide}));
  strip.position.y = 2.9; strip.rotation.x = Math.PI / 2; s.add(strip);
  const tex = pmrem.fromScene(s, .04).texture; pmrem.dispose();
  return tex;
}

async function chooseYourself() {
  const saved = tabMe.get();
  if (saved?.look && cleanLook(saved.look)) return {...saved, look: cleanLook(saved.look), resumed: true};
  if (params.get('pick') === 'auto') return {look: randomLook(Math.random() < .5 ? 'drifella' : 'drilady'), name: params.get('name') || ''};
  await wait(900);                     // a moment of "going down…" first
  loading.classList.add('done');
  const last = lastMe.get();
  const pick = await pickAvatar({previous: last?.look ? cleanLook(last.look) : null, name: last?.name || ''});
  loading.classList.remove('done');
  return {look: pick.look, name: sanitizeName(pick.name)};
}

async function start() {
  const levelReady = loadLevel('world', renderer);
  levelReady.catch(() => {});
  const mine = await chooseYourself();
  lastMe.set({look: mine.look, name: mine.name});
  tabMe.set({...tabMe.get(), look: mine.look, name: mine.name});
  const [level] = await Promise.all([levelReady, preloadLook(mine.look)]);
  scene.add(level.scene);
  scene.environment = avatarEnvironment();
  const fog = level.meta.fog;
  if (fog) {
    scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
    scene.background = new THREE.Color(fog.color);
    camera.far = fog.far + 5; camera.updateProjectionMatrix();
  }
  const avatarLights = createAvatarLights(level.meta, scene);
  const collider = createCollider(level.meta);
  const hits = createWorldHits(level);
  const doors = createDoors(level, collider);
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
  const resumed = mine.resumed && Number.isFinite(mine.x) && Number.isFinite(mine.z);
  const player = {x: resumed ? mine.x : spawn.x, z: resumed ? mine.z : spawn.z, y: EYE_HEIGHT, vx: 0, vz: 0, kx: 0, kz: 0,
    emote: '', emoteTime: 0, punchTime: -1};
  const vertical = createVerticalMovement();
  const me = await createAvatar(mine.look);
  scene.add(me.root);
  // first person: a headless copy of you rides the camera so you can see your own punch
  const meView = await createAvatar(mine.look);
  meView.setHeadless(true);
  meView.root.visible = false;
  camera.add(meView.root);
  let thirdPerson = params.get('view') === '3p' || (resumed && mine.view === '3p');
  let relock = false, lastPunch = 0, lastShot = 0, lastSpray = 0, shake = 0, menuRelease = false;

  const controls = createControls({
    canvas, isTouch,
    onToggleView: () => { thirdPerson = !thirdPerson; },
    onJump: () => { if (!chat.open && vertical.jump()) player.emote = ''; },
    onChat: () => { if (!chat.open) { relock = controls.state.locked; release(); chat.setOpen(true); } },
    onEmotes: () => toggleEmotes(),
    onLockChange: locked => {
      document.body.classList.toggle('locked', locked);
      if (locked) { toggleGallery(false); return; }
      // Esc while holding a can opens the piece gallery
      if (!menuRelease && heldType() === 'spray' && !chat.open && emoteMenu.hidden) toggleGallery(true);
      menuRelease = false;
    },
    onPrimary: () => primary(),
    onSecondary: () => secondary(),
    onUse: () => { held() ? secondary() : grab(); },
    onGallery: () => toggleGallery(),
  });
  // let go of the mouse for one of our own menus (not the gallery's Esc)
  function release() { if (controls.state.locked) menuRelease = true; controls.release(); }
  controls.state.yaw = resumed ? mine.yaw || 0 : spawn.yaw;
  controls.state.pitch = resumed ? mine.pitch || 0 : 0;
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
    if (open) { toggleGallery(false); release(); }
  }
  addEventListener('keydown', e => { if (e.code === 'Escape') { toggleEmotes(false); if (!controls.state.locked) toggleGallery(false); } });
  // clicking back into the world closes the chat box, the emote menu or the gallery and gives you control again
  document.addEventListener('pointerdown', e => {
    if (!emoteMenu.hidden && !e.target.closest('#emotes, #btnEmote')) toggleEmotes(false);
    if (chat.open && !e.target.closest('#chat form, #btnChat')) { relock = false; chat.setOpen(false); }
    if (!gallery.hidden && !e.target.closest('#gallery, #btnGallery')) toggleGallery(false);
  }, true);

  // -------------------------------------------------------------- chat
  const chat = createChatUI({
    onSend: text => { if (!network.online) { chat.record('not connected yet, try again in a sec', {system: true}); return false; } return network.sendChat(text); },
    onOpenChange: open => { if (!open && relock && !controls.state.touch) { relock = false; canvas.requestPointerLock?.()?.catch?.(() => {}); } },
  });
  let myBubble = null, myBubbleExpires = 0;

  // ------------------------------------------------------- paint & tags
  const splats = createBatch(markMaterial(level, splatAtlas(), 2));
  splats.mesh.renderOrder = 3; scene.add(splats.mesh);
  const splatMarks = [];
  const pieces = level.meta.graffiti || [];
  const pieceByName = new Map(pieces.map(p => [p.name, p]));
  const pageBatches = new Map();
  function pageBatch(page) {
    if (!pageBatches.has(page)) {
      const src = level.materials.get(`graffiti_${page}`);
      const b = createBatch(markMaterial(level, src?.map || null, 1), 8000);
      b.mesh.renderOrder = 2; scene.add(b.mesh);
      pageBatches.set(page, b);
    }
    return pageBatches.get(page);
  }
  const sprayMarks = [];
  const fades = [];   // freshly sprayed pieces fade in
  function addSplat(s, fresh = false) {
    const point = new THREE.Vector3(...s.p), normal = new THREE.Vector3(...s.n);
    const r = ((s.s >> 3) % 1000) / 1000, size = .2 + r * .16;
    const up = Math.abs(normal.y) > .9 ? new THREE.Vector3(Math.cos(s.s), 0, Math.sin(s.s)) : new THREE.Vector3(0, 1, 0);
    up.applyAxisAngle(normal, (s.s % 628) / 100);
    const verts = cutDecal(hits, {point, normal, up, width: size, height: size, depth: .12});
    const [cu, cv] = splatCell(s.s);
    for (const q of verts) { q.u = cu + q.u / 4; q.v = cv + q.v / 2; }
    splatMarks.push(splats.add(verts, rgbOf(s.c)));
    while (splatMarks.length > MAX_SPLATS) splats.remove(splatMarks.shift());
    if (fresh) burst(point, normal, s.c);
  }
  function addSpray(s, fresh = false) {
    const piece = pieceByName.get(s.piece);
    if (!piece) return;
    const point = new THREE.Vector3(...s.p), normal = new THREE.Vector3(...s.n), up = new THREE.Vector3(...s.up);
    const w = s.size, h = s.size * piece.h / piece.w;
    const verts = cutDecal(hits, {point, normal, up, width: w, height: h, depth: .15, minFacing: .45});
    const [u0, v0, u1, v1] = piece.uv;
    for (const q of verts) { q.u = u0 + q.u * (u1 - u0); q.v = v0 + q.v * (v1 - v0); }
    const batch = pageBatch(piece.page);
    const m = batch.add(verts, [255, 255, 255], fresh ? 0 : 1);
    sprayMarks.push({batch, m});
    while (sprayMarks.length > MAX_SPRAYS) { const old = sprayMarks.shift(); old.batch.remove(old.m); }
    if (fresh) fades.push({batch, m, t: 0});
  }
  function resetMarks(list) {
    splats.clear(); splatMarks.length = 0;
    for (const b of pageBatches.values()) b.clear();
    sprayMarks.length = 0;
    for (const s of list.splats || []) { const c = cleanSplat(s); if (c) addSplat(c); }
    for (const s of list.sprays || []) { const c = cleanSpray(s); if (c) addSpray(c); }
  }

  // a puff of paint where a ball bursts
  const puffs = [];
  const puffGeo = new THREE.SphereGeometry(.02, 6, 4);
  function burst(point, normal, color) {
    const mat = new THREE.MeshBasicMaterial({color, transparent: true, opacity: .9, depthWrite: false});
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(puffGeo, mat);
      m.position.copy(point).addScaledVector(normal, .03);
      const v = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(2.4).addScaledVector(normal, 1.6);
      scene.add(m); puffs.push({m, v, t: 0});
    }
  }

  // paint on avatars: a splat stuck to the nearest bone
  const avatarSplatGeo = new THREE.PlaneGeometry(1, 1);
  const splatTexture = splats.mesh.material.map;
  function paintAvatar(avatar, local) {
    if (!avatar || !local) return;
    const world = avatar.root.localToWorld(new THREE.Vector3(...local.p));
    const n = new THREE.Vector3(...local.n).applyQuaternion(avatar.root.quaternion);
    let bone = null, best = Infinity;
    avatar.model.updateMatrixWorld(true);
    avatar.model.traverse(o => {
      if (!o.isBone || /Socket/.test(o.name)) return;
      const d = o.getWorldPosition(new THREE.Vector3()).distanceTo(world);
      if (d < best) { best = d; bone = o; }
    });
    if (!bone) return;
    const [cu, cv] = splatCell(local.s);
    const geo = avatarSplatGeo.clone();
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, cu + uv.getX(i) / 4, cv + uv.getY(i) / 2);
    const mat = new THREE.MeshStandardMaterial({map: splatTexture, color: local.c, transparent: true, alphaTest: .35, roughness: .35,
      polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide, depthWrite: false});
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 4;
    const ws = bone.getWorldScale(new THREE.Vector3());
    mesh.position.copy(bone.worldToLocal(world.clone().addScaledVector(n, .015)));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    mesh.quaternion.copy(bone.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
    mesh.scale.set(.22 / ws.x, .22 / ws.y, .22 / ws.z);
    mesh.frustumCulled = false;
    bone.add(mesh);
    (avatar.paint ??= []).push(mesh);
    while (avatar.paint.length > 12) { const old = avatar.paint.shift(); old.removeFromParent(); old.geometry.dispose(); old.material.dispose(); }
  }

  // paintballs in flight (yours and everyone else's)
  const balls = [];
  const ballGeo = new THREE.SphereGeometry(.017, 8, 6);
  const GRAVITY = 5.5, SPEED = 34;
  function simulate(o, v, t) { return new THREE.Vector3(o.x + v.x * t, o.y + v.y * t - .5 * GRAVITY * t * t, o.z + v.z * t); }
  function launch(o, v, color, t, onLand) {
    const m = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({color}));
    m.position.copy(o); scene.add(m);
    balls.push({m, o: o.clone(), v: v.clone(), t: 0, end: t, onLand});
  }
  // where a ball fired from o at velocity v first lands: the level, or a player
  function trace(o, v, ignore) {
    const step = 1 / 60;
    let prev = o.clone();
    for (let t = step; t < 2.5; t += step) {
      const next = simulate(o, v, t), seg = next.clone().sub(prev), len = seg.length(), dir = seg.clone().divideScalar(len);
      let best = null;
      const h = hits.raycast(prev, dir, len);
      if (h) best = {t: t - step + step * h.distance / len, point: h.point, normal: h.normal, d: h.distance};
      for (const p of [...peers.values(), {id: network.id, last: {x: player.x, z: player.z}, avatar: me}]) {
        if (p.id === ignore || !p.last || !p.avatar) continue;
        // a capsule around each body: 0.28 m wide, feet to head
        const cx = p.last.x, cz = p.last.z, base = p.avatar.model.position.y;
        for (let k = 0; k <= 8; k++) {
          const q = prev.clone().addScaledVector(dir, len * k / 8);
          if (q.y < base - .05 || q.y > base + 1.62) continue;
          if (Math.hypot(q.x - cx, q.z - cz) < .3) {
            const d = len * k / 8;
            if (!best || d < best.d) best = {t: t - step + step * d / len, point: q, target: p, d};
            break;
          }
        }
      }
      if (best) return best;
      prev = next;
    }
    return {t: 2.5, point: simulate(o, v, 2.5)};
  }

  // ------------------------------------------------------------- items
  const items = createItems({scene, camera});
  const prompt = $('prompt'), btnAct = $('btnAct');
  const held = () => network.id ? items.heldBy(network.id) : null;
  const heldType = () => held()?.state.type || '';
  function grab() {
    const t = items.target(player, controls.state.yaw, controls.state.pitch);
    if (t) { network.send({type: 'pickup', id: t.state.id}); return true; }
    return false;
  }
  function primary() {
    if (chat.open || !emoteMenu.hidden) return;
    const h = held();
    if (h?.state.type === 'flashlight') { network.send({type: 'toggle', id: h.state.id, on: !h.state.on}); return; }
    if (h?.state.type === 'paintball') { shoot(); return; }
    if (h?.state.type === 'spray') { spray(); return; }
    if (grab()) return;
    punch();
  }
  function secondary() {
    const h = held();
    if (!h) return;
    const yaw = controls.state.yaw;
    toggleGallery(false);
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
  // where the crosshair points: the first thing along the camera's ray
  function aimPoint(far = 60) {
    const o = camera.getWorldPosition(new THREE.Vector3()), d = camera.getWorldDirection(new THREE.Vector3());
    if (thirdPerson) o.addScaledVector(d, camDist);   // start the ray at your shoulder, not behind it
    const h = hits.raycast(o, d, far);
    return {point: h ? h.point : o.clone().addScaledVector(d, far), hit: h, origin: o, dir: d};
  }
  function shoot() {
    const now = performance.now(), gun = held();
    if (!gun || now - lastShot < SHOT_INTERVAL_MS) return;
    lastShot = now;
    camera.updateMatrixWorld(); items.frame(frameArgs(0));
    const muzzle = items.tip(gun);
    const aim = aimPoint();
    const dir = aim.point.clone().sub(muzzle);
    const dist = dir.length(); dir.normalize();
    // aim a little high so the drop meets the crosshair, plus a touch of spread
    const tFlight = dist / SPEED;
    const v = dir.multiplyScalar(SPEED);
    v.y += .5 * GRAVITY * tFlight;
    v.x += (Math.random() - .5) * .5; v.y += (Math.random() - .5) * .5; v.z += (Math.random() - .5) * .5;
    const color = PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)], seed = Math.floor(Math.random() * 0xffffff);
    const land = trace(muzzle, v, network.id);
    const msg = {type: 'shoot', o: muzzle.toArray().map(r3), v: v.toArray().map(r3), c: color, s: seed, t: r3(land.t)};
    if (land.target) {
      msg.target = land.target.id;
      const a = land.target.avatar;
      const lp = a.root.worldToLocal(land.point.clone());
      const ln = land.point.clone().sub(new THREE.Vector3(a.root.position.x, land.point.y, a.root.position.z)).normalize()
        .applyQuaternion(a.root.quaternion.clone().invert());
      msg.local = {p: lp.toArray().map(r3), n: ln.toArray().map(r3)};
    } else if (land.normal) msg.hit = {p: land.point.toArray().map(r3), n: land.normal.toArray().map(r3)};
    items.kick(gun.state.id);
    network.send(msg);
  }
  const r3 = x => Math.round(x * 1000) / 1000;

  // ------------------------------------------------------- spray pieces
  const gallery = $('gallery'), galleryList = gallery.querySelector('.list'), tagLabel = $('tagLabel');
  let chosenPiece = null;
  try { chosenPiece = localStorage.getItem('111k:piece'); } catch {}
  if (!pieceByName.has(chosenPiece)) chosenPiece = pieces.length ? pieces[Math.floor(Math.random() * pieces.length)].name : null;
  const thumbs = new Map();
  function thumb(piece, maxW = 140) {
    const img = level.materials.get(`graffiti_${piece.page}`)?.map?.image;
    const c = document.createElement('canvas');
    if (!img) return c;
    const [u0, v0, u1, v1] = piece.uv;
    const sw = (u1 - u0) * img.width, sh = (v1 - v0) * img.height;
    const s = Math.min(maxW / sw, maxW * .75 / sh, 1);
    c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
    // atlas uvs run bottom-up when the texture is flipped, top-down otherwise
    const flip = level.materials.get(`graffiti_${piece.page}`).map.flipY;
    const sy = flip ? (1 - v1) * img.height : v0 * img.height;
    c.getContext('2d').drawImage(img, u0 * img.width, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  function buildGallery() {
    if (galleryList.childElementCount || !pieces.length) return;
    for (const p of pieces) {
      const b = document.createElement('button'); b.type = 'button'; b.title = p.name.replace(/_/g, ' ');
      b.dataset.piece = p.name;
      b.append(thumb(p));
      b.addEventListener('click', () => choosePiece(p.name));
      galleryList.append(b);
    }
    choosePiece(chosenPiece);
  }
  function choosePiece(name) {
    chosenPiece = name;
    try { localStorage.setItem('111k:piece', name); } catch {}
    for (const b of galleryList.children) b.classList.toggle('chosen', b.dataset.piece === name);
    const p = pieceByName.get(name);
    tagLabel.replaceChildren(...(p ? [thumb(p, 72), document.createTextNode(isTouch ? 'tap tags to change' : 'esc: change piece')] : []));
  }
  function toggleGallery(force) {
    const open = force ?? gallery.hidden;
    if (open && !pieces.length) return;
    if (open) { buildGallery(); gallery.querySelector('.chosen')?.scrollIntoView({block: 'nearest'}); }
    gallery.hidden = !open;
  }
  function spray() {
    const now = performance.now(), can = held();
    if (!can || !chosenPiece || now - lastSpray < SPRAY_INTERVAL_MS) return;
    const piece = pieceByName.get(chosenPiece);
    const aim = aimPoint(SPRAY_RANGE + 3);
    if (!aim.hit || Math.hypot(aim.point.x - player.x, aim.point.z - player.z) > SPRAY_RANGE) { items.shake(can.state.id); return; }
    lastSpray = now;
    const n = aim.hit.normal;
    // upright on walls; on floors and ceilings, readable from where you stand
    const up = Math.abs(n.y) < .7 ? new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize()
      : new THREE.Vector3(aim.dir.x, 0, aim.dir.z).normalize().multiplyScalar(n.y > 0 ? 1 : -1);
    const tilt = (Math.random() - .5) * .12;
    up.applyAxisAngle(n, tilt);
    const big = Math.max(piece.w, piece.h);
    const size = Math.max(.35, Math.min(piece.w * Math.min(1, 1.5 / big), 2.2)) * (.9 + Math.random() * .2);
    items.shake(can.state.id);
    network.send({type: 'spray', p: aim.point.toArray().map(r3), n: n.toArray().map(r3), up: up.toArray().map(r3), piece: chosenPiece,
      size: Math.round(size * 100) / 100});
  }

  // ----------------------------------------------------------- network
  const peers = new Map();
  const online = $('online');
  function updateCount() { online.textContent = `${peers.size + 1} here`; }
  function peer(id) {
    if (!id || id === network.id) return null;
    let p = peers.get(id);
    if (p) return p;
    p = {id, motion: createPoseBuffer(), avatar: null, look: null, lookKey: '', previous: null, lastUpdate: 0, bubble: null,
      typing: null, hue: hueOf(id), last: null, pendingPaint: []};
    peers.set(id, p); updateCount();
    return p;
  }
  function setLook(p, look) {
    const clean = cleanLook(look);
    if (!clean) return;
    const key = JSON.stringify(clean);
    if (key === p.lookKey) return;
    p.lookKey = key; p.look = clean;
    createAvatar(clean).then(a => {
      if (peers.get(p.id) !== p || p.lookKey !== key) { a.dispose(); return; }
      p.avatar?.dispose(); p.avatar = a; scene.add(a.root);
      for (const local of p.pendingPaint.splice(0)) paintAvatar(a, local);
    }).catch(err => console.warn('avatar failed', err));
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
    onStatus: s => {
      status.dataset.state = s; status.title = s;
      if (s === 'online') { lastSent = ''; network.send({type: 'look', look: mine.look, name: mine.name}); }
    },
    onState: m => {
      const live = new Set(m.players.map(p => p.id));
      for (const id of [...peers.keys()]) if (!live.has(id)) removePeer(id);
      for (const p of m.players) if (p.id !== network.id) { applyPose(p.id, p.pose, m.now); if (p.look) setLook(peer(p.id), p.look); }
      if (m.items) items.set(m.items);
    },
    onPose: m => applyPose(m.id, m.pose, m.time),
    onLeave: id => removePeer(id),
    onItem: it => {
      const before = items.items.get(it.id)?.state.holder;
      items.update(it);
      if (before === network.id && it.holder !== network.id) toggleGallery(false);
    },
    onPunch: m => {
      if (m.target === network.id) {
        // knocked back, a little hop, and the screen jolts
        player.kx += m.dir[0] * 7.5; player.kz += m.dir[1] * 7.5;
        vertical.bump(); shake = 1;
      }
    },
    onChat: m => {
      const own = m.id === network.id;
      chat.record(m.text, {own, hue: hueOf(m.id), name: m.name || ''});
      const bubble = createBubble(m.text);
      if (own) { myBubble?.dispose(); myBubble = bubble; myBubbleExpires = m.expiresAt; return; }
      const target = peer(m.id);
      if (!target) { bubble.dispose(); return; }
      target.bubble?.dispose(); target.bubble = bubble; target.bubbleExpires = m.expiresAt;
    },
    onMessage: m => {
      if (m.type === 'look' && m.id !== network.id) setLook(peer(m.id), m.look);
      else if (m.type === 'marks') resetMarks(m);
      else if (m.type === 'shot') {
        const o = new THREE.Vector3(...m.o), v = new THREE.Vector3(...m.v);
        launch(o, v, m.c, m.t, () => {
          if (m.hit) { const s = cleanSplat(m.hit); if (s) addSplat({...s, c: m.c, s: m.s}, true); }
          if (m.target && m.local) {
            const local = {...m.local, c: m.c, s: m.s};
            const end = simulate(o, v, m.t);
            if (m.target === network.id) { paintAvatar(me, local); paintAvatar(meView, local); shake = Math.max(shake, .5); }
            else {
              const p = peers.get(m.target);
              if (p?.avatar) paintAvatar(p.avatar, local); else p?.pendingPaint.push(local);
            }
            burst(end, new THREE.Vector3(0, 1, 0), m.c);
          }
        });
      } else if (m.type === 'spray') {
        addSpray(m.mark, true);
        const p = peers.get(m.from);
        if (p?.avatar) p.sprayed = performance.now();
      }
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
  let camDist = 1.9, camSide = .6, lastSent = '', sentAt = 0, settle = 0, last = performance.now(), firstFrame = true, savedAt = 0;
  loading.classList.add('done');
  $('hint').hidden = isTouch;
  choosePiece(chosenPiece);

  function project(pos, height) {
    bubbleAnchor.set(pos.x, height, pos.z).project(camera);
    const visible = bubbleAnchor.z > -1 && bubbleAnchor.z < 1 && Math.abs(bubbleAnchor.x) < 1.1 && Math.abs(bubbleAnchor.y) < 1.1;
    return {x: (bubbleAnchor.x + 1) * innerWidth / 2, y: (1 - bubbleAnchor.y) * innerHeight / 2, visible};
  }
  // speech bubbles hide when a wall is between you and the speaker
  function inSight(pos) {
    const dx = pos.x - camera.position.x, dz = pos.z - camera.position.z, d = Math.hypot(dx, dz);
    return d < .3 || collider.raycast(camera.position.x, camera.position.z, dx, dz, d, Math.min(camera.position.y, 1.7), 0) >= d - .25;
  }
  const frameArgs = dt => ({me, myId: network.id, thirdPerson, avatarOf: id => peers.get(id)?.avatar, poseOf: id => peers.get(id)?.last, dt});
  function saveTab() {
    tabMe.set({look: mine.look, name: mine.name, x: r3(player.x), z: r3(player.z), yaw: r3(controls.state.yaw), pitch: r3(controls.state.pitch),
      view: thirdPerson ? '3p' : '1p'});
  }
  addEventListener('pagehide', saveTab);

  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min(.1, (now - last) / 1000); last = now;
    const input = controls.update();
    const frozen = chat.open || !emoteMenu.hidden;
    // movement in the camera's yaw frame, plus any knock-back still fading out
    const speed = (input.run ? 4.3 : 2.7) * (input.crouch ? .5 : 1) * vertical.boost;
    const mx = frozen ? 0 : input.moveX, mz = frozen ? 0 : input.moveZ;
    const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
    const tx = (mx * cos + mz * sin) * speed, tz = (-mx * sin + mz * cos) * speed;
    player.vx += (tx - player.vx) * damp(12, dt); player.vz += (tz - player.vz) * damp(12, dt);
    if (vertical.takeHop()) {   // a clean hop shoves you along the way you're going
      const v = Math.hypot(player.vx, player.vz);
      if (v > .5) { player.kx += player.vx / v * .9; player.kz += player.vz / v * .9; }
    }
    player.kx *= Math.exp(-dt * 5); player.kz *= Math.exp(-dt * 5);
    const px = player.x, pz = player.z;
    [player.x, player.z] = collider.resolve(player.x + (player.vx + player.kx) * dt, player.z + (player.vz + player.kz) * dt);
    doors.push(player.x, player.z, player.x - px, player.z - pz);
    [player.x, player.z] = doors.resolve(player.x, player.z);
    const velocity = Math.hypot(player.x - px, player.z - pz) / Math.max(dt, 1e-4);
    if (velocity > .3) player.emote = '';
    if (player.emote) player.emoteTime = Math.min(EMOTE_DURATION, player.emoteTime + dt);
    if (player.punchTime >= 0) { player.punchTime += dt; if (player.punchTime > PUNCH_DURATION) player.punchTime = -1; }
    player.y = vertical.update(dt, !frozen && input.crouch);
    const h = held(), holding = !!h;
    if (h?.state.type === 'paintball' && input.firing && !frozen) shoot();
    document.body.classList.toggle('holding-spray', h?.state.type === 'spray');
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
      // over the right shoulder, close in: you see past yourself to what you're aiming at
      const yaw = input.yaw, pitch = input.pitch;
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const sideRoom = collider.raycast(player.x, player.z, rx, rz, 1, player.y, .12) - .2;
      const wantSide = Math.max(.12, Math.min(.68, sideRoom));
      camSide += (wantSide - camSide) * damp(wantSide < camSide ? 25 : 5, dt);
      const head = Math.min(player.y + .2, ceilingAt(player.x, player.z) - .28);
      pivot.set(player.x + rx * camSide, head, player.z + rz * camSide);
      if (firstFrame) smoothPivot.copy(pivot);
      smoothPivot.lerp(pivot, damp(22, dt));
      smoothPivot.x = pivot.x; smoothPivot.z = pivot.z;    // only ease the height (jumps, crouches)
      dir.set(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const want = 1.95;
      // walls: the horizontal part of the boom, tested from three points across the camera's width
      const flat = Math.hypot(dir.x, dir.z) || 1e-6;
      let free = want;
      for (const off of [-.14, 0, .14]) {
        const ox = smoothPivot.x + rx * off, oz = smoothPivot.z + rz * off;
        free = Math.min(free, collider.raycast(ox, oz, dir.x, dir.z, want * flat, smoothPivot.y, .16) / flat);
      }
      // the level itself (door frames, props, low ceilings)
      const back = hits.raycast(smoothPivot, dir, want);
      if (back) free = Math.min(free, back.distance - .15);
      if (dir.y > 1e-4) {
        const endX = smoothPivot.x + dir.x * free, endZ = smoothPivot.z + dir.z * free;
        free = Math.min(free, (ceilingAt(endX, endZ) - .18 - smoothPivot.y) / dir.y);
      } else if (dir.y < -1e-4) free = Math.min(free, (smoothPivot.y - .2) / -dir.y);
      free = Math.max(.2, free);
      camDist += (free - camDist) * (free < camDist ? damp(30, dt) : damp(4, dt));
      if (firstFrame) camDist = free;
      camera.position.copy(smoothPivot).addScaledVector(dir, camDist);
      me.setVisible(camDist > .55);  // too close to a wall: hide yourself rather than fill the screen
      meView.root.visible = false;
    } else {
      camera.position.set(player.x, player.y, player.z);
      me.setVisible(false);
      // your punch, seen from inside your head
      meView.root.visible = player.punchTime >= 0;
      if (meView.root.visible) {
        meView.root.position.set(.0, -EYE_HEIGHT + .36, .3);
        meView.update(dt, 0, {punchTime: player.punchTime, pitch: 0});
      }
    }
    firstFrame = false;
    camera.rotation.set(input.pitch + sy, input.yaw + sx, 0);
    camera.updateMatrixWorld();

    // network: 15 Hz while something changes, then 3 settling packets
    if (now - sentAt >= 1000 / 15 && network.online) {
      const pose = sanitizePose({x: player.x, y: player.y, z: player.z, yaw: input.yaw, pitch: input.pitch, room: 'office',
        crouch: motion.crouch, jumpTime: motion.jumpTime, jumpPower: motion.jumpPower, emote: player.emote, emoteTime: player.emoteTime,
        typing: chat.typing, punchTime: player.punchTime});
      const key = JSON.stringify(pose);
      if (key !== lastSent) settle = 3;
      if (key !== lastSent || settle > 0) { network.sendPose(pose); if (key === lastSent) settle--; lastSent = key; }
      sentAt = now;
    }
    if (now - savedAt > 1000) { savedAt = now; saveTab(); }

    // remote peers
    const serverNow = network.now();
    for (const p of peers.values()) {
      const s = p.motion.sample(now);
      if (!s) continue;
      p.last = s;
      if (!p.avatar) continue;
      const pdt = Math.min(.1, Math.max(0, (now - (p.lastUpdate || now)) / 1000)); p.lastUpdate = now;
      const v = p.previous && pdt > 0 ? Math.hypot(s.x - p.previous.x, s.z - p.previous.z) / pdt : 0;
      p.previous = s;
      p.avatar.root.position.set(s.x, 0, s.z); p.avatar.root.rotation.y = s.yaw;
      p.avatar.update(pdt, v, {...s, holding: !!items.heldBy(p.id)});
      doors.push(s.x, s.z, v * pdt * Math.sin(-s.yaw), 0);
      if (p.bubble && serverNow > p.bubbleExpires) { p.bubble.dispose(); p.bubble = null; }
      if (p.bubble || p.typing) {
        if (!p.sightAt || now - p.sightAt > 150) { p.seen = inSight(s); p.sightAt = now; }
        const at = project(s, 2.0 + (s.jumpTime >= 0 ? .4 : 0));
        const show = at.visible && p.seen;
        const top = p.bubble ? p.bubble.update(at.x, at.y, show) : at.y;
        p.typing?.update(at.x, top, show);
      }
    }
    if (myBubble) {
      if (serverNow > myBubbleExpires) { myBubble.dispose(); myBubble = null; }
      else { const at = project(player, 2.0); myBubble.update(at.x, at.y, at.visible && thirdPerson); }
    }
    doors.update(dt);

    // paintballs, paint puffs, fresh tags
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.t = Math.min(b.end, b.t + dt);
      b.m.position.copy(simulate(b.o, b.v, b.t));
      if (b.t >= b.end) { b.m.removeFromParent(); b.m.material.dispose(); balls.splice(i, 1); b.onLand(); }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const f = puffs[i];
      f.t += dt; f.v.y -= 6 * dt;
      f.m.position.addScaledVector(f.v, dt);
      f.m.scale.setScalar(Math.max(.01, 1 - f.t * 2.5));
      if (f.t > .4) { f.m.removeFromParent(); puffs.splice(i, 1); }
    }
    for (let i = fades.length - 1; i >= 0; i--) {
      const f = fades[i];
      f.t += dt;
      f.batch.setAlpha(f.m, Math.min(1, f.t / .55));
      if (f.t >= .55) fades.splice(i, 1);
    }

    // held items and what you can do right now
    items.frame(frameArgs(dt));
    const t = !h && !frozen ? items.target(player, input.yaw, input.pitch) : null;
    const type = h?.state.type;
    const hint = isTouch ? '' : h ? (type === 'flashlight' ? `click: ${h.state.on ? 'turn off' : 'turn on'}  ·  right-click: drop`
      : type === 'paintball' ? 'click: fire  ·  right-click: drop' : 'click a wall: spray  ·  esc: pick a piece  ·  right-click: drop')
      : t ? `click: pick up ${ITEM_NAMES[t.state.type] || 'it'}` : '';
    if (prompt.textContent !== hint) prompt.textContent = hint;
    document.body.classList.toggle('holding', !!h);
    tagLabel.hidden = type !== 'spray' || !chosenPiece;
    const act = h ? (type === 'flashlight' ? (h.state.on ? 'light off' : 'light on') : type === 'paintball' ? 'fire' : 'spray') : t ? 'grab' : 'punch';
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
  window.__111k = {scene, camera, player, peers, network, renderer, items, controls, hits, doors, me, meView, vertical,
    setView: v => { thirdPerson = v; }, primary, secondary, shoot, spray, choosePiece, toggleGallery, get pieces() { return pieces; }};
}

start().catch(err => {
  console.error(err);
  loading.classList.remove('done');
  loading.querySelector('p').textContent = 'Could not load the space. Refresh to try again.';
});

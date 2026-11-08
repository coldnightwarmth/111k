import * as THREE from 'three';
import {serverUrl, isTouch, lowPower} from './config.js';
import {loadLevel, createAvatarLights, createFlicker, lighting, ghost} from './level.js';
import {createCollider, STEP_UP} from './physics.js';
import {createAvatar, preloadLook, AVATAR_SCALE} from './avatar.js';
import {createVerticalMovement, createPoseBuffer, EYE_HEIGHT, jumpHeight} from './motion.js';
import {connectRoom} from './net.js';
import {createChatUI, createBubble} from './chat.js';
import {createControls} from './controls.js';
import {createItems, ITEM_NAMES, simulateFall} from './items.js';
import {createMachine} from './machine.js';
import {createShelves, SHELF_COLLIDERS} from './shelves.js';
import {mergeGeometries} from '../vendor/three/BufferGeometryUtils.js';
import {createCleaning} from './cleaning.js';
import {MACHINE_COLLIDER, BUTTON, BUTTON_RANGE, RACE_LAPS} from './race.js';
import {KOTH_GRACE_MS, KOTH_WIN_MS, kothActive, kothTime} from './koth.js';
import {createMimic} from './mimic.js';
import {createBeamShadows, castsBeamShadow} from './beamshadows.js';
import {createWorldHits, cutDecal, createBatch, markMaterial, splatAtlas, splatCell, PAINT_COLORS, PAINT_ROWS, RANDOM_PAINT, rgbOf} from './decals.js';
import {createDoors} from './doors.js';
import {pickAvatar} from './picker.js';
import {createVoice, voicePanel} from './voice.js';
import {randomLook, cleanLook} from './looks.js';
import {cleanEmoteConfig, offeredEmotes} from './emotes.js';
import {EMOTES, EMOTE_DURATION, PUNCH_COOLDOWN_MS, PUNCH_DURATION, PUNCH_COMBO_MS, SHOT_INTERVAL_MS, SPRAY_INTERVAL_MS, SPRAY_RANGE,
  MAX_SPLATS, MAX_SPRAYS, SPLAT_LIFE_MS, sanitizePose, sanitizeName, cleanSplat, cleanSpray, splatId, sprayId} from './protocol.js';
import {paintingSize, paintingMatrix, paintingTris} from './paintings.js';

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
const voice = createVoice();   // proximity voice: set up on the start screen or the Esc screen

// --------------------------------------------------------------- renderer
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({canvas, antialias: !lowPower, powerPreference: 'high-performance'});
// checking each shader for errors makes the browser finish compiling it on the spot (a stall each time
// something new comes into view); only worth it while developing
renderer.debug.checkShaderErrors = /^(localhost|127\.|\[::1\])/.test(location.hostname);
// if the GPU drops the context (a driver reset, a phone putting the tab to sleep), come straight back:
// the session keeps where you were and what you held
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); });
canvas.addEventListener('webglcontextrestored', () => location.reload());
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
  // the picker comes up over the black; "going down…" only shows once you've picked
  const last = lastMe.get();
  const pick = await pickAvatar({previous: last?.look ? cleanLook(last.look) : null, name: last?.name || '', extra: voicePanel(voice, {checkbox: true})});
  return {look: pick.look, name: sanitizeName(pick.name)};
}

async function start() {
  const levelReady = loadLevel('world', renderer);
  levelReady.catch(() => {});
  const mine = await chooseYourself();
  loading.classList.add('going');      // "going down…" while the space loads
  const goingAt = performance.now();
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
  level.meta.colliders.push(MACHINE_COLLIDER, ...SHELF_COLLIDERS);   // the lap timer and the supply shelves stand in the level too
  const collider = createCollider(level.meta);
  const doors = createDoors(level, collider);
  const hits = createWorldHits(level, doors.doors);
  const machine = createMachine(scene);
  // the lap timer takes tags and paint (all but its display and its button); its paint borrows the baked
  // light of the tunnel wall right beside it
  {
    machine.root.updateMatrixWorld(true);
    const beside = machine.root.localToWorld(new THREE.Vector3(.95, 1.3, .4)), into = new THREE.Vector3(0, 0, -1).transformDirection(machine.root.matrixWorld);
    hits.addPaintable(machine.root, hits.lightAt(beside, into, 3));
  }
  const shelves = createShelves(THREE, scene, mergeGeometries);
  hits.addSolid(shelves);
  // what blocks flashlight beams: the level (doors included), the lap timer and the shelving
  for (const m of level.meshes) if (!m.material.transparent) castsBeamShadow(m);
  castsBeamShadow(machine.root); castsBeamShadow(shelves);
  const beamShadows = createBeamShadows(renderer, scene);
  const cleaning = createCleaning({level, scene, hits});
  const mimic = createMimic(level, scene);   // the control room's ring board: occupied rooms light up
  let mimicAt = 0;
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
    emote: '', emoteTime: 0, punchTime: -1, punchHand: 0, impactIn: -1,
    ground: resumed && Number.isFinite(mine.g) ? mine.g : 0,   // height of whatever's under your feet (floor, pallet, desk)
    fall: 0, stepLag: 0};
  const vertical = createVerticalMovement();
  const me = await createAvatar(mine.look);
  scene.add(me.root);
  // first person: a headless copy of you rides the camera so you can see your own punch
  const meView = await createAvatar(mine.look);
  meView.setHeadless(true);
  meView.root.visible = false;
  camera.add(meView.root);
  let thirdPerson = params.get('view') === '3p' || (resumed && mine.view === '3p');
  let fireLatch = false, doorAim = null, doorCheckAt = 0, cleanTarget = null, cleanCheckAt = 0;   // set by the click that picks something up, until the button is let go
  const speedoEl = $('speedo'), speedoNum = speedoEl.querySelector('b');
  let speedNow = 0, speedoPeak = 0, speedoHold = 0, speedoLive = false, speedoShown = false, speedoBlink = false;
  // things you've done at least once (remembered in this browser): their hints stop showing
  let learned = new Set();
  try { learned = new Set(JSON.parse(localStorage.getItem('111k:learned') || '[]')); } catch {}
  const learnHooks = [];
  function learn(c) {
    if (learned.has(c)) return;
    learned.add(c);
    try { localStorage.setItem('111k:learned', JSON.stringify([...learned])); } catch {}
    for (const f of learnHooks) f();
  }
  // while you emote the camera swings round you on a boom (first person too) and you hold still
  let orbiting = false, emoteYaw = 0, boom = thirdPerson, wasBoom = thirdPerson;
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
      // Esc (or Tab) while holding a can opens the piece gallery (or, holding the paintball gun, the paint list)
      const byYou = !menuRelease && !chat.open && emoteMenu.hidden;
      if (byYou && ['spray', 'paintball'].includes(heldType())) toggleGallery(true);
      menuRelease = false;
      // and it opens the chat box, ready to type (staying out of the world once you've sent or shut it).
      // Not when the mouse went because the window lost focus (switching apps, a system dialog).
      if (byYou && !controls.state.touch) setTimeout(() => {
        if (document.hasFocus() && document.visibilityState === 'visible' && !controls.state.locked && !chat.open && emoteMenu.hidden) { relock = false; chat.setOpen(true); }
      }, 60);
    },
    onPrimary: () => primary(),
    onSecondary: () => secondary(),
    onUse: () => { held() ? secondary() : grab() || secondary(); },
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
  // the menu offers what the site's settings switch on (changed from /anim, sent by the server, live)
  let emoteConfig = cleanEmoteConfig(null);
  function emoteButtons() {
    emoteMenu.replaceChildren(...offeredEmotes(emoteConfig).map(e => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = e.label;
      b.addEventListener('click', () => { player.emote = e.id; player.emoteTime = 0; toggleEmotes(false); backToPlay(); });
      return b;
    }));
  }
  emoteButtons();
  function toggleEmotes(force) {
    const open = force ?? emoteMenu.hidden;
    emoteMenu.hidden = !open;
    if (open) { toggleGallery(false); release(); }
  }
  addEventListener('keydown', e => { if (e.code === 'Escape' || e.code === 'Tab') { toggleEmotes(false); if (!controls.state.locked) toggleGallery(false); } });
  // clicking back into the world closes the chat box, the emote menu or the gallery and gives you control again
  document.addEventListener('pointerdown', e => {
    if (!emoteMenu.hidden && !e.target.closest('#emotes, #btnEmote')) toggleEmotes(false);
    if (chat.open && !e.target.closest('#chat, #btnChat')) { relock = false; chat.setOpen(false); }   // (scrolling the log keeps it open)
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
  const splatMarks = [];   // {batch, m, born}: paint fades away a minute after it lands
  const doorBatches = new Map();
  function doorBatch(k) {
    if (!doorBatches.has(k)) {
      const surface = hits.door(k);
      if (!surface) return null;
      const b = createBatch(splats.mesh.material, 2000);
      b.mesh.renderOrder = 3; surface.mesh.add(b.mesh);   // rides along as the door swings
      doorBatches.set(k, {batch: b, surface});
    }
    return doorBatches.get(k);
  }
  // The tags menu (and scrolling through tags) goes word by word: names are style_word[_variant], so every
  // take on a word sits together (words A to Z; within one, tags first, then throw-ups, pieces and the rest,
  // each plain before its variants).
  const STYLE_ORDER = ['tag', 'wk', 'bf', 'mp', 'tu', 'pc', 'ol', 'pl', 'hs', 'sp', 'fx', 'rl', 'sc', 'sn', 'mk', 'ex', 'dd'];
  const pieceKey = name => { const [style, word = '', ...rest] = name.split('_'), k = STYLE_ORDER.indexOf(style);
    return [word, k < 0 ? STYLE_ORDER.length : k, rest.join('_')]; };
  const byWord = (a, b) => { const x = pieceKey(a.name), y = pieceKey(b.name);
    return x[0].localeCompare(y[0], undefined, {numeric: true}) || x[1] - y[1] || x[2].localeCompare(y[2]); };
  const pieces = [...(level.meta.graffiti || [])].sort(byWord);
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
  const PUNCH_IMPACT = .2;   // seconds into the punch when the fist is all the way out (frame 6 of 15)
  const SPRAY_FADE_IN = .28, PAINT_FADE_MS = 4000, HOP_GRACE = .2;
  let lastPaintCheck = 0;
  // ------------------------------------------- paint on paintings
  // Paint that lands on a painting is cut in the painting's own space and hung on it, so it goes wherever
  // the painting goes. What lands round it stays put, with the painting's shape cut out of it for good
  // (that bit of wall was behind the painting), so moving the painting away leaves a clean patch.
  const trisByArt = new Map(), noUv = new THREE.Vector2();
  const boxTris = art => { if (!trisByArt.has(art)) trisByArt.set(art, paintingTris(art)); return trisByArt.get(art); };
  function paintingSurface(pi) {
    const it = items.items.get(pi);
    if (!it?.model.userData.painting) return null;
    const {w, h, d} = paintingSize(it.state.art), c0 = new THREE.Vector3(0, 0, d / 2), r0 = Math.hypot(w, h, d) / 2;
    const tris = boxTris(it.state.art).map(t => ({p: t.p, uv: [noUv, noUv, noUv], n: t.n}));
    return {mesh: it.model, gather: (center, radius) => (center.distanceTo(c0) > radius + r0 ? [] : tris)};
  }
  // the level plus the paintings that stood in front of a mark when it went on (they take no paint here)
  function withOccluders(occ) {
    if (!occ?.length) return hits;
    const extra = occ.map(([x, y, z, yaw, tilt, art, roll = 0]) => {
      const m = paintingMatrix(x, y, z, yaw, tilt, roll), {w, h, d} = paintingSize(art);
      return {c: new THREE.Vector3(0, 0, d / 2).applyMatrix4(m), r: Math.hypot(w, h, d) / 2,
        tris: boxTris(art).map(t => ({p: t.p.map(q => q.clone().applyMatrix4(m)), uv: [noUv, noUv, noUv], n: t.n.clone().transformDirection(m), noPaint: true}))};
    });
    return {gather: (center, radius) => [...hits.gather(center, radius), ...extra.filter(e => e.c.distanceTo(center) <= radius + e.r).flatMap(e => e.tris)]};
  }
  // marks hung on a painting: lit like the painting (not by the level's baked light, which stays behind)
  const paintingBatches = new Map(), paintingMats = new Map();
  function paintingBatch(pi, key, map) {
    const k = `${pi}|${key}`;
    if (!paintingBatches.has(k)) {
      if (!paintingMats.has(key)) paintingMats.set(key, new THREE.MeshStandardMaterial({map, transparent: true, depthWrite: false, vertexColors: true,
        roughness: .8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -4}));
      const b = createBatch(paintingMats.get(key), 2000);
      b.mesh.renderOrder = 3; items.items.get(pi).model.add(b.mesh);
      paintingBatches.set(k, b);
    }
    return paintingBatches.get(k);
  }
  // The pieces of a mark (in the world) that land on paintings, each in that painting's own space;
  // the paintings it touched are noted on the mark itself, so the wall keeps their outline clean.
  function paintingParts(kind, base, piece = null) {
    if (base.d !== undefined) return [];
    const p = new THREE.Vector3(...base.p), n = new THREE.Vector3(...base.n);
    const half = kind === 'spray' ? base.size * Math.max(1, piece.h / piece.w) / 2 : .2, reach = kind === 'spray' ? 1.6 : .7;
    const parts = [], occ = [];
    for (const it of items.paintings()) {
      const u = it.model.userData;
      it.model.updateMatrixWorld();
      const c = new THREE.Vector3(0, 0, u.d / 2).applyMatrix4(it.model.matrixWorld);
      if (c.distanceTo(p) > half * 1.5 + Math.hypot(u.w, u.h) / 2 + reach) continue;
      const inv = it.model.matrixWorld.clone().invert(), dirIn = v => new THREE.Vector3(...v).transformDirection(inv).toArray().map(r3);
      const local = {...base, pi: it.state.id, p: p.clone().applyMatrix4(inv).toArray().map(r3), n: dirIn(base.n)};
      delete local.occ;
      if (base.up) local.up = dirIn(base.up);
      if (base.v) local.v = dirIn(base.v);
      const surface = paintingSurface(it.state.id);
      const verts = kind === 'spray' ? sprayVerts(local, piece, surface) : splatVerts(local, surface);
      if (!verts.length) continue;
      const s = it.state;
      parts.push(local); occ.push([r3(s.x), r3(s.y), r3(s.z), r3(s.yaw), r3(s.tilt || 0), s.art || 1, ...(s.roll ? [r3(s.roll)] : [])]);
    }
    if (occ.length) base.occ = occ;
    return parts;
  }
  // a splat's patch: thrown along the ball's flight, it wraps the corner it can reach and lands round
  // small things, never behind. Doors are thin: cut shallow so the paint stays on the face that was hit
  function splatVerts(s, surface) {
    const point = new THREE.Vector3(...s.p), normal = new THREE.Vector3(...s.n), thin = s.d !== undefined;
    const r = ((s.s >> 3) % 1000) / 1000, size = .2 + r * .16;
    const up = Math.abs(normal.y) > .9 ? new THREE.Vector3(Math.cos(s.s), 0, Math.sin(s.s)) : new THREE.Vector3(0, 1, 0);
    up.applyAxisAngle(normal, (s.s % 628) / 100);
    const verts = cutDecal(surface || withOccluders(s.occ), {point, normal, up, width: size, height: size,
      dir: s.v ? new THREE.Vector3(...s.v) : null, front: thin ? .03 : .3, back: thin ? .03 : .35, apart: s.pi ? null : undefined});
    const [cu, cv] = splatCell(s.s);
    for (const q of verts) { q.u = cu + q.u / 4; q.v = cv + q.v / 2; }
    return verts;
  }
  function addSplat(s, fresh = false, age = 0) {
    if (age >= SPLAT_LIFE_MS) return;
    const onDoor = s.d !== undefined ? doorBatch(s.d) : null;
    if (s.d !== undefined && !onDoor) return;
    const onPainting = s.pi ? paintingSurface(s.pi) : null;
    if (s.pi && !onPainting) return;
    const batch = onDoor ? onDoor.batch : onPainting ? paintingBatch(s.pi, 'splat', splats.mesh.material.map) : splats;
    const verts = splatVerts(s, onDoor ? onDoor.surface : onPainting);
    const m = batch.add(verts, rgbOf(s.c));
    splatMarks.push({batch, m, born: performance.now() - age, kind: 'splat', id: splatId(s), verts: m.verts});
    while (splatMarks.length > MAX_SPLATS) { const old = splatMarks.shift(); old.batch.remove(old.m); }
    if (fresh && !onPainting) {      // (one puff per ball: the part on a painting comes with one on the world)
      const point = new THREE.Vector3(...s.p), normal = new THREE.Vector3(...s.n);
      if (onDoor) { onDoor.surface.mesh.localToWorld(point); normal.transformDirection(onDoor.surface.mesh.matrixWorld); }
      burst(point, normal, s.c);
    }
  }
  // tags on a door live in a batch hung on that door, in its hinge space
  const doorPages = new Map();
  function doorPageBatch(k, page) {
    const key = `${k}:${page}`;
    if (!doorPages.has(key)) {
      const b = createBatch(pageBatch(page).mesh.material, 3000);
      b.mesh.renderOrder = 2; hits.door(k).mesh.add(b.mesh);
      doorPages.set(key, b);
    }
    return doorPages.get(key);
  }
  // the patch a tag covers: cut from whatever it lands on (a door's own surface for a door)
  // how far along the throw a tag carries from what you hit: 60 cm beyond it (into a doorway's recess), and toward you
  // right up to the nozzle (1.5 m for tags sprayed before where you stood was sent along)
  const sprayReach = s => [.6, s.r !== undefined ? Math.max(.1, s.r - .05) : 1.5];
  function sprayVerts(s, piece, surface = null) {
    const point = new THREE.Vector3(...s.p), normal = new THREE.Vector3(...s.n), up = new THREE.Vector3(...s.up), thin = s.d !== undefined;
    const verts = cutDecal(surface || withOccluders(s.occ), {point, normal, up, width: s.size, height: s.size * piece.h / piece.w,
      dir: s.v ? new THREE.Vector3(...s.v) : null, front: thin ? .03 : .9, back: thin ? .03 : .6,
      slab: thin ? null : sprayReach(s), thrower: s.r ?? null, apart: s.pi ? null : undefined});   // (on a painting, the painting is all there is)
    const [u0, v0, u1, v1] = piece.uv;
    for (const q of verts) { q.u = u0 + q.u * (u1 - u0); q.v = v0 + q.v * (v1 - v0); }
    return verts;
  }
  function addSpray(s, fresh = false) {
    const piece = pieceByName.get(s.piece);
    if (!piece) return;
    const onDoor = s.d !== undefined ? hits.door(s.d) : null;
    if (s.d !== undefined && !onDoor) return;
    const onPainting = s.pi ? paintingSurface(s.pi) : null;
    if (s.pi && !onPainting) return;
    const verts = sprayVerts(s, piece, onDoor || onPainting);
    const batch = onDoor ? doorPageBatch(s.d, piece.page) : onPainting ? paintingBatch(s.pi, `page${piece.page}`, pageBatch(piece.page).mesh.material.map)
      : pageBatch(piece.page);
    const m = batch.add(verts, [255, 255, 255], fresh ? 0 : 1);
    sprayMarks.push({batch, m, kind: 'spray', id: sprayId(s), verts: m.verts});
    while (sprayMarks.length > MAX_SPRAYS) { const old = sprayMarks.shift(); old.batch.remove(old.m); }
    if (fresh) fades.push({batch, m, t: 0});
  }
  // a mark scrubbed off by someone with the bucket
  function eraseMark(kind, id) {
    if (kind === 'baked') { cleaning.eraseBaked(id); return; }
    const list = kind === 'splat' ? splatMarks : sprayMarks;
    const i = list.findIndex(k => k.id === id);
    if (i >= 0) { list[i].batch.remove(list[i].m); list.splice(i, 1); }
    cleaning.forget(kind, id);
  }
  function resetMarks(list) {
    for (const id of list.erased || []) cleaning.eraseBaked(id);
    splats.clear(); splatMarks.length = 0;
    for (const d of doorBatches.values()) d.batch.clear();
    for (const b of pageBatches.values()) b.clear();
    for (const b of doorPages.values()) b.clear();
    for (const b of paintingBatches.values()) b.clear();
    sprayMarks.length = 0;
    for (const s of list.splats || []) { const c = cleanSplat(s); if (c) addSplat(c, false, Number.isFinite(s.age) ? s.age : 0); }
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
    mesh.userData.born = performance.now();
    (avatar.paint ??= []).push(mesh);
    while (avatar.paint.length > 12) { const old = avatar.paint.shift(); old.removeFromParent(); old.geometry.dispose(); old.material.dispose(); }
  }

  // paintballs in flight (yours and everyone else's)
  const balls = [];
  const ballGeo = new THREE.SphereGeometry(.017, 8, 6);
  const GRAVITY = 5.5, SPEED = 34;
  function simulate(o, v, t) { return new THREE.Vector3(o.x + v.x * t, o.y + v.y * t - .5 * GRAVITY * t * t, o.z + v.z * t); }
  // `from`: where the ball should be seen leaving (the barrel tip as this client sees it); it eases
  // onto the real flight within its first few metres, so it still lands exactly where it lands
  function launch(o, v, color, t, onLand, from = null) {
    const m = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({color}));
    const offset = from ? from.clone().sub(o) : new THREE.Vector3();
    if (offset.length() > 3) offset.set(0, 0, 0);          // too far off to be the same gun: don't bend it
    m.position.copy(o).add(offset); scene.add(m);
    balls.push({m, o: o.clone(), v: v.clone(), t: 0, end: t, onLand, offset, blend: Math.max(1e-3, Math.min(.12, t * .6))});
  }
  // where a ball fired from o at velocity v first lands: the level, or a player
  function trace(o, v, ignore) {
    const step = 1 / 60;
    let prev = o.clone();
    for (let t = step; t < 2.5; t += step) {
      const next = simulate(o, v, t), seg = next.clone().sub(prev), len = seg.length(), dir = seg.clone().divideScalar(len);
      let best = null;
      const h = hits.raycast(prev, dir, len, true);
      if (h) best = {t: t - step + step * h.distance / len, point: h.point, normal: h.normal, d: h.distance, door: h.door, local: h.local, mesh: h.mesh};
      const ph = items.paintingHit(prev, dir, len);
      if (ph && (!best || ph.distance < best.d)) best = {t: t - step + step * ph.distance / len, point: ph.point, normal: ph.normal, d: ph.distance};
      for (const p of [...peers.values(), {id: network.id, last: {x: player.x, z: player.z}, avatar: me}]) {
        if (p.id === ignore || !p.last || !p.avatar) continue;
        // a capsule around each body: 0.28 m wide, feet to head
        const cx = p.last.x, cz = p.last.z, base = p.avatar.root.position.y + p.avatar.model.position.y;
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
  const items = createItems({scene, camera, hits, shadows: beamShadows});
  // king of the hill, as the server last told it (and when, to run its clocks on)
  let koth = null, kothAt = 0, kothWonAt = -1e9;
  const kothNow = () => koth ? koth.now + (performance.now() - kothAt) : 0;
  const kothEl = $('koth'), kothWho = kothEl.querySelector('span'), kothClock = kothEl.querySelector('b'), kothMine = kothEl.querySelector('small');
  const nameOf = id => id === network.id ? 'you' : (koth?.names?.[id] || 'anon');
  const secs = ms => `${(Math.floor(ms / 100) / 10).toFixed(1)}`;
  // a player's crown time for the chat, seconds:hundredths like the lap timer (it never reaches a minute)
  const crownTime = ms => `${String(Math.floor(Math.min(ms, 59999) / 1000)).padStart(2, '0')}:${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;
  // top of the screen while a game's on: who has the crown and their time, and yours if it's not you
  function updateKoth(now) {
    const live = kothActive(koth), won = koth?.state === 'done' && now - kothWonAt < 8000;
    kothEl.classList.toggle('on', live || won);
    if (!live && !won) return;
    const t = kothNow();
    let who, clock, mine = '';
    if (won) { who = `${nameOf(koth.winner)} ${koth.winner === network.id ? 'win' : 'wins'}`; clock = secs(KOTH_WIN_MS); }
    else if (koth.state === 'grace') { who = koth.wearer ? `${nameOf(koth.wearer)} · grace` : 'grace'; clock = Math.max(0, Math.ceil((koth.graceEnds - t) / 1000)) + ''; }
    else if (koth.wearer) { who = nameOf(koth.wearer); clock = secs(Math.min(KOTH_WIN_MS, kothTime(koth, koth.wearer, t))); }
    else { who = 'crown up for grabs'; clock = ''; }
    if (live && koth.state === 'running' && koth.wearer !== network.id && koth.times?.[network.id]) mine = `you ${secs(koth.times[network.id])}`;
    if (kothWho.textContent !== who) kothWho.textContent = who;
    if (kothClock.textContent !== clock) kothClock.textContent = clock;
    if (kothMine.textContent !== mine) kothMine.textContent = mine;
    kothEl.classList.toggle('grace', koth.state === 'grace');
  }
  const prompt = $('prompt'), btnAct = $('btnAct');
  const held = () => network.id ? items.heldBy(network.id) : null;
  const heldType = () => held()?.state.type || '';
  // the loose item under the crosshair, if it's close and in plain view
  function lookTarget() {
    camera.updateMatrixWorld();
    const o = camera.getWorldPosition(new THREE.Vector3()), d = camera.getWorldDirection(new THREE.Vector3());
    return items.target(player, o, d, dist => { const w = hits.raycast(o, d, dist); return !w || w.distance > dist - .05; });
  }
  function grab() {
    const t = lookTarget();
    if (t) { network.send({type: 'pickup', id: t.state.id}); learn(`pickup:${t.state.type}`); fireLatch = true; return true; }   // this click doesn't fire what you picked up
    return false;
  }
  // the lap timer's button, if the crosshair is on it and it's in reach
  function onButton() {
    camera.updateMatrixWorld();
    const o = camera.getWorldPosition(new THREE.Vector3()), d = camera.getWorldDirection(new THREE.Vector3());
    const far = (boom ? camDist : 0) + BUTTON_RANGE;
    return Math.hypot(player.x - BUTTON.x, player.z - BUTTON.z) < BUTTON_RANGE - .1 && machine.aimed(o, d, far) !== null;
  }
  // an open door under the crosshair, within reach (empty hand: click pulls it shut)
  function doorTarget() {
    camera.updateMatrixWorld();
    const o = camera.getWorldPosition(new THREE.Vector3()), d = camera.getWorldDirection(new THREE.Vector3());
    const h = hits.raycast(o, d, (boom ? camDist : 0) + 2.4, true);
    return h && h.door !== undefined && doors.isOpen(h.door) ? h.door : null;
  }
  function primary() {
    if (chat.open || !emoteMenu.hidden) return;
    if (onButton()) { machine.press(); network.send({type: 'button'}); learn('button'); return; }
    const h = held();
    if (!h && !lookTarget()) {
      const door = doorTarget();
      if (door !== null) { doors.close(door); network.send({type: 'door', i: door}); learn('door'); return; }
    }
    if (h?.state.type === 'flashlight') { network.send({type: 'toggle', id: h.state.id, on: !h.state.on}); learn('flashlight'); return; }
    if (h?.state.type === 'paintball') { shoot(); return; }
    if (h?.state.type === 'spray') { spray(); return; }
    if (h?.state.type === 'crown') { if (!kothActive(koth)) network.send({type: 'koth'}); learn('koth'); return; }
    if (h?.state.type === 'painting') { const plan = planPlace(h); if (plan) placePainting(h, plan); return; }
    if (h?.state.type === 'bucket') {
      if (cleanTarget) { network.send({type: 'erase', kind: cleanTarget.kind, id: cleanTarget.id}); items.scrub(h.state.id); learn('scrub'); }
      return;
    }
    if (grab()) return;
    punch();
  }
  // put it down where you're aiming if there's something within reach; otherwise let it go in
  // front of you and it falls (everyone replays the same fall to the spot it settles on)
  const DROP_REACH = 2.8;
  // ------------------------------------------------------------- paintings
  // Where a painting in your hands would go: on a wall (straight, or the tunnel's curve sloping back
  // low down or leaning over up high), hung flat against it; on the floor or a table right in front of
  // a wall, leant back against that wall; anywhere else laid face up, its top pointing away from you.
  // Either way it's fitted to the whole surface under it, not just the spot you aim at.
  // {x, y, z, yaw, tilt, roll, how} or null (nothing in reach to put it on).
  const PLACE_REACH = 3.2;
  function planPlace(h) {
    const {w, h: ht} = paintingSize(h.state.art);
    camera.updateMatrixWorld();
    const o = camera.getWorldPosition(new THREE.Vector3()), dir = camera.getWorldDirection(new THREE.Vector3());
    if (boom) o.addScaledVector(dir, camDist);
    const hit = hits.raycast(o, dir, PLACE_REACH, true);
    if (!hit || hit.door !== undefined || onMachine(hit.mesh)) return null;
    const n = hit.normal, P = hit.point;
    if (n.y <= -.6) return null;                                  // a ceiling
    if (n.y < .7) {
      const plan = fitOn(P, n, w, ht, new THREE.Vector3(0, 1, 0));
      return plan && {...plan, how: 'hang'};
    }
    // a wall just beyond where you're aiming (straight, or the tunnel's curve rising from the floor): lean it there
    const fwd = new THREE.Vector3(dir.x, 0, dir.z);
    if (fwd.lengthSq() > 1e-6) {
      fwd.normalize();
      const plan = leanOn(P, n, fwd, w, ht);
      if (plan) return plan;
    }
    // laid down, its top away from you
    const plan = fitOn(P, n, w, ht, fwd.lengthSq() > 1e-6 ? fwd : new THREE.Vector3(0, 0, -1));
    return plan && {...plan, how: 'lay'};
  }
  // Leant: its bottom edge on the floor where you aim, tipped back until it rests on the wall behind it.
  // The wall is felt for along its back at both sides and the middle, so a curved wall (low in the tunnel)
  // works the same as a flat one: it tips back as far as it takes to touch.
  const MIN_LEAN = .12, MAX_LEAN = 1.25;
  function leanOn(P, floorN, fwd, w, ht) {
    const wall = hits.raycast(P.clone().add(new THREE.Vector3(0, .3, 0)).addScaledVector(fwd, -.05), fwd, 1);
    if (!wall || wall.normal.y > .75 || wall.normal.y < -.5 || onMachine(wall.mesh)) return null;
    const out = new THREE.Vector3(wall.normal.x, 0, wall.normal.z);
    if (out.lengthSq() < 1e-4) return null;
    out.normalize();                                            // the way the picture faces: out from the wall
    const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), out).normalize();
    const upAt = t => new THREE.Vector3(0, Math.cos(t), 0).addScaledVector(out, -Math.sin(t));   // up its back, tipped back by t
    const touches = (F, t) => {
      const u = upAt(t);
      for (const k of [-.5, 0, .5]) {
        const from = F.clone().addScaledVector(side, k * w * .96).addScaledVector(u, .03);
        const h = hits.raycast(from, u, ht - .03);
        if (h && !onMachine(h.mesh)) return true;
      }
      return false;
    };
    // its foot: where you aim, eased out from the wall if it would have to stand nearly upright
    const F = P.clone();
    for (let k = 0; touches(F, MIN_LEAN); k++) { if (k > 20) return null; F.addScaledVector(out, .03); }
    if (!touches(F, MAX_LEAN)) return null;                     // the wall's out of reach: it'd fall flat
    let lo = MIN_LEAN, hi = MAX_LEAN;
    for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (touches(F, mid)) hi = mid; else lo = mid; }
    const t = hi, u = upAt(t);
    const at = F.clone().addScaledVector(u, ht / 2).add(new THREE.Vector3(0, .002, 0));
    return {x: at.x, y: at.y, z: at.z, yaw: Math.atan2(out.x, out.z), tilt: -t, roll: 0, how: 'lean'};
  }
  // nothing goes on the lap timer machine
  const onMachine = m => { for (let q = m; q; q = q.parent) if (q === machine.root) return true; return false; };
  // Fitted to a surface: the surface is felt for at 25 points across the painting's back and the painting
  // turned to the plane that fits them best (a few rounds, since turning it moves the points), then brought
  // out until nothing of the surface comes through it. Points on a different surface (the floor below a
  // wall, the wall beside a floor) are left out. `top` is which way its top should point.
  function fitOn(P, n0, w, ht, top) {
    const n = n0.clone(), c = P.clone(), right = new THREE.Vector3(), up = new THREE.Vector3(), back = new THREE.Vector3();
    const frame = () => {
      up.copy(top).addScaledVector(n, -top.dot(n));
      if (up.lengthSq() < 1e-4) up.set(0, 0, 1).addScaledVector(n, -n.z);
      up.normalize(); right.crossVectors(up, n).normalize();
    };
    const feel = () => {
      const pts = [];
      back.copy(n).negate();
      for (const sx of [-1, -.5, 0, .5, 1]) for (const sy of [-1, -.5, 0, .5, 1]) {
        const x = sx * w / 2 * .97, y = sy * ht / 2 * .97;
        const from = c.clone().addScaledVector(right, x).addScaledVector(up, y).addScaledVector(n, .35);
        const h = hits.raycast(from, back, 1, true);
        if (h && h.door === undefined && !onMachine(h.mesh) && h.normal.dot(n0) > .5) pts.push({x, y, z: h.point.clone().sub(c).dot(n)});
      }
      return pts;
    };
    for (let round = 0; round < 3; round++) {
      frame();
      const pts = feel();
      if (pts.length < 12) return null;                          // mostly over thin air: an edge or a doorway
      // least squares: depth z = a x + b y + k over the points
      let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
      for (const q of pts) { sxx += q.x * q.x; sxy += q.x * q.y; syy += q.y * q.y; sx += q.x; sy += q.y; sxz += q.x * q.z; syz += q.y * q.z; sz += q.z; }
      const M = new THREE.Matrix3().set(sxx, sxy, sx, sxy, syy, sy, sx, sy, pts.length);
      if (Math.abs(M.determinant()) < 1e-9) break;
      const [a, b, k] = new THREE.Vector3(sxz, syz, sz).applyMatrix3(M.invert()).toArray();
      c.addScaledVector(n, k);
      n.addScaledVector(right, -a).addScaledVector(up, -b).normalize();
      if (n.dot(n0) < .7) return null;                            // nothing like flat there
    }
    frame();
    const settle = () => {
      const pts = feel();
      if (pts.length < 12) return false;
      c.addScaledVector(n, Math.max(...pts.map(q => q.z)) + .003);   // its back just clear of the nearest bit of it
      return true;
    };
    if (!settle()) return null;
    // something else coming through it (the wall beside a floor, the ceiling's curve over a wall):
    // slide it away from that, a few centimetres at a time, up to half a metre
    for (let step = 0; ; step++) {
      let ix = 0, iy = 0, count = 0;
      back.copy(n).negate();
      for (const sx of [-1, -.5, 0, .5, 1]) for (const sy of [-1, -.5, 0, .5, 1]) {
        const x = sx * (w / 2 + .006), y = sy * (ht / 2 + .006);   // (a few millimetres past its edges: never flush into a wall)
        const h = hits.raycast(c.clone().addScaledVector(right, x).addScaledVector(up, y).addScaledVector(n, .3), back, .3);
        // and across its face from the middle (a wall it reaches right into, where the ray above starts inside it)
        const mid = c.clone().addScaledVector(n, .025), to = new THREE.Vector3().addScaledVector(right, x).addScaledVector(up, y), far = to.length();
        const across = far > .01 && hits.raycast(mid, to.divideScalar(far), far);
        if ((h && h.distance < .296) || across) { ix += x; iy += y; count++; }
      }
      if (!count) break;
      if (step >= 10) return null;
      const len = Math.hypot(ix, iy) || 1;
      c.addScaledVector(right, -ix / len * .05).addScaledVector(up, -iy / len * .05);
      if (!settle()) return null;
    }
    // hung: its bottom edge kept off the floor (slid up the wall), its top off the ceiling
    if (n.y < .7) {
      let lift = 0;
      for (const sx of [-1, 0, 1]) {
        const corner = c.clone().addScaledVector(right, sx * w / 2).addScaledVector(up, -ht / 2).addScaledVector(n, .02);
        const down = hits.raycast(corner.clone().add(new THREE.Vector3(0, .6, 0)), new THREE.Vector3(0, -1, 0), 1.2);
        if (down && down.normal.y > .7 && corner.y < down.point.y + .02) lift = Math.max(lift, (down.point.y + .02 - corner.y) / Math.max(.3, up.y));
      }
      c.addScaledVector(up, lift);
      const above = hits.raycast(c.clone().addScaledVector(n, .05), new THREE.Vector3(0, 1, 0), ht);
      const reach = ht / 2 * Math.abs(up.y);
      if (above && above.distance < reach + .01) c.y -= reach + .01 - above.distance;
    }
    // as yaw, tilt and roll: the frame (right, up, out of the front) as a rotation
    const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n), 'YXZ');
    return {x: c.x, y: c.y, z: c.z, yaw: e.y, tilt: e.x, roll: e.z};
  }
  function placePainting(h, plan) {
    network.send({type: 'drop', id: h.state.id, x: r3(plan.x), y: r3(plan.y), z: r3(plan.z), yaw: r3(plan.yaw), tilt: r3(plan.tilt), roll: r3(plan.roll || 0)});
    learn('place'); learn('drop');
  }
  // a faint outline of the painting where a click would put it
  let placeGhost = null, placeGhostArt = 0, placeAt = 0, placePlan = null;
  function updatePlaceGhost(now, h, frozen) {
    if (h?.state.type !== 'painting' || frozen) { if (placeGhost) placeGhost.visible = false; placePlan = null; return; }
    if (now - placeAt < 70) return;
    placeAt = now;
    placePlan = planPlace(h);
    if (!placeGhost || placeGhostArt !== h.state.art) {
      if (placeGhost) { placeGhost.removeFromParent(); placeGhost.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
      const {w, h: ht, d} = paintingSize(h.state.art);
      const box = new THREE.BoxGeometry(w, ht, d).translate(0, 0, d / 2);
      placeGhost = new THREE.Mesh(box, new THREE.MeshBasicMaterial({color: 0xfff2c8, transparent: true, opacity: .16, depthWrite: false, toneMapped: false}));
      placeGhost.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({color: 0xffe08a, transparent: true, opacity: .7, toneMapped: false})));
      placeGhost.renderOrder = 7; placeGhost.matrixAutoUpdate = false;
      scene.add(placeGhost); placeGhostArt = h.state.art;
    }
    placeGhost.visible = !!placePlan;
    if (placePlan) { paintingMatrix(placePlan.x, placePlan.y, placePlan.z, placePlan.yaw, placePlan.tilt, placePlan.roll || 0, placeGhost.matrix); placeGhost.matrixWorldNeedsUpdate = true; }
  }
  function secondary() {
    // hands empty, a game over and the crown still on: right-click takes it off
    const h = held() || (!kothActive(koth) && network.id ? items.wornBy(network.id) : null);
    if (!h) return;
    if (h.state.type === 'painting') { const plan = planPlace(h); if (plan) { placePainting(h, plan); return; } }
    const yaw = controls.state.yaw;
    learn('drop');
    toggleGallery(false);
    camera.updateMatrixWorld();
    const o = camera.getWorldPosition(new THREE.Vector3()), d = camera.getWorldDirection(new THREE.Vector3());
    if (boom) o.addScaledVector(d, camDist);
    const hit = hits.raycast(o, d, DROP_REACH);
    const msg = {type: 'drop', id: h.state.id, yaw};
    if (h.state.type === 'painting') msg.tilt = -Math.PI / 2;    // let go of, it falls flat
    let start = null, vel = null;
    if (hit && hit.normal.y > .7) Object.assign(msg, {x: r3(hit.point.x), y: r3(hit.point.y), z: r3(hit.point.z)});   // set down right there
    else if (hit) { start = hit.point.clone().addScaledVector(hit.normal, .12); vel = new THREE.Vector3(); }          // against a wall: slides down it
    else {
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), eye = new THREE.Vector3(player.x, player.y - .2, player.z);
      const block = hits.raycast(eye, fwd, .75);
      start = eye.addScaledVector(fwd, block ? Math.max(0, block.distance - .2) : .55);
      vel = fwd.multiplyScalar(1.3).add(new THREE.Vector3(player.vx * .4, .9, player.vz * .4));
    }
    if (start) {
      const f = simulateFall(hits, start.toArray(), vel.toArray());
      Object.assign(msg, {x: r3(f.rest.x), y: r3(f.rest.y), z: r3(f.rest.z), fall: {p: start.toArray().map(r3), v: vel.toArray().map(r3)}});
    }
    network.send(msg);
  }
  function punch() {
    const now = performance.now();
    if (now - lastPunch < PUNCH_COOLDOWN_MS) return;
    // keep clicking and the hands alternate, jab-cross; leave it a moment and the next starts from the right
    player.punchHand = now - lastPunch < PUNCH_COMBO_MS ? 1 - player.punchHand : 0;
    lastPunch = now; player.punchTime = 0; player.emote = '';
    // whoever is closest in front of you, within reach
    const yaw = controls.state.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestD = 1.95;
    for (const p of peers.values()) {
      const s = p.motion.sample(now); if (!s) continue;
      const dx = s.x - player.x, dz = s.z - player.z, d = Math.hypot(dx, dz);
      if (d < bestD && (dx * fx + dz * fz) / (d || 1) > .5) { best = p; bestD = d; }
    }
    network.send({type: 'punch', target: best ? best.id : ''});
  }
  // where the crosshair points: the first thing along the camera's ray
  function aimPoint(far = 60, withDoors = false) {
    const o = camera.getWorldPosition(new THREE.Vector3()), d = camera.getWorldDirection(new THREE.Vector3());
    if (boom) o.addScaledVector(d, camDist);   // start the ray at your shoulder, not behind it
    let h = hits.raycast(o, d, far, withDoors);
    const ph = items.paintingHit(o, d, far);
    if (ph && (!h || ph.distance < h.distance)) h = ph;           // a painting in front of the wall
    return {point: h ? h.point : o.clone().addScaledVector(d, far), hit: h, origin: o, dir: d};
  }
  function shoot() {
    const now = performance.now(), gun = held();
    if (!gun || now - lastShot < SHOT_INTERVAL_MS) return;
    lastShot = now;
    learn('fire');
    camera.updateMatrixWorld(); items.frame(frameArgs(0));
    const muzzle = items.tip(gun);
    const aim = aimPoint(60, true);
    const dir = aim.point.clone().sub(muzzle);
    const dist = dir.length(); dir.normalize();
    // aim a little high so the drop meets the crosshair, plus a touch of spread
    const tFlight = dist / SPEED;
    const v = dir.multiplyScalar(SPEED);
    v.y += .5 * GRAVITY * tFlight;
    v.x += (Math.random() - .5) * .5; v.y += (Math.random() - .5) * .5; v.z += (Math.random() - .5) * .5;
    const color = chosenPaint === RANDOM_PAINT ? PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)] : chosenPaint;
    const seed = Math.floor(Math.random() * 0xffffff);
    const land = trace(muzzle, v, network.id);
    const msg = {type: 'shoot', o: muzzle.toArray().map(r3), v: v.toArray().map(r3), c: color, s: seed, t: r3(land.t)};
    if (land.target) {
      msg.target = land.target.id;
      const a = land.target.avatar;
      const lp = a.root.worldToLocal(land.point.clone());
      const ln = land.point.clone().sub(new THREE.Vector3(a.root.position.x, land.point.y, a.root.position.z)).normalize()
        .applyQuaternion(a.root.quaternion.clone().invert());
      msg.local = {p: lp.toArray().map(r3), n: ln.toArray().map(r3)};
    } else {
      // which way the ball was flying when it hit (in the door's space for a door)
      const fly = new THREE.Vector3(v.x, v.y - GRAVITY * land.t, v.z).normalize();
      if (land.door !== undefined) {
        fly.transformDirection(land.mesh.matrixWorld.clone().invert());
        msg.hit = {p: land.local.point.toArray().map(r3), n: land.local.normal.toArray().map(r3), d: land.door, v: fly.toArray().map(r3)};
      } else if (land.normal) {
        msg.hit = {p: land.point.toArray().map(r3), n: land.normal.toArray().map(r3), v: fly.toArray().map(r3)};
        // the bits that land on paintings (worked out with the ball's own seed, so both halves are one splat)
        const parts = paintingParts('splat', Object.assign(msg.hit, {s: seed, c: color}));
        delete msg.hit.s; delete msg.hit.c;
        if (parts.length) msg.parts = parts.map(({s, c, ...p}) => p);
      }
    }
    items.kick(gun.state.id);
    network.send(msg);
  }
  const r3 = x => Math.round(x * 1000) / 1000;
  const formatRace = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;

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
    const sw = (u1 - u0) * img.width, sh = Math.abs(v1 - v0) * img.height;
    const s = Math.min(maxW / sw, maxW * .75 / sh, 1);
    c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
    // glTF textures aren't flipped: v runs down the image, so the piece's top edge is the smaller v
    c.getContext('2d').drawImage(img, u0 * img.width, Math.min(v0, v1) * img.height, sw, Math.abs(sh), 0, 0, c.width, c.height);
    return c;
  }
  function buildGallery() {
    if (galleryList.childElementCount || !pieces.length) return;
    for (const p of pieces) {
      const b = document.createElement('button'); b.type = 'button'; b.title = p.name.replace(/_/g, ' ');
      b.dataset.piece = p.name;
      b.append(thumb(p));
      b.addEventListener('click', () => { choosePiece(p.name); backToPlay(); });
      galleryList.append(b);
    }
    choosePiece(chosenPiece);
  }
  function choosePiece(name) {
    chosenPiece = name;
    try { localStorage.setItem('111k:piece', name); } catch {}
    for (const b of galleryList.children) b.classList.toggle('chosen', b.dataset.piece === name);
    const p = pieceByName.get(name);
    tagLabel.replaceChildren(...(p ? [thumb(p, 72), tagAdjust] : []));      // just the piece (and any turn or size you've set)
  }
  // with a can in hand, the scroll wheel steps through your tags whenever the tags menu is shut (open, it
  // scrolls the list); with anything else, or nothing, it does nothing here.
  // Trackpads send a stream of small deltas, so they're added up and each step takes a fair swipe.
  let wheelAcc = 0, wheelAt = 0, stepAt = 0;
  // With a can in hand, ctrl + scroll turns the next tag and shift + scroll sizes it (the ghost shows it).
  let adjAcc = 0, adjAt = 0;
  addEventListener('wheel', e => {
    if (!pieces.length || !gallery.hidden || chat.open || heldType() !== 'spray') return;
    if (!controls.state.locked && e.target !== canvas) return;
    const now = performance.now();
    const turning = e.ctrlKey && heldType() === 'spray', sizing = !turning && e.shiftKey && heldType() === 'spray';
    if (turning || sizing) {
      if (e.cancelable) e.preventDefault();            // ctrl + scroll would zoom the page
      // (shift turns the wheel sideways in some browsers)
      const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      if (now - adjAt > 250) adjAcc = 0;
      adjAt = now; adjAcc += d;
      if (Math.abs(adjAcc) < 40) return;
      const step = -Math.sign(adjAcc); adjAcc = 0;
      if (turning) { tagTurn = Math.round((tagTurn + step * TURN_STEP) / TURN_STEP) * TURN_STEP; tagTurn = Math.atan2(Math.sin(tagTurn), Math.cos(tagTurn)); learn('tagturn'); }
      else { tagScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, tagScale * (step > 0 ? SCALE_STEP : 1 / SCALE_STEP))); learn('tagsize'); }
      nextTilt = 0; nextScale = 1;                      // set by hand: no random wobble on top
      showTagAdjust();
      previewKey = '';
      return;
    }
    if (now - wheelAt > 250) wheelAcc = 0;
    wheelAt = now;
    wheelAcc += e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    if (Math.abs(wheelAcc) < 50 || now - stepAt < 70) return;
    const step = Math.sign(wheelAcc); wheelAcc = 0; stepAt = now;
    const i = Math.max(0, pieces.findIndex(p => p.name === chosenPiece));
    choosePiece(pieces[(i + step + pieces.length) % pieces.length].name);
  }, {passive: false});
  // picked something: shut the menu and go straight back to playing (the click is the gesture the
  // browser needs to take the mouse again)
  function backToPlay() {
    toggleGallery(false);
    if (!controls.state.touch && !controls.state.locked) canvas.requestPointerLock?.()?.catch?.(() => {});
  }
  function toggleGallery(force) {
    const open = force ?? gallery.hidden;
    const paint = heldType() === 'paintball';
    // the tags menu is for a can in hand (the paint list for the paintball gun): nothing else opens it
    if (open && (paint ? false : heldType() !== 'spray' || !pieces.length)) return;
    if (open) {
      gallery.dataset.mode = paint ? 'paint' : 'piece';
      gallery.setAttribute('aria-label', paint ? 'paint to load' : 'pieces to spray');
      gallery.querySelector('h2').textContent = paint ? 'paint' : 'tags';
      if (paint) buildPaints(); else buildGallery();
      learn(paint ? 'paints' : 'pieces');
      gallery.querySelector(paint ? '.paints .chosen' : '.list .chosen')?.scrollIntoView({block: 'nearest'});
    }
    gallery.hidden = !open;
  }

  // ------------------------------------------------- paintball gun paint
  const paintList = gallery.querySelector('.paints'), paintLabel = $('paintLabel'), btnGallery = $('btnGallery');
  const hex = c => '#' + c.toString(16).padStart(6, '0');
  const RAINBOW = `conic-gradient(${PAINT_ROWS.slice(0, 7).map(([, sh]) => hex(sh[1])).join(', ')}, ${hex(PAINT_ROWS[0][1][1])})`;
  let chosenPaint = RANDOM_PAINT;
  try { const v = Number(localStorage.getItem('111k:paint')); if (PAINT_COLORS.includes(v)) chosenPaint = v; } catch {}
  function buildPaints() {
    if (paintList.childElementCount) return;
    const swatch = (c, label) => {
      const b = document.createElement('button'); b.type = 'button'; b.title = label; b.dataset.paint = c;
      b.style.setProperty('--paint', c === RANDOM_PAINT ? RAINBOW : hex(c));
      b.addEventListener('click', () => { choosePaint(c); backToPlay(); });
      return b;
    };
    const random = swatch(RANDOM_PAINT, 'random'); random.classList.add('random'); random.textContent = 'random';
    paintList.append(random);
    for (const [name, shades] of PAINT_ROWS) {
      const row = document.createElement('div'); row.className = 'row'; row.textContent = name;
      paintList.append(row, ...shades.map((c, i) => swatch(c, name.includes(',') ? name.split(', ')[i] : `${['light', '', 'deep'][i]} ${name}`.trim())));
    }
    choosePaint(chosenPaint);
  }
  function choosePaint(c) {
    chosenPaint = c;
    try { localStorage.setItem('111k:paint', String(c)); } catch {}
    items.setMyPaint(c);
    for (const b of paintList.querySelectorAll('button')) b.classList.toggle('chosen', Number(b.dataset.paint) === c);
    const dot = document.createElement('i'); dot.style.setProperty('--paint', c === RANDOM_PAINT ? RAINBOW : hex(c));
    paintLabel.replaceChildren(dot);
  }
  // the next tag's little twist and size are rolled ahead, so the preview shows exactly what you'll get
  // (once you've turned or sized it by hand, it goes on exactly as set: no wobble)
  let nextTilt = 0, nextScale = 1, tagTurn = 0, tagScale = 1;
  const TURN_STEP = 5 * Math.PI / 180, SCALE_STEP = 1.06, SCALE_MIN = .3, SCALE_MAX = 2;
  const handSet = () => tagTurn !== 0 || tagScale !== 1;
  const rollSpray = () => {
    if (handSet()) { nextTilt = 0; nextScale = 1; return; }
    nextTilt = (Math.random() * 2 - 1) * 3 * Math.PI / 180; nextScale = .9 + Math.random() * .2;
  };
  // the turn and size you've set, shown under the piece by the can (nothing when they're as standard)
  const tagAdjust = document.createElement('small');
  function showTagAdjust() {
    const deg = Math.round(tagTurn * 180 / Math.PI), pct = Math.round(tagScale * 100);
    tagAdjust.textContent = [deg ? `${deg > 0 ? '+' : ''}${deg}°` : '', pct !== 100 ? `${pct}%` : ''].filter(Boolean).join('  ');
  }
  rollSpray();
  // what a click would spray right now, as the message to send (null if there's no wall in reach)
  function planSpray() {
    const piece = pieceByName.get(chosenPiece);
    if (!piece) return null;
    const aim = aimPoint(SPRAY_RANGE + 3, true);
    if (!aim.hit || Math.hypot(aim.point.x - player.x, aim.point.z - player.z) > SPRAY_RANGE) return null;
    const n = aim.hit.normal;
    // upright on walls; on floors and ceilings, readable from where you stand
    const up = Math.abs(n.y) < .7 ? new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize()
      : new THREE.Vector3(aim.dir.x, 0, aim.dir.z).normalize().multiplyScalar(n.y > 0 ? 1 : -1);
    up.applyAxisAngle(n, nextTilt + tagTurn);                 // your turn, or by itself up to 3° either way
    const big = Math.max(piece.w, piece.h);
    const size = Math.max(.1, Math.min(4.5, Math.max(.35, Math.min(piece.w * Math.min(1, 1.5 / big), 2.2)) * nextScale * tagScale));
    // sprayed partly along your aim (so it wraps the corner you can see) and partly straight on (so the piece reads)
    const fly = aim.dir.clone().normalize().add(n.clone().negate()).normalize();
    const msg = {type: 'spray', p: aim.point.toArray().map(r3), n: n.toArray().map(r3), up: up.toArray().map(r3), piece: chosenPiece,
      size: Math.round(size * 100) / 100, v: fly.toArray().map(r3),
      r: Math.round(aim.point.clone().sub(aim.origin).dot(fly) * 100) / 100};
    if (aim.hit.door !== undefined) {   // on a door: send it in the door's own space so it stays put as the door swings
      const inv = aim.hit.mesh.matrixWorld.clone().invert();
      Object.assign(msg, {p: aim.hit.local.point.toArray().map(r3), n: aim.hit.local.normal.toArray().map(r3),
        up: up.clone().transformDirection(inv).toArray().map(r3), d: aim.hit.door, v: fly.clone().transformDirection(inv).toArray().map(r3)});
    }
    return msg;
  }
  function spray() {
    const now = performance.now(), can = held();
    if (!can || !chosenPiece || now - lastSpray < SPRAY_INTERVAL_MS) return;
    camera.updateMatrixWorld();
    const msg = planSpray();
    items.shake(can.state.id);
    if (!msg) return;
    lastSpray = now;
    const parts = paintingParts('spray', msg, pieceByName.get(msg.piece));
    if (parts.length) msg.parts = parts;
    network.send(msg);
    learn('spray');
    rollSpray();
    previewKey = '';
  }

  // a faint ghost of the tag where a click would put it
  let preview = null, previewKey = '', previewAt = 0, previewMat = null;
  function clearPreview() {
    if (preview) { preview.removeFromParent(); preview.geometry.dispose(); preview = null; }   // (the material is kept: a new one means a new shader)
    previewKey = '';
  }
  function updatePreview(now, show) {
    if (!show) { if (preview) clearPreview(); return; }
    if (now - previewAt < 80) return;
    previewAt = now;
    camera.updateMatrixWorld();
    const s = planSpray(), piece = s && pieceByName.get(s.piece);
    if (!s) { clearPreview(); return; }
    const key = `${s.piece}|${s.d ?? ''}|${s.p}|${s.n}|${s.up}|${s.v}|${s.size}`;
    if (key === previewKey) return;
    const onDoor = s.d !== undefined ? hits.door(s.d) : null;
    // the parts on paintings, brought back into the world for the ghost
    const parts = paintingParts('spray', s, piece);
    const verts = [...sprayVerts(s, piece, onDoor), ...parts.flatMap(part => {
      const mw = items.items.get(part.pi).model.matrixWorld;
      return sprayVerts(part, piece, paintingSurface(part.pi)).map(q => ({...q, p: q.p.clone().applyMatrix4(mw)}));
    })];
    clearPreview(); previewKey = key;
    if (!verts.length) return;
    const position = [], uv = [], color = [];
    for (const q of verts) { position.push(q.p.x, q.p.y, q.p.z); uv.push(q.u, q.v); color.push(1, 1, 1, q.k ?? 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(color, 4));
    const map = level.materials.get(`graffiti_${piece.page}`)?.map || null;
    previewMat ||= new THREE.MeshBasicMaterial({vertexColors: true, transparent: true, opacity: .38,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6});
    if (!previewMat.map !== !map) previewMat.needsUpdate = true;
    previewMat.map = map;
    preview = new THREE.Mesh(geo, previewMat);
    preview.renderOrder = 7; preview.frustumCulled = false;
    (onDoor ? onDoor.mesh : scene).add(preview);
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
    return createAvatar(clean).then(a => {
      if (peers.get(p.id) !== p || p.lookKey !== key) { a.dispose(); return; }
      p.avatar?.dispose(); p.avatar = a; scene.add(a.root);
      for (const local of p.pendingPaint.splice(0)) paintAvatar(a, local);
    }).catch(err => console.warn('avatar failed', err));
  }
  function removePeer(id) {
    const p = peers.get(id); if (!p) return;
    p.avatar?.dispose(); p.bubble?.dispose(); p.typing?.dispose(); p.speakEl?.remove(); peers.delete(id); updateCount();
  }
  function applyPose(id, pose, time) {
    const p = peer(id); if (!p) return;
    p.motion.push(pose, performance.now(), time);
    if (pose.typing && !p.typing) { p.typing = createBubble('', {typing: true}); }
    if (!pose.typing && p.typing) { p.typing.dispose(); p.typing = null; }
  }
  let roomArrived;
  const roomIn = new Promise(r => { roomArrived = p => { roomArrived = () => {}; p.then(r); }; });
  const network = connectRoom({
    url: serverUrl(),
    onStatus: s => {
      status.dataset.state = s; status.title = s;
      if (s === 'online') { lastSent = ''; network.send({type: 'look', look: mine.look, name: mine.name}); }
    },
    onState: m => {
      const live = new Set(m.players.map(p => p.id)), coming = [];
      for (const id of [...peers.keys()]) if (!live.has(id)) removePeer(id);
      for (const p of m.players) if (p.id !== network.id) { applyPose(p.id, p.pose, m.now); if (p.look) coming.push(setLook(peer(p.id), p.look)); }
      if (m.items) items.set(m.items);
      updateCount();   // (with no one else here, nothing else would ever replace the "…")
      roomArrived(Promise.allSettled(coming));   // the first time: who's here, so they're in before the fade
    },
    onPose: m => applyPose(m.id, m.pose, m.time),
    onLeave: id => removePeer(id),
    onItem: (it, fall) => {
      const before = items.items.get(it.id)?.state.holder;
      items.update(it, fall);
      if (before === network.id && it.holder !== network.id) toggleGallery(false);
    },
    onPunch: m => {
      // your fist landed: the jolt comes as it connects, not when you swing
      if (m.from === network.id) player.impactIn = Math.max(0, PUNCH_IMPACT - Math.max(0, player.punchTime));
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
      if (m.type === 'emotes') { emoteConfig = cleanEmoteConfig(m.config); emoteButtons(); return; }
      if (m.type === 'rtc') { voice.signal(m.from, m.d); return; }
      if (m.type === 'door') { doors.close(m.i); return; }
      if (m.type === 'erase') {
        eraseMark(m.kind, m.id);
        if (m.by !== network.id) { const b = items.heldBy(m.by); if (b) items.scrub(b.state.id); }
        return;
      }
      if (m.type === 'look' && m.id !== network.id) setLook(peer(m.id), m.look);
      else if (m.type === 'marks') resetMarks(m);
      else if (m.type === 'shot') {
        const o = new THREE.Vector3(...m.o), v = new THREE.Vector3(...m.v);
        // out of the shooter's barrel as you see it: your view model's, or their avatar's gun
        const gun = items.heldBy(m.from);
        const from = gun?.state.type === 'paintball' && gun.model.visible !== false ? items.tip(gun) : null;
        launch(o, v, m.c, m.t, () => {
          if (m.hit) { const s = cleanSplat(m.hit); if (s) addSplat({...s, c: m.c, s: m.s}, true); }
          for (const part of m.parts || []) { const s = cleanSplat({...part, c: m.c, s: m.s}); if (s) addSplat(s, true); }
          if (m.target && m.local) {
            const local = {...m.local, c: m.c, s: m.s};
            const end = simulate(o, v, m.t);
            if (m.target === network.id) {
              paintAvatar(me, local); paintAvatar(meView, local); shake = Math.max(shake, .6);
              // knocked back along the ball's flight (you keep whatever you're holding)
              const fly = Math.hypot(v.x, v.z) || 1;
              player.kx += v.x / fly * 3.6; player.kz += v.z / fly * 3.6;
            }
            else {
              const p = peers.get(m.target);
              if (p?.avatar) paintAvatar(p.avatar, local); else p?.pendingPaint.push(local);
            }
            burst(end, new THREE.Vector3(0, 1, 0), m.c);
          }
        }, from);
      } else if (m.type === 'koth') {
        koth = m.koth; kothAt = performance.now();
        const name = (id, n) => id === network.id ? 'you' : (n || 'anon');
        const who = name(m.by, m.byName), at = `${who} (${crownTime(m.time || 0)})`;
        const say = text => chat.record(text, {system: true});
        if (m.event === 'start') say(`${who} initiated a game of king's crown`);
        else if (m.event === 'grace') say('the game begins!');
        else if (m.event === 'take') say(`${at} got the crown`);
        else if (m.event === 'lost') {
          const by = m.from ? (m.from === network.id ? 'your' : `${m.fromName || 'anon'}'s`) : '';
          const how = by && (m.how === 'punch' || m.how === 'paintball') ? ` to ${by} ${m.how}` : '';
          say(`${at} lost the crown${how}`);
        } else if (m.event === 'win') { say(`${who} won the king's crown!`); kothWonAt = performance.now(); }
        else if (m.event === 'cancel') say('we wait another day for our king...');
      } else if (m.type === 'race') {
        machine.setRace(m.race);
        if (m.by && m.by !== network.id) machine.press();
        const who = m.by === network.id ? 'you' : (m.byName || 'anon'), whose = m.by === network.id ? 'your' : `${m.byName || 'anon'}'s`;
        const say = text => chat.record(text, {system: true});
        const splits = m.race.splits || [];
        if (m.busy) say(`${m.race.name || 'someone'} is on a loop run: wait for them to finish (or for 3 minutes to pass)`);
        else if (m.event === 'start') say(`${who} started a loop run`);
        else if (m.event === 'lap') {
          // the lap's own time, then the running total
          const n = splits.length, lapTime = splits[n - 1] - (splits[n - 2] || 0);
          say(`${who}: lap ${n} in ${formatRace(lapTime)} (${formatRace(splits[n - 1])})${m.race.laps ? '' : ' · hit the button!'}`);
        } else if (m.event === 'finish') {
          const laps = splits.map((t, i) => formatRace(t - (splits[i - 1] || 0))).join(' / ');
          say(`${who} finished the loop run in ${formatRace(m.race.time)}${laps ? ` (laps ${laps})` : ''}`);
        } else if (m.event === 'cancel') say(m.race.runner === m.by ? `${whose} loop run was called off` : `${who} called off ${m.race.name || 'anon'}'s loop run`);
      } else if (m.type === 'spray') {
        addSpray(m.mark, true);
        for (const part of m.parts || []) addSpray(part, true);
        const p = peers.get(m.from);
        if (p?.avatar) p.sprayed = performance.now();
      }
    },
  });

  // ------------------------------------------------------------- voice
  voice.attach(m => network.send(m), () => network.id || '');
  if (voice.wantsMic && !voice.hasMic) voice.setMicOn(true);      // mic on from last time (or just switched on at the door)
  const bubbleLayer = $('bubbles'), micBtn = $('micBtn'), voiceDock = $('voiceDock');
  voiceDock.append(voicePanel(voice));
  // the mic icon shows and hides the voice box (M, or the button in the box, turns the mic on and off)
  micBtn.addEventListener('click', () => {
    const open = voiceDock.classList.toggle('open');
    micBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  addEventListener('keydown', e => {
    if (e.code !== 'KeyM' || e.repeat || chat.open || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    voice.setMicOn(!voice.micOn);
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
  reveal();
  // the controls bar: each control fades once you've used it, and when you've used every one the
  // bar goes for good (remembered in this browser)
  {
    const hintEl = $('hint'), cmds = [...hintEl.querySelectorAll('[data-cmd]')].map(el => el.dataset.cmd);
    const show = () => {
      for (const el of hintEl.querySelectorAll('[data-cmd]')) el.classList.toggle('used', learned.has(el.dataset.cmd));
      hintEl.hidden = isTouch || cmds.every(c => learned.has(c));
    };
    learnHooks.push(show);
    const KEYS = {KeyW: 'move', KeyA: 'move', KeyS: 'move', KeyD: 'move', ShiftLeft: 'run', ShiftRight: 'run', Space: 'jump',
      KeyC: 'crouch', Enter: 'chat', KeyE: 'emotes', KeyV: 'view'};
    addEventListener('keydown', e => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (KEYS[e.code] && (!typing || e.code === 'Enter') && (!chat.open || e.code === 'Enter')) learn(KEYS[e.code]);
    }, true);
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement) learn('look'); });
    addEventListener('mousedown', e => { if (!document.pointerLockElement) return; if (e.button === 0) learn('use'); if (e.button === 2) learn('drop'); }, true);
    show();
  }
  choosePiece(chosenPiece);
  choosePaint(chosenPaint);

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
  const frameArgs = dt => ({me, myId: network.id, thirdPerson: boom, avatarOf: id => peers.get(id)?.avatar, poseOf: id => peers.get(id)?.last, dt});
  function saveTab() {
    tabMe.set({look: mine.look, name: mine.name, x: r3(player.x), z: r3(player.z), yaw: r3(controls.state.yaw), pitch: r3(controls.state.pitch), g: r3(player.ground),
      view: thirdPerson ? '3p' : '1p'});
  }
  addEventListener('pagehide', saveTab);

  // one frame of the game (run below, guarded)
  const frame = () => {
    const now = performance.now(), dt = Math.min(.1, (now - last) / 1000); last = now;
    const input = controls.update();
    const frozen = chat.open || !emoteMenu.hidden;
    // movement in the camera's yaw frame, plus any knock-back still fading out
    const speed = (input.run ? 4.7 : 3.1) * (input.crouch ? .5 : 1) * vertical.boost;
    const mx = frozen ? 0 : input.moveX, mz = frozen ? 0 : input.moveZ;
    const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
    const tx = (mx * cos + mz * sin) * speed, tz = (-mx * sin + mz * cos) * speed;
    player.vx += (tx - player.vx) * damp(12, dt); player.vz += (tz - player.vz) * damp(12, dt);
    if (vertical.takeHop()) {   // a clean hop shoves you along the way you're going
      const v = Math.hypot(player.vx, player.vz);
      if (v > .5) { const k = .9 * vertical.boost; player.kx += player.vx / v * k; player.kz += player.vz / v * k; }
    }
    // the hop shove barely fades in the air, and the ground only starts eating it a
    // moment after touchdown, so a hop timed in the window keeps all of it
    const landed = vertical.landedFor, drag = landed < 0 || landed < HOP_GRACE ? .6 : 5;
    player.kx *= Math.exp(-dt * drag); player.kz *= Math.exp(-dt * drag);
    const px = player.x, pz = player.z;
    // fast hops cover a lot of ground per frame: move in small steps so walls stay solid
    const mvx = (player.vx + player.kx) * dt, mvz = (player.vz + player.kz) * dt;
    const steps = Math.min(40, Math.ceil(Math.hypot(mvx, mvz) / .15));
    const feet = player.ground + vertical.lift;
    for (let i = 0; i < steps; i++) [player.x, player.z] = collider.resolve(player.x + mvx / steps, player.z + mvz / steps, feet);
    doors.push(player.x, player.z, player.x - px, player.z - pz);
    [player.x, player.z] = doors.resolve(player.x, player.z);
    const velocity = Math.hypot(player.x - px, player.z - pz) / Math.max(dt, 1e-4);
    // bunny-hop speedometer: after ten clean hops your speed fades in (rough mph); when the run ends
    // it holds your peak for five seconds, then fades
    speedNow += (Math.min(velocity, 60) - speedNow) * (1 - Math.exp(-dt * 6));
    if (vertical.chain >= 10) {
      if (!speedoLive && now >= speedoHold) speedoPeak = 0;          // a fresh run
      speedoLive = true; speedoPeak = Math.max(speedoPeak, speedNow);
    } else if (speedoLive) { speedoLive = false; speedoHold = now + 5000; }
    const speedoOn = speedoLive || now < speedoHold;
    if (speedoOn) speedoNum.textContent = Math.round((speedoLive ? speedNow : speedoPeak) * 2.237);
    if (speedoOn !== speedoShown) { speedoShown = speedoOn; speedoEl.classList.toggle('on', speedoOn); }
    const blink = speedoOn && !speedoLive && Math.round(speedoPeak * 2.237) === 111;
    if (blink !== speedoBlink) { speedoBlink = blink; speedoEl.classList.toggle('blink', blink); }
    // slamming into a wall or a prop mid-run is a crash: the hop chain and its shove are gone.
    // (sliding along a wall at a shallow angle keeps most of the speed, so that's fine)
    const meant = Math.hypot(mvx, mvz) / Math.max(dt, 1e-4);
    if (vertical.chain > 0 && meant > 2.5 && velocity < meant * .55) { vertical.crash(); player.kx = player.kz = 0; }
    if (velocity > .3 || (!frozen && (input.moveX || input.moveZ))) player.emote = '';   // any move ends it
    if (player.emote && !orbiting) { orbiting = true; emoteYaw = input.yaw; }
    else if (!player.emote) orbiting = false;
    const faceYaw = orbiting ? emoteYaw : input.yaw, facePitch = orbiting ? 0 : input.pitch;
    boom = thirdPerson || orbiting;
    if (player.emote) player.emoteTime = Math.min(EMOTE_DURATION, player.emoteTime + dt);
    if (player.punchTime >= 0) { player.punchTime += dt; if (player.punchTime > PUNCH_DURATION) player.punchTime = -1; }
    if (player.impactIn >= 0) { player.impactIn -= dt; if (player.impactIn < 0) shake = Math.max(shake, .45); }
    const eye = vertical.update(dt, !frozen && input.crouch);
    // standing on things: step up onto low tops, land on higher ones from a jump, drop off edges
    {
      const feetNow = player.ground + vertical.lift;
      const support = collider.groundAt(player.x, player.z, feetNow);
      if (support > player.ground + 1e-4) {
        if (vertical.lift <= 1e-4) { player.stepLag -= support - player.ground; player.ground = support; player.fall = 0; }   // a step: the view eases up
        else if (vertical.descending && feetNow <= support + .02) {
          // landing on something higher: the view carries on from where the feet were and eases onto it
          player.stepLag += feetNow - support; player.ground = support; player.fall = 0; vertical.touchdown();
        }
      } else if (support < player.ground - 1e-4) {
        player.fall -= 13 * dt;
        player.ground = Math.max(support, player.ground + player.fall * dt);
        if (player.ground <= support + 1e-4) { player.ground = support; player.fall = 0; }
      } else player.fall = 0;
      // a short drop just smooths down; a real one is a fall (no jumping mid-air)
      vertical.setFalling(player.fall < -1.2 || (player.fall < 0 && vertical.lift <= 1e-4 && player.ground - support > STEP_UP));
      player.stepLag *= Math.exp(-dt * 14);
    }
    // (read again: a touchdown just now ended the jump's lift)
    player.y = player.ground + vertical.eye + player.stepLag;
    const h = held(), holding = !!h;
    if (!input.firing) fireLatch = false;
    if (h?.state.type === 'paintball' && input.firing && !fireLatch && !frozen) shoot();
    document.body.classList.toggle('holding-spray', h?.state.type === 'spray');
    document.body.classList.toggle('holding-paint', h?.state.type === 'paintball');
    const motion = {...vertical.pose, emote: player.emote, emoteTime: player.emoteTime, emoteConfig, pitch: facePitch,
      punchTime: player.punchTime, punchHand: player.punchHand, holding};

    // local avatar
    me.root.position.set(player.x, player.ground + player.stepLag, player.z); me.root.rotation.y = faceYaw;
    me.eye = player.y - player.ground; me.pitch = facePitch;
    me.update(dt, velocity, motion);

    // camera
    ghost.ghostOn.value = boom ? 1 : 0;
    shake *= Math.exp(-dt * 7);
    const sx = (Math.random() - .5) * .06 * shake, sy = (Math.random() - .5) * .06 * shake;
    if (boom) {
      // over the right shoulder, close in: you see past yourself to what you're aiming at.
      // Emoting, the boom is centred on you and a little longer, and the mouse swings it round you
      if (!wasBoom) { camDist = .3; firstFrame = true; }       // from first person: ease out of your head
      const yaw = input.yaw, pitch = input.pitch;
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const sideRoom = collider.raycast(player.x, player.z, rx, rz, 1.1, player.y, .12) - .2;
      const wantSide = orbiting ? 0 : Math.max(.12, Math.min(.8, sideRoom));
      camSide += (wantSide - camSide) * damp(wantSide < camSide ? 25 : 5, dt);
      const head = Math.min(orbiting ? player.y - .35 : player.y + .3, ceilingAt(player.x, player.z) - .25);   // big heads: look over them
      pivot.set(player.x + rx * camSide, head, player.z + rz * camSide);
      if (firstFrame) smoothPivot.copy(pivot);
      smoothPivot.lerp(pivot, damp(22, dt));
      smoothPivot.x = pivot.x; smoothPivot.z = pivot.z;    // only ease the height (jumps, crouches)
      dir.set(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const want = orbiting ? 2.4 : 1.85;
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
      if (firstFrame && wasBoom) camDist = free;
      camera.position.copy(smoothPivot).addScaledVector(dir, camDist);
      me.setVisible(true);   // pressed close against a wall the camera ghosts you (dithered) rather than hiding you
      meView.root.visible = false;
    } else {
      camera.position.set(player.x, player.y, player.z);
      me.setVisible(false);
      // your punch, seen from inside your head
      meView.root.visible = player.punchTime >= 0;
      if (meView.root.visible) {
        meView.root.position.set(.0, -EYE_HEIGHT + .36, .3);
        meView.update(dt, 0, {punchTime: player.punchTime, punchHand: player.punchHand, pitch: 0});
      }
    }
    firstFrame = false; wasBoom = boom;
    camera.rotation.set(input.pitch + sy, input.yaw + sx, 0);
    camera.updateMatrixWorld();

    // network: 15 Hz while something changes, then 3 settling packets
    if (now - sentAt >= 1000 / 15 && network.online) {
      const pose = sanitizePose({x: player.x, y: player.y, z: player.z, g: player.ground, pc: chosenPaint, yaw: faceYaw, pitch: facePitch, room: 'office',
        crouch: motion.crouch, jumpTime: motion.jumpTime, jumpPower: motion.jumpPower, emote: player.emote, emoteTime: player.emoteTime,
        typing: chat.typing, punchTime: player.punchTime, punchHand: player.punchHand, vc: voice.micOn ? 1 : 0});
      const key = JSON.stringify(pose);
      if (key !== lastSent) settle = 3;
      if (key !== lastSent || settle > 0) { network.sendPose(pose); if (key === lastSent) settle--; lastSent = key; }
      sentAt = now;
    }
    if (now - savedAt > 1000) { savedAt = now; saveTab(); }

    // anyone the camera is inside (you, pressed against a wall; someone you walk through) ghosts entirely
    const camWorld = camera.getWorldPosition(new THREE.Vector3());
    if (boom) me.ghostFor(camWorld, dt);
    me.ghostNear(boom); meView.ghostNear(false);
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
      p.avatar.root.position.set(s.x, s.g || 0, s.z); p.avatar.root.rotation.y = s.yaw;
      p.avatar.update(pdt, v, {...s, holding: !!items.heldBy(p.id), emoteConfig});
      p.avatar.ghostNear(true);            // walking into someone dissolves them, first person too
      p.avatar.ghostFor(camWorld, pdt);
      doors.push(s.x, s.z, v * pdt * Math.sin(-s.yaw), 0, p.id);
      if (p.bubble && serverNow > p.bubbleExpires) { p.bubble.dispose(); p.bubble = null; }
      if (p.bubble || p.typing) {
        if (!p.sightAt || now - p.sightAt > 150) { p.seen = inSight(s); p.sightAt = now; }
        const at = project(s, (s.g || 0) + 2.0 + (s.jumpTime >= 0 ? .4 : 0));
        const show = at.visible && p.seen;
        const top = p.bubble ? p.bubble.update(at.x, at.y, show) : at.y;
        p.typing?.update(at.x, top, show);
      }
    }
    // voice: link up with nearby talkers, place their voices, and mark who's speaking
    voice.update({camera, hits, peers: [...peers.values()].filter(p => p.last).map(p => ({id: p.id, vc: p.last.vc,
      x: p.last.x, y: (p.last.g || 0) + 1.25 + jumpHeight(p.last.jumpTime ?? -1, p.last.jumpPower), z: p.last.z}))});
    for (const p of peers.values()) {
      const level = p.last && p.avatar ? voice.levelOf(p.id) : 0;
      if (level > .05 || p.speakEl) {
        if (!p.speakEl) { p.speakEl = document.createElement('div'); p.speakEl.className = 'speaking'; p.speakEl.innerHTML = '<i></i><i></i><i></i>'; bubbleLayer.append(p.speakEl); }
        p.speakLevel = Math.max(level, (p.speakLevel || 0) * .9);
        const at = project(p.last, (p.last.g || 0) + 1.78 + jumpHeight(p.last.jumpTime ?? -1, p.last.jumpPower));
        const show = at.visible && p.speakLevel > .04;
        p.speakEl.hidden = !show;
        if (show) {
          p.speakEl.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -100%)`;
          [...p.speakEl.children].forEach((bar, i) => { bar.style.transform = `scaleY(${(.25 + Math.min(1, p.speakLevel * (1.6 - i * .3) * 2.2)).toFixed(2)})`; });
        }
      }
    }
    micBtn.dataset.state = !voice.micOn ? 'off' : voice.talking ? 'talking' : 'live';
    if (myBubble) {
      if (serverNow > myBubbleExpires) { myBubble.dispose(); myBubble = null; }
      else { const at = project(player, player.ground + 2.0); myBubble.update(at.x, at.y, at.visible && boom); }
    }
    doors.update(dt);

    // paintballs, paint puffs, fresh tags
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.t = Math.min(b.end, b.t + dt);
      const ease = Math.max(0, 1 - b.t / b.blend);
      b.m.position.copy(simulate(b.o, b.v, b.t)).addScaledVector(b.offset, ease * ease * (3 - 2 * ease));
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
      f.batch.setAlpha(f.m, Math.min(1, f.t / SPRAY_FADE_IN));
      if (f.t >= SPRAY_FADE_IN) fades.splice(i, 1);
    }
    // paint dries off: the last few seconds of its minute it fades out, then it's gone
    if (now - lastPaintCheck > 100) {
      lastPaintCheck = now;
      for (let i = splatMarks.length - 1; i >= 0; i--) {
        const k = splatMarks[i], left = SPLAT_LIFE_MS - (now - k.born);
        if (left <= 0) { k.batch.remove(k.m); splatMarks.splice(i, 1); }
        else if (left < PAINT_FADE_MS) k.batch.setAlpha(k.m, left / PAINT_FADE_MS);
        else if (k.m.alpha !== 1) k.batch.setAlpha(k.m, 1);
      }
      for (const a of [me, meView, ...[...peers.values()].map(p => p.avatar)]) {
        if (!a?.paint?.length) continue;
        for (let i = a.paint.length - 1; i >= 0; i--) {
          const mesh = a.paint[i], left = SPLAT_LIFE_MS - (now - mesh.userData.born);
          if (left <= 0) { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); a.paint.splice(i, 1); }
          else if (left < PAINT_FADE_MS) { mesh.material.opacity = left / PAINT_FADE_MS; mesh.material.alphaTest = .35 * mesh.material.opacity; }
        }
      }
    }

    // crowns on heads (their hats come off for it), and the king of the hill clock
    me.setCrowned(!!network.id && !!items.wornBy(network.id));
    for (const p of peers.values()) p.avatar?.setCrowned(!!items.wornBy(p.id));
    updateKoth(now);
    // held items and what you can do right now
    items.frame(frameArgs(dt));
    // with the bucket: the paint or graffiti under the crosshair, glowing
    cleaning.tick(dt);
    if (h?.state.type !== 'bucket' || frozen) cleanTarget = null;
    else if (now - cleanCheckAt > 70) {
      cleanCheckAt = now;
      camera.updateMatrixWorld();
      const o = camera.getWorldPosition(new THREE.Vector3()), d = camera.getWorldDirection(new THREE.Vector3());
      if (boom) o.addScaledVector(d, camDist);
      cleanTarget = cleaning.pick(o, d, 3.2, [...splatMarks, ...sprayMarks]);
    }
    cleaning.highlight(cleanTarget);
    if (now - mimicAt > 250) {
      mimicAt = now;
      mimic.update([{x: player.x, z: player.z}, ...[...peers.values()].filter(p => p.last).map(p => p.last)]);
    }
    updatePreview(now, h?.state.type === 'spray' && !!chosenPiece && !frozen && gallery.hidden);
    updatePlaceGhost(now, h, frozen);
    const pushable = !frozen && onButton();
    machine.highlight(pushable);
    machine.update(dt);
    const t = !h && !frozen && !pushable ? lookTarget() : null;
    items.highlight(t ? t.state.id : null);
    // an open door in reach to pull shut (checked a few times a second)
    if (h || t || frozen || pushable) doorAim = null;
    else if (now - doorCheckAt > 120) { doorCheckAt = now; doorAim = doorTarget(); }
    const type = h?.state.type;
    // what you can do right now, leaving out whatever you've already done at least once
    const drop = ['drop', 'right-click: drop'];
    const parts = isTouch ? [] : pushable ? [['button', 'click: push the button']] : doorAim !== null ? [['door', 'click: close the door']]
      : h ? (type === 'flashlight' ? [['flashlight', `click: ${h.state.on ? 'turn off' : 'turn on'}`], drop]
        : type === 'paintball' ? [['fire', 'click: fire'], drop]
        : type === 'bucket' ? [['scrub', cleanTarget ? 'click: scrub it off' : 'aim at paint or graffiti to scrub it'], drop]
        : type === 'crown' ? (kothActive(koth) ? [] : [['koth', 'click: start king of the hill'], drop])
        : type === 'painting' ? [['place', placePlan ? `click: ${{hang: 'hang it here', lean: 'lean it here', lay: 'lay it down'}[placePlan.how]}` : 'aim at a wall or the floor to put it there']]
        : [['spray', 'click a wall: spray'], ['pieces', 'esc or tab: pick a piece'], ['tagturn', 'ctrl + scroll: turn'], ['tagsize', 'shift + scroll: size'], drop])
      : t ? (t.state.type === 'crown' && kothActive(koth) ? [['pickup:crown:on', 'click: put on the crown']]
        : [[`pickup:${t.state.type}`, `click: pick up ${ITEM_NAMES[t.state.type] || 'it'}`]]) : [];
    const hint = parts.filter(([k]) => !learned.has(k)).map(([, text]) => text).join('  ·  ');
    if (prompt.textContent !== hint) prompt.textContent = hint;
    document.body.classList.toggle('holding', !!h);
    tagLabel.hidden = type !== 'spray' || !chosenPiece;
    paintLabel.hidden = type !== 'paintball';
    const galleryLabel = type === 'paintball' ? 'paint' : 'tags';
    if (btnGallery.textContent !== galleryLabel) btnGallery.textContent = galleryLabel;
    const act = pushable ? 'push' : doorAim !== null ? 'close' : h ? (type === 'flashlight' ? (h.state.on ? 'light off' : 'light on')
      : type === 'paintball' ? 'fire' : type === 'bucket' ? 'scrub' : type === 'crown' ? 'start' : type === 'painting' ? 'place' : 'spray') : t ? 'grab' : 'punch';
    if (btnAct.textContent !== act) btnAct.textContent = act;
    document.body.classList.toggle('can-grab', !!t);
    // first person: say which emote you're doing, since you can't see yourself
    const label = !boom && player.emote ? EMOTES.find(e => e.id === player.emote)?.label || '' : '';
    if (emoteLabel.textContent !== label) { emoteLabel.textContent = label; emoteLabel.hidden = !label; }

    avatarLights.update(camera.position.x, camera.position.z);
    updateLights(now);
    renderer.render(scene, camera);
  };
  // A thrown error mustn't stop the loop for good (that freezes the game): report it (once per kind)
  // and carry on with the next frame.
  const reported = new Set();
  renderer.setAnimationLoop(() => {
    try { frame(); } catch (err) {
      const key = String(err?.stack || err).slice(0, 300);
      if (!reported.has(key)) { reported.add(key); console.error('frame failed', err); }
    }
  });
  // Fade the space in from black only once it's really there: the room's state and everyone in it
  // (or a few seconds, if the server is slow), every shader compiled, and a few frames drawn behind the black.
  async function reveal() {
    await Promise.race([roomIn, wait(6000)]);
    await renderer.compileAsync?.(scene, camera).catch(() => {});
    for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r));
    await wait(1500 - (performance.now() - goingAt));   // "going down…" stays long enough to read, even when it all loaded while you picked
    loading.classList.add('done');
    document.body.classList.add('ready');
  }
  window.__111k = {scene, camera, player, peers, network, renderer, items, controls, hits, doors, me, meView, vertical,
    voice, cleaning, mimic, planPlace, get cleanTarget() { return cleanTarget; }, splatMarks, sprayMarks, addSplat, doorBatches, setView: v => { thirdPerson = v; }, primary, secondary, shoot, spray, choosePiece, choosePaint, toggleGallery, get pieces() { return pieces; }};
}

start().catch(err => {
  console.error(err);
  loading.classList.remove('done'); loading.classList.add('going');
  loading.querySelector('p').textContent = 'Could not load the space. Refresh to try again.';
});

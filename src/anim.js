// /anim: preview every emote (the originals beside their redos, and the new ones), and choose what the
// live site uses: for each original, which version everyone plays, and which emotes the menu offers.
// Saving sends the settings to the room server, which keeps them and tells everyone connected.
import * as THREE from 'three';
import {createAvatar} from './avatar.js';
import {randomLook} from './looks.js';
import {EMOTE_LIST, emoteById, variantOf, cleanEmoteConfig, DEFAULT_EMOTE_CONFIG} from './emotes.js';
import {EMOTE_CLIPS} from './emote-clips.js';
import {emotesUrl} from './config.js';

const $ = id => document.getElementById(id);
const canvas = $('view'), stage = $('stage');

// ------------------------------------------------------------------------------------------ the scene
const renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0a0e);
scene.fog = new THREE.Fog(0x0b0a0e, 11, 24);
{
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({color: 0x3a3a40, side: THREE.BackSide})));
  const panel = (c, x, y, z, w, h) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({color: c, side: THREE.DoubleSide})); m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m); };
  panel(0xffffff, 0, 2.9, 0, 6, 4); panel(0xfff0e0, 4.9, 1, 2, 3, 3); panel(0xd8e4ff, -4.9, 1.4, -1, 2.5, 3);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(s, .04).texture;
}
const key = new THREE.DirectionalLight(0xfff1e6, 1.6); key.position.set(2.5, 4, 3); scene.add(key);
scene.add(new THREE.HemisphereLight(0xd8e0ff, 0x1a1418, .6));
const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 64), new THREE.MeshStandardMaterial({color: 0x17161b, roughness: .95}));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
const grid = new THREE.PolarGridHelper(5, 8, 6, 64, 0x2a2830, 0x221f27); grid.position.y = .002; scene.add(grid);
const camera = new THREE.PerspectiveCamera(32, 1, .05, 40);
const orbit = {yaw: Math.PI - .42, pitch: .12, dist: 7.6, target: new THREE.Vector3(0, 1.02, 0)};   // in front of them (they face -z), a little to their left
function placeCamera() {
  const {yaw, pitch, dist, target} = orbit;
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(target);
}
{
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = {x: e.clientX, y: e.clientY}; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    orbit.yaw -= (e.clientX - drag.x) * .008; orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + (e.clientY - drag.y) * .006, -.25, 1.2);
    drag = {x: e.clientX, y: e.clientY};
  });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => { e.preventDefault(); orbit.dist = THREE.MathUtils.clamp(orbit.dist * Math.exp(e.deltaY * .001), 2.5, 16); }, {passive: false});
}

// ------------------------------------------------------------------------------------------ avatars
// one look, shown once per version being compared
let kind = 'drifella', look = randomLook(kind);
const slots = [];   // {variant, avatar, x}
let building = Promise.resolve(), generation = 0;
function rebuild() {
  const gen = ++generation, wanted = shownVariants();
  building = building.then(async () => {
    if (gen !== generation) return;
    const made = await Promise.all(wanted.map(() => createAvatar(look, {waitForEmotes: true})));
    if (gen !== generation) { for (const a of made) a.dispose(); return; }
    for (const s of slots) s.avatar.dispose();
    slots.length = 0;
    wanted.forEach((variant, i) => {
      const avatar = made[i], x = wanted.length === 1 ? 0 : ((wanted.length - 1) / 2 - i) * 2.4;   // the original on the left
      avatar.root.position.x = x; scene.add(avatar.root);
      slots.push({variant, avatar, x});
    });
    labels();
  }).catch(err => console.error(err));
  return building;
}
let forced = null;   // (tests: show just this version)
function shownVariants() {
  const e = emoteById(selected);
  if (forced) return [!e?.original ? 'redo' : forced];
  if (!e) return ['original'];
  if (!e.original) return ['redo'];
  if (!e.made) return ['original'];
  return compare ? ['original', 'redo'] : [variantOf(selected, draft)];
}
function labels() {
  const box = $('labels'); box.innerHTML = '';
  if (slots.length < 2) return;
  for (const s of slots) {
    const el = document.createElement('span');
    el.textContent = s.variant === 'redo' ? 'redo' : 'original';
    el.dataset.variant = s.variant;
    box.append(el);
  }
  placeLabels();
}
const tmp = new THREE.Vector3();
function placeLabels() {
  const els = $('labels').children;
  slots.forEach((s, i) => {
    const el = els[i]; if (!el) return;
    tmp.set(s.x, 0, 0).project(camera);
    el.style.left = `${(tmp.x + 1) / 2 * stage.clientWidth}px`;
    el.classList.toggle('on', variantOf(selected, draft) === s.variant);
  });
}

// ------------------------------------------------------------------------------------------ playback
let selected = null, compare = true, playing = true, speed = 1, t = 0;
const span = () => {   // how much of the timeline to show: the intro and a loop and a half, or the originals' move and a hold
  const e = emoteById(selected), timing = e && EMOTE_CLIPS[e.id];
  const showing = shownVariants();
  let end = 3;
  if (timing && showing.includes('redo')) end = Math.max(end, timing[1] + (timing[1] - timing[0]) * .5);
  return end;
};
function setTime(v) { t = Math.max(0, v); }
const scrub = $('scrub'), clock = $('clock'), loopMark = $('loopMark');
scrub.addEventListener('input', () => { setTime(scrub.value / 1000 * span()); });
$('play').addEventListener('click', () => { playing = !playing; $('play').classList.toggle('paused', !playing); $('play').setAttribute('aria-label', playing ? 'pause' : 'play'); });
$('restart').addEventListener('click', () => setTime(0));
$('speed').addEventListener('change', e => { speed = Number(e.target.value) || 1; });
addEventListener('keydown', e => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
  if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { e.preventDefault(); step(e.code === 'ArrowDown' ? 1 : -1); }
});
function updateTimeline() {
  const S = span(), timing = EMOTE_CLIPS[selected];
  if (document.activeElement !== scrub) scrub.value = String(Math.round(Math.min(1, t / S) * 1000));
  clock.textContent = `${t.toFixed(2)}s`;
  const showLoop = timing && shownVariants().includes('redo');
  loopMark.style.display = showLoop ? 'block' : 'none';
  if (showLoop) loopMark.style.left = `${timing[0] / S * 100}%`;
}

// ------------------------------------------------------------------------------------------ settings
let saved = cleanEmoteConfig(DEFAULT_EMOTE_CONFIG), draft = structuredClone(saved), reachable = false;
const same = (a, b) => JSON.stringify(cleanEmoteConfig(a)) === JSON.stringify(cleanEmoteConfig(b));
const isOn = (id, c = draft) => !(c.off || []).includes(id);
function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = cls; }
function refreshDirty() {
  const dirty = !same(saved, draft);
  $('save').disabled = !dirty || !reachable; $('revert').disabled = !dirty;
  if (!reachable) return;
  if (dirty) {
    const n = EMOTE_LIST.filter(e => variantOf(e.id, saved) !== variantOf(e.id, draft) || isOn(e.id, saved) !== isOn(e.id, draft)).length;
    setStatus(`${n} change${n === 1 ? '' : 's'} not saved yet`, 'dirty');
  } else setStatus('the live site matches this', 'ok');
}
async function load() {
  try {
    const r = await fetch(emotesUrl(), {cache: 'no-store'});
    if (!r.ok) throw Error(r.status);
    saved = cleanEmoteConfig(await r.json()); draft = structuredClone(saved); reachable = true;
  } catch (err) {
    setStatus(`couldn't reach the room server (${err.message}); you can still preview`, 'err');
  }
  list(); detail(); refreshDirty(); rebuild();
}
async function save() {
  const body = JSON.stringify(cleanEmoteConfig(draft));
  let keyText = null; try { keyText = localStorage.getItem('111k:emotesKey'); } catch {}
  for (let attempt = 0; attempt < 2; attempt++) {
    setStatus('saving…');
    try {
      const r = await fetch(emotesUrl(), {method: 'POST', body, headers: {'Content-Type': 'application/json', ...(keyText ? {'X-Emotes-Key': keyText} : {})}});
      if (r.status === 401 && attempt === 0) {
        keyText = prompt('This server wants a key to change the emotes:');
        if (!keyText) { setStatus('not saved (no key)', 'err'); return; }
        try { localStorage.setItem('111k:emotesKey', keyText); } catch {}
        continue;
      }
      if (!r.ok) throw Error(r.status);
      saved = cleanEmoteConfig(await r.json()); draft = structuredClone(saved);
      list(); detail(); refreshDirty();
      setStatus('saved: everyone on the site has it now', 'ok');
      return;
    } catch (err) { setStatus(`couldn't save (${err.message})`, 'err'); return; }
  }
}
$('save').addEventListener('click', save);
$('revert').addEventListener('click', () => { draft = structuredClone(saved); list(); detail(); refreshDirty(); rebuild(); });

// ------------------------------------------------------------------------------------------ the list
function list() {
  const q = $('search').value.trim().toLowerCase();
  const groups = [
    ['the originals', EMOTE_LIST.filter(e => e.original)],
    ['new', EMOTE_LIST.filter(e => !e.original)],
  ];
  const box = $('groups'); box.innerHTML = '';
  for (const [title, items] of groups) {
    const shown = items.filter(e => !q || e.label.toLowerCase().includes(q) || e.id.includes(q));
    if (!shown.length) continue;
    const g = document.createElement('section'); g.className = 'group';
    g.innerHTML = `<h3>${title} · ${shown.length}</h3>`;
    for (const e of shown) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'row'; b.dataset.id = e.id;
      b.classList.toggle('sel', e.id === selected);
      b.classList.toggle('off', !isOn(e.id));
      const v = variantOf(e.id, draft), changed = variantOf(e.id, saved) !== v || isOn(e.id, saved) !== isOn(e.id);
      b.innerHTML = `<span class="label"></span>${e.original && v === 'redo' ? '<span class="tag redo">redo</span>' : ''}${!e.made ? '<span class="tag">not made yet</span>' : ''}${changed ? '<span class="tag changed">changed</span>' : ''}`;
      b.querySelector('.label').textContent = e.label;
      b.addEventListener('click', () => select(e.id));
      g.append(b);
    }
    box.append(g);
  }
}
$('search').addEventListener('input', list);
function step(dir) {
  const ids = [...document.querySelectorAll('#groups .row')].map(b => b.dataset.id);
  const i = ids.indexOf(selected);
  if (ids.length) select(ids[(i + dir + ids.length) % ids.length]);
}

// ------------------------------------------------------------------------------------------ the detail
function detail() {
  const e = emoteById(selected);
  $('name').textContent = e ? e.label : '—';
  const choice = $('choice'); choice.innerHTML = '';
  if (!e) return;
  $('about').textContent = e.original
    ? 'One of the original poses (made for still images). The redo moves into the same pose and then keeps it alive.'
    : 'A new emote: it plays once and then loops for as long as you hold it.';
  if (e.original) {
    for (const [v, title, sub] of [['original', 'original', 'moves into the pose, then holds still'], ['redo', 'redo', e.made ? 'moves in properly, then keeps moving' : 'not made yet']]) {
      const l = document.createElement('label');
      l.className = 'opt' + (v === 'redo' && !e.made ? ' missing' : '');
      l.innerHTML = `<input type="radio" name="variant" value="${v}"><span><b>${title}</b><small>${sub}</small></span>`;
      const input = l.querySelector('input');
      input.checked = variantOf(e.id, draft) === v; input.disabled = v === 'redo' && !e.made;
      input.addEventListener('change', () => {
        draft.variant = {...draft.variant}; if (v === 'redo') draft.variant[e.id] = 'redo'; else delete draft.variant[e.id];
        list(); refreshDirty(); if (!compare) rebuild(); else placeLabels();
      });
      choice.append(l);
    }
  }
  const on = $('onSite'); on.checked = isOn(e.id); on.disabled = !variantOf(e.id, draft);
}
$('onSite').addEventListener('change', e => {
  const off = new Set(draft.off || []);
  if (e.target.checked) off.delete(selected); else off.add(selected);
  draft.off = [...off]; list(); refreshDirty();
});
function select(id) {
  if (!emoteById(id)) return;
  selected = id; t = 0;
  try { history.replaceState(null, '', `#${id}`); } catch {}
  list(); detail(); rebuild();
  document.querySelector(`#groups .row[data-id="${id}"]`)?.scrollIntoView({block: 'nearest'});
}
$('compare').addEventListener('change', e => { compare = e.target.checked; rebuild(); });
for (const b of document.querySelectorAll('.who button')) b.addEventListener('click', () => {
  kind = b.dataset.kind; look = randomLook(kind);
  for (const o of document.querySelectorAll('.who button')) o.setAttribute('aria-selected', String(o === b));
  rebuild();
});
$('reroll').addEventListener('click', () => { look = randomLook(kind); rebuild(); });

// ------------------------------------------------------------------------------------------ the loop
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage); resize();
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;   // the first rAF stamp can be older than `last`
  if (playing) t += dt * speed;
  for (const s of slots) s.avatar.update(dt, 0, {emote: selected, emoteTime: t, emoteVariant: s.variant});
  placeCamera(); placeLabels(); updateTimeline();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

selected = emoteById(location.hash.slice(1))?.id || EMOTE_LIST[0].id;
load();

// for tests and screenshots: a stick figure (bones as limbs: left blue, right red, the spine white)
const sticks = {on: false, group: new THREE.Group(), parts: []};
scene.add(sticks.group);
const LEAF = {Head: .51, 'Hand.L': .32, 'Hand.R': .32, 'Foot.L': .23, 'Foot.R': .23, TailTip: .3};
const stickMat = side => new THREE.MeshBasicMaterial({color: side === 'L' ? 0x4f9dff : side === 'R' ? 0xff5a5a : 0xeeeeee});
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, .5, 0), ball = new THREE.SphereGeometry(1, 16, 12);
function drawSticks() {
  for (const p of sticks.parts) sticks.group.remove(p);
  sticks.parts = [];
  if (!sticks.on) return;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const s of slots) {
    s.avatar.root.traverse(o => { if (o.isMesh) o.visible = false; });
    s.avatar.root.updateMatrixWorld(true);
    const bones = []; s.avatar.root.traverse(o => { if (o.isBone && o.name !== 'CardSocketR' && !/^Root$/.test(o.name)) bones.push(o); });
    const scale = s.avatar.root.getWorldScale(new THREE.Vector3()).y;
    for (const bone of bones) {
      const name = bone.name.replace(/([LR])$/, '.$1'), side = /\.L$/.test(name) ? 'L' : /\.R$/.test(name) ? 'R' : '';
      bone.getWorldPosition(a);
      const kids = bone.children.filter(c => c.isBone && c.name !== 'CardSocketR');
      const ends = kids.length ? kids.map(c => c.getWorldPosition(new THREE.Vector3())) : [a.clone().add(new THREE.Vector3(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar((LEAF[name] || .2) * scale * 1.5))];
      for (const e of ends) {
        b.copy(e).sub(a); const len = b.length(); if (len < 1e-4) continue;
        const m = new THREE.Mesh(unitCyl, stickMat(side)); m.position.copy(a); m.scale.set(.022, len, .022);
        m.quaternion.setFromUnitVectors(up, b.normalize()); sticks.group.add(m); sticks.parts.push(m);
      }
      if (name === 'Head') { const h = new THREE.Mesh(ball, stickMat('')); h.position.copy(ends[0]).lerp(a, .45); h.scale.setScalar(.17); sticks.group.add(h); sticks.parts.push(h);
      }
      const j = new THREE.Mesh(ball, stickMat(side)); j.position.copy(a); j.scale.setScalar(.03); sticks.group.add(j); sticks.parts.push(j);
    }
  }
}

window.__anim = {
  sticks: v => { sticks.on = v; },
  select, setTime: v => { playing = false; $('play').classList.add('paused'); setTime(v); },
  setCompare: v => { compare = v; $('compare').checked = v; return rebuild(); },
  setKind: k => { kind = k; look = randomLook(k); return rebuild(); },
  only: v => { forced = v; return rebuild(); },
  ready: () => building, orbit, get slots() { return slots.length; },
  render: () => { for (const s of slots) s.avatar.update(0, 0, {emote: selected, emoteTime: t, emoteVariant: s.variant}); drawSticks(); placeCamera(); renderer.render(scene, camera); return canvas.toDataURL('image/jpeg', .85); },
};

// The door before the tunnel: pick a name (optional) and one of twelve random
// avatars (six Drifellas, six Driladies), or keep the one from last time.
import * as THREE from 'three';
import {createAvatar, preloadLook} from './avatar.js';
import {randomLook} from './looks.js';

const KINDS = [['drifella', 'drifella'], ['drilady', 'drilady']];

// Renders still portraits of avatars with a small offscreen renderer. Each one is framed to fit: feet
// a little up from the bottom of the card, on a soft shadow, and the whole head in (big heads and tall
// hats get pulled back so nothing's cut off; everyone else is shown at the same scale).
const W = 300, H = 400;
const FOOT = .085, HEAD = .06;      // the share of the card below the feet and above the head
const MIN_SPAN = 2.2;               // metres of height a card shows at least (same scale for ordinary avatars)
function createPortraits() {
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studio(), .04).texture;
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2420, 1.4));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.4); key.position.set(1.4, 2.6, 2.2); scene.add(key);
  const rim = new THREE.DirectionalLight(0xff79c0, 1.6); rim.position.set(-2, 1.6, -1.8); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(24, W / H, .1, 30);
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const v = new THREE.Vector3();
  const loaded = new Set();
  // how far the avatar reaches from the axis it turns on, and from its feet to the top of its head (the
  // skinned, posed vertices: the quick bounding boxes are off), so it fits the card at every angle
  function extent(root) {
    let reach = 0, top = -Infinity, bottom = Infinity;
    root.traverse(o => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
        v.applyMatrix4(o.matrixWorld);
        reach = Math.max(reach, Math.hypot(v.x, v.z)); top = Math.max(top, v.y); bottom = Math.min(bottom, v.y);
      }
    });
    return {reach, top, bottom};
  }
  function framing({reach, top, bottom}) {
    top += .02; bottom = Math.min(0, bottom);
    let span = Math.max(MIN_SPAN, (top - bottom) / (1 - FOOT - HEAD));
    span = Math.max(span, 2 * (reach + .04) / camera.aspect);
    const cy = bottom - FOOT * span + span / 2;
    // measured a little in front of the axis, so whatever swings toward you still fits
    const dist = span / 2 / tan + reach * .6;
    camera.position.set(0, cy + .18, dist); camera.lookAt(0, cy, 0); camera.updateMatrixWorld();
    return {pos: camera.position.clone(), quat: camera.quaternion.clone(), feet: new THREE.Vector3(0, bottom, 0).project(camera)};
  }
  return {
    // an avatar, set up to be drawn (and turned) on its card
    async load(look) {
      const a = await createAvatar(look);
      a.root.rotation.y = Math.PI;
      a.update(1 / 30, 0, {});
      a.root.updateMatrixWorld(true);
      const entry = {a, yaw: .38, frame: framing(extent(a.root))};
      loaded.add(entry);
      return entry;
    },
    paint(entry, canvas) {
      const {a, frame} = entry;
      a.root.rotation.y = Math.PI + entry.yaw;
      camera.position.copy(frame.pos); camera.quaternion.copy(frame.quat); camera.updateMatrixWorld();
      scene.add(a.root);
      renderer.render(scene, camera);
      scene.remove(a.root);
      const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      // a soft shadow to stand on
      const x = (frame.feet.x + 1) / 2 * w, y = (1 - frame.feet.y) / 2 * h, rx = w * .3, ry = h * .028;
      ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, 'rgba(0, 0, 0, .55)'); g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.drawImage(renderer.domElement, 0, 0, w, h);
    },
    // done with one (its card was rerolled away)
    drop(entry) { if (loaded.delete(entry)) entry.a.dispose(); },
    dispose() { for (const e of loaded) e.a.dispose(); loaded.clear(); renderer.dispose(); pmrem.dispose(); renderer.forceContextLoss?.(); },
  };
}

// A soft grey room for reflections, so metal and gloss finishes read in the portraits.
function studio() {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({color: 0x3a3a40, side: THREE.BackSide}));
  s.add(room);
  const panel = (c, x, y, z, w, h) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({color: c, side: THREE.DoubleSide})); m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m); };
  panel(0xffffff, 0, 2.9, 0, 6, 4); panel(0xfff0e0, 4.9, 1, 2, 3, 3); panel(0xd8e4ff, -4.9, 1.4, -1, 2.5, 3);
  return s;
}

export function pickAvatar({previous = null, name = '', extra = null} = {}) {
  const root = document.getElementById('picker');
  const looks = Object.fromEntries(KINDS.map(([kind]) => [kind, Array.from({length: 6}, () => randomLook(kind))]));
  let kind = previous?.character === 'drilady' ? 'drilady' : 'drifella';
  let chosen = previous ? 'previous' : null;
  const DICE = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="3.5"/><circle cx="6.8" cy="6.8" r="1.25"/><circle cx="13.2" cy="6.8" r="1.25"/><circle cx="10" cy="10" r="1.25"/><circle cx="6.8" cy="13.2" r="1.25"/><circle cx="13.2" cy="13.2" r="1.25"/></svg>';
  const LADDER = '<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M4 1v18M12 1v18M4 5.5h8M4 10h8M4 14.5h8"/></svg>';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', "who's going down?");
  root.innerHTML = `
    <div class="sheet">
      <label class="name"><span>name</span><input type="text" maxlength="24" placeholder="anon" autocomplete="off" spellcheck="false"></label>
      <div class="who">
        <div class="tabs" role="tablist" aria-label="who">${KINDS.map(([k, label]) => `<button type="button" role="tab" data-kind="${k}">${label}</button>`).join('')}</div>
        <button type="button" class="reroll" aria-label="new options" title="new options">${DICE}</button>
      </div>
      ${previous ? `<div class="previous"><button type="button" class="card" data-id="previous"><canvas width="${W}" height="${H}"></canvas></button><p>last time</p></div>` : ''}
      <div class="grid"></div>
      <div class="extra"></div>
      <div class="foot"><button type="button" class="go" disabled>enter the tunnel ${LADDER}</button></div>
    </div>`;
  root.hidden = false;
  if (extra) root.querySelector('.extra').append(extra);
  const input = root.querySelector('input'), grid = root.querySelector('.grid'), go = root.querySelector('.go');
  input.value = name || '';
  for (const type of ['keydown', 'keyup']) input.addEventListener(type, e => e.stopPropagation());
  const portraits = createPortraits();
  const drawn = new Map(), entries = new Map(), retired = new WeakSet();
  // one portrait at a time keeps the GPU and network calm
  let queue = Promise.resolve();
  const draw = (look, card) => {
    queue = queue.then(() => retired.has(card) ? null : portraits.load(look)).then(e => {
      if (!e) return;
      if (retired.has(card)) { portraits.drop(e); return; }    // rerolled away while it loaded
      entries.set(card, e); portraits.paint(e, card.querySelector('canvas'));
    })
      .catch(err => console.warn('portrait', err));
    return queue;
  };
  // drag across a card to turn whoever's on it (a click without a drag still picks them); it spins on a
  // little when you let go
  let spinning = null;
  function turnable(card) {
    let down = null, moved = false, frame = 0, swallow = false;
    const paint = () => { frame = 0; const e = entries.get(card); if (e) portraits.paint(e, card.querySelector('canvas')); };
    card.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      down = {id: e.pointerId, x: e.clientX, t: performance.now(), vel: 0}; moved = false; swallow = false;
      if (spinning?.card === card) { cancelAnimationFrame(spinning.raf); spinning = null; }
      try { card.setPointerCapture(e.pointerId); } catch {}
    });
    card.addEventListener('pointermove', e => {
      if (!down || e.pointerId !== down.id) return;
      // the button's already up (released somewhere the card never heard about): the drag's over
      if (e.pointerType === 'mouse' && !(e.buttons & 1)) { up(e); return; }
      const dx = e.clientX - down.x, now = performance.now();
      if (!moved && Math.abs(dx) < 4) return;
      moved = true; card.classList.add('turning');
      const ent = entries.get(card);
      if (ent) ent.yaw += dx * .012;
      down.vel = dx * .012 / Math.max(8, now - down.t); down.x = e.clientX; down.t = now;
      if (!frame) frame = requestAnimationFrame(paint);
    });
    const up = e => {
      if (!down || (e && e.pointerId !== down.id)) return;
      const ent = entries.get(card);
      card.classList.remove('turning');
      if (moved) {
        swallow = true;
        let vel = performance.now() - down.t < 80 ? down.vel : 0, last = performance.now();
        const spin = now => {
          const dt = Math.min(50, now - last); last = now;
          vel *= Math.exp(-dt / 260);
          if (!ent || Math.abs(vel) < .0004) { spinning = null; return; }
          ent.yaw += vel * dt; portraits.paint(ent, card.querySelector('canvas'));
          spinning = {card, raf: requestAnimationFrame(spin)};
        };
        if (spinning) cancelAnimationFrame(spinning.raf);
        spinning = {card, raf: requestAnimationFrame(spin)};
      }
      down = null;
    };
    card.addEventListener('pointerup', up);
    card.addEventListener('lostpointercapture', up);
    card.addEventListener('pointercancel', () => { down = null; card.classList.remove('turning'); });
    // the click that ends a drag doesn't pick
    card.addEventListener('click', e => { if (swallow) { swallow = false; e.stopImmediatePropagation(); } }, true);
    card.addEventListener('dblclick', e => { if (moved) e.stopImmediatePropagation(); }, true);
  }

  const cards = {};
  const makeCards = k => looks[k].map((look, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'card loading'; b.dataset.id = `${k}:${i}`;
      b.innerHTML = `<canvas width="${W}" height="${H}"></canvas>`;
      turnable(b);
      b.addEventListener('click', () => select(b.dataset.id));
      return b;
    });
  for (const [k] of KINDS) cards[k] = makeCards(k);
  // the dice: six new options for the side you're looking at (the old ones are let go)
  root.querySelector('.reroll').addEventListener('click', e => {
    const k = kind;
    for (const b of cards[k]) { retired.add(b); drawn.delete(b); const ent = entries.get(b); if (ent) { portraits.drop(ent); entries.delete(b); } }
    if (spinning && cards[k].includes(spinning.card)) { cancelAnimationFrame(spinning.raf); spinning = null; }
    looks[k] = Array.from({length: 6}, () => randomLook(k));
    cards[k] = makeCards(k);
    if (chosen?.startsWith(`${k}:`)) select(null);
    show(k);
    const dice = e.currentTarget; dice.classList.remove('rolled'); void dice.offsetWidth; dice.classList.add('rolled');
  });
  function show(k) {
    kind = k;
    grid.replaceChildren(...cards[k]);
    for (const t of root.querySelectorAll('.tabs button')) t.setAttribute('aria-selected', t.dataset.kind === k);
    cards[k].forEach((b, i) => {
      if (drawn.has(b)) return;
      drawn.set(b, draw(looks[k][i], b).then(() => b.classList.remove('loading')));
    });
  }
  function select(id) {
    chosen = id;
    for (const c of root.querySelectorAll('.card')) c.classList.toggle('chosen', c.dataset.id === id);
    go.disabled = !id;
  }
  for (const t of root.querySelectorAll('.tabs button')) t.addEventListener('click', () => show(t.dataset.kind));
  if (previous) {
    const card = root.querySelector('.previous .card');
    turnable(card);
    card.addEventListener('click', () => select('previous'));
    draw(previous, card);
  }
  show(kind);
  if (chosen) select(chosen);
  // warm the other tab's parts in the background
  const other = kind === 'drifella' ? 'drilady' : 'drifella';
  queue.then(() => Promise.all(looks[other].map(preloadLook))).catch(() => {});

  return new Promise(resolve => {
    const finish = () => {
      if (!chosen) return;
      const look = chosen === 'previous' ? previous : looks[chosen.split(':')[0]][Number(chosen.split(':')[1])];
      root.classList.add('done');
      if (spinning) cancelAnimationFrame(spinning.raf);
      setTimeout(() => { root.hidden = true; extra?.remove(); root.innerHTML = ''; queue.then(() => portraits.dispose()); }, 600);
      resolve({look, name: input.value.trim()});
    };
    go.addEventListener('click', finish);
    root.addEventListener('dblclick', e => { if (e.target.closest('.card')) finish(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(); });
  });
}

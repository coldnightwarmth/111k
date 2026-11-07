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
  const box = new THREE.Box3(), feet = new THREE.Vector3();
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  function frame() {
    const top = box.max.y + .02, bottom = Math.min(0, box.min.y);
    const cx = (box.min.x + box.max.x) / 2, halfW = (box.max.x - box.min.x) / 2 + .06;
    let span = Math.max(MIN_SPAN, (top - bottom) / (1 - FOOT - HEAD));
    span = Math.max(span, 2 * halfW / camera.aspect);
    const cy = bottom - FOOT * span + span / 2;
    // measured a little in front of the body's middle, so heads that stick out toward you still fit
    const dist = span / 2 / tan + Math.max(0, box.max.z) * .6;
    camera.position.set(cx, cy + .18, dist); camera.lookAt(cx, cy, 0);
    camera.updateMatrixWorld();
    return feet.set(cx, bottom, 0).project(camera);
  }
  return {
    async draw(look, canvas) {
      const a = await createAvatar(look);
      a.root.rotation.y = Math.PI + .38;
      a.update(1 / 30, 0, {});
      scene.add(a.root);
      a.root.updateMatrixWorld(true);
      box.setFromObject(a.root, true);      // exact: the skinned, posed vertices (the quick box is off)
      const f = frame();
      renderer.render(scene, camera);
      const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      // a soft shadow to stand on
      const x = (f.x + 1) / 2 * w, y = (1 - f.y) / 2 * h, rx = w * .3, ry = h * .028;
      ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, 'rgba(0, 0, 0, .55)'); g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.drawImage(renderer.domElement, 0, 0, w, h);
      scene.remove(a.root); a.dispose();
    },
    dispose() { renderer.dispose(); pmrem.dispose(); renderer.forceContextLoss?.(); },
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
  root.innerHTML = `
    <div class="sheet">
      <header class="head">
        <h1>who's going down?</h1>
        <p>an abandoned room off the loop. pick someone to be.</p>
      </header>
      <div class="bar">
        <label class="name"><span>name</span><input type="text" maxlength="24" placeholder="anon" autocomplete="off" spellcheck="false"></label>
        <div class="tabs" role="tablist" aria-label="who">${KINDS.map(([k, label]) => `<button type="button" role="tab" data-kind="${k}">${label}</button>`).join('')}</div>
      </div>
      <div class="cards">
        ${previous ? `<div class="previous"><button type="button" class="card" data-id="previous"><canvas width="${W}" height="${H}"></canvas><span>last time</span></button></div>` : ''}
        <div class="grid"></div>
      </div>
      <div class="extra"></div>
    </div>
    <footer class="foot"><div class="inner"><p class="chosen-note">pick someone</p><button type="button" class="go" disabled>go down <span aria-hidden="true">↓</span></button></div></footer>`;
  root.hidden = false;
  if (extra) root.querySelector('.extra').append(extra);
  const input = root.querySelector('input'), grid = root.querySelector('.grid'), go = root.querySelector('.go');
  const note = root.querySelector('.chosen-note');
  input.value = name || '';
  for (const type of ['keydown', 'keyup']) input.addEventListener(type, e => e.stopPropagation());
  const portraits = createPortraits();
  const drawn = new Map();
  // one portrait at a time keeps the GPU and network calm
  let queue = Promise.resolve();
  const draw = (look, canvas) => { queue = queue.then(() => portraits.draw(look, canvas)).catch(err => console.warn('portrait', err)); return queue; };

  const cards = {};
  for (const [k] of KINDS) {
    cards[k] = looks[k].map((look, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'card loading'; b.dataset.id = `${k}:${i}`;
      b.innerHTML = `<canvas width="${W}" height="${H}"></canvas>`;
      b.addEventListener('click', () => select(b.dataset.id));
      return b;
    });
  }
  function show(k) {
    kind = k;
    grid.replaceChildren(...cards[k]);
    for (const t of root.querySelectorAll('.tabs button')) t.setAttribute('aria-selected', t.dataset.kind === k);
    cards[k].forEach((b, i) => {
      if (drawn.has(b)) return;
      drawn.set(b, draw(looks[k][i], b.querySelector('canvas')).then(() => b.classList.remove('loading')));
    });
  }
  function select(id) {
    chosen = id;
    for (const c of root.querySelectorAll('.card')) c.classList.toggle('chosen', c.dataset.id === id);
    go.disabled = !id;
    note.textContent = !id ? 'pick someone' : id === 'previous' ? 'you, like last time' : `${id.split(':')[0]} #${Number(id.split(':')[1]) + 1}`;
  }
  for (const t of root.querySelectorAll('.tabs button')) t.addEventListener('click', () => show(t.dataset.kind));
  if (previous) {
    const card = root.querySelector('.previous .card');
    card.addEventListener('click', () => select('previous'));
    draw(previous, card.querySelector('canvas'));
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
      setTimeout(() => { root.hidden = true; extra?.remove(); root.innerHTML = ''; portraits.dispose(); }, 600);
      resolve({look, name: input.value.trim()});
    };
    go.addEventListener('click', finish);
    root.addEventListener('dblclick', e => { if (e.target.closest('.card')) finish(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(); });
  });
}

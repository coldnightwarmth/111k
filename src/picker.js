// The door before the tunnel: pick a name (optional) and one of twelve random
// avatars (six Drifellas, six Driladies), or keep the one from last time.
import * as THREE from 'three';
import {createAvatar, preloadLook} from './avatar.js';
import {randomLook} from './looks.js';

const KINDS = [['drifella', 'drifella'], ['drilady', 'drilady']];

// Renders still portraits of avatars with a small offscreen renderer.
function createPortraits() {
  const W = 240, H = 320;
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studio(), .04).texture;
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2420, 1.4));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.4); key.position.set(1.4, 2.6, 2.2); scene.add(key);
  const rim = new THREE.DirectionalLight(0xff79c0, 1.6); rim.position.set(-2, 1.6, -1.8); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(26, W / H, .1, 20);
  camera.position.set(0, 1.05, 4.5); camera.lookAt(0, .84, 0);
  return {
    async draw(look, canvas) {
      const a = await createAvatar(look);
      a.root.rotation.y = Math.PI + .38;
      a.update(1 / 30, 0, {});
      scene.add(a.root);
      renderer.render(scene, camera);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
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

export function pickAvatar({previous = null, name = ''} = {}) {
  const root = document.getElementById('picker');
  const looks = Object.fromEntries(KINDS.map(([kind]) => [kind, Array.from({length: 6}, () => randomLook(kind))]));
  let kind = previous?.character === 'drilady' ? 'drilady' : 'drifella';
  let chosen = previous ? 'previous' : null;
  root.innerHTML = `
    <div class="sheet">
      <h1>who's going down?</h1>
      <label class="name">name <input type="text" maxlength="24" placeholder="anon" autocomplete="off" spellcheck="false"></label>
      ${previous ? '<div class="previous"><button type="button" class="card" data-id="previous"><canvas width="240" height="320"></canvas><span>last time</span></button><p>keep your look from last time, or pick a new one</p></div>' : ''}
      <div class="grid"></div>
      <div class="tabs" role="tablist">${KINDS.map(([k, label]) => `<button type="button" role="tab" data-kind="${k}">${label}</button>`).join('')}</div>
      <button type="button" class="go" disabled>go down</button>
    </div>`;
  root.hidden = false;
  const input = root.querySelector('input'), grid = root.querySelector('.grid'), go = root.querySelector('.go');
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
      b.innerHTML = '<canvas width="240" height="320"></canvas>';
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
      setTimeout(() => { root.hidden = true; root.innerHTML = ''; portraits.dispose(); }, 600);
      resolve({look, name: input.value.trim()});
    };
    go.addEventListener('click', finish);
    root.addEventListener('dblclick', e => { if (e.target.closest('.card')) finish(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(); });
  });
}

// The converter in B-20: a big machine against the back wall that turns any painting into any piece of the
// collection. Stand a painting in its chamber, punch the piece's number into the keypad, hit the big button: a
// steel shutter rolls down over the chamber, and when it goes back up the canvas is that piece. The server does
// the converting (server/room.js: keypad, convert); this builds and works the machine.
import * as THREE from 'three';
import {FRAME, MX, MW, MD, MH, FRONT, CH, CH_X, PANEL_X, DISPLAY_Y, KEYPAD_Y, BUTTON_Y, KEYS, KEY_PITCH, HATCH_MS} from './converter-spec.js';
import {piece, validArt, ART_MAX} from './collection.js';
import {glowBox} from './items.js';

const GREEN = '#7dffb0', AMBER = '#ffbe3c', PINK = '#ff5fae', RED = '#ff4a3a';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
let seed = 2020;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// deep blue enamel, scuffed, with a little speckle
function enamel() {
  const t = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#1f2a52'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${rnd() < .5 ? '8,12,30' : '90,110,170'},${.04 + rnd() * .05})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 2 + rnd() * 12, 0, 7); g.fill(); }
    for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(160,165,175,.5)'; const x = rnd() * w, y = rnd() * h; g.fillRect(x, y, 1 + rnd() * 6, 1 + rnd() * 2); }
    for (let i = 0; i < 18; i++) { const x = rnd() * w, y = rnd() * h * .6, len = 30 + rnd() * 120; const gr = g.createLinearGradient(x, y, x, y + len);
      gr.addColorStop(0, 'rgba(10,10,14,.35)'); gr.addColorStop(1, 'rgba(10,10,14,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + rnd() * 3, len); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// the shutter: steel slats, one texture repeat per slat
function slats() {
  const t = canvasTexture(256, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#8d949b'); gr.addColorStop(.12, '#c3c9ce'); gr.addColorStop(.55, '#9aa1a8'); gr.addColorStop(.86, '#6c727a'); gr.addColorStop(1, '#2c3036');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(40,30,20,${rnd() * .18})`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 18, 1); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function hazard() {
  return canvasTexture(256, 32, (g, w, h) => {
    g.fillStyle = '#e8b416'; g.fillRect(0, 0, w, h); g.fillStyle = '#16140f';
    for (let x = -h; x < w + h; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0); g.fill(); }
  });
}
// the name across the top
function header() {
  return canvasTexture(1024, 160, (g, w, h) => {
    g.fillStyle = '#10142a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ff5fae'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    g.font = 'bold 84px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = PINK; g.shadowBlur = 18; g.fillStyle = '#ffd6ec';
    g.fillText('PIECE CONVERTER', w / 2, h / 2 + 4);
    g.shadowBlur = 0; g.font = 'bold 26px monospace'; g.fillStyle = '#9fb3ff';
    g.fillText('111K', 70, h / 2); g.fillText('MK.II', w - 70, h / 2);
  });
}
// a small stencilled label
function label(text, w = 256, h = 48, color = '#e8ecff', bg = null) {
  return canvasTexture(w, h, (g) => {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    g.font = `bold ${Math.round(h * .55)}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 1);
  });
}
// a key's face
function keyFace(k) {
  return canvasTexture(64, 64, g => {
    const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, '#e9e5da'); gr.addColorStop(1, '#bdb8aa');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.fillStyle = k === 'C' ? '#c0281e' : '#1b1d22';
    g.font = `bold ${k === '<' ? 36 : 40}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(k === '<' ? '←' : k, 32, 35);
  });
}
// the display: the number as typed, and a line about it
function createDisplay() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 224;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  let last = '';
  return {
    texture: t,
    draw(big, small, color = GREEN, cursor = false) {
      const key = `${big}|${small}|${color}|${cursor}`;
      if (key === last) return;
      last = key;
      const g = c.getContext('2d');
      g.fillStyle = '#04100a'; g.fillRect(0, 0, 512, 224);
      // the dot matrix behind
      g.fillStyle = 'rgba(125,255,176,.05)';
      for (let y = 6; y < 224; y += 8) for (let x = 6; x < 512; x += 8) g.fillRect(x, y, 4, 4);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = color; g.shadowBlur = 14; g.fillStyle = color;
      g.font = 'bold 96px monospace';
      g.fillText(big + (cursor ? '_' : ''), 256, 84);
      g.shadowBlur = 6; g.font = 'bold 34px monospace';
      g.fillText(small, 256, 178);
      g.shadowBlur = 0;
      const sheen = g.createLinearGradient(0, 0, 0, 224); sheen.addColorStop(0, 'rgba(255,255,255,.07)'); sheen.addColorStop(.4, 'rgba(255,255,255,0)');
      g.fillStyle = sheen; g.fillRect(0, 0, 512, 224);
      t.needsUpdate = true;
    },
  };
}
function part(parent, geo, mat, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
}
const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({color, roughness, metalness, ...extra});
// a box from its corners (in the machine's own frame)
const slab = (parent, mat, x0, x1, y0, y1, z0, z1) => part(parent, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);

export function createConverter(scene) {
  const root = new THREE.Group(); root.name = 'converter';
  // the machine's own frame: x across as you face it (right is +x), y up, z out of its front (0 is the front face)
  const at = FRAME.toWorld(MX, FRONT);
  root.position.set(at.x, 0, at.z); root.rotation.y = FRAME.yaw + Math.PI;
  scene.add(root);
  const L = x => MX - x;                         // room x to the machine's (it faces the other way)
  const cx0 = L(CH.x1), cx1 = L(CH.x0), chD = CH.z1 - FRONT, px = L(PANEL_X);   // the chamber across, its depth; the panel

  const enamelMap = enamel();
  const paint = std(0xffffff, .72, .3, {map: enamelMap, emissiveMap: enamelMap, emissive: 0xffffff, emissiveIntensity: .25});
  const trim = std(0x2a2f3a, .5, .7), steel = std(0x8a9096, .4, .85), black = std(0x0b0c0e, .55, .4);
  const lining = std(0x5a6270, .35, .55, {emissive: 0x2a3444});        // (lit from inside by its strip light)
  const pink = std(0xff5fae, .45, .2, {emissive: 0x5a0f34});

  // ---- the body, round the chamber
  const body = new THREE.Group(); root.add(body);
  const hx = MW / 2;
  slab(body, paint, -hx, cx0, 0, MH, -MD, 0);                    // the panel's column
  slab(body, paint, cx1, hx, 0, MH, -MD, 0);                     // the chamber's far side
  slab(body, paint, cx0, cx1, 0, CH.y0, -MD, 0);                 // under it
  slab(body, paint, cx0, cx1, CH.y1, MH, -MD, 0);                // over it
  slab(body, paint, cx0, cx1, CH.y0, CH.y1, -MD, -chD);          // behind it
  // the chamber's lining (a shade in from the body's faces)
  const e = .004;
  slab(body, lining, cx0, cx1, CH.y0, CH.y0 + e, -chD, 0);
  slab(body, lining, cx0, cx1, CH.y1 - e, CH.y1, -chD, 0);
  slab(body, lining, cx0, cx0 + e, CH.y0, CH.y1, -chD, 0);
  slab(body, lining, cx1 - e, cx1, CH.y0, CH.y1, -chD, 0);
  slab(body, lining, cx0, cx1, CH.y0, CH.y1, -chD, -chD + e);
  // a light strip along the chamber's ceiling, and a glowing frame round its mouth
  const glowW = new THREE.MeshBasicMaterial({color: 0xdff4ff, toneMapped: false});
  part(body, new THREE.BoxGeometry(cx1 - cx0 - .12, .012, .05), glowW, [(cx0 + cx1) / 2, CH.y1 - .012, -.12]);
  // the strip's light on the chamber's back wall, brightest under it
  const wash = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = 8; c.height = 128; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(210,235,255,.55)'); gr.addColorStop(1, 'rgba(210,235,255,.06)'); g.fillStyle = gr; g.fillRect(0, 0, 8, 128); return c; })());
  part(body, new THREE.PlaneGeometry(cx1 - cx0 - .02, CH.y1 - CH.y0 - .02), new THREE.MeshBasicMaterial({map: wash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}),
    [(cx0 + cx1) / 2, (CH.y0 + CH.y1) / 2, -chD + e + .002]).userData.noHit = true;
  const frameGlow = new THREE.MeshBasicMaterial({color: 0x52e6ff, toneMapped: false});
  for (const [x0, x1, y0, y1] of [[cx0 - .05, cx1 + .05, CH.y1, CH.y1 + .035], [cx0 - .05, cx1 + .05, CH.y0 - .035, CH.y0],
    [cx0 - .05, cx0, CH.y0, CH.y1], [cx1, cx1 + .05, CH.y0, CH.y1]]) slab(body, frameGlow, x0, x1, y0, y1, 0, .012);
  // trim: a plinth, the corners, a cap
  slab(body, black, -hx - .01, hx + .01, 0, .12, -MD, .015);
  slab(body, trim, -hx - .02, hx + .02, MH - .05, MH + .02, -MD, .02);
  for (const x of [-hx, hx]) slab(body, trim, x - .02, x + .02, .12, MH - .05, -MD, .02);
  slab(body, trim, cx0 - .1, cx0 - .06, .12, MH - .05, -.02, .015);       // between the panel and the chamber
  // the name across the top
  part(body, new THREE.PlaneGeometry(MW - .2, (MW - .2) * 160 / 1024), new THREE.MeshBasicMaterial({map: header(), toneMapped: false, color: 0xd8d8d8}),
    [0, (CH.y1 + MH) / 2 + .02, .004]);
  // vents low down, rivets, stencils
  for (let i = 0; i < 5; i++) slab(body, black, cx0 + .1, cx1 - .1, .25 + i * .08, .27 + i * .08, -.01, .006);
  part(body, new THREE.PlaneGeometry(.62, .11), new THREE.MeshBasicMaterial({map: label('CANVAS IN ▼', 512, 90, '#ffd6ec'), transparent: true, toneMapped: false}),
    [(cx0 + cx1) / 2, CH.y0 - .1, .004]);
  for (const [x, y] of [[-hx + .06, .2], [-hx + .06, MH - .12], [hx - .06, .2], [hx - .06, MH - .12], [cx0 - .2, .2], [cx0 - .2, MH - .12]])
    part(body, new THREE.CylinderGeometry(.012, .012, .01, 8), steel, [x, y, .006], [Math.PI / 2, 0, 0]);
  // a beacon on top (spins while it's working)
  const beacon = new THREE.Group(); beacon.position.set(-hx + .25, MH + .02, -.3); body.add(beacon);
  part(beacon, new THREE.CylinderGeometry(.07, .08, .04, 16), black, [0, .02, 0]);
  const beaconGlass = std(0xffa020, .2, 0, {transparent: true, opacity: .75, emissive: 0x401800});
  part(beacon, new THREE.CylinderGeometry(.055, .06, .11, 16), beaconGlass, [0, .095, 0]);
  const beaconLamp = part(beacon, new THREE.BoxGeometry(.05, .04, .02), new THREE.MeshBasicMaterial({color: 0xffc040, toneMapped: false}), [0, .095, .02]);
  // pipes from the back of the top into the wall
  for (const x of [cx0 + .25, cx1 - .25]) part(body, new THREE.CylinderGeometry(.05, .05, .5, 12), steel, [x, MH + .25, -MD + .15]);

  // ---- the shutter: rolls down from a slot over the chamber's mouth
  const shutterH = CH.y1 - CH.y0, shutterW = cx1 - cx0 + .04;
  const slatTex = slats(), SLAT = .07;
  const shutterGeo = new THREE.BoxGeometry(shutterW, 1, .02); shutterGeo.translate(0, -.5, 0);     // hangs from its top
  const shutter = part(root, shutterGeo, std(0xffffff, .4, .8, {map: slatTex, emissive: 0x111418}), [(cx0 + cx1) / 2, CH.y1, .025]);
  const bar = new THREE.Group(); root.add(bar);
  part(bar, new THREE.BoxGeometry(shutterW + .02, .06, .045), std(0xffffff, .5, .3, {map: hazard()}), [0, -.03, 0]);
  part(bar, new THREE.BoxGeometry(.12, .025, .03), black, [0, -.05, .035]);       // a handle
  bar.position.set((cx0 + cx1) / 2, CH.y1, .03);
  // the slot it comes out of
  slab(root, black, cx0 - .02, cx1 + .02, CH.y1 + .035, CH.y1 + .075, 0, .06);
  let shut = 0;                                  // 0 open, 1 down
  const setShutter = k => {
    shut = k;
    const len = Math.max(.001, shutterH * k);
    shutter.scale.y = len; shutter.visible = k > .002;
    slatTex.repeat.set(1, len / SLAT); slatTex.offset.y = -len / SLAT;
    bar.position.y = CH.y1 - len; bar.visible = k > .002;
  };
  setShutter(0);

  // ---- the panel: display, keypad, big button
  const panel = new THREE.Group(); panel.position.set(px, 0, 0); body.add(panel);     // (solid: balls and paint stop on it)
  const noPaint = o => { o.traverse(q => { q.userData.noPaint = true; }); return o; };
  slab(panel, trim, -.36, .36, DISPLAY_Y - .2, DISPLAY_Y + .2, 0, .05);                // the display's bezel
  const display = createDisplay();
  noPaint(part(panel, new THREE.PlaneGeometry(.62, .62 * 224 / 512), new THREE.MeshBasicMaterial({map: display.texture, toneMapped: false}), [0, DISPLAY_Y, .052]));
  part(panel, new THREE.PlaneGeometry(.62, .62 * 224 / 512), std(0x99aab0, .05, .2, {transparent: true, opacity: .1, depthWrite: false}), [0, DISPLAY_Y, .056]);
  // keypad: on a recessed plate, three across
  slab(panel, black, -.2, .2, KEYPAD_Y - .25, KEYPAD_Y + .25, 0, .02);
  const keys = new Map(), keyMat = std(0xffffff, .6, .05), keyGlowMat = new THREE.MeshBasicMaterial({color: 0x9fe8ff, toneMapped: false, transparent: true, opacity: .55, depthWrite: false});
  KEYS.forEach((k, i) => {
    const c = i % 3, r = Math.floor(i / 3);
    const g = new THREE.Group(); g.position.set((c - 1) * KEY_PITCH, KEYPAD_Y + (1.5 - r) * KEY_PITCH, .02); panel.add(g);
    const face = std(0xffffff, .55, .05, {map: keyFace(k), emissive: 0x161616});
    const cap = part(g, new THREE.BoxGeometry(.078, .078, .03), [keyMat, keyMat, keyMat, keyMat, face, keyMat], [0, 0, .015]);   // (the label on its front)
    const glow = part(g, new THREE.BoxGeometry(.09, .09, .036), keyGlowMat, [0, 0, .016]); glow.visible = false; glow.userData.noHit = true;
    keys.set(k, {group: g, cap, glow, press: 0});
    noPaint(g);
  });
  // the big button, in a yellow guard
  slab(panel, std(0xe0a81a, .55, .3, {emissive: 0x3a2a06}), -.17, .17, BUTTON_Y - .17, BUTTON_Y + .17, 0, .07);
  part(panel, new THREE.CylinderGeometry(.125, .135, .03, 32), black, [0, BUTTON_Y, .085], [Math.PI / 2, 0, 0]);
  const button = new THREE.Group(); button.position.set(0, BUTTON_Y, .1); panel.add(button);
  part(button, new THREE.CylinderGeometry(.065, .065, .05, 24), std(0x111111, .9, 0), [0, 0, .025], [Math.PI / 2, 0, 0]);
  const btnMat = std(0x18c25a, .3, .1, {emissive: 0x06401c});
  const btnCap = part(button, new THREE.SphereGeometry(.11, 32, 12, 0, Math.PI * 2, 0, Math.PI * .42), btnMat, [0, 0, .02], [Math.PI / 2, 0, 0]);
  btnCap.scale.set(1, .55, 1);
  part(panel, new THREE.PlaneGeometry(.4, .07), new THREE.MeshBasicMaterial({map: label('CONVERT', 256, 44, '#16140f'), transparent: true, toneMapped: false}), [0, BUTTON_Y - .21, .002]);
  const buttonGlow = glowBox(new THREE.Vector3(-.175, -.175, .0), new THREE.Vector3(.175, .175, .075),
    {x: 0, y: 0, r: .136, z0: .07, z1: .1}, {c: [0, 0, .12], r: [.111, .111, .062]});
  buttonGlow.position.set(0, BUTTON_Y, 0); panel.add(buttonGlow);
  noPaint(panel);
  part(panel, new THREE.PlaneGeometry(.5, .06), new THREE.MeshBasicMaterial({map: label('PIECE No. 1 - 111111', 512, 60, '#9fb3ff'), transparent: true, toneMapped: false}), [0, DISPLAY_Y + .25, .002]);

  root.updateMatrixWorld(true);
  // the targets the crosshair can be on
  const targets = [...[...keys].map(([k, v]) => ({k, mesh: v.cap})), {k: 'go', mesh: btnCap}];
  const ray = new THREE.Raycaster();

  // ---- what it's doing
  let entry = '', flash = null, job = null, t = 0, pressT = 0, hovered = null;
  const say = (text, color, ms = 1600) => { flash = {text, color, until: performance.now() + ms}; };
  const kindName = n => ({painting: 'PAINTING', '3d': '3D PIECE', animated: 'ANIMATED', egg: 'EGG'}[piece(n)?.kind] || '');
  function drawDisplay(now) {
    if (job) {
      const dots = '.'.repeat(1 + Math.floor(now / 300) % 3);
      display.draw(`#${job.n}`, job.phase === 'open' ? 'DONE!' : `CONVERTING${dots}`, job.phase === 'open' ? GREEN : AMBER);
      return;
    }
    if (flash && now < flash.until) { display.draw(entry ? `#${entry}` : '#', flash.text, flash.color, Math.floor(now / 400) % 2 === 0); return; }
    const n = Number(entry);
    const small = !entry ? 'ENTER A NUMBER' : validArt(n) ? kindName(n) : `1 - ${ART_MAX}`;
    display.draw(`#${entry}`, small, entry && !validArt(n) ? RED : GREEN, Math.floor(now / 500) % 2 === 0);
  }

  return {
    root, body, collider: null,
    // the keypad's entry, as the server has it (k: the key that was pressed, by someone else)
    setEntry(e, {k = null, denied = null} = {}) {
      entry = typeof e === 'string' ? e : '';
      if (k && keys.has(k)) keys.get(k).press = .15;
      if (denied) say({empty: 'INSERT A CANVAS', number: 'NO SUCH PIECE', busy: 'BUSY'}[denied] || 'ERROR', RED);
    },
    // pressed here (shown at once; the server's answer follows)
    pressKey(k) { if (k === 'go') pressT = .22; else if (keys.has(k)) keys.get(k).press = .15; },
    // the key or button under the crosshair (within `far`), or null
    aimed(origin, dir, far) {
      ray.set(origin, dir); ray.far = far;
      let best = null;
      for (const tg of targets) {
        const h = ray.intersectObject(tg.mesh, false)[0];
        if (h && (!best || h.distance < best.d)) best = {k: tg.k, d: h.distance};
      }
      return best && best.k;
    },
    highlight(k) {
      if (k === hovered) return;
      hovered = k;
      for (const [kk, v] of keys) v.glow.visible = kk === k;
      buttonGlow.visible = k === 'go';
    },
    // the server converted the painting in the chamber: down comes the shutter; `swap` puts the new picture on
    // (once it's down); `ready()` -> a promise that settles when the new picture's in; then the shutter goes up
    start(n, swap, ready) {
      job = {n, phase: 'down', t: 0, swap, ready, loaded: false};
      pressT = Math.max(pressT, .01);
    },
    // a painting under the shutter can't be taken out yet
    get busy() { return !!job && job.phase !== 'open'; },
    get shut() { return shut; },
    update(dt) {
      t += dt;
      const now = performance.now();
      pressT = Math.max(0, pressT - dt);
      button.position.z = .1 - .03 * Math.sin(Math.min(1, pressT / .22) * Math.PI);
      for (const v of keys.values()) { v.press = Math.max(0, v.press - dt); v.group.position.z = .02 - .012 * Math.sin(Math.min(1, v.press / .15) * Math.PI); }
      if (job) {
        job.t += dt * 1000;
        if (job.phase === 'down') {
          setShutter(Math.min(1, job.t / HATCH_MS));
          if (job.t >= HATCH_MS) {
            job.phase = 'wait'; job.t = 0;
            try { job.swap?.(); } catch (e) { console.warn('converter:', e); }
            Promise.resolve(job.ready?.()).catch(() => {}).finally(() => { if (job) job.loaded = true; });
          }
        } else if (job.phase === 'wait') {
          if ((job.loaded && job.t > 1400) || job.t > 12000) { job.phase = 'up'; job.t = 0; }
        } else if (job.phase === 'up') {
          setShutter(Math.max(0, 1 - job.t / HATCH_MS));
          if (job.t >= HATCH_MS) { job.phase = 'open'; job.t = 0; }
        } else if (job.phase === 'open' && job.t > 2200) job = null;
        beacon.rotation.y += dt * 9;
      }
      beaconLamp.visible = !!job && job.phase !== 'open' ? Math.sin(t * 18) > -.3 : false;
      beaconGlass.emissive.setHex(job && job.phase !== 'open' ? 0xb05000 : 0x401800);
      frameGlow.color.setHex(job && job.phase !== 'open' ? (Math.sin(t * 10) > 0 ? 0xff5fae : 0x52e6ff) : 0x52e6ff);
      drawDisplay(now);
    },
    // what happens next, for sounds: the phase the shutter's in
    get phase() { return job ? job.phase : null; },
  };
}

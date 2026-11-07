// The lap timer: a machine set into the tunnel wall just round from the start room. A wide
// seven-segment clock, a one-digit lap counter beside it, a big red button under them and a
// security camera on top. The server runs the race; this draws it and works the button.
import * as THREE from 'three';
import {MACHINE_ANGLE, MACHINE_BASE, loopPoint} from './race.js';
import {glowBox} from './items.js';

const SLOPE = .12;                       // the front leans back a little with the wall's curve
const HEIGHT = 2.4, WIDTH = 1.56;
const AMBER = '#ffb020', RED = '#ff2d1e', GREEN = '#5dff86';

// ------------------------------------------------------------------ textures
function canvasTexture(w, h, draw, repeat = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// worn olive enamel: mottled, chipped to primer and steel, rust weeping from the seams
function enamel() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#596150'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) {                       // mottling
      const v = rnd(); g.fillStyle = `rgba(${v < .5 ? '30,34,26' : '140,146,120'},${.05 + rnd() * .06})`;
      const r = 2 + rnd() * 14; g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, 7); g.fill();
    }
    for (let i = 0; i < 70; i++) {                         // chips: primer red-brown with a steel core
      const x = rnd() * w, y = rnd() * h, r = 1.5 + rnd() * 5;
      g.fillStyle = '#6b4a36'; g.beginPath(); g.ellipse(x, y, r * 1.6, r, rnd() * 3, 0, 7); g.fill();
      g.fillStyle = '#9a9a92'; g.beginPath(); g.ellipse(x, y, r * .7, r * .45, rnd() * 3, 0, 7); g.fill();
    }
    for (let i = 0; i < 26; i++) {                         // rust streaks running down
      const x = rnd() * w, y = rnd() * h * .7, len = 40 + rnd() * 160;
      const grad = g.createLinearGradient(x, y, x, y + len);
      grad.addColorStop(0, 'rgba(120,64,28,.55)'); grad.addColorStop(1, 'rgba(120,64,28,0)');
      g.fillStyle = grad; g.fillRect(x, y, 2 + rnd() * 4, len);
    }
    const edge = g.createLinearGradient(0, 0, 0, h);       // grime settles at the bottom
    edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(.75, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(20,16,10,.5)');
    g.fillStyle = edge; g.fillRect(0, 0, w, h);
  });
}
function hazard() {
  return canvasTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#d9a514'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16140f';
    for (let x = -h; x < w + h; x += 64) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 32, h); g.lineTo(x + 32 + h, 0); g.lineTo(x + h, 0); g.fill(); }
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(30,24,16,${rnd() * .35})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 6, 1 + rnd() * 3); }
  });
}
// ------------------------------------------------------------ seven segments
// segments a-g as hexagons in a unit cell (0..1 wide, 0..2 tall), drawn with a slight italic lean
const SEGS = {a: [.12, 0, .76, 0], b: [.88, .12, .88, .88], c: [.88, 1.12, .88, 1.88], d: [.12, 2, .76, 2],
  e: [0, 1.12, 0, 1.88], f: [0, .12, 0, .88], g: [.12, 1, .76, 1]};
const DIGITS = {0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': ''};
function drawDigit(g, ch, x, y, s, color, ghost) {
  const on = DIGITS[ch] ?? '', t = .13;                     // segment thickness (cell units)
  for (const [name, [x0, y0, x1, y1]] of Object.entries(SEGS)) {
    const horiz = y0 === y1;
    const lean = yy => (2 - yy) * .09;                      // italic
    const P = (px, py) => [x + (px + lean(py)) * s, y + py * s];
    const pts = horiz
      ? [P(x0, y0), P(x0 + t, y0 - t), P(x1 + .12 - t, y0 - t), P(x1 + .12, y0), P(x1 + .12 - t, y0 + t), P(x0 + t, y0 + t)]
      : [P(x0, y0), P(x0 + t, y0 + t), P(x1 + t, y1 - t), P(x1, y1), P(x1 - t, y1 - t), P(x0 - t, y0 + t)];
    const lit = on.includes(name);
    g.fillStyle = lit ? color : ghost;
    g.shadowColor = lit ? color : 'transparent'; g.shadowBlur = lit ? s * .22 : 0;
    g.beginPath(); pts.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py)); g.closePath(); g.fill();
  }
}
function createReadout(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  let last = '';
  return {
    texture: t,
    // text: digits, ':' and '.'; color: lit segment colour; visible false blanks the lit segments
    draw(text, color, visible = true) {
      const key = `${text}|${color}|${visible}`;
      if (key === last) return;
      last = key;
      const g = c.getContext('2d');
      g.fillStyle = '#060807'; g.fillRect(0, 0, w, h);
      const ghost = color === RED ? 'rgba(255,45,30,.07)' : color === GREEN ? 'rgba(93,255,134,.06)' : 'rgba(255,176,32,.07)';
      const s = h * .36, y = (h - 2 * s) / 2;
      const digits = text.replace(/[:.]/g, '').length, seps = text.length - digits;
      let x = (w - (digits * s * 1.42 + seps * s * .5)) / 2;
      for (const ch of text) {
        if (ch === ':' || ch === '.') {
          g.fillStyle = visible ? color : ghost; g.shadowColor = visible ? color : 'transparent'; g.shadowBlur = visible ? s * .2 : 0;
          const dots = ch === ':' ? [.62, 1.42] : [1.86];
          for (const dy of dots) { g.beginPath(); g.arc(x + s * .18 + (2 - dy) * .09 * s, y + dy * s, s * .085, 0, 7); g.fill(); }
          x += s * .5; continue;
        }
        drawDigit(g, ch, x, y, s, visible ? color : ghost, ghost);
        x += s * 1.42;
      }
      g.shadowBlur = 0;
      // glass: a soft sheen across the top
      const sheen = g.createLinearGradient(0, 0, 0, h);
      sheen.addColorStop(0, 'rgba(255,255,255,.06)'); sheen.addColorStop(.35, 'rgba(255,255,255,0)');
      g.fillStyle = sheen; g.fillRect(0, 0, w, h);
      t.needsUpdate = true;
    },
  };
}

// ----------------------------------------------------------------- the model
function part(parent, geo, mat, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
}
const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({color, roughness, metalness, ...extra});

export function createMachine(scene) {
  const root = new THREE.Group(); root.name = 'lap-timer';
  const base = loopPoint(MACHINE_ANGLE, MACHINE_BASE);
  root.position.set(base.x, 0, base.z);
  root.rotation.y = Math.atan2(-Math.cos(MACHINE_ANGLE), Math.sin(MACHINE_ANGLE));   // local +z faces the tunnel
  scene.add(root);

  // runtime objects only get the few dynamic lights, so the paint carries a little of the tunnel's
  // baked light itself (emissive from its own texture) to sit at the same brightness as the walls
  const enamelMap = enamel();
  enamelMap.wrapS = enamelMap.wrapT = THREE.RepeatWrapping;
  const paint = std(0xffffff, .78, .35, {map: enamelMap, emissiveMap: enamelMap, emissive: 0xffffff, emissiveIntensity: .32});
  const steel = std(0x5e6266, .45, .85), dark = std(0x1c1e20, .6, .6), black = std(0x0a0b0b, .5, .4);
  const yellow = std(0xe0a81a, .55, .3, {emissive: 0x3a2a06}), red = std(0xc4140f, .3, .1, {emissive: 0x5a0703});
  const rubber = std(0x111111, .9, 0);

  // housing: a slab whose front leans back with the wall; its back is buried in the lining
  const side = new THREE.Shape();
  side.moveTo(0, 0); side.lineTo(-SLOPE * HEIGHT, HEIGHT); side.lineTo(-1.15, HEIGHT); side.lineTo(-1.15, 0); side.closePath();
  const housing = new THREE.ExtrudeGeometry(side, {depth: WIDTH - .04, bevelEnabled: true, bevelThickness: .02, bevelSize: .02, bevelOffset: -.02, bevelSegments: 2});
  housing.translate(0, 0, -(WIDTH - .04) / 2); housing.rotateY(-Math.PI / 2);    // shape x -> local z, extrusion -> local x
  // map the paint by world size, projected along each face's own axis, so nothing stretches
  const pos = housing.attributes.position, uv = housing.attributes.uv;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k), y = pos.getY(i + k), z = pos.getZ(i + k);
      if (Math.abs(n.y) > .7) uv.setXY(i + k, x * .6, z * .6);                 // top and bottom
      else if (Math.abs(n.x) > .7) uv.setXY(i + k, z * .6, y * .6);            // sides
      else uv.setXY(i + k, x * .6, Math.hypot(y, z) * Math.sign(y || 1) * .6);  // the leaning front
    }
  }
  part(root, housing, paint);

  // the front: everything on it is laid out in its own leaning plane (u across, v up the slope, w out)
  const face = new THREE.Group();
  face.rotation.x = -Math.atan(SLOPE);
  root.add(face);
  const F = (geo, mat, u, v, w, rot) => part(face, geo, mat, [u, v, w], rot);
  const slant = HEIGHT * Math.hypot(1, SLOPE);

  // hood over the display, kick plate with hazard stripes, side rails
  F(new THREE.BoxGeometry(WIDTH + .06, .07, .2), paint, 0, slant - .05, .07);
  F(new THREE.BoxGeometry(WIDTH - .04, .3, .012), std(0xffffff, .6, .2, {map: hazard()}), 0, .17, .007);
  for (const u of [-1, 1]) F(new THREE.BoxGeometry(.05, slant - .4, .035), dark, u * (WIDTH / 2 - .045), slant / 2 + .12, .017);

  // display bezel with the timer window and the lap window beside it
  const bezel = F(new THREE.BoxGeometry(1.42, .62, .06), dark, 0, 1.9, .03);
  bezel.userData.noHit = false;
  // (the display, the control plate and the button take no paint: they stay readable and pushable)
  const noPaint = (...ms) => { for (const m of ms) m.traverse(o => { o.userData.noPaint = true; }); return ms[0]; };
  noPaint(bezel);
  const timer = createReadout(1024, 256), laps = createReadout(256, 256);
  const screenMat = tex => new THREE.MeshBasicMaterial({map: tex, toneMapped: false});
  noPaint(F(new THREE.PlaneGeometry(.96, .36), screenMat(timer.texture), -.17, 1.88, .0605), F(new THREE.PlaneGeometry(.26, .36), screenMat(laps.texture), .52, 1.88, .0605));
  // glass over both, a touch reflective
  const glass = std(0x99aab0, .06, .2, {transparent: true, opacity: .12, depthWrite: false});
  F(new THREE.PlaneGeometry(.96, .36), glass, -.17, 1.88, .064);
  F(new THREE.PlaneGeometry(.26, .36), glass, .52, 1.88, .064);
  noPaint(F(new THREE.BoxGeometry(.035, .5, .065), black, .355, 1.9, .033));           // divider
  // power and status lamps
  const lamp = (color, u) => noPaint(F(new THREE.CylinderGeometry(.012, .012, .01, 12), new THREE.MeshBasicMaterial({color, toneMapped: false}), u, 1.63, .062, [Math.PI / 2, 0, 0]));
  lamp(0x47ff6a, -.6); const runLamp = lamp(0xff3020, -.55);
  for (const [u, v] of [[-.68, 2.18], [.68, 2.18], [-.68, 1.62], [.68, 1.62]]) noPaint(F(new THREE.CylinderGeometry(.011, .011, .012, 8), steel, u, v, .066, [Math.PI / 2, 0, 0]));

  // control plate, the button in its yellow guard, and the stencils
  const plate = F(new THREE.BoxGeometry(.9, .62, .03), dark, 0, 1.03, .015);   // the whole plate is the push target
  noPaint(plate);
  for (const [u, v] of [[-.42, 1.3], [.42, 1.3], [-.42, .76], [.42, .76]]) noPaint(F(new THREE.CylinderGeometry(.012, .012, .014, 8), steel, u, v, .036, [Math.PI / 2, 0, 0]));
  noPaint(F(new THREE.BoxGeometry(.32, .32, .07), yellow, 0, 1.07, .065));
  noPaint(F(new THREE.CylinderGeometry(.115, .125, .03, 32), black, 0, 1.07, .112, [Math.PI / 2, 0, 0]));            // collar
  const button = new THREE.Group(); button.position.set(0, 1.07, .127); face.add(button);
  part(button, new THREE.CylinderGeometry(.06, .06, .05, 24), rubber, [0, 0, .025], [Math.PI / 2, 0, 0]);  // stem
  const capGeo = new THREE.SphereGeometry(.1, 32, 12, 0, Math.PI * 2, 0, Math.PI * .42);
  const cap = part(button, capGeo, red, [0, 0, .02], [Math.PI / 2, 0, 0]);
  cap.scale.set(1, .55, 1);
  noPaint(button);
  // the glow: round the yellow guard, the black collar and the red cap together, fitted to each, from any angle
  // (the cap: a sphere of 0.1 squashed to 0.055 deep, its middle 0.147 out from the face)
  const buttonGlow = glowBox(new THREE.Vector3(-.162, -.162, .028), new THREE.Vector3(.162, .162, .102),
    {x: 0, y: 0, r: .126, z0: .095, z1: .128}, {c: [0, 0, .147], r: [.101, .101, .057]});
  buttonGlow.position.set(0, 1.07, 0); face.add(buttonGlow);

  // a caged work lamp on the hood, lighting the front
  const lampMat = new THREE.MeshBasicMaterial({color: 0xffe2a8, toneMapped: false});
  F(new THREE.CylinderGeometry(.04, .05, .1, 16), lampMat, .45, slant + .04, .13, [Math.PI / 2 - .5, 0, 0]);
  for (let i = 0; i < 4; i++) F(new THREE.TorusGeometry(.055, .004, 4, 16), dark, .45, slant + .04 + Math.sin(.5) * (i * .03 - .045), .13 + i * .028, [Math.PI / 2 - .5, 0, 0]);
  F(new THREE.BoxGeometry(.06, .04, .1), dark, .45, slant + .02, .05);
  const glowLight = new THREE.SpotLight(0xffd8a0, 6, 3.2, .9, .7, 1.4);
  glowLight.position.set(.45, slant + .05, .2); face.add(glowLight);
  glowLight.target.position.set(0, 1.2, .9); face.add(glowLight.target);

  // vents low on the front
  for (let i = 0; i < 6; i++) F(new THREE.BoxGeometry(.7, .018, .02), black, 0, .42 + i * .045, .01);

  // conduit from the top back into the lining
  part(root, new THREE.CylinderGeometry(.045, .045, .75, 14), steel, [.5, 2.75, -.78]);
  part(root, new THREE.CylinderGeometry(.06, .06, .05, 14), dark, [.5, 2.42, -.78]);

  // security camera on a bracket at the top corner, looking out over the tunnel
  const cam = new THREE.Group(); cam.position.set(-.6, HEIGHT + .02, -SLOPE * HEIGHT - .07); root.add(cam);
  part(cam, new THREE.BoxGeometry(.08, .03, .08), dark);
  part(cam, new THREE.CylinderGeometry(.015, .015, .16, 10), steel, [0, .09, 0]);
  const head = new THREE.Group(); head.position.set(0, .18, 0); head.rotation.set(.3, .3, 0, 'YXZ'); cam.add(head);
  part(head, new THREE.BoxGeometry(.11, .1, .24), std(0xd9d6cc, .5, .2), [0, 0, .06]);
  part(head, new THREE.BoxGeometry(.13, .02, .28), dark, [0, .06, .07]);                       // sun hood
  part(head, new THREE.CylinderGeometry(.035, .04, .04, 20), black, [0, 0, .19], [Math.PI / 2, 0, 0]);
  part(head, new THREE.CircleGeometry(.028, 20), new THREE.MeshStandardMaterial({color: 0x10161c, roughness: .05, metalness: .9}), [0, 0, .211]);
  const led = part(head, new THREE.SphereGeometry(.007, 8, 6), new THREE.MeshBasicMaterial({color: 0xff2020, toneMapped: false}), [.04, -.03, .185]);

  // ---------------------------------------------------------------- state
  let race = null, clockOffset = 0, pressT = 0, t = 0;
  const fmt = ms => {
    ms = Math.max(0, Math.min(ms, 99 * 60000 + 59999));
    const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, c = Math.floor(ms / 10) % 100;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
  };
  // a time that reads all ones once the leading zeros are gone (00:00.11, 00:01.11, 11:11.11...)
  const allOnes = ms => /^1+$/.test(fmt(ms).replace(/[^0-9]/g, '').replace(/^0+/, ''));
  // ...celebrates: a quick blink for a few seconds before it settles
  const ones = since => since > 4200 || Math.floor(since / 160) % 2 === 0;
  const buttonBox = new THREE.Box3(), ray = new THREE.Ray();
  return {
    root, button,
    // a new race state from the server (its clock comes along so we can keep counting)
    setRace(r) { race = r; clockOffset = r.now - performance.now(); },
    press() { pressT = .22; },
    highlight(on) { buttonGlow.visible = on; },
    // is this camera ray on the button (close enough to reach)?
    aimed(origin, dir, far = 3.6) {
      buttonBox.setFromObject(plate).expandByScalar(.03);
      ray.set(origin, dir);
      const hit = ray.intersectBox(buttonBox, new THREE.Vector3());
      return hit && hit.distanceTo(origin) < far ? hit.distanceTo(origin) : null;
    },
    update(dt) {
      t += dt;
      led.visible = Math.sin(t * 3.2) > -.2;
      // the button sinks when pushed and springs back
      pressT = Math.max(0, pressT - dt);
      button.position.z = .127 - .03 * Math.sin(Math.min(1, pressT / .22) * Math.PI);
      const r = race || {state: 'idle'};
      const serverNow = performance.now() + clockOffset;
      runLamp.visible = r.state === 'running' && Math.sin(t * 6) > 0;
      if (r.state === 'running') {
        timer.draw(fmt(serverNow - r.startedAt), AMBER); laps.draw(String(r.laps), AMBER);
      } else if (r.state === 'done') {
        // the final time blinks a few times, then stays
        const since = serverNow - r.endedAt;
        const on = allOnes(r.time) ? ones(since) : since > 2400 || Math.floor(since / 300) % 2 === 0;
        timer.draw(fmt(r.time), GREEN, on); laps.draw('0', GREEN, on);
      } else if (r.state === 'cancelled') {
        const on = !allOnes(r.time) || r.endedAt === undefined || ones(serverNow - r.endedAt);
        timer.draw(fmt(r.time), RED, on); laps.draw(String(r.laps), RED, on);
      } else { timer.draw('00:00.00', AMBER); laps.draw('-', AMBER); }
    },
  };
}

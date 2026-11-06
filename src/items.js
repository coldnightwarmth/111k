// Held items: flashlights, the paintball marker and spray cans. The server owns
// who holds what and where things lie; this module draws them on the ground,
// in other players' hands and in your own view, and feeds torch beams to the
// level shader.
import * as THREE from 'three';
import {lighting, MAX_FLASHLIGHTS, MAX_SPOTLIGHTS, FAN, FAN_TAN, FAN_RANGE, flashlightReach, beamFrame} from './level.js';
import {EYE_HEIGHT} from './motion.js';
import {PAINT_COLORS, RANDOM_PAINT} from './decals.js';

const BEAM_COLOR = new THREE.Color(1, .93, .8);
export const ITEM_NAMES = {flashlight: 'flashlight', paintball: 'paintball marker', spray: 'spray can'};

const std = (color, roughness = .55, metalness = .2, extra = {}) => new THREE.MeshStandardMaterial({color, roughness, metalness, ...extra});
function part(g, geo, mat, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
}

// A chunky rubberised torch, 26 cm, pointing down its local -z.
function flashlightModel() {
  const g = new THREE.Group();
  const body = std(0x1c1d20, .55, .3), metal = std(0x8a8d92, .35, .8);
  const lens = new THREE.MeshBasicMaterial({color: 0x333333, toneMapped: false});
  const X = [Math.PI / 2, 0, 0];
  part(g, new THREE.CylinderGeometry(.021, .021, .18, 12), body, [0, 0, .03], X);
  part(g, new THREE.CylinderGeometry(.034, .023, .06, 14), body, [0, 0, -.09], X);
  part(g, new THREE.CylinderGeometry(.036, .036, .012, 14), metal, [0, 0, -.125], X);
  for (let i = 0; i < 6; i++) part(g, new THREE.TorusGeometry(.0215, .0025, 4, 12), body, [0, 0, .1 - i * .018]);   // grip rings
  part(g, new THREE.CircleGeometry(.03, 14), lens, [0, 0, -.1315], [Math.PI, 0, 0]);
  part(g, new THREE.BoxGeometry(.012, .008, .02), metal, [0, .022, -.01]);
  part(g, new THREE.TorusGeometry(.012, .003, 4, 10), metal, [0, 0, .125]);                                         // lanyard loop
  g.userData = {lens, tip: new THREE.Vector3(0, 0, -.14), ground: .034, groundRoll: Math.PI / 2};
  return g;
}

// ----------------------------------------------------------------- the marker
// Shapes drawn side-on (z forward/back, y up) and extruded across x, bevelled.
function sideExtrude(points, width, bevel = .003, curveSegments = 6) {
  const shape = new THREE.Shape();
  points.forEach(([z, y, cz, cy], i) => {
    if (i === 0) shape.moveTo(z, y);
    else if (cz !== undefined) shape.quadraticCurveTo(cz, cy, z, y);
    else shape.lineTo(z, y);
  });
  const geo = new THREE.ExtrudeGeometry(shape, {depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel,
    bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments});
  geo.translate(0, 0, -(width - 2 * bevel) / 2);
  geo.rotateY(-Math.PI / 2);          // shape x -> world z, extrusion -> world x
  geo.computeVertexNormals();
  return geo;
}
// A solid of revolution around the z axis from (radius, z) pairs.
function lathe(profile, segments = 24) {
  if (profile.at(-1)[1] < profile[0][1]) profile = [...profile].reverse();   // faces point outward when z runs back to front
  const geo = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  geo.rotateX(Math.PI / 2);           // lathe y -> world z
  return geo;
}
// knurled / ribbed bands around a z-axis part
function rings(g, mat, r, z0, z1, n, y = 0, tube = .0016) {
  for (let i = 0; i < n; i++) part(g, new THREE.TorusGeometry(r, tube, 5, 20), mat, [0, y, z0 + (z1 - z0) * (i + .5) / n]);
}

// A modern speedball marker, muzzle down its local -z, ~63 cm from muzzle to tank end.
// The hopper's balls show the loaded paint (setPaint).
function paintballModel() {
  const g = new THREE.Group();
  const X = [Math.PI / 2, 0, 0];
  const ano = std(0x1b1d22, .32, .75);                      // black anodised aluminium
  const accent = std(0xd8265f, .3, .7, {emissive: 0x1a0008});  // pink anodised parts
  const steel = std(0xb8bdc4, .22, .95), dark = std(0x0b0b0c, .6, .3);
  const rubber = std(0x151515, .92, 0), cover = std(0x23262b, .85, .05);
  const smoke = std(0x2a3540, .08, 0, {transparent: true, opacity: .42, depthWrite: false, side: THREE.DoubleSide});
  const glass = std(0xf2f0e6, .2, 0), needle = std(0xd02020, .4, .2);

  // body: rounded back, flat top, raked front
  part(g, sideExtrude([[.1, -.03], [.1, .016], [.08, .037, .1, .037], [-.095, .037], [-.12, .028, -.12, .037],
    [-.12, -.008], [-.1, -.03, -.12, -.03], [.1, -.03]], .036, .004), ano);
  part(g, sideExtrude([[.08, .037], [-.09, .037], [-.09, .041], [.08, .041]], .02, .0015), accent);       // top strip
  part(g, sideExtrude([[.098, -.02], [.098, .012], [.086, .024, .098, .024], [.06, .024], [.06, -.02]], .0372, .0015), accent);   // back cap
  for (const x of [-1, 1]) {
    part(g, new THREE.CircleGeometry(.011, 20), accent, [x * .0186, .006, .03], [0, x * Math.PI / 2, 0]);  // eye covers
    part(g, new THREE.CircleGeometry(.0065, 16), dark, [x * .0188, .006, .03], [0, x * Math.PI / 2, 0]);
    for (const [z, y] of [[-.1, .02], [-.1, -.018], [.055, .028], [.055, -.022]])                         // screws
      part(g, new THREE.CylinderGeometry(.0028, .0028, .002, 10), steel, [x * .0186, y, z], [0, 0, Math.PI / 2]);
    for (let i = 0; i < 5; i++)                                                                           // milled slots
      part(g, new THREE.BoxGeometry(.001, .006, .022), dark, [x * .0182, -.016, -.07 + i * .016]);
  }
  // barrel: a ribbed back, a slim ported front, an open bore
  part(g, lathe([[0, .0], [.019, 0], [.019, -.012], [.0175, -.016], [.0175, -.07], [.0185, -.075], [.0185, -.085], [.0165, -.09], [0, -.09]]),
    steel, [0, .012, -.115]);
  rings(g, ano, .0177, -.135, -.18, 6, .012, .0013);
  part(g, lathe([[0, 0], [.0158, 0], [.0152, -.2], [.0168, -.204], [.0168, -.222], [.0118, -.224], [.0118, -.02], [0, -.02]], 28),
    ano, [0, .012, -.205]);
  for (let i = 0; i < 12; i++) {                                                                          // porting: a spiral of holes
    const a = i * 2.1, z = -.33 - i * .007;
    part(g, new THREE.CylinderGeometry(.0025, .0025, .004, 8), dark, [Math.cos(a) * .0152, .012 + Math.sin(a) * .0152, z], [0, 0, a + Math.PI / 2]);
  }
  part(g, new THREE.CircleGeometry(.0117, 20), dark, [0, .012, -.4275], [Math.PI, 0, 0]);                  // bore

  // grip frame with wraparound rubber, trigger guard and blade
  const gripPts = [[.022, -.029], [.034, -.128, .02, -.11], [.09, -.13, .062, -.142], [.09, -.12], [.072, -.029]];
  part(g, sideExtrude(gripPts, .028, .003), ano);
  part(g, sideExtrude([[.03, -.04], [.039, -.118, .03, -.105], [.08, -.122, .06, -.13], [.07, -.04]], .0335, .004), rubber);
  for (let i = 0; i < 6; i++) part(g, new THREE.BoxGeometry(.035, .0025, .006), dark, [0, -.055 - i * .012, .068 - i * .0015]);   // stippling ribs
  const guard = new THREE.CatmullRomCurve3([[0, -.03, .02], [0, -.07, .016], [0, -.078, -.01], [0, -.073, -.04], [0, -.03, -.05]].map(p => new THREE.Vector3(...p)));
  part(g, new THREE.TubeGeometry(guard, 24, .0042, 8, false), ano);
  part(g, sideExtrude([[-.004, -.03], [.004, -.03], [.006, -.05, .009, -.04], [-.001, -.064, .006, -.06], [-.006, -.06], [-.001, -.05, -.002, -.056], [-.004, -.03]], .008, .0015, 8), steel);
  // foregrip with the air source adapter under it
  part(g, sideExtrude([[-.05, -.029], [-.052, -.118], [-.06, -.128, -.052, -.128], [-.082, -.128], [-.09, -.118, -.09, -.128], [-.092, -.029]], .03, .003), ano);
  for (let i = 0; i < 4; i++) part(g, new THREE.BoxGeometry(.031, .0045, .028), rubber, [0, -.05 - i * .018, -.071]);
  const ty = -.172;
  part(g, new THREE.CylinderGeometry(.015, .015, .022, 18), steel, [0, -.138, -.066]);                     // ASA
  part(g, new THREE.CylinderGeometry(.007, .007, .02, 10), accent, [.017, -.137, -.066], [0, 0, Math.PI / 2]);   // on/off knob
  // the tank runs back under the grip as a stock: regulator, gauge, bottle, cover
  part(g, lathe([[0, -.088], [.022, -.088], [.026, -.083], [.026, -.04], [.022, -.036], [.022, -.025], [0, -.025]]), steel, [0, ty, 0]);
  rings(g, dark, .0262, -.078, -.05, 5, ty, .0011);
  part(g, new THREE.CylinderGeometry(.011, .011, .012, 20), steel, [.03, ty, -.06], [0, 0, Math.PI / 2]);   // gauge
  part(g, new THREE.CircleGeometry(.0092, 20), glass, [.0362, ty, -.06], [0, Math.PI / 2, 0]);
  part(g, new THREE.BoxGeometry(.0006, .007, .0012), needle, [.0366, ty + .002, -.06], [.6, 0, 0]);
  part(g, lathe([[0, -.028], [.03, -.028], [.034, -.016], [.035, .004], [.035, .19], [.03, .218], [.018, .232], [0, .236]], 28), steel, [0, ty, 0]);
  part(g, lathe([[.0362, .006], [.0362, .186]], 28), cover, [0, ty, 0]);
  part(g, new THREE.CylinderGeometry(.0366, .0366, .012, 28, 1, true), accent, [0, ty, .168], X);          // cover stripes
  part(g, new THREE.CylinderGeometry(.0366, .0366, .006, 28, 1, true), accent, [0, ty, .03], X);
  // macroline from the ASA up into the front of the body
  const hose = new THREE.CatmullRomCurve3([[0, -.125, -.08], [.0, -.11, -.11], [0, -.05, -.118], [0, -.015, -.112]].map(p => new THREE.Vector3(...p)));
  part(g, new THREE.TubeGeometry(hose, 20, .0034, 8, false), dark);
  // feed neck with a clamp, and the pod hopper on top
  part(g, new THREE.CylinderGeometry(.0165, .0175, .03, 20), ano, [0, .052, -.02]);
  part(g, new THREE.CylinderGeometry(.0195, .0195, .012, 20), accent, [0, .058, -.02]);
  part(g, new THREE.BoxGeometry(.006, .006, .022), steel, [.022, .058, -.02]);                           // clamp lever
  const shell = part(g, new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, Math.PI * .34, Math.PI * .66), smoke, [0, .118, .005]);
  shell.scale.set(.052, .054, .098); shell.renderOrder = 2;
  const lid = part(g, new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI * .36), ano, [0, .118, .005]);
  lid.scale.set(.0525, .0545, .0985);
  part(g, new THREE.TorusGeometry(1, .03, 6, 32), accent, [0, .118 + .054 * Math.cos(Math.PI * .36), .005], [Math.PI / 2, 0, 0])
    .scale.set(.052 * Math.sin(Math.PI * .36), .098 * Math.sin(Math.PI * .36), .1);
  part(g, new THREE.BoxGeometry(.018, .006, .03), accent, [0, .174, -.03], [-.15, 0, 0]);                  // lid latch
  // the paint inside: balls settled into the bottom of the pod
  const balls = [], ballGeo = new THREE.SphereGeometry(.0087, 12, 8);
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 11; i++) {
    const a = i / 11 * Math.PI * 2 + layer * .5, rr = layer === 2 ? .45 : .72;
    const b = part(g, ballGeo, std(0xffffff, .25, 0, {emissive: 0x000000}),
      [Math.cos(a) * .052 * rr * .78, .085 + layer * .016, .005 + Math.sin(a) * .098 * rr * .8]);
    b.renderOrder = 1; balls.push(b);
  }
  let shown = null;
  const setPaint = (color, palette) => {
    if (color === shown) return;
    shown = color;
    balls.forEach((b, i) => b.material.color.setHex(color < 0 ? palette[(i * 7 + 3) % palette.length] : color));
  };
  g.userData = {tip: new THREE.Vector3(0, .012, -.428), ground: .052, groundRoll: Math.PI / 2, setPaint};
  return g;
}

const CAN_COLORS = [0xe8322f, 0x2b6cf0, 0xf2c614, 0x22b45a, 0xf06bc6, 0x111111, 0xf4f1e8, 0xff7a1a, 0x8a4df0, 0x19c2c2];
// A spray can standing on its base (+y up), nozzle facing -z.
function sprayModel(id) {
  const g = new THREE.Group();
  const n = [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  const col = CAN_COLORS[n % CAN_COLORS.length], cap = CAN_COLORS[(n * 7 + 3) % CAN_COLORS.length];
  const body = std(col, .35, .55), label = std(0xf1ede2, .7, 0), metal = std(0xb9bec6, .3, .9), capM = std(cap, .4, .1);
  part(g, new THREE.CylinderGeometry(.033, .033, .17, 20), body, [0, .087, 0]);
  part(g, new THREE.CylinderGeometry(.0335, .0335, .06, 20), label, [0, .075, 0]);
  part(g, new THREE.CylinderGeometry(.026, .033, .02, 20), metal, [0, .182, 0]);     // shoulder
  part(g, new THREE.CylinderGeometry(.033, .031, .006, 20), metal, [0, .003, 0]);    // base rim
  part(g, new THREE.CylinderGeometry(.012, .014, .018, 12), capM, [0, .2, 0]);        // actuator
  part(g, new THREE.CylinderGeometry(.003, .003, .006, 6), metal, [0, .203, -.013], [Math.PI / 2, 0, 0]);  // nozzle
  g.userData = {tip: new THREE.Vector3(0, .203, -.02), ground: .033, groundRoll: Math.PI / 2, upright: true};
  return g;
}

const MODELS = {flashlight: flashlightModel, paintball: paintballModel, spray: sprayModel};
export const ITEM_MODELS = MODELS;   // for previews

// ------------------------------------------------------------------- falling
// A dropped item's fall through the level: gravity, a couple of soft bounces, a skid to a stop.
// Pure and fixed-step, so every client works out the same path from the same start.
const FALL_DT = 1 / 60;
export function simulateFall(hits, start, velocity) {
  const p = new THREE.Vector3(...start), v = new THREE.Vector3(...velocity), path = [p.clone()];
  const step = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let i = 0; i < 240; i++) {
    v.y -= 9.8 * FALL_DT;
    step.copy(v).multiplyScalar(FALL_DT);
    const len = step.length();
    const h = len > 1e-6 ? hits.raycast(p, dir.copy(step).divideScalar(len), len + .02) : null;
    if (h) {
      const n = h.normal, vn = v.dot(n);
      p.copy(h.point).addScaledVector(n, .005);
      if (n.y > .7 && -vn < 1.1) { p.y = h.point.y; path.push(p.clone()); return {path, rest: p}; }   // settled
      v.addScaledVector(n, -1.35 * vn);                 // bounce, losing most of the speed into the surface
      v.multiplyScalar(.62);                            // and scraping along it
    } else p.add(step);
    path.push(p.clone());
    if (p.y < -1) break;
  }
  p.y = Math.max(p.y, 0);
  return {path, rest: p};
}

// A soft yellow glow round whatever you can pick up: the model's surfaces pushed out a few
// millimetres (in view space, so scaled parts get the same rim) and drawn back-faces only.
const glowTime = {value: 0};
function outlineMaterial(width, opacity) {
  const m = new THREE.MeshBasicMaterial({color: new THREE.Color(1, .82, .18), side: THREE.BackSide, transparent: true,
    opacity, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending});
  m.onBeforeCompile = sh => {
    sh.uniforms.glowTime = glowTime;
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec3 outN = normalize(normalMatrix * normal);
      mvPosition.xyz += outN * ${width.toFixed(4)} * (1.0 + 0.002 * -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float glowTime;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
      gl_FragColor.a *= 0.75 + 0.25 * sin(glowTime * 5.0);`);
  };
  m.customProgramCacheKey = () => `outline-${width}`;
  return m;
}
const OUTLINES = [outlineMaterial(.007, 1), outlineMaterial(.016, .35)];
function addOutline(model) {
  const shells = new THREE.Group(); shells.visible = false;
  const meshes = [];
  model.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) for (const mat of OUTLINES) {
    const shell = new THREE.Mesh(o.geometry, mat);
    o.updateMatrix(); shell.matrixAutoUpdate = false;
    // the part's transform relative to the model, so the shell sits on it wherever the model goes
    shell.matrix.copy(o.matrix); let q = o.parent;
    while (q && q !== model) { q.updateMatrix(); shell.matrix.premultiply(q.matrix); q = q.parent; }
    shell.renderOrder = 5;
    shells.add(shell);
  }
  model.add(shells);
  return shells;
}

export function createItems({scene, camera, hits}) {
  const items = new Map();          // id -> {state, model, kick}
  const spots = [];                 // real spotlights so avatars catch the beams
  const lit = [];                   // switched-on flashlights this frame, nearest first
  let myPaint = RANDOM_PAINT;       // the colour you've loaded into the marker
  let highlighted = null;           // the item under your crosshair that you could pick up
  // how far each ray of a beam's fan gets before it hits the level (cached while the light holds still)
  const fanRight = new THREE.Vector3(), fanUp = new THREE.Vector3(), fanDir = new THREE.Vector3();
  let fanBudget = 0;                // fans re-cast this frame (moving lights beyond this reuse last frame's)
  function reachOf(it, origin, dir) {
    const key = `${origin.x.toFixed(2)},${origin.y.toFixed(2)},${origin.z.toFixed(2)},${dir.x.toFixed(3)},${dir.y.toFixed(3)},${dir.z.toFixed(3)}`;
    if (it.fanKey === key || (it.fan && fanBudget <= 0)) return it.fan;
    fanBudget--;
    it.fanKey = key; it.fan ??= new Uint8Array(FAN * FAN);
    const fw = fanDir.copy(dir).normalize();
    beamFrame(fw, fanRight, fanUp);
    const ray = new THREE.Vector3();
    for (let gy = 0; gy < FAN; gy++) for (let gx = 0; gx < FAN; gx++) {
      const tu = (gx / (FAN - 1) * 2 - 1) * FAN_TAN, tv = (gy / (FAN - 1) * 2 - 1) * FAN_TAN;
      ray.copy(fw).addScaledVector(fanRight, tu).addScaledVector(fanUp, tv).normalize();
      const h = hits?.raycast(origin, ray, FAN_RANGE, true);
      it.fan[gy * FAN + gx] = Math.round((h ? h.distance : FAN_RANGE) / FAN_RANGE * 255);
    }
    return it.fan;
  }
  for (let i = 0; i < MAX_SPOTLIGHTS; i++) {
    const s = new THREE.SpotLight(BEAM_COLOR, 0, 18, .52, .45, 1.6);
    scene.add(s, s.target);
    spots.push(s);
  }
  // first-person hand: low and right, pointing where you look
  const view = new THREE.Group();
  view.position.set(.2, -.2, -.38);
  camera.add(view);
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), fwd = new THREE.Vector3();
  const _ray = new THREE.Ray(), _box = new THREE.Box3();

  function ensure(state) {
    let it = items.get(state.id);
    if (!it || it.state.type !== state.type) {
      if (it) it.model.removeFromParent();
      const model = (MODELS[state.type] || flashlightModel)(state.id);
      model.traverse(o => { o.castShadow = false; o.frustumCulled = false; });
      it = {state, model, sway: 0, kick: 0, shake: 0, outline: addOutline(model), fall: null};
      scene.add(model);
      items.set(state.id, it);
    }
    it.state = {...state};
    return it;
  }

  return {
    items,
    set(list) { for (const s of list) ensure(s); },
    // a new state from the server; with a fall, it drops from where it was let go to where it settled
    update(state, fall) {
      const it = ensure(state);
      if (fall && hits && !state.holder) {
        const f = simulateFall(hits, fall.p, fall.v);
        f.path[f.path.length - 1].set(state.x, state.y, state.z);   // the server's resting spot is the word
        it.fall = {path: f.path, t: 0, spin: (state.yaw * 7.3) % 1 > .5 ? 1 : -1};
      } else it.fall = null;
    },
    // which item (if any) shows the pick-up glow
    highlight(id) { highlighted = id; },
    heldBy(id) { for (const it of items.values()) if (it.state.holder === id) return it; return null; },
    // recoil / shake for your own view model
    kick(id, amount = 1) { const it = items.get(id); if (it) it.kick = amount; },
    shake(id) { const it = items.get(id); if (it) it.shake = .5; },
    setMyPaint(c) { myPaint = c; },
    // nearest free item within reach that you're roughly looking at
    // the item the crosshair is actually on: the camera's ray has to pass over it
    // (with a few centimetres to spare), it has to be within reach of your body,
    // and nothing solid can be in between (clear(distance) says whether the way is open)
    target(player, origin, dir, clear = () => true, reach = 2) {
      let best = null, bestD = Infinity;
      _ray.set(origin, dir);
      for (const it of items.values()) {
        if (it.state.holder || !it.model.visible) continue;
        if (Math.hypot(it.state.x - player.x, it.state.z - player.z) > reach) continue;
        _box.setFromObject(it.model).expandByScalar(.07);
        const hit = _ray.intersectBox(_box, tmpV);
        if (!hit) continue;
        const d = hit.distanceTo(origin);
        if (d < bestD && clear(d)) { best = it; bestD = d; }
      }
      return best;
    },
    // world position of an item's business end (muzzle, nozzle, lens)
    tip(it) { it.model.updateMatrixWorld(); return it.model.localToWorld(it.model.userData.tip.clone()); },
    // place every item: on the ground, in a hand, or in your view
    frame({me, myId, thirdPerson, avatarOf, poseOf, dt}) {
      glowTime.value += dt;
      let n = 0;
      for (const it of items.values()) {
        const s = it.state, m = it.model, u = m.userData;
        // the hopper shows what's loaded: yours, the holder's choice, or a mix lying on the floor
        if (u.setPaint) u.setPaint(s.holder === myId ? myPaint : s.holder ? (poseOf(s.holder)?.pc ?? RANDOM_PAINT) : RANDOM_PAINT, PAINT_COLORS);
        it.kick *= Math.exp(-dt * 14); it.shake = Math.max(0, it.shake - dt);
        let origin = null, dir = null;
        if (!(s.holder === myId && !thirdPerson) || s.type === 'flashlight') m.scale.setScalar(1);
        it.outline.visible = !s.holder && s.id === highlighted && !it.fall;
        if (!s.holder) {
          if (m.parent !== scene) scene.add(m);
          m.visible = true;
          // lying on its side, head toward its yaw
          m.position.set(s.x, s.y + u.ground, s.z);
          m.rotation.set(0, s.yaw, u.groundRoll, 'YXZ');
          if (u.upright) { m.rotation.set(Math.PI / 2, s.yaw, 0, 'YXZ'); m.position.y = s.y + u.ground; }
          if (it.fall) {                      // still on its way down: follow the path, tumbling, settling into its rest pose
            const f = it.fall; f.t += dt;
            const at = f.t / FALL_DT, i = Math.floor(at), last = f.path.length - 1;
            if (i >= last) it.fall = null;
            else {
              const k = at - i, togo = Math.min(1, (last - at) / 24);
              m.position.lerpVectors(f.path[i], f.path[i + 1], k); m.position.y += u.ground;
              m.rotation.x += togo * togo * 5 * f.spin; m.rotation.z += togo * 1.2 * f.spin;
            }
          }
          m.updateMatrixWorld();
          origin = m.localToWorld(tmpV.copy(u.tip)).clone();
          dir = new THREE.Vector3(0, 0, -1).applyQuaternion(m.getWorldQuaternion(tmpQ));
        } else if (s.holder === myId && !thirdPerson) {
          if (m.parent !== view) view.add(m);
          m.visible = true;
          it.sway += dt;
          const bob = Math.sin(it.sway * 1.7) * .004;
          if (s.type === 'paintball') {
            m.scale.setScalar(.64);
            m.position.set(.0, -.05 + bob + it.kick * .012, -.02 + it.kick * .05);
            m.rotation.set(.04 + it.kick * .12, -.06, 0);
          } else if (s.type === 'spray') {
            const sh = it.shake > 0 ? Math.sin(it.sway * 70) * .006 : 0;
            m.scale.setScalar(.8);
            m.position.set(.05 + sh, -.1 + bob, .02);
            m.rotation.set(-.15, -.35, sh * 2);
          } else {
            m.position.set(0, bob, 0);
            m.rotation.set(.04, -.06, 0);
          }
          m.updateMatrixWorld();
          origin = camera.localToWorld(tmpV.set(.18, -.16, -.5)).clone();
          dir = camera.getWorldDirection(new THREE.Vector3());
        } else {
          const avatar = s.holder === myId ? me : avatarOf(s.holder);
          const socket = avatar?.socket;
          if (m.parent !== scene) scene.add(m);
          const pose = s.holder === myId ? null : poseOf(s.holder);
          const yaw = pose ? pose.yaw : me.root.rotation.y, pitch = pose ? pose.pitch || 0 : me.pitch || 0;
          dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
          // gripped in the right hand, aimed where its holder is looking
          if (s.type === 'spray') m.rotation.set(-.35 + pitch * .5, yaw, 0, 'YXZ');
          else m.rotation.set(pitch, yaw, 0, 'YXZ');
          if (socket) {
            socket.getWorldPosition(m.position);
            if (s.type === 'paintball') m.position.addScaledVector(dir, .08).y += .06;
            else if (s.type === 'spray') m.position.y -= .07;
            else m.position.addScaledVector(dir, .03);
            m.visible = avatar.root.visible && avatar.model.visible !== false;
          } else {
            const px = pose ? pose.x : me.root.position.x, pz = pose ? pose.z : me.root.position.z;
            const py = pose ? (pose.y ?? EYE_HEIGHT) : me.eye;
            m.position.set(px + Math.cos(yaw) * .2, py - .5, pz - Math.sin(yaw) * .2).addScaledVector(dir, .3);
            m.visible = !!avatar;
          }
          m.updateMatrixWorld();
          origin = m.localToWorld(tmpV.copy(u.tip)).clone();
        }
        if (s.type !== 'flashlight') continue;
        u.lens.color.setScalar(s.on ? 4 : .2);
        if (s.on) {
          // only a few beams can be lit at once: yours first, then other people's, then the nearest on the floor
          const far = origin.distanceTo(camera.position);
          if (!s.holder && far > 30) continue;
          lit.push({it, origin, dir, rank: s.holder === myId ? -1e6 : s.holder ? far - 1e3 : far});
        }
      }
      lit.sort((a, b) => a.rank - b.rank);
      fanBudget = 2;
      for (const l of lit) {
        if (n >= MAX_FLASHLIGHTS) break;
        lighting.flPos.value[n].copy(l.origin);
        lighting.flDir.value[n].copy(l.dir).normalize();
        lighting.flOn.value[n] = 1;
        const fan = reachOf(l.it, l.origin, l.dir);
        flashlightReach.data.set(fan, n * FAN * FAN);
        if (n < MAX_SPOTLIGHTS) {
          // avatars catch the beam too, but not through the wall it's pointed at
          spots[n].position.copy(l.origin); spots[n].target.position.copy(l.origin).add(l.dir); spots[n].intensity = 40;
          spots[n].distance = Math.min(18, fan[(FAN * FAN - 1) / 2] / 255 * FAN_RANGE + 1);
        }
        n++;
      }
      flashlightReach.texture.needsUpdate = true;
      lit.length = 0;
      for (let i = n; i < MAX_FLASHLIGHTS; i++) lighting.flOn.value[i] = 0;
      for (let i = n; i < MAX_SPOTLIGHTS; i++) spots[i].intensity = 0;
    },
  };
}

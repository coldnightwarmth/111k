// Held items: flashlights, the paintball marker and spray cans. The server owns
// who holds what and where things lie; this module draws them on the ground,
// in other players' hands and in your own view, and feeds torch beams to the
// level shader.
import * as THREE from 'three';
import {lighting, MAX_FLASHLIGHTS, MAX_SPOTLIGHTS, FAN_RANGE, packBeams, ghostMaterial} from './level.js';
const BEAM_FAR = 42, BEAM_FADE = 10;   // torches on the floor: full strength to 32 m, gone by 42 m
import {EYE_HEIGHT} from './motion.js';
import {PAINT_COLORS, RANDOM_PAINT} from './decals.js';
import {ART, paintingSize} from './paintings.js';
import {mergeVertices} from '../vendor/three/BufferGeometryUtils.js';

const BEAM_COLOR = new THREE.Color(1, .93, .8);
export const ITEM_NAMES = {flashlight: 'flashlight', paintball: 'paintball marker', spray: 'spray can', bucket: 'bucket and sponge', crown: 'golden crown', painting: 'painting'};

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
const GUN_SCALE = 1.12;   // the marker is drawn a little bigger than it was built
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
  const body = new THREE.Group(); body.scale.setScalar(GUN_SCALE);
  while (g.children.length) body.add(g.children[0]);
  g.add(body);
  g.userData = {tip: new THREE.Vector3(0, .012, -.428).multiplyScalar(GUN_SCALE), ground: .052 * GUN_SCALE, groundRoll: Math.PI / 2, setPaint};
  return g;
}

const CAN_COLORS = [0xe8322f, 0x2b6cf0, 0xf2c614, 0x22b45a, 0xf06bc6, 0x111111, 0xf4f1e8, 0xff7a1a, 0x8a4df0, 0x19c2c2];
// A spray can standing on its base (+y up), nozzle facing -z.
const CAN_SCALE = 1.5;   // cans read as too small next to everything else; drawn half as big again
function sprayModel(id) {
  const g = new THREE.Group(), can = new THREE.Group();
  can.scale.setScalar(CAN_SCALE); g.add(can);
  const n = [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  const col = CAN_COLORS[n % CAN_COLORS.length], cap = CAN_COLORS[(n * 7 + 3) % CAN_COLORS.length];
  const body = std(col, .35, .55), label = std(0xf1ede2, .7, 0), metal = std(0xb9bec6, .3, .9), capM = std(cap, .4, .1);
  part(can, new THREE.CylinderGeometry(.033, .033, .17, 20), body, [0, .087, 0]);
  part(can, new THREE.CylinderGeometry(.0335, .0335, .06, 20), label, [0, .075, 0]);
  part(can, new THREE.CylinderGeometry(.026, .033, .02, 20), metal, [0, .182, 0]);     // shoulder
  part(can, new THREE.CylinderGeometry(.033, .031, .006, 20), metal, [0, .003, 0]);    // base rim
  part(can, new THREE.CylinderGeometry(.012, .014, .018, 12), capM, [0, .2, 0]);        // actuator
  part(can, new THREE.CylinderGeometry(.003, .003, .006, 6), metal, [0, .203, -.013], [Math.PI / 2, 0, 0]);  // nozzle
  g.userData = {tip: new THREE.Vector3(0, .203, -.02).multiplyScalar(CAN_SCALE), ground: .033 * CAN_SCALE, groundRoll: Math.PI / 2, upright: true};
  return g;
}

// --------------------------------------------------------------- the bucket
// A dented galvanised pail of grey suds with a wire bail, a rag hung over the rim and a sponge.
// Held, the pail hangs from the left hand and the sponge goes in the right.
function grimeTexture(base, streaks, seed0) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  let seed = seed0; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rnd() < .5 ? '255,255,255' : '0,0,0'},${rnd() * .06})`; g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 10, 1 + rnd() * 5); }
  for (let i = 0; i < streaks; i++) {
    const x = rnd() * 256, y = rnd() * 120, len = 40 + rnd() * 140, grad = g.createLinearGradient(x, y, x, y + len);
    grad.addColorStop(0, 'rgba(60,50,35,.45)'); grad.addColorStop(1, 'rgba(60,50,35,0)');
    g.fillStyle = grad; g.fillRect(x, y, 2 + rnd() * 6, len);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function bucketModel(id) {
  const g = new THREE.Group();
  const n = [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  const zinc = std(0xffffff, .42, .85, {map: grimeTexture('#a3aaae', 30, 11 + n), side: THREE.DoubleSide});
  const dark = std(0x55595c, .5, .8), wood = std(0x7a5232, .7, 0);
  // the pail: a tapered shell with a rolled rim and a dished floor
  const shell = new THREE.LatheGeometry([[.118, 0], [.122, .01], [.145, .27]].map(([r, y]) => new THREE.Vector2(r, y)), 32);
  part(g, shell, zinc);
  part(g, new THREE.TorusGeometry(.146, .0065, 8, 40), zinc, [0, .27, 0], [Math.PI / 2, 0, 0]);
  for (const y of [.09, .18]) part(g, new THREE.TorusGeometry(.128 + y * .085, .003, 4, 40), zinc, [0, y, 0], [Math.PI / 2, 0, 0]);   // pressed ribs
  part(g, new THREE.CircleGeometry(.118, 32), dark, [0, .004, 0], [-Math.PI / 2, 0, 0]);
  // grey suds with a little foam
  part(g, new THREE.CircleGeometry(.14, 32), std(0x6f7a70, .08, .3, {transparent: true, opacity: .92}), [0, .215, 0], [-Math.PI / 2, 0, 0]);
  const foam = std(0xe9ece6, .9, 0);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39, r = .03 + (i % 4) * .025;
    const b = part(g, new THREE.SphereGeometry(.018 + (i % 3) * .006, 10, 6), foam, [Math.cos(a) * r, .215, Math.sin(a) * r]);
    b.scale.y = .35;
  }
  // ears and the wire bail with a wooden grip (it flops over when the pail is set down)
  for (const x of [-1, 1]) part(g, new THREE.BoxGeometry(.012, .035, .022), dark, [x * .148, .245, 0]);
  const bail = new THREE.Group(); bail.position.y = .245; g.add(bail);
  part(bail, new THREE.TorusGeometry(.15, .0028, 6, 32, Math.PI), dark);
  part(bail, new THREE.CylinderGeometry(.013, .013, .085, 12), wood, [0, .15, 0], [0, 0, Math.PI / 2]);
  // a rag hung over the rim: a strip bent inside, over the rim and down the outside
  const rag = new THREE.PlaneGeometry(.11, 1, 1, 16), path = new THREE.CatmullRomCurve3([
    [.1, .16], [.128, .25], [.148, .282], [.162, .262], [.168, .16], [.165, .06]].map(([r, y]) => new THREE.Vector3(r, y, 0)));
  const rp = rag.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const t = rp.getY(i) + .5, w = rp.getX(i), p = path.getPoint(1 - t);
    const ang = .55 + w / .16 + Math.sin(t * 9) * .02;            // wrap round the rim by the strip's width
    rp.setXYZ(i, Math.cos(ang) * p.x, p.y + Math.sin(t * 13 + w * 30) * .004, Math.sin(ang) * p.x);
  }
  rag.computeVertexNormals();
  const cloth = grimeTexture(['#8f3a30', '#3b5a7a', '#6d6a3a'][n % 3], 14, 31 + n);
  part(g, rag, std(0xffffff, .95, 0, {map: cloth, side: THREE.DoubleSide}));
  // the sponge: soft yellow foam with a green scouring pad
  const sponge = new THREE.Group();
  part(sponge, new THREE.BoxGeometry(.1, .04, .066), std(0xe6c048, .95, 0));
  part(sponge, new THREE.BoxGeometry(.1, .012, .066), std(0x2f7a3c, .9, 0), [0, .026, 0]);
  const rest = {position: new THREE.Vector3(-.02, .225, .03), rotation: new THREE.Euler(.35, .6, .2)};
  sponge.position.copy(rest.position); sponge.rotation.copy(rest.rotation);
  g.add(sponge);
  g.userData = {tip: new THREE.Vector3(0, .1, 0), ground: 0, groundRoll: 0, standing: true, sponge, bail,
    // put the sponge back in the pail and let the bail fall over
    dock() { if (sponge.parent !== g) g.add(sponge); sponge.position.copy(rest.position); sponge.rotation.copy(rest.rotation); bail.rotation.x = 1.1; }};
  return g;
}

// ---------------------------------------------------------------- the crown
// A gold band rising into eight points, each tipped with a pearl, red and blue stones round the
// band and a velvet cap inside. Worn, it sits on the head (king of the hill).
const CROWN_R = .075, CROWN_BAND = .03, CROWN_PEAK = .045, CROWN_POINTS = 8, CROWN_SCALE = 2.2;   // 33 cm across: these are big heads
// where it sits in the head bone's space: hats start about 1.15 up the bone, on every head
export const CROWN_ON_HEAD = {y: 1.13, z: 0, scale: 2.55, tilt: 0};
function crownModel() {
  const g = new THREE.Group(), c = new THREE.Group();
  c.scale.setScalar(CROWN_SCALE); g.add(c);
  const gold = std(0xffcf55, .28, .8, {emissive: 0x7a5000, emissiveIntensity: .6, side: THREE.DoubleSide});
  const goldSolid = std(0xffcf55, .3, .8, {emissive: 0x7a5000, emissiveIntensity: .6});
  // the band: an open cylinder whose top edge zigzags up into the points, flaring a touch
  const seg = CROWN_POINTS * 8, top = CROWN_BAND + CROWN_PEAK;
  const band = new THREE.CylinderGeometry(1, 1, 1, seg, 3, true);
  const bp = band.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i) + .5, z = bp.getZ(i);
    const a = Math.atan2(x, z), f = ((a / (2 * Math.PI)) * CROWN_POINTS % 1 + 1) % 1;
    const rise = Math.abs(2 * f - 1);                                   // 1 at a point, 0 between
    // rows: the bottom edge, the top of the plain band, partway up the point, the zigzag edge
    const h = y < .01 ? 0 : y < .34 ? CROWN_BAND * .75 : y < .67 ? CROWN_BAND + CROWN_PEAK * rise * .45 - .006 * (1 - rise) : CROWN_BAND + CROWN_PEAK * rise;
    const r = CROWN_R * (1 + .1 * h / top);
    bp.setXYZ(i, Math.sin(a) * r, h, Math.cos(a) * r);
  }
  band.computeVertexNormals();
  part(c, band, gold);
  // rims round the bottom and the top of the plain band
  part(c, new THREE.TorusGeometry(CROWN_R * 1.005, .0055, 8, 48), goldSolid, [0, .004, 0], [Math.PI / 2, 0, 0]);
  part(c, new THREE.TorusGeometry(CROWN_R * (1 + .1 * CROWN_BAND / top) + .001, .0035, 6, 48), goldSolid, [0, CROWN_BAND, 0], [Math.PI / 2, 0, 0]);
  // a pearl on every point, a stone below each, alternating ruby and sapphire
  const pearl = std(0xfff6e6, .25, .1), stones = [std(0xc0142c, .12, .2, {emissive: 0x3a0008}), std(0x1d4fd6, .12, .2, {emissive: 0x060f3a})];
  for (let k = 0; k < CROWN_POINTS; k++) {
    const a = 2 * Math.PI * k / CROWN_POINTS, rt = CROWN_R * 1.1 + .001;
    part(c, new THREE.SphereGeometry(.0085, 12, 8), pearl, [Math.sin(a) * rt, top + .006, Math.cos(a) * rt]);
    const rb = CROWN_R * (1 + .1 * CROWN_BAND * .45 / top) + .003;
    const gem = part(c, new THREE.SphereGeometry(.009, 12, 8), stones[k % 2], [Math.sin(a) * rb, CROWN_BAND * .45, Math.cos(a) * rb]);
    gem.scale.set(1, 1.15, .5); gem.rotation.y = a;
    // a little gold setting round the stone
    const set = part(c, new THREE.TorusGeometry(.0098, .0018, 5, 16), goldSolid, [Math.sin(a) * (rb - .001), CROWN_BAND * .45, Math.cos(a) * (rb - .001)]);
    set.rotation.y = a; set.scale.y = 1.15;
  }
  // the velvet cap inside, with a gold button on top
  const cap = part(c, new THREE.SphereGeometry(CROWN_R * .95, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0x7d0f22, .92, 0), [0, CROWN_BAND * .2, 0]);
  cap.scale.y = .62;
  part(c, new THREE.SphereGeometry(.011, 12, 8), goldSolid, [0, CROWN_BAND * .2 + CROWN_R * .95 * .62 + .006, 0]);
  g.userData = {tip: new THREE.Vector3(0, top * CROWN_SCALE, 0), ground: 0, groundRoll: 0, standing: true};
  return g;
}

// ------------------------------------------------------------- paintings
// A stretched canvas: the picture on the front, its edge pixels running round the sides (gallery
// wrapped, so the sides streak with the picture's own colours), and an open back: the canvas's raw
// back, folded and stapled over a pine stretcher with a cross brace. Origin: the middle of the back;
// the picture faces +z, its top is +y.
const artTextures = new Map();
function artTexture(art) {
  if (!artTextures.has(art)) {
    const t = new THREE.TextureLoader().setCrossOrigin('anonymous').load((ART[art] || ART[1]).url);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    artTextures.set(art, t);
  }
  return artTextures.get(art);
}
let woodTex = null, linenTex = null, primedTex = null;
// white primed canvas: gesso over the weave, the weave just showing through
function primedTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f2efe8'; g.fillRect(0, 0, 64, 64);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 64; i += 2) {
    g.fillStyle = `rgba(170,160,140,${.04 + rnd() * .05})`; g.fillRect(0, i, 64, 1);
    g.fillStyle = `rgba(170,160,140,${.04 + rnd() * .05})`; g.fillRect(i, 0, 1, 64);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function grainTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c8a26a'; g.fillRect(0, 0, 64, 256);
  let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {                 // long grain lines down the bar, wavering a little
    const x = rnd() * 64, w = .6 + rnd() * 1.8, a = .08 + rnd() * .16;
    g.strokeStyle = `rgba(${rnd() < .7 ? '120,80,40' : '235,205,150'},${a})`; g.lineWidth = w;
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 16) g.lineTo(x + Math.sin(y * .03 + i) * 2.2, y);
    g.stroke();
  }
  for (let i = 0; i < 2; i++) {                  // a knot or two
    const x = 10 + rnd() * 44, y = 30 + rnd() * 200;
    g.fillStyle = 'rgba(110,70,35,.35)'; g.beginPath(); g.ellipse(x, y, 3 + rnd() * 3, 7 + rnd() * 6, 0, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function linenTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ddd3c0'; g.fillRect(0, 0, 128, 128);
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 128; i += 2) {             // the weave
    g.fillStyle = `rgba(150,135,110,${.05 + rnd() * .08})`; g.fillRect(0, i, 128, 1);
    g.fillStyle = `rgba(150,135,110,${.05 + rnd() * .08})`; g.fillRect(i, 0, 1, 128);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function paintingModel(id, state) {
  const art = state?.art || 1, {w, h, d} = paintingSize(art), x = w / 2, y = h / 2;
  const g = new THREE.Group();
  // the picture on the front; the canvas wrapped round the sides is plain white primed canvas
  const pos = [], uv = [], idx = [];
  const quad = (p, t) => { const b = pos.length / 3; p.forEach(q => pos.push(...q)); t.forEach(q => uv.push(...q)); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  quad([[-x, -y, d], [x, -y, d], [x, y, d], [-x, y, d]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const geo = () => { const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.Float32BufferAttribute(pos.splice(0), 3));
    b.setAttribute('uv', new THREE.Float32BufferAttribute(uv.splice(0), 2)); b.setIndex(idx.splice(0)); b.computeVertexNormals(); return b; };
  const canvasMat = new THREE.MeshStandardMaterial({map: artTexture(art), roughness: .82, metalness: 0});
  const front = new THREE.Mesh(geo(), canvasMat); front.name = 'canvas'; g.add(front);
  // sides: the weave running along each edge
  const tw = w * 4, th = h * 4, td = d * 4;
  quad([[-x, y, d], [x, y, d], [x, y, 0], [-x, y, 0]], [[0, td], [tw, td], [tw, 0], [0, 0]]);       // top
  quad([[-x, -y, 0], [x, -y, 0], [x, -y, d], [-x, -y, d]], [[0, 0], [tw, 0], [tw, td], [0, td]]);   // bottom
  quad([[x, -y, d], [x, -y, 0], [x, y, 0], [x, y, d]], [[td, 0], [0, 0], [0, th], [td, th]]);       // right
  quad([[-x, -y, 0], [-x, -y, d], [-x, y, d], [-x, y, 0]], [[0, 0], [td, 0], [td, th], [0, th]]);   // left
  primedTex ||= primedTexture();
  part(g, geo(), new THREE.MeshStandardMaterial({map: primedTex, roughness: .9, metalness: 0}));
  // the back: raw canvas behind the picture, folded over the stretcher's back edge and stapled
  woodTex ||= grainTexture(); linenTex ||= linenTexture();
  const linen = new THREE.MeshStandardMaterial({map: linenTex, roughness: .95, metalness: 0, side: THREE.DoubleSide});
  const wood = new THREE.MeshStandardMaterial({map: woodTex, roughness: .75, metalness: 0});
  const staple = std(0x9a9ca0, .4, .8);
  const back = part(g, new THREE.PlaneGeometry(w - .002, h - .002), linen, [0, 0, d - .0025], [0, Math.PI, 0]);
  back.material = linen;
  // (the bars sit a couple of millimetres inside the canvas's wrapped sides, so the two never fight)
  const bar = .042, deep = d - .006, fold = .016, inset = .0025;
  // stretcher bars round the edge (meeting at mitred-looking corners), then the cross brace
  const barGeo = (len, across, depth, vertical) => {
    const geo = new THREE.BoxGeometry(vertical ? across : len, vertical ? len : across, depth);
    const uvs = geo.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * .25, uvs.getY(i) * len * 2);   // grain along the bar
    return geo;
  };
  part(g, barGeo(w - 2 * inset, bar, deep, false), wood, [0, y - inset - bar / 2, deep / 2]);
  part(g, barGeo(w - 2 * inset, bar, deep, false), wood, [0, -y + inset + bar / 2, deep / 2]);
  part(g, barGeo(h - 2 * bar - 2 * inset, bar, deep, true), wood, [x - inset - bar / 2, 0, deep / 2]);
  part(g, barGeo(h - 2 * bar - 2 * inset, bar, deep, true), wood, [-x + inset + bar / 2, 0, deep / 2]);
  const braceDeep = deep * .7;
  if (h > .5) part(g, barGeo(w - 2 * bar, bar * .85, braceDeep, false), wood, [0, 0, braceDeep / 2]);
  if (w > .5) part(g, barGeo(h - 2 * bar, bar * .85, braceDeep, true), wood, [0, 0, braceDeep / 2 - .0005]);
  // the canvas folded over the back of the bars, with staples every few centimetres
  const folds = [[w, fold, 0, y - fold / 2], [w, fold, 0, -y + fold / 2], [fold, h - 2 * fold, x - fold / 2, 0], [fold, h - 2 * fold, -x + fold / 2, 0]];
  for (const [fw, fh, fx, fy] of folds) part(g, new THREE.PlaneGeometry(fw, fh), linen, [fx, fy, -.0008], [0, Math.PI, 0]);
  const stapleGeo = new THREE.BoxGeometry(.012, .0022, .001);
  for (let s = -x + .05; s < x - .03; s += .075) for (const sy of [y - fold * .55, -y + fold * .55]) part(g, stapleGeo, staple, [s, sy, -.0014]);
  for (let s = -y + .06; s < y - .03; s += .075) for (const sx of [x - fold * .55, -x + fold * .55]) part(g, stapleGeo, staple, [sx, s, -.0014], [0, 0, Math.PI / 2]);
  // corner keys: little wedges tapped into the stretcher's inside corners
  const key = new THREE.BoxGeometry(.03, .03, .006);
  for (const [kx, ky] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) part(g, key, wood, [kx * (x - bar - .012), ky * (y - bar - .012), .004], [0, 0, Math.PI / 4]);
  // the pick-up glow: one closed box with its corners' normals shared, so the glow wraps it without gaps
  const ob = glowBoxGeometry(new THREE.Vector3(-x, -y, 0), new THREE.Vector3(x, y, d));
  g.userData = {tip: new THREE.Vector3(0, 0, d), ground: .002, painting: true, w, h, d, art, canvas: front, outline: ob};
  return g;
}

const MODELS = {flashlight: flashlightModel, paintball: paintballModel, spray: sprayModel, bucket: bucketModel, crown: crownModel, painting: paintingModel};
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
// A painting hangs flush against a wall (or lies flat on the floor), so a glow pushed out round it would be
// half inside that wall. Its glow is drawn over everything instead, minus wherever the line of sight passes
// through the painting itself (tested against its box): just the ring round its outline, from any angle.
// (Only shown while you're aiming at it in plain view, so drawing it over things is fine.)
const boxOutlines = new Map();
// (cyl, if given: an upright cylinder along z, {x, y, r, z0, z1}, and ell, an ellipsoid {c: [x, y, z], r: [x, y, z]},
// joined to the box: the glow goes round all of them together)
function boxOutlineMaterials(min, max, cyl = null, ell = null) {
  const key = `${min.toArray().map(v => v.toFixed(3))}|${max.toArray().map(v => v.toFixed(3))}|${cyl ? Object.values(cyl).map(v => v.toFixed(3)) : ''}|${ell ? [...ell.c, ...ell.r].map(v => v.toFixed(3)) : ''}`;
  if (!boxOutlines.has(key)) boxOutlines.set(key, [[.007, 1], [.016, .35]].map(([width, opacity]) => {
    const m = outlineMaterial(width, opacity);
    m.depthTest = false;
    const before = m.onBeforeCompile;
    m.onBeforeCompile = sh => {
      before(sh);
      sh.uniforms.boxMin = {value: min.clone()};
      sh.uniforms.boxMax = {value: max.clone()};
      sh.uniforms.cyl = {value: cyl ? new THREE.Vector3(cyl.x, cyl.y, cyl.r) : new THREE.Vector3()};
      sh.uniforms.cylZ = {value: cyl ? new THREE.Vector2(cyl.z0, cyl.z1) : new THREE.Vector2()};
      sh.uniforms.ellC = {value: ell ? new THREE.Vector3(...ell.c) : new THREE.Vector3()};
      sh.uniforms.ellR = {value: ell ? new THREE.Vector3(...ell.r) : new THREE.Vector3()};
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;\nvarying vec3 vEye;')
        .replace('gl_Position = projectionMatrix * mvPosition;', `gl_Position = projectionMatrix * mvPosition;
      vObj = (inverse(modelViewMatrix) * mvPosition).xyz;
      vEye = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 boxMin; uniform vec3 boxMax; uniform vec3 cyl; uniform vec2 cylZ; uniform vec3 ellC; uniform vec3 ellR;
// ... or through the ellipsoid?
bool hitEll(vec3 o, vec3 d) {
  if (ellR.x <= 0.0) return false;
  vec3 p = (o - ellC) / ellR, q = d / ellR;
  float a = dot(q, q), b = dot(p, q), c = dot(p, p) - 1.0, disc = b * b - a * c;
  if (disc < 0.0) return false;
  return (-b + sqrt(disc)) / a >= 0.0;
}
varying vec3 vObj; varying vec3 vEye;
// does the line of sight o + t d (t >= 0) pass through the cylinder?
bool hitCyl(vec3 o, vec3 d) {
  if (cyl.z <= 0.0) return false;
  vec2 p = o.xy - cyl.xy;
  float a = dot(d.xy, d.xy), b = dot(p, d.xy), c = dot(p, p) - cyl.z * cyl.z, t0, t1;
  if (a < 1e-12) { if (c > 0.0) return false; t0 = -1e30; t1 = 1e30; }
  else { float disc = b * b - a * c; if (disc < 0.0) return false; float s = sqrt(disc); t0 = (-b - s) / a; t1 = (-b + s) / a; }
  float zin = -1e30, zout = 1e30;
  if (abs(d.z) < 1e-9) { if (o.z < cylZ.x || o.z > cylZ.y) return false; }
  else { float za = (cylZ.x - o.z) / d.z, zb = (cylZ.y - o.z) / d.z; zin = min(za, zb); zout = max(za, zb); }
  float tin = max(t0, zin), tout = min(t1, zout);
  return tout >= max(tin, 0.0);
}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      {
        vec3 dir = vObj - vEye;
        vec3 inv = 1.0 / dir;
        vec3 t0 = (boxMin - vEye) * inv, t1 = (boxMax - vEye) * inv;
        vec3 lo = min(t0, t1), hi = max(t0, t1);
        float tin = max(max(lo.x, lo.y), lo.z), tout = min(min(hi.x, hi.y), hi.z);
        if (tout >= max(tin, 0.0) || hitCyl(vEye, dir) || hitEll(vEye, dir)) discard;        // the thing itself is here
      }`);
    };
    m.customProgramCacheKey = () => `box-outline-${width}-${key}`;
    return m;
  }));
  return boxOutlines.get(key);
}
// a closed box with its corners' normals shared, so a glow pushed out from it wraps it without gaps
export function glowBoxGeometry(min, max) {
  const [x0, y0, z0] = min.toArray(), [x1, y1, z1] = max.toArray();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], 3));
  g.setIndex([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3]);
  g.computeVertexNormals();
  return g;
}
// a glow round a box (in its parent's space), and an upright cylinder joined to it if given, seen from
// any angle: hidden until shown
export function glowBox(min, max, cyl = null, ell = null) {
  const shells = new THREE.Group(); shells.visible = false;
  const geos = [glowBoxGeometry(min, max)];
  if (cyl) {
    // a closed cylinder whose rim normals are shared, so its glow has no gap at the edge
    const c = new THREE.CylinderGeometry(cyl.r, cyl.r, cyl.z1 - cyl.z0, 40, 1, false);
    c.deleteAttribute('normal'); c.deleteAttribute('uv');
    const m = mergeVertices(c);
    m.rotateX(Math.PI / 2); m.translate(cyl.x, cyl.y, (cyl.z0 + cyl.z1) / 2); m.computeVertexNormals();
    geos.push(m);
  }
  if (ell) {
    const e = mergeVertices((() => { const g = new THREE.SphereGeometry(1, 40, 20); g.deleteAttribute('normal'); g.deleteAttribute('uv'); return g; })());
    e.scale(...ell.r); e.translate(...ell.c); e.computeVertexNormals();
    geos.push(e);
  }
  for (const geo of geos) for (const mat of boxOutlineMaterials(min, max, cyl, ell)) { const s = new THREE.Mesh(geo, mat); s.renderOrder = 5; s.frustumCulled = false; shells.add(s); }
  return shells;
}
export function addOutline(model) {
  const shells = new THREE.Group(); shells.visible = false;
  const meshes = [];
  const u = model.userData;
  if (u.outline) meshes.push(new THREE.Mesh(u.outline));   // a shape made for glowing round
  else model.traverse(o => { if (o.isMesh) meshes.push(o); });
  const mats = u.outline && u.painting ? boxOutlineMaterials(new THREE.Vector3(-u.w / 2, -u.h / 2, 0), new THREE.Vector3(u.w / 2, u.h / 2, u.d)) : OUTLINES;
  for (const o of meshes) for (const mat of mats) {
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

const worn = s => s.type === 'crown' && s.on;
const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4(), _onHead = new THREE.Matrix4();

export function createItems({scene, camera, hits, shadows = null}) {
  const items = new Map();          // id -> {state, model, kick}
  const spots = [];                 // real spotlights so avatars catch the beams
  const slotOf = new Map(), used = new Array(MAX_FLASHLIGHTS).fill(false);   // torch id -> its beam slot
  const lit = [];                   // switched-on flashlights this frame, nearest first
  let myPaint = RANDOM_PAINT;       // the colour you've loaded into the marker
  let highlighted = null;           // the item under your crosshair that you could pick up
  // how far a beam's middle gets before it hits the level (cached while the light holds still), so the
  // real spotlight that lights avatars stops at the wall it's pointed at
  let reachBudget = 0;
  function reachOf(it, origin, dir) {
    const key = `${origin.x.toFixed(2)},${origin.y.toFixed(2)},${origin.z.toFixed(2)},${dir.x.toFixed(3)},${dir.y.toFixed(3)},${dir.z.toFixed(3)}`;
    if (it.reachKey === key || (it.reach !== undefined && reachBudget <= 0)) return it.reach;
    reachBudget--;
    it.reachKey = key;
    const h = hits?.raycast(origin, dir.clone().normalize(), FAN_RANGE, true);
    it.reach = h ? h.distance : FAN_RANGE;
    return it.reach;
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
      const model = (MODELS[state.type] || flashlightModel)(state.id, state);
      model.traverse(o => { o.castShadow = false; o.frustumCulled = false; });
      it = {state, model, sway: 0, kick: 0, shake: 0, outline: addOutline(model), fall: null};
      // a crown dithers away with its wearer when the camera pushes into them
      if (state.type === 'crown') {
        it.ghost = {ghostAll: {value: 0}, ghostOn: {value: 0}};
        const done = new Map();
        model.traverse(o => {
          if (!o.isMesh || o.parent === it.outline) return;
          if (!done.has(o.material)) done.set(o.material, ghostMaterial(o.material, it.ghost));
          o.material = done.get(o.material);
        });
      }
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
        // the server's resting spot is the word: ease the difference in over the whole fall, not a jump at the end
        const last = f.path.length - 1, err = new THREE.Vector3(state.x, state.y, state.z).sub(f.path[last]);
        f.path.forEach((p, i) => p.addScaledVector(err, last ? i / last : 1));
        it.fall = {path: f.path, t: 0};
      } else it.fall = null;
    },
    // which item (if any) shows the pick-up glow
    highlight(id) { highlighted = id; },
    heldBy(id) { for (const it of items.values()) if (it.state.holder === id && !worn(it.state)) return it; return null; },
    // the crown on this player's head, if they have it on
    wornBy(id) { for (const it of items.values()) if (it.state.holder === id && worn(it.state)) return it; return null; },
    // recoil / shake for your own view model
    kick(id, amount = 1) { const it = items.get(id); if (it) it.kick = amount; },
    shake(id) { const it = items.get(id); if (it) it.shake = .5; },
    setMyPaint(c) { myPaint = c; },
    // the sponge's scrubbing motion (your view and others')
    scrub(id) { const it = items.get(id); if (it) it.scrub = .45; },
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
    // paintings that aren't in anyone's hands (on walls, leant, lying about)
    paintings() { return [...items.values()].filter(it => it.model.userData.painting && !it.state.holder && it.model.visible); },
    // the nearest painting along a ray: {point, normal (facing the ray), distance, painting, local: {point, normal}}
    paintingHit(origin, dir, far) {
      let best = null;
      for (const it of this.paintings()) {
        const u = it.model.userData;
        it.model.updateMatrixWorld();
        const inv = _inv.copy(it.model.matrixWorld).invert();
        _ray.set(origin, dir).applyMatrix4(inv);
        _box.min.set(-u.w / 2, -u.h / 2, 0); _box.max.set(u.w / 2, u.h / 2, u.d);
        const lp = _ray.intersectBox(_box, new THREE.Vector3());
        if (!lp) continue;
        const wp = lp.clone().applyMatrix4(it.model.matrixWorld), dist = wp.distanceTo(origin);
        if (dist > far || (best && dist >= best.distance)) continue;
        // which face: the one the point sits on
        const ln = new THREE.Vector3();
        const gaps = [[u.w / 2 - lp.x, 'x', 1], [lp.x + u.w / 2, 'x', -1], [u.h / 2 - lp.y, 'y', 1], [lp.y + u.h / 2, 'y', -1], [u.d - lp.z, 'z', 1], [lp.z, 'z', -1]];
        const [, axis, sgn] = gaps.reduce((a, b) => (b[0] < a[0] ? b : a));
        ln[axis] = sgn;
        const wn = ln.clone().transformDirection(it.model.matrixWorld);
        best = {point: wp, normal: wn, distance: dist, painting: it, local: {point: lp, normal: ln}};
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
        let origin = null, dir = null, eye = null;
        if (!(s.holder === myId && !thirdPerson) || s.type === 'flashlight') m.scale.setScalar(1);
        it.outline.visible = !s.holder && s.id === highlighted && !it.fall;
        if (it.ghost) it.ghost.ghostAll.value = it.ghost.ghostOn.value = 0;     // (worn, it follows its wearer: below)
        if (!s.holder) {
          if (m.parent !== scene) scene.add(m);
          m.visible = true;
          // lying on its side, head toward its yaw
          m.position.set(s.x, s.y + u.ground, s.z);
          m.rotation.set(0, s.yaw, u.groundRoll, 'YXZ');
          if (u.upright) { m.rotation.set(Math.PI / 2, s.yaw, 0, 'YXZ'); m.position.y = s.y + u.ground; }
          if (u.standing) { m.rotation.set(0, s.yaw, 0); m.position.y = s.y; }
          if (u.painting) { m.rotation.set(s.tilt || 0, s.yaw, s.roll || 0, 'YXZ'); m.position.set(s.x, s.y, s.z); }   // hung, leant or laid as placed
          u.dock?.();
          if (it.fall) {                      // still on its way down: follow the path, already in its rest pose (no tumbling)
            const f = it.fall; f.t += dt;
            const at = f.t / FALL_DT, i = Math.floor(at), last = f.path.length - 1;
            if (i >= last) it.fall = null;
            else {
              const k = at - i;
              m.position.lerpVectors(f.path[i], f.path[i + 1], k); m.position.y += u.ground;
            }
          }
          m.updateMatrixWorld();
          origin = m.localToWorld(tmpV.copy(u.tip)).clone();
          dir = new THREE.Vector3(0, 0, -1).applyQuaternion(m.getWorldQuaternion(tmpQ));
        } else if (worn(s)) {
          // on its wearer's head (yours folds away in first person, and the crown with it)
          const avatar = s.holder === myId ? me : avatarOf(s.holder);
          if (m.parent !== scene) scene.add(m);
          if (avatar?.head) {
            if (it.ghost && avatar.ghost) { it.ghost.ghostAll.value = avatar.ghost.ghostAll.value; it.ghost.ghostOn.value = avatar.ghost.ghostOn.value; }
            avatar.head.updateWorldMatrix(true, false);
            _onHead.makeRotationX(CROWN_ON_HEAD.tilt).setPosition(0, CROWN_ON_HEAD.y, CROWN_ON_HEAD.z || 0);
            _onHead.scale(tmpV.setScalar(CROWN_ON_HEAD.scale));
            _m.multiplyMatrices(avatar.head.matrixWorld, _onHead).decompose(m.position, m.quaternion, m.scale);
            m.visible = avatar.root.visible && avatar.model.visible !== false && m.scale.x > .01;
          } else m.visible = false;
          continue;
        } else if (s.holder === myId && !thirdPerson) {
          if (m.parent !== view) view.add(m);
          m.visible = true;
          it.sway += dt;
          const bob = Math.sin(it.sway * 1.7) * .004;
          if (s.type === 'paintball') {
            m.scale.setScalar(.8 / GUN_SCALE);           // in your own hand: 1.25x what it was (was .64 unscaled)
            m.position.set(.0, -.05 + bob + it.kick * .012, -.02 + it.kick * .05);
            m.rotation.set(.04 + it.kick * .12, -.06, 0);
          } else if (s.type === 'spray') {
            const sh = it.shake > 0 ? Math.sin(it.sway * 70) * .006 : 0;
            m.scale.setScalar(.62);              // (the can is drawn 1.5x; about 1.15x what it was in your hand)
            m.position.set(.05 + sh, -.11 + bob, .02);
            m.rotation.set(-.15, -.35, sh * 2);
          } else if (s.type === 'bucket') {
            m.scale.setScalar(.85);
            m.position.set(-.56, -.36 + bob, -.12); m.rotation.set(.12, .5, 0); u.bail.rotation.x = 0;
            if (u.sponge.parent !== view) view.add(u.sponge);
            it.scrub = Math.max(0, (it.scrub || 0) - dt);
            const sc = it.scrub > 0 ? Math.sin(it.scrub * 40) * .03 : 0;
            u.sponge.position.set(-.02 + sc, -.03 + bob + Math.abs(sc) * .4, -.06 - (it.scrub > 0 ? .06 : 0));
            u.sponge.rotation.set(-.9, -.25, .15 + sc * 3);
          } else if (s.type === 'painting') {
            // carried at your side, turned so you can see the picture
            m.scale.setScalar(.5);
            m.position.set(.1, -.2 + bob, -.16);
            m.rotation.set(.08, -.95, .02);
          } else if (s.type === 'crown') {
            m.scale.setScalar(.62);
            m.position.set(-.07, -.02 + bob, -.15);
            m.rotation.set(.3, .3, -.05);
          } else {
            m.position.set(0, bob, 0);
            m.rotation.set(.04, -.06, 0);
          }
          m.updateMatrixWorld();
          origin = camera.localToWorld(tmpV.set(.18, -.16, -.5)).clone();
          dir = camera.getWorldDirection(new THREE.Vector3());
          // up against a wall the torch's tip pokes through it, and from the far side the beam lit
          // nothing; so the light starts no further out than the first thing between eye and tip
          {
            const from = camera.getWorldPosition(new THREE.Vector3()), to = origin.clone().sub(from), len = to.length();
            const h = hits?.raycast(from, to.divideScalar(len), len, true);
            if (h) origin.copy(from).addScaledVector(to, Math.max(.02, h.distance - .08));
          }
          // your own beam casts its shadows from just beside your eye: each shadow then falls behind
          // the thing casting it as you see it, instead of sheets of dark showing past shelves and
          // table tops that the torch, lower and to the right, can't see over
          eye = camera.localToWorld(tmpV.set(.03, -.04, 0)).clone();
        } else {
          const avatar = s.holder === myId ? me : avatarOf(s.holder);
          const socket = avatar?.socket;
          if (m.parent !== scene) scene.add(m);
          const pose = s.holder === myId ? null : poseOf(s.holder);
          const yaw = pose ? pose.yaw : me.root.rotation.y, pitch = pose ? pose.pitch || 0 : me.pitch || 0;
          dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
          // gripped in the right hand, aimed where its holder is looking
          if (s.type === 'spray') m.rotation.set(-.35 + pitch * .5, yaw, 0, 'YXZ');
          else if (s.type === 'bucket' || s.type === 'crown') m.rotation.set(0, yaw, 0);
          else m.rotation.set(pitch, yaw, 0, 'YXZ');
          if (s.type === 'painting' && avatar?.hand) {
            // carried at their side by the top of the stretcher, the picture facing out
            m.rotation.set(0, yaw + Math.PI / 2, 0);
            avatar.hand.getWorldPosition(m.position);
            m.position.add(tmpV.set(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(.05)).y -= u.h / 2 - .08;
            m.visible = avatar.root.visible && avatar.model.visible !== false;
          } else if (s.type === 'bucket' && avatar?.handL && socket) {
            m.scale.setScalar(1);
            avatar.handL.getWorldPosition(m.position); m.position.y -= .4;      // the bail's grip in the fist
            u.bail.rotation.x = 0;
            if (u.sponge.parent !== scene) scene.add(u.sponge);
            socket.getWorldPosition(u.sponge.position);
            it.scrub = Math.max(0, (it.scrub || 0) - dt);
            u.sponge.position.addScaledVector(dir, it.scrub > 0 ? .08 + Math.sin(it.scrub * 40) * .03 : .02);
            u.sponge.rotation.set(-.4 + pitch, yaw, 0, 'YXZ');
            m.visible = u.sponge.visible = avatar.root.visible && avatar.model.visible !== false;
          } else if (socket) {
            socket.getWorldPosition(m.position);
            if (s.type === 'paintball') m.position.addScaledVector(dir, .08).y += .06;
            else if (s.type === 'spray') m.position.y -= .07 * CAN_SCALE;
            else if (s.type === 'crown') m.position.addScaledVector(dir, .1).y -= .1;   // held by the band, out in front
            else if (avatar.hand) {
              // a torch in a fist: the middle of the barrel sits in the closed hand, just ahead of the wrist
              avatar.hand.getWorldPosition(m.position);
              m.position.addScaledVector(dir, .085).add(tmpV.set(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(-.022));
            } else m.position.addScaledVector(dir, .03);
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
          // every lit torch shines. Ones lying far off fade out over a few metres rather than
          // switching off at a line (the loop curves away; past ~40 m you can't see their light)
          const far = origin.distanceTo(camera.position);
          const fade = s.holder ? 1 : Math.min(1, Math.max(0, (BEAM_FAR - far) / BEAM_FADE));
          if (fade > 0) lit.push({it, origin, eye, dir, fade, rank: s.holder === myId ? -1e6 : s.holder ? far - 1e3 : far});
        }
      }
      // each lit torch keeps its own slot (and so its shadow tile) for as long as it's lit
      for (const [id, i] of slotOf) if (!lit.some(l => l.it.state.id === id)) { slotOf.delete(id); used[i] = false; }
      let top = 0;
      for (const l of lit) {
        const id = l.it.state.id;
        let i = slotOf.get(id);
        if (i === undefined) { i = used.indexOf(false); if (i < 0) continue; used[i] = true; slotOf.set(id, i); }
        lighting.flPos.value[i].copy(l.origin);
        lighting.flDir.value[i].copy(l.dir).normalize();
        lighting.flOn.value[i] = l.fade;
        shadows?.assign(i, id, l.eye || l.origin, lighting.flDir.value[i]);
        top = Math.max(top, i + 1);
      }
      for (let i = 0; i < MAX_FLASHLIGHTS; i++) if (!used[i]) { lighting.flOn.value[i] = 0; shadows?.clear(i); }
      shadows?.render(dt);
      packBeams(top);
      // the nearest few also get a real spotlight so avatars catch them, but not through the wall it's pointed at
      lit.sort((a, b) => a.rank - b.rank);
      reachBudget = 4;
      for (const l of lit) {
        if (n >= MAX_SPOTLIGHTS) break;
        spots[n].position.copy(l.origin); spots[n].target.position.copy(l.origin).add(l.dir); spots[n].intensity = 40 * l.fade;
        spots[n].distance = Math.min(18, reachOf(l.it, l.origin, l.dir) + 1);
        n++;
      }
      lit.length = 0;
      for (let i = n; i < MAX_SPOTLIGHTS; i++) spots[i].intensity = 0;
    },
  };
}

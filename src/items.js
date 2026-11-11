// Held items: flashlights, the paintball gun and spray cans. The server owns
// who holds what and where things lie; this module draws them on the ground,
// in other players' hands and in your own view, and feeds torch beams to the
// level shader.
import * as THREE from 'three';
import {lighting, MAX_FLASHLIGHTS, MAX_SPOTLIGHTS, FAN_RANGE, packBeams, ghostMaterial} from './level.js';
const BEAM_FAR = 42, BEAM_FADE = 10;   // torches on the floor: full strength to 32 m, gone by 42 m
import {EYE_HEIGHT} from './motion.js';
import {MAG_SIZE, RELOAD_MS} from './protocol.js';
import {PAINT_COLORS, RANDOM_PAINT} from './decals.js';
import {ART, ART_IDS, PREVIEW, artFile, artOriginal, paintingSize, paintingMatrix} from './paintings.js';
import {mergeVertices, mergeGeometries} from '../vendor/three/BufferGeometryUtils.js';
import {GLTFLoader} from '../vendor/three/GLTFLoader.js';
import {eggModel} from './eggs.js';
import {MONS, squareAt} from './pieces.js';

const BEAM_COLOR = new THREE.Color(1, .93, .8);
export const ITEM_NAMES = {flashlight: 'flashlight', paintball: 'paintball gun', spray: 'spray can', bucket: 'bucket and sponge', crown: 'golden crown', painting: 'painting', marker: 'marker', piece: 'piece', radio: 'radio'};

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

// ----------------------------------------------------------------- the paintball gun
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

// A modern speedball paintball gun, muzzle down its local -z, ~63 cm from muzzle to tank end.
// The hopper's balls show the loaded paint (setPaint).
const GUN_SCALE = 1.12;   // the gun is drawn a little bigger than it was built
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
  // (one instanced mesh, a colour per ball: the same 33 balls in one draw)
  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(.0087, 12, 8), std(0xffffff, .25, 0, {emissive: 0x000000}), 33);
  const at = new THREE.Matrix4(), tint = new THREE.Color();
  for (let layer = 0, n = 0; layer < 3; layer++) for (let i = 0; i < 11; i++, n++) {
    const a = i / 11 * Math.PI * 2 + layer * .5, rr = layer === 2 ? .45 : .72;
    balls.setMatrixAt(n, at.makeTranslation(Math.cos(a) * .052 * rr * .78, .085 + layer * .016, .005 + Math.sin(a) * .098 * rr * .8));
    balls.setColorAt(n, tint.setHex(0xffffff));
  }
  balls.renderOrder = 1; balls.computeBoundingSphere(); g.add(balls);
  let shown = null;
  const setPaint = (color, palette) => {
    if (color === shown) return;
    shown = color;
    for (let i = 0; i < 33; i++) balls.setColorAt(i, tint.setHex(color < 0 ? palette[(i * 7 + 3) % palette.length] : color));
    balls.instanceColor.needsUpdate = true;
  };
  // as many balls as are loaded (the top layer goes first: they're drawn bottom layer up)
  const setAmmo = n => { n = Math.max(0, Math.min(33, Math.round(n))); if (balls.count !== n) balls.count = n; };
  const body = new THREE.Group(); body.scale.setScalar(GUN_SCALE);
  while (g.children.length) body.add(g.children[0]);
  g.add(body);
  g.userData = {tip: new THREE.Vector3(0, .012, -.428).multiplyScalar(GUN_SCALE), ground: .052 * GUN_SCALE, groundRoll: Math.PI / 2, setPaint, setAmmo};
  return g;
}

// A fat paint marker, its nib down its local -z: the band and the nib show the paint it's loaded with.
const MARKER_SCALE = 1.4;
// a marker nobody's used yet: a colour of its own (from its id), not the cycling 'random'
const restingPaint = id => PAINT_COLORS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PAINT_COLORS.length];
function markerModel() {
  const g = new THREE.Group(), m = new THREE.Group(); m.scale.setScalar(MARKER_SCALE); g.add(m);
  const Z = [Math.PI / 2, 0, 0], NZ = [-Math.PI / 2, 0, 0];
  const body = std(0x18191c, .45, .25), metal = std(0xc4c8ce, .28, .92), nib = std(0xffffff, .6, 0), band = std(0xffffff, .4, .05);
  part(m, new THREE.CylinderGeometry(.0135, .0135, .11, 20), body, [0, 0, .005], Z);                  // barrel
  part(m, new THREE.CylinderGeometry(.0137, .0137, .028, 20), band, [0, 0, .028], Z);                 // the colour band
  part(m, new THREE.CylinderGeometry(.0128, .0135, .012, 20), body, [0, 0, .066], Z);                 // end
  part(m, new THREE.SphereGeometry(.0128, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), body, [0, 0, .072], Z);
  part(m, new THREE.CylinderGeometry(.0135, .011, .018, 20), metal, [0, 0, -.059], Z);                // ferrule
  part(m, new THREE.CylinderGeometry(.0035, .0062, .016, 12), nib, [0, 0, -.076], NZ);                // nib
  for (let i = 0; i < 3; i++) part(m, new THREE.TorusGeometry(.0135, .0008, 4, 20), metal, [0, 0, -.045 + i * .004]);   // grip rings
  let shown = null;
  const setPaint = (color, palette) => {
    const c = color < 0 ? palette[(Math.floor(performance.now() / 700)) % palette.length] : color;   // (random: it cycles)
    if (c === shown) return c;
    shown = c; nib.color.setHex(c); band.color.setHex(c);
    return c;
  };
  g.userData = {tip: new THREE.Vector3(0, 0, -.085 * MARKER_SCALE), ground: .0135 * MARKER_SCALE, groundRoll: Math.PI / 2, setPaint};
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
// A painting is never a blank canvas: every picture comes small in one atlas, loaded before the space fades
// in, and that's on each painting from the start. Bigger versions go on as you get near: the 512 px one within
// ART_MID, the full one (ART_PX on its long side: 512 on a phone) within ART_NEAR, and come off again a good
// way further out (each painting's own hysteresis, so nothing flickers between the two at the edge). "Near" is
// measured from you and from where you'll be in a moment at the speed you're going (a bunnyhop run looks well
// ahead), and files are fetched a few at a time, nearest first, only when they're wanted: never the lot.
const ART_PX = globalThis.matchMedia?.('(pointer: coarse)').matches ? 512 : 1024;
const ART_NEAR = 10, ART_NEAR_OFF = 16, ART_MID = 24, ART_MID_OFF = 34;   // metres
const ART_AHEAD = [.5, 1.2, 2.2], ART_AHEAD_MAX = 80;   // seconds looked ahead at your speed (and no further than that)
let previewTex = null, previewsReady = Promise.resolve();
const previewViews = [];             // each painting's window onto it (they share the one image: uploaded once)
function previews() {
  if (!previewTex) {
    previewTex = new THREE.Texture();
    previewTex.colorSpace = THREE.SRGBColorSpace; previewTex.anisotropy = 4;
    previewsReady = new Promise(done => {
      const img = new Image();
      img.onload = () => { previewTex.image = img; previewTex.needsUpdate = true; for (const t of previewViews) t.needsUpdate = true; done(); };
      img.onerror = () => done();
      img.src = PREVIEW.url;
    });
  }
  return previewTex;
}
// a painting's own window onto the atlas (they all share the one image, uploaded once)
function previewOf(art) {
  const k = ART_IDS.indexOf(art), atlas = previews();
  if (k < 0) return primedTex;
  const t = atlas.clone(), cell = PREVIEW.tile + 2 * PREVIEW.pad, rows = Math.ceil(ART_IDS.length / PREVIEW.cols);
  const W = PREVIEW.cols * cell, H = rows * cell, r = Math.floor(k / PREVIEW.cols), c = k % PREVIEW.cols;
  t.repeat.set(PREVIEW.tile / W, PREVIEW.tile / H);
  t.offset.set((c * cell + PREVIEW.pad) / W, 1 - (r * cell + PREVIEW.pad + PREVIEW.tile) / H);
  previewViews.push(t);
  if (atlas.image) t.needsUpdate = true;
  return t;
}
// the pictures' files, fetched once and kept (compressed: about 130 KB each at 1024 px, 40 at 512), a few at a
// time and the most wanted first (prio: how far off it's wanted, less is sooner); ones nobody wants any more by
// the time their turn comes are skipped
const artFiles = new Map();          // `${art}/${px}` -> Promise<Blob>
// a picture with no small copies (from anywhere in the collection): its original, fetched once for every size
const originals = new Map();         // art -> Promise<Blob>
function original(art, get) {
  if (!originals.has(art)) { const p = get(artOriginal(art)); originals.set(art, p); p.catch(() => originals.delete(art)); }
  return originals.get(art);
}
const fetchQueue = [];               // {key, art, px, prio, wanted(), resolve, reject}
let fetching = 0;
const MAX_FETCHES = 4;
function pumpFetches() {
  while (fetching < MAX_FETCHES && fetchQueue.length) {
    let k = 0;
    for (let i = 1; i < fetchQueue.length; i++) if (fetchQueue[i].prio < fetchQueue[k].prio) k = i;
    const job = fetchQueue.splice(k, 1)[0];
    if (!job.wanted()) { artFiles.delete(job.key); job.reject(new Error('not wanted')); continue; }
    fetching++;
    const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.blob(); });
    (ART[job.art] ? get(artFile(job.art, job.px)) : Promise.reject()).catch(() => original(job.art, get))      // (not made small: the original)
      .then(job.resolve, e => { artFiles.delete(job.key); job.reject(e); })
      .finally(() => { fetching--; pumpFetches(); });
  }
}
function artFile_(art, px, prio = 0, wanted = () => true) {
  const key = `${art}/${px}`;
  if (!artFiles.has(key)) {
    let job;
    const p = new Promise((resolve, reject) => { job = {key, art, px, prio, wanted, resolve, reject}; });
    p.catch(() => {});
    artFiles.set(key, p); fetchQueue.push(job);
    queueMicrotask(pumpFetches);                // (once this frame's wants are all in: nearest first)
  } else {
    const queued = fetchQueue.find(j => j.key === key);          // wanted sooner now: moved up
    if (queued) { queued.prio = Math.min(queued.prio, prio); queued.wanted = wanted; }
  }
  return artFiles.get(key);
}
async function artImage(art, px, prio, wanted) {
  const blob = await artFile_(art, px, prio, wanted), url = URL.createObjectURL(blob), img = new Image();
  try { img.src = url; await img.decode(); } finally { URL.revokeObjectURL(url); }
  if (Math.max(img.width, img.height) <= px * 1.05) return img;
  const k = px / Math.max(img.width, img.height), c = document.createElement('canvas');      // an original: drawn down
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
// the textures on the GPU: `${art}/${px}` -> {texture (once it's in), users: materials showing (or waiting for) it,
// ready, failed: when}. Shared by every painting of the same picture; dropped as soon as nothing shows it.
const artTextures = new Map();
function acquireArt(art, px, material, prio) {
  const key = `${art}/${px}`;
  let a = artTextures.get(key);
  if (!a && spare.has(key)) { a = spare.get(key); spare.delete(key); artTextures.set(key, a); }
  if (a?.failed && performance.now() - a.failed < 30000) return null;     // (tried a moment ago: wait a bit)
  if (!a || a.failed) {
    const b = a = {texture: null, users: new Set([material]), failed: 0};
    artTextures.set(key, b);
    b.ready = artImage(art, px, prio, () => b.users.size > 0).then(img => {
      if (!b.users.size) { if (artTextures.get(key) === b) artTextures.delete(key); return; }   // gone out of sight meanwhile
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
      b.texture = t;
    }, () => {
      if (artTextures.get(key) === b) { if (b.users.size) b.failed = performance.now(); else artTextures.delete(key); }
      for (const m of b.users) if (m.userData.pending === key) { m.userData.pending = null; m.userData.want = null; }
      b.users.clear();
    });
  } else artFile_(art, px, prio, () => a.users.size > 0);          // (still queued: moved up if it's wanted sooner now)
  a.users.add(material);
  return a;
}
// Pictures nobody shows any more stay on the GPU a while (the last few of each size) in case you come back
// round: on a fast lap they're there again at once instead of decoded over.
const SPARE = {512: 28, 1024: 8};
const spare = new Map();             // key -> entry, oldest first
function releaseArt(key, material) {
  const a = key && artTextures.get(key);
  if (!a) return;
  a.users.delete(material);
  if (a.users.size || !a.texture) return;
  artTextures.delete(key);
  spare.delete(key); spare.set(key, a);
  const px = key.split('/')[1], keep = SPARE[px] ?? 4;
  const mine = [...spare.keys()].filter(k => k.endsWith(`/${px}`));
  for (let i = 0; i < mine.length - keep; i++) { spare.get(mine[i]).texture.dispose(); spare.delete(mine[i]); }
}
// Which picture a painting's canvas shows: 0 the small one (from the atlas), or px. The one it has stays on
// until the new one's in, so it never goes back to small in between.
function setArt(art, material, preview, px, prio = 0) {
  const u = material.userData;
  if (u.want === px) return;
  u.want = px;
  if (u.pending && u.pending !== u.held) releaseArt(u.pending, material);
  u.pending = null;
  if (!px) { material.map = preview; releaseArt(u.held, material); u.held = null; return; }
  const key = `${art}/${px}`;
  if (u.held === key) { material.map = artTextures.get(key)?.texture || material.map; return; }
  const a = acquireArt(art, px, material, prio);
  if (!a) { u.want = null; return; }
  u.pending = key;
  const apply = () => {
    if (u.pending !== key || !a.texture) return;
    material.map = a.texture;
    if (u.held && u.held !== key) releaseArt(u.held, material);
    u.held = key; u.pending = null;
  };
  if (a.texture) apply(); else a.ready.then(apply);
}
// the picture a painting should show `far` metres from you (hysteresis from what it wants now)
// near: from you or just ahead; far: from you or anywhere you're about to be. The full picture goes by near, the
// middle one by far, so on a fast run the middle ones for what's coming go first and the full ones fill in.
function artTier(near, far, now) {
  if (ART_PX > 512 && (near < ART_NEAR || (now === ART_PX && near < ART_NEAR_OFF))) return ART_PX;
  if (far < ART_MID || (now && far < ART_MID_OFF)) return 512;
  return 0;
}
let woodTex = null, linenTex = null, primedTex = null, paintingMats = null;
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
  primedTex ||= primedTexture();
  const preview = previewOf(art);
  const canvasMat = new THREE.MeshStandardMaterial({map: preview, roughness: .82, metalness: 0});   // the full picture goes on when it comes near
  const front = new THREE.Mesh(geo(), canvasMat); front.name = 'canvas'; g.add(front);
  // sides: the weave running along each edge
  const tw = w * 4, th = h * 4, td = d * 4;
  quad([[-x, y, d], [x, y, d], [x, y, 0], [-x, y, 0]], [[0, td], [tw, td], [tw, 0], [0, 0]]);       // top
  quad([[-x, -y, 0], [x, -y, 0], [x, -y, d], [-x, -y, d]], [[0, 0], [tw, 0], [tw, td], [0, td]]);   // bottom
  quad([[x, -y, d], [x, -y, 0], [x, y, 0], [x, y, d]], [[td, 0], [0, 0], [0, th], [td, th]]);       // right
  quad([[-x, -y, 0], [-x, -y, d], [-x, y, d], [-x, y, 0]], [[0, 0], [td, 0], [td, th], [0, th]]);   // left
  // (the materials other than the picture's are the same for every painting: made once, shared)
  woodTex ||= grainTexture(); linenTex ||= linenTexture();
  paintingMats ||= {
    primed: new THREE.MeshStandardMaterial({map: primedTex, roughness: .9, metalness: 0}),
    linen: new THREE.MeshStandardMaterial({map: linenTex, roughness: .95, metalness: 0, side: THREE.DoubleSide}),
    wood: new THREE.MeshStandardMaterial({map: woodTex, roughness: .75, metalness: 0}),
    staple: std(0x9a9ca0, .4, .8),
  };
  part(g, geo(), paintingMats.primed);
  // the back: raw canvas behind the picture, folded over the stretcher's back edge and stapled
  const {linen, wood, staple} = paintingMats;
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
  g.userData = {tip: new THREE.Vector3(0, 0, d), ground: .002, painting: true, w, h, d, art, canvas: front, outline: ob,
    // its back (raw canvas, stretcher, staples): not drawn while it hangs on a wall, where nothing can see it
    backMats: [paintingMats.linen, paintingMats.wood, paintingMats.staple],
    // which picture it shows, by how far it is from you (src/items.js frame)
    artAt: (near, far = near) => { const px = artTier(near, far, canvasMat.userData.want) || (ART[art] ? 0 : 512);    // (one from the converter has no small one in the atlas)
      setArt(art, canvasMat, preview, px, px > 512 ? near + 12 : far); },
    artReady: () => { const k = canvasMat.userData.pending; return k ? artTextures.get(k)?.ready : null; }};
  return g;
}

// a painting's back on or off (its parts found once, after they're merged)
function showBack(model, u, on) {
  if (u.backOn === on) return;
  if (!u.backParts) { u.backParts = []; model.traverse(o => { if (o.isMesh && u.backMats.includes(o.material)) u.backParts.push(o); }); }
  for (const o of u.backParts) o.visible = on;
  u.backOn = on;
}


// --------------------------------------------------------------- Super Metal Mons pieces (src/pieces.js)
// The mons are the figures in assets/mons/pieces.glb (tools/mons_pieces.py), glazed like the ceramic ones, each
// its own colour; their shapes arrive with the file (an empty stand-in till then, filled in place, so the
// outline that shares it fills in too). The mana, supermana, bombs and potions are made here.
const PIECES_URL = new URL('../assets/mons/pieces.glb', import.meta.url).href;
const shared = new Map();       // piece id -> where it's nudged to, sharing its square
const monGeos = new Map();
let piecesLoading = null;
function monGeometry(name) {
  let g = monGeos.get(name);
  if (!g) {
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3)); g.setIndex([0, 1, 2]);
    monGeos.set(name, g);
  }
  piecesLoading ||= new GLTFLoader().loadAsync(PIECES_URL).then(gltf => {
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const n = o.name.replace(/^mon-/, ''), src = o.geometry;
      const geo = monGeos.get(n) || monGeos.set(n, new THREE.BufferGeometry()).get(n);
      geo.setAttribute('position', src.attributes.position); geo.setIndex(src.index);
      geo.computeVertexNormals(); geo.computeBoundingBox(); geo.computeBoundingSphere();
    });
  }).catch(err => console.warn('pieces:', err));
  return g;
}
// glazes: the "Daydreaming" pastels (thirty of them, red round to pink), each mon given one at random (the same
// shuffle everywhere, so everyone sees the same colours)
const PASTELS = [0xffbdbc, 0xfaaa9e, 0xffbfa3, 0xfebf90, 0xffce92, 0xffdb91, 0xfee590, 0xfff097, 0xebed8d, 0xdceb8f,
  0xd4ed9c, 0xc0e78f, 0xb3e698, 0xa1edbc, 0xa5edd9, 0xb0f2f3, 0xa2dbf5, 0xb8d8f4, 0xa7c3f5, 0xa5b4f3,
  0xb5aef4, 0xc0abf4, 0xcaa3f7, 0xe1afff, 0xf2b9fe, 0xfec0fc, 0xfeb7e6, 0xfeb4cb, 0xffb1b7, 0xffc7c5];
const PASTEL_ORDER = (() => {
  const o = PASTELS.map((_, i) => i);
  let r = 1111;
  for (let i = o.length - 1; i > 0; i--) { r = (r * 16807) % 2147483647; const j = r % (i + 1); [o[i], o[j]] = [o[j], o[i]]; }
  return o;
})();
const glazeOf = k => PASTELS[PASTEL_ORDER[k % PASTELS.length]];
const glaze = color => new THREE.MeshStandardMaterial({color, roughness: .22, metalness: 0, emissive: color, emissiveIntensity: .1});
function monModel(id) {
  const name = id.slice(4), k = MONS.indexOf(name);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(monGeometry(name), glaze(glazeOf(k < 0 ? [...name].length : k))));
  g.userData = {tip: new THREE.Vector3(0, .12, 0), ground: 0, standing: true, piece: true};
  return g;
}
// a mana drop: round at the bottom, drawn up to a point
function manaModel(id) {
  const white = id.startsWith('mana-w'), g = new THREE.Group(), pts = [];
  // the classic teardrop, x = sin t sin(t/2)^m, y = cos t: round at t = pi (the bottom), a point at t = 0 (the top)
  for (let k = 0; k <= 32; k++) {
    const t = Math.PI * (1 - k / 32);
    pts.push(new THREE.Vector2(Math.max(.07 * Math.sin(t) * Math.pow(Math.sin(t / 2), 1.3), 1e-4), .055 * (1 + Math.cos(t))));
  }
  part(g, new THREE.LatheGeometry(pts, 28), new THREE.MeshStandardMaterial({color: white ? 0xf4f2ec : 0x16161b, roughness: .16, metalness: white ? 0 : .1, emissive: white ? 0x3a3936 : 0}));
  g.userData = {tip: new THREE.Vector3(0, .1, 0), ground: 0, standing: true, piece: true};
  return g;
}
// the supermana: a little white cat of a thing, round, with ears and dark eyes
function supermanaModel() {
  const g = new THREE.Group(), white = glaze(0xf3f5f8), dark = new THREE.MeshStandardMaterial({color: 0x1c2230, roughness: .15});
  const body = part(g, new THREE.SphereGeometry(.058, 28, 20), white, [0, .056, 0]); body.scale.set(1.1, .95, 1);
  part(g, new THREE.SphereGeometry(.05, 24, 16), white, [0, .118, .004]);                    // head
  for (const s of [-1, 1]) {
    part(g, new THREE.ConeGeometry(.02, .042, 16), white, [s * .03, .165, 0], [0, 0, -s * .38]);   // ears
    const eye = part(g, new THREE.SphereGeometry(.0105, 12, 8), dark, [s * .019, .122, .045]); eye.scale.set(1, 1.3, .6);
  }
  g.userData = {tip: new THREE.Vector3(0, .12, 0), ground: 0, standing: true, piece: true};
  return g;
}
// a bomb (black, a fuse cap on top) or a potion (pink, a white stopper)
function orbModel(id) {
  const bomb = id.startsWith('bomb'), g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({color: bomb ? 0x111114 : 0xf2a9c4, roughness: .14, metalness: bomb ? .15 : 0});
  const cap = new THREE.MeshStandardMaterial({color: bomb ? 0x2a2a2e : 0xf6f1ea, roughness: .25});
  part(g, new THREE.SphereGeometry(.048, 28, 20), body, [0, .048, 0]);
  part(g, new THREE.CylinderGeometry(.012, .016, .02, 16), bomb ? cap : body, [0, .1, 0]);
  part(g, new THREE.SphereGeometry(.012, 14, 10), cap, [0, .114, 0]);
  if (bomb) for (const s of [-1, 1]) part(g, new THREE.SphereGeometry(.006, 10, 8), new THREE.MeshBasicMaterial({color: 0xe0302a}), [s * .016, .058, .044]);
  g.userData = {tip: new THREE.Vector3(0, .1, 0), ground: 0, standing: true, piece: true};
  return g;
}
function pieceModel(id) {
  if (id.startsWith('egg-')) return eggModel(id);
  if (id.startsWith('mon-')) return monModel(id);
  if (id.startsWith('mana-')) return manaModel(id);
  if (id === 'smana') return supermanaModel();
  return orbModel(id);
}

// --------------------------------------------------------------- the radio (src/radio.js plays it)
// A portable AM/FM set: a grey case with the speaker grille on the left, the lit dial window on the right, tone,
// volume and band knobs under it, tuning on the side, a black carry handle and a telescopic aerial. Its front
// is its +z; it stands on its feet (y = 0).
function radioFace() {
  const c = document.createElement('canvas'); c.width = 680; c.height = 400;
  const g = c.getContext('2d');
  g.fillStyle = '#5d6064'; g.fillRect(0, 0, 680, 400);
  // the grille: a dark panel of little holes
  g.fillStyle = '#26282b'; g.beginPath(); g.roundRect(14, 22, 280, 356, 18); g.fill();
  g.fillStyle = '#121314';
  for (let y = 34; y < 368; y += 9) for (let x = 26 + (y % 18 ? 4 : 0); x < 284; x += 9) { g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); }
  // the dial window
  g.fillStyle = '#0b0b0c'; g.beginPath(); g.roundRect(318, 26, 344, 218, 12); g.fill();
  g.fillStyle = '#e8ebe6'; g.font = 'bold 22px Arial, sans-serif'; g.fillText('MD-T16', 332, 60);
  g.font = '11px Arial, sans-serif'; g.fillText('AM/FM 2BAND PORTABLE RADIO', 428, 58);
  g.font = '15px Arial, sans-serif';
  g.fillText('FM', 332, 92); ['87', '92', '96', '100', '104', '108'].forEach((t, i) => g.fillText(t, 372 + i * 44, 92)); g.fillText('MHz', 626, 92);
  for (const y of [102, 170]) {
    g.fillStyle = '#d9f2cf'; g.fillRect(318, y, 344, 9); g.fillRect(318, y + 22, 344, 9);
    g.fillStyle = '#111'; g.fillRect(370, y + 6, 262, 20);
  }
  g.fillStyle = '#f4e35a'; g.fillRect(540, 109, 8, 17); g.fillRect(568, 177, 8, 17);
  g.fillStyle = '#e8ebe6'; g.fillText('AM', 332, 226); ['520', '700', '900', '1150', '1400', '1710'].forEach((t, i) => g.fillText(t, 368 + i * 44, 226)); g.fillText('kHz', 630, 226);
  // the labels under it
  g.fillStyle = '#eceeed'; g.font = 'bold 15px Arial, sans-serif';
  g.fillText('TONE', 334, 282); g.fillText('VOLUME', 452, 268); g.fillText('RADIO', 584, 282);
  g.font = '11px Arial, sans-serif'; g.fillText('LOW  HIGH', 326, 298); g.fillText('MIN', 430, 300); g.fillText('MAX', 540, 300); g.fillText('AM   FM', 584, 298);
  g.fillText('ON', 440, 360); g.fillText('OFF', 438, 376);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const RADIO_SCALE = 1.5;     // (a 51 cm set: drawn half as big again as first made)
function radioModel() {
  const top = new THREE.Group(), g = new THREE.Group(), W = .34, H = .2, D = .1, foot = .008;
  g.scale.setScalar(RADIO_SCALE); top.add(g);
  const grey = std(0x5d6064, .45, .35), black = std(0x141516, .55, .2), chrome = std(0xd8dade, .2, .95);
  const face = new THREE.MeshStandardMaterial({map: radioFace(), roughness: .5, metalness: .2});
  part(g, new THREE.BoxGeometry(W, H, D), [grey, grey, grey, grey, face, grey], [0, foot + H / 2, 0]);
  // a slightly rounded look: soft edge strips
  for (const s of [-1, 1]) part(g, new THREE.CylinderGeometry(.012, .012, H - .01, 8), grey, [s * (W / 2 - .002), foot + H / 2, D / 2 - .008]);
  for (const x of [-W / 2 + .03, W / 2 - .03]) for (const z of [-D / 2 + .02, D / 2 - .02]) part(g, new THREE.BoxGeometry(.03, foot, .02), black, [x, foot / 2, z]);
  // knobs: tone, volume (big), band
  const knob = (x, y, r, h) => { part(g, new THREE.CylinderGeometry(r, r * 1.05, h, 18), black, [x, y, D / 2 + h / 2], [Math.PI / 2, 0, 0]); part(g, new THREE.BoxGeometry(r * .3, r * 1.6, .004), black, [x, y, D / 2 + h + .001]); };
  const fx = u => -W / 2 + u * W, fy = v => foot + H - v * H;
  knob(fx(.508), fy(.82), .016, .014); knob(fx(.7), fy(.8), .026, .02); knob(fx(.89), fy(.82), .016, .014);
  part(g, new THREE.CylinderGeometry(.024, .024, .02, 20), black, [W / 2 + .01, foot + H * .55, 0], [0, 0, Math.PI / 2]);   // tuning
  // the handle: two posts and a bar
  for (const s of [-1, 1]) part(g, new THREE.BoxGeometry(.016, .07, .022), black, [s * (W / 2 - .03), foot + H + .035, -.01]);
  part(g, new THREE.BoxGeometry(W - .03, .018, .03), black, [0, foot + H + .074, -.01]);
  // the aerial: from a swivel on the top right corner, up and back at an angle
  const base = new THREE.Vector3(W / 2 - .035, foot + H + .004, -.03), L = .36;
  part(g, new THREE.CylinderGeometry(.008, .009, .01, 10), chrome, [base.x, base.y, base.z]);
  const tilt = new THREE.Euler(-.3, 0, .5), dir = new THREE.Vector3(0, 1, 0).applyEuler(tilt);
  const mid = base.clone().addScaledVector(dir, L / 2);
  const aer = part(g, new THREE.CylinderGeometry(.0025, .0042, L, 6), chrome, [mid.x, mid.y, mid.z], [tilt.x, tilt.y, tilt.z]);
  part(aer, new THREE.SphereGeometry(.006, 8, 6), chrome, [0, L / 2, 0]);
  top.userData = {tip: new THREE.Vector3(0, .15 * RADIO_SCALE, 0), ground: 0, standing: true, radio: true};
  return top;
}

const MODELS = {flashlight: flashlightModel, paintball: paintballModel, spray: sprayModel, bucket: bucketModel, crown: crownModel, painting: paintingModel, marker: markerModel, piece: pieceModel, radio: radioModel};
export const ITEM_MODELS = MODELS;   // for previews

// ------------------------------------------------------------------- falling
// A dropped item's fall through the level: gravity, a couple of soft bounces, a skid to a stop.
// Pure and fixed-step, so every client works out the same path from the same start.
const FALL_DT = 1 / 60;
// a painting in someone's hands as everyone else sees it (and you, in third person): held out in front in both
// hands, one on each side edge. Where its back's middle is from their chest (ahead, to the right), how high the
// hands are from the chest, how it's turned from the way they face, and where the hands are on it (down the side
// edges from its middle, as a share of its height). Their arms are short (about half a metre from the shoulder:
// src/avatar.js), so it's close in and at chest height for both hands to reach.
const HELD_PAINTING = {ahead: .35, right: .02, up: .02, turn: -.1, tilt: .08, roll: .01, grip: .06};
// the arms reached to where the hands hold it, after the body's animation has posed them: a two-bone reach
// (shoulder to elbow to wrist), the elbow bent down and out to the side
const reachV = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const reachQ = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
function turnBoneToward(bone, from, to) {
  // turn `bone` (in the world) so the direction `from` becomes `to` (both unit vectors)
  const [q, w, p] = reachQ;
  q.setFromUnitVectors(from, to);
  bone.getWorldQuaternion(w); w.premultiply(q);
  bone.parent.getWorldQuaternion(p).invert();
  bone.quaternion.copy(p.multiply(w));
  bone.updateMatrixWorld(true);
}
function reachArm(upper, fore, hand, target, pole) {
  const [S, E, H, dir, bend, t] = reachV;
  upper.getWorldPosition(S); fore.getWorldPosition(E); hand.getWorldPosition(H);
  const a = S.distanceTo(E), b = E.distanceTo(H);
  if (a < 1e-4 || b < 1e-4) return;
  dir.subVectors(target, S); const d = THREE.MathUtils.clamp(dir.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3); dir.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  bend.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  // the elbow where it has to be, then the upper arm turned to it, then the forearm to the hand's place
  t.copy(S).addScaledVector(dir, a * cosA).addScaledVector(bend, a * sinA);
  turnBoneToward(upper, E.sub(S).normalize(), t.sub(S).normalize());
  fore.getWorldPosition(E); hand.getWorldPosition(H);
  turnBoneToward(fore, H.sub(E).normalize(), t.subVectors(target, E).normalize());
}
// both hands on a held painting `m` (u: its userData) of `avatar`, facing yaw
const gripV = [new THREE.Vector3(), new THREE.Vector3()];
function holdPainting(avatar, m, u, yaw) {
  const arms = avatar.arms ||= ['R', 'L'].map(s => ({side: s === 'R' ? 1 : -1,
    upper: avatar.model.getObjectByName('UpperArm' + s), fore: avatar.model.getObjectByName('Forearm' + s), hand: avatar.model.getObjectByName('Hand' + s)}));
  const [target, pole] = gripV, rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  for (const arm of arms) {
    if (!arm.upper || !arm.fore || !arm.hand) continue;
    // the wrist just outside the side edge (the fist closes round it), a little toward the holder
    m.localToWorld(target.set(arm.side * (u.w / 2 + .035), -u.h * HELD_PAINTING.grip, u.d * .6));
    pole.set(rx * arm.side * .7 - fx * .25, -1, rz * arm.side * .7 - fz * .25);
    reachArm(arm.upper, arm.fore, arm.hand, target, pole);
  }
}
const PREDICT_MS = 3000;       // how long something you picked up or put down is shown so before the server's had its say
export const PATH_HZ = 15;     // a painting's recorded tumble (src/settle.js); played back smoothed between frames
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
// The small parts of a model that never move against each other, merged: per parent and material, the
// same triangles in the same places, drawn in one go instead of one draw (or two) per part. Left alone:
// anything the code reaches for later (in userData), transparent or ordered parts, instanced ones,
// mirrored ones (baking a mirror would turn their faces inside out), and parts with children.
export function mergeParts(model) {
  const keep = new Set();
  const mark = v => { if (v?.isObject3D) v.traverse(o => keep.add(o)); else if (Array.isArray(v)) v.forEach(mark); };
  for (const v of Object.values(model.userData)) mark(v);
  const lists = new Map();
  model.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || keep.has(o) || Array.isArray(o.material) || o.material.transparent
      || o.renderOrder || o.children.length || !o.visible || o.geometry.morphAttributes.position) return;
    o.updateMatrix();
    if (o.matrix.determinant() <= 0) return;
    const key = `${o.parent.uuid}/${o.material.uuid}`;
    (lists.get(key) || lists.set(key, []).get(key)).push(o);
  });
  for (const list of lists.values()) {
    if (list.length < 2) continue;
    const names = Object.keys(list[0].geometry.attributes).sort().join();
    if (!['normal,position', 'normal,position,uv'].includes(names) || list.some(m => Object.keys(m.geometry.attributes).sort().join() !== names)) continue;
    const geos = list.map(m => {
      const g = m.geometry.clone().applyMatrix4(m.matrix);
      if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
      return g;
    });
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow;
    list[0].parent.add(mesh);
    for (const m of list) m.removeFromParent();
  }
  return model;
}
export function addOutline(model) {
  const shells = new THREE.Group(); shells.visible = false;
  const meshes = [];
  const u = model.userData;
  if (u.outline) meshes.push(new THREE.Mesh(u.outline));   // a shape made for glowing round
  else model.traverse(o => { if (o.isMesh) meshes.push(o); });
  const mats = u.outline && u.painting ? boxOutlineMaterials(new THREE.Vector3(-u.w / 2, -u.h / 2, 0), new THREE.Vector3(u.w / 2, u.h / 2, u.d)) : OUTLINES;
  for (const o of meshes) for (const mat of mats) {
    const shell = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, mat, o.count) : new THREE.Mesh(o.geometry, mat);
    if (o.isInstancedMesh) { shell.instanceMatrix = o.instanceMatrix; shell.boundingSphere = o.boundingSphere; }
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
const _m = new THREE.Matrix4(), _onHead = new THREE.Matrix4(), _eye = new THREE.Vector3();

// onImpact(item, speed, position): something falling or tumbling hit something (for its sound)
export function createItems({scene, camera, hits, shadows = null, onImpact = null}) {
  const items = new Map();          // id -> {state, model, kick}
  const spots = [];                 // real spotlights so avatars catch the beams
  const slotOf = new Map(), used = new Array(MAX_FLASHLIGHTS).fill(false);   // torch id -> its beam slot
  const lit = [];                   // switched-on flashlights this frame, nearest first
  let myPaint = RANDOM_PAINT;       // the colour you've loaded into the gun
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
  const ahead = ART_AHEAD.map(() => new THREE.Vector3());

  // start the way a state arrives: a fall eased onto where it settled, or a painting's tumble
  function play(it, fall, path) {
    const state = it.state;
    it.fly = null;
    it.path = Array.isArray(path) && path.length > 1 && !state.holder ? {frames: path, t: 0} : null;
    if (it.path) it.fall = null;
    else if (fall && hits && !state.holder) {
      const f = simulateFall(hits, fall.p, fall.v);
      // the server's resting spot is the word: ease the difference in over the whole fall, not a jump at the end
      const last = f.path.length - 1, err = new THREE.Vector3(state.x, state.y, state.z).sub(f.path[last]);
      f.path.forEach((q, i) => q.addScaledVector(err, last ? i / last : 1));
      it.fall = {path: f.path, t: 0};
    } else it.fall = null;
    return it;
  }

  function ensure(state) {
    let it = items.get(state.id);
    const reart = it && state.type === 'painting' && it.state.art !== state.art;       // (the converter's made it another picture)
    if (!it || it.state.type !== state.type || reart) {
      const old = it?.model;
      if (old) {
        old.removeFromParent();
        if (reart) { const cm = old.userData.canvas?.material; if (cm) { cm.userData.want = -1; setArt(it.state.art, cm, null, 0); } }
      }
      const model = mergeParts((MODELS[state.type] || flashlightModel)(state.id, state));
      // paint and tags on it come over to the new one
      if (reart) for (const c of [...old.children]) if (c.userData.keep) model.add(c);
      // items are culled like anything else when they're out of view (they only ever move, so their bounds hold)
      model.traverse(o => { o.castShadow = false; });
      const prev = it;
      it = {state, model, sway: 0, kick: 0, shake: 0, outline: addOutline(model), fall: null};
      if (reart) { model.position.copy(prev.model.position); model.quaternion.copy(prev.model.quaternion); }
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

  // While something's falling or tumbling: a sudden change in how it's moving is it hitting something (the
  // floor, a wall, another painting), the harder the louder. Coming to rest counts too, if it was still going.
  function bumps(it, p, moving, dt, clock) {
    if (!moving && !it.was) return;
    if (it.was && dt > 1e-3) {
      const vx = (p.x - it.was.x) / dt, vy = (p.y - it.was.y) / dt, vz = (p.z - it.was.z) / dt;
      if (it.vel) {
        const dv = Math.hypot(vx - it.vel[0], vy - it.vel[1], vz - it.vel[2]);
        if (dv > 2.2 && (vy - it.vel[1] > 1.2 || !moving) && clock - (it.bumpAt || 0) > 70) { it.bumpAt = clock; onImpact?.(it, dv, p); }
      }
      it.vel = [vx, vy, vz];
    }
    if (moving) (it.was ||= new THREE.Vector3()).copy(p); else it.was = it.vel = null;
  }

  previews();                          // the pictures' atlas: on its way from the start
  return {
    items,
    // everything as the server has it (on joining, or when someone comes back): whatever you've been shown
    // ahead of the server holds while the server catches up
    set(list) { for (const s of list) this.update(s, null, null, false, false); },
    // the small pictures, all of them (the space waits for these before it fades in)
    get previewsReady() { return previewsReady; },
    // the bigger pictures on the paintings round a point, put on now; settles once they're in (or have failed)
    artNear(center) {
      const waits = [];
      for (const it of items.values()) {
        const s = it.state, u = it.model.userData;
        if (!u.artAt || s.holder) continue;
        u.artAt(Math.hypot(s.x - center.x, s.y - center.y, s.z - center.z));
        const r = u.artReady();
        if (r) waits.push(r);
      }
      return Promise.allSettled(waits);
    },
    // a new state from the server; with a fall, it drops from where it was let go to where it settled; with a
    // path (a painting's tumble, worked out by whoever let it go), it plays that: [x, y, z, qx, qy, qz, qw] at PATH_HZ.
    // `refused`: the server turned down what you asked for (a pickup or a drop), and this is how things really are.
    // Returns true when this is the server saying yes to what you'd already been shown (src/main.js: predict).
    update(state, fall, path, refused = false, animate = true) {
      const it = items.get(state.id), p = it?.pending;
      if (p && !refused) {
        const holder = state.holder || null;
        if (holder === p.holder) {
          // yes: it carries on as it is (in your hand, or on its way down just as it was going), unless the
          // server has it somewhere else (well off where you put it): then that's where it goes
          it.pending = null; it.server = null;
          const off = !holder && Math.hypot(state.x - it.state.x, state.y - it.state.y, state.z - it.state.z) > .05;
          if (!off) { it.state = {...state}; return true; }
        } else if (!holder || holder === p.me) {
          // news from before the server got to yours (it's dealt with in order): kept for if yours comes to nothing
          it.server = {...state};
          return false;
        } else { it.pending = null; it.server = null; }        // someone else got there first
      }
      if (it) { it.pending = null; it.server = null; }
      const now = ensure(state);
      if (animate) play(now, fall, path);
      return false;
    },
    // Show something happening straight away, before the server has said so: picked up (in your hand this
    // frame), or put down / dropped (where it's going, falling or tumbling there). The server's answer
    // then just confirms it (update); if it turns it down, or never answers, back it goes.
    // patch: the state as it'll be; fall / path: as for update; me: your id.
    predict(id, patch, {fall = null, path = null, me = null} = {}) {
      const it = items.get(id);
      if (!it) return;
      if (!it.pending) it.server = {...it.state};
      it.pending = {holder: patch.holder ?? null, me, until: performance.now() + PREDICT_MS};
      it.state = {...it.state, ...patch};
      play(it, fall, path);
    },
    // a painting tumbling just now (its physics having been worked out after you let it go): start its path,
    // `ahead` seconds in, so one already thrown carries on from where it's got to
    tumble(id, path, ahead = 0) {
      const it = items.get(id);
      if (it && Array.isArray(path) && path.length > 1) { it.path = {frames: path, t: Math.max(0, ahead)}; it.fall = null; it.fly = null; }
    },
    // a painting let go of, flying on from your hand while its physics is worked out (ballistic, no tumbling yet)
    fly(id, from, vel) {
      const it = items.get(id);
      if (it) { it.fly = {from: {...from}, v: [...vel], t: 0}; it.path = it.fall = null; }
    },
    // being worked out (a painting's physics): not to be picked up again until it's settled
    busy(id, on) { const it = items.get(id); if (it) it.busy = on; },
    // which item (if any) shows the pick-up glow
    highlight(id) { highlighted = id; },
    heldBy(id) { for (const it of items.values()) if (it.state.holder === id && !worn(it.state)) return it; return null; },
    // the crown on this player's head, if they have it on
    wornBy(id) { for (const it of items.values()) if (it.state.holder === id && worn(it.state)) return it; return null; },
    // a paintball gun's hopper refilled: the reload played (theirs or yours), full at the end of it
    reload(id) { const it = items.get(id); if (it && it.state.type === 'paintball' && !it.reload) it.reload = {t: 0, from: it.state.ammo ?? MAG_SIZE}; },
    reloading(id) { return !!items.get(id)?.reload; },
    // a marker bearing down (drawing): your view model's
    drawing(id, on) { const it = items.get(id); if (it) it.drawing = on; },
    // a marker's stroke went down in this colour: it keeps it when it's put down
    inked(id, color) { const it = items.get(id); if (it) it.lastPaint = it.inkPaint = color; },
    // a shot gone from its hopper
    spend(id) { const it = items.get(id); if (it && it.state.type === 'paintball') it.state.ammo = Math.max(0, (it.state.ammo ?? MAG_SIZE) - 1); },
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
        if (it.state.holder || it.busy) continue;
        if (Math.hypot(it.state.x - player.x, it.state.z - player.z) > reach) continue;
        _box.setFromObject(it.model).expandByScalar(.07);
        const hit = _ray.intersectBox(_box, tmpV);
        if (!hit) continue;
        const d = hit.distanceTo(origin);
        // (an egg sits down in its crate: the crate's side in front of it doesn't hide it)
        if (d < bestD && clear(it.model.userData.egg ? Math.max(.1, d - .5) : d)) { best = it; bestD = d; }
      }
      return best;
    },
    // paintings that aren't in anyone's hands (on walls, leant, lying about)
    paintings() { return [...items.values()].filter(it => it.model.userData.painting && !it.state.holder); },
    // the nearest painting along a ray: {point, normal (facing the ray), distance, painting, local: {point, normal}}
    paintingHit(origin, dir, far, list = this.paintings()) {
      let best = null;
      for (const it of list) {
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
    // the same against paintings in someone's hands (as they're shown carried), but the shooter's own: a held
    // painting stops a paintball (a shield), whatever's behind it
    shieldHit(origin, dir, far, ignore) {
      const held = [...items.values()].filter(it => it.model.userData.painting && it.state.holder && it.state.holder !== ignore && it.model.parent && it.model.visible);
      return held.length ? this.paintingHit(origin, dir, far, held) : null;
    },
    // A ray test against the paintings lying about near a point (each as its closed box, where the server has
    // it, not mid-fall), shaped like the level's: (origin, dir, far) -> {point, normal (facing the ray),
    // distance, painting} or null. For putting things on paintings.
    paintingRay(center, radius) {
      const list = [];
      for (const it of this.paintings()) {
        const s = it.state, u = it.model.userData;
        if (Math.hypot(s.x - center.x, s.y - center.y, s.z - center.z) > radius) continue;
        const m = paintingMatrix(s.x, s.y, s.z, s.yaw, s.tilt || 0, s.roll || 0);
        list.push({it, m, inv: m.clone().invert(), box: new THREE.Box3(new THREE.Vector3(-u.w / 2, -u.h / 2, 0), new THREE.Vector3(u.w / 2, u.h / 2, u.d))});
      }
      const ray = new THREE.Ray(), lp = new THREE.Vector3();
      return (origin, dir, far) => {
        let best = null;
        for (const p of list) {
          ray.set(origin, dir).applyMatrix4(p.inv);
          if (!ray.intersectBox(p.box, lp)) continue;
          const point = lp.clone().applyMatrix4(p.m), distance = point.distanceTo(origin);
          if (distance > far || (best && distance >= best.distance)) continue;
          const b = p.box, gaps = [[b.max.x - lp.x, 'x', 1], [lp.x - b.min.x, 'x', -1], [b.max.y - lp.y, 'y', 1], [lp.y - b.min.y, 'y', -1], [b.max.z - lp.z, 'z', 1], [lp.z - b.min.z, 'z', -1]];
          const [, axis, sgn] = gaps.reduce((a, c) => (c[0] < a[0] ? c : a));
          const normal = new THREE.Vector3(); normal[axis] = sgn;
          normal.transformDirection(p.m);
          if (normal.dot(dir) > 0) normal.negate();
          best = {point, normal, distance, painting: p.it};
        }
        return best;
      };
    },
    // world position of an item's business end (muzzle, nozzle, lens)
    tip(it) { it.model.updateMatrixWorld(); return it.model.localToWorld(it.model.userData.tip.clone()); },
    // place every item: on the ground, in a hand, or in your view
    frame({me, myId, thirdPerson, avatarOf, poseOf, dt, vel = null, cull = null}) {
      glowTime.value += dt;
      let n = 0;
      camera.getWorldPosition(_eye);
      const clock = performance.now();
      // where you'll be a moment from now, if you're moving (for the paintings' pictures)
      let aheadN = 0;
      const sp = vel ? Math.hypot(vel[0], vel[1]) : 0;
      if (sp > 1) for (const t of ART_AHEAD) {
        const k = Math.min(t, ART_AHEAD_MAX / sp);
        ahead[aheadN++].set(_eye.x + vel[0] * k, _eye.y, _eye.z + vel[1] * k);
      }
      // a mon and the mana, supermana or bomb it's carrying on one square of the board: side by side
      shared.clear();
      {
        const sq = new Map();
        for (const it of items.values()) {
          const s = it.state;
          if (s.type !== 'piece' || s.holder || s.id.startsWith('egg-') || it.fall || it.path) continue;
          const q = squareAt(s.x, s.z);
          if (q) { const k = q.i * 11 + q.j; (sq.get(k) || sq.set(k, []).get(k)).push(s.id); }
        }
        for (const ids of sq.values()) {
          if (ids.length !== 2) continue;
          const mon = ids.find(id => id.startsWith('mon-')), other = ids.find(id => /^(mana-|smana|bomb-)/.test(id));
          if (!mon || !other) continue;
          // what it carries in front of it (a mon faces its +z), a little off to one side; the mon back a touch
          const yaw = items.get(mon).state.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
          shared.set(mon, new THREE.Vector3(-fx * .035, 0, -fz * .035));
          shared.set(other, new THREE.Vector3(fx * .06 + rx * .035, 0, fz * .06 + rz * .035));
        }
      }
      for (const it of items.values()) {
        // shown picked up or put down, and the server never said so (or it got lost): back as the server has it
        if (it.pending && clock > it.pending.until && !it.busy) { it.state = it.server || it.state; it.pending = it.server = null; it.path = it.fall = it.fly = null; it.busy = false; }
        const s = it.state, m = it.model, u = m.userData;
        // an egg: sat in its crate as it started, or on its side (its glowing outline was made round it as it
        // first was: moved with it)
        if (u.egg?.(s) && it.outline) { u.eggMesh.updateMatrix(); for (const sh of it.outline.children) sh.matrix.copy(u.eggMesh.matrix); }
        if (u.artAt) {
          // how far it is from you, or from where you'll be in a moment at this speed, whichever's nearer
          let near = s.holder ? 0 : Math.hypot(s.x - _eye.x, s.y - _eye.y, s.z - _eye.z), far = near;
          for (let k = 0; k < aheadN && far > 0; k++) {
            const d = Math.hypot(s.x - ahead[k].x, s.y - ahead[k].y, s.z - ahead[k].z);
            far = Math.min(far, d); if (k === 0) near = Math.min(near, d);
          }
          u.artAt(near, far);
        }
        // the hopper shows what's loaded: yours, the holder's choice, or a mix lying on the floor. A marker shows
        // its holder's paint, and put down keeps the colour it last drew with (or showed): it doesn't cycle
        if (u.setPaint) {
          const loaded = s.holder === myId ? myPaint : s.holder ? (poseOf(s.holder)?.pc ?? RANDOM_PAINT) : null;
          if (s.type === 'marker') {
            const shown = u.setPaint(loaded ?? it.lastPaint ?? restingPaint(s.id), PAINT_COLORS);
            if (loaded !== null && it.inkPaint === undefined) it.lastPaint = shown;
            if (loaded === null) it.inkPaint = undefined;
          } else u.setPaint(loaded ?? RANDOM_PAINT, PAINT_COLORS);
        }
        // the hopper: what's left in it, filling back up through a reload
        let reload = 0;
        if (it.reload) {
          const r = it.reload; r.t += dt;
          reload = Math.min(1, r.t / (RELOAD_MS / 1000));
          if (reload >= 1) { it.reload = null; s.ammo = MAG_SIZE; reload = 0; }
          else u.setAmmo?.(r.from + (MAG_SIZE - r.from) * Math.max(0, Math.min(1, (reload - .25) / .55)));
        }
        if (!it.reload) u.setAmmo?.(s.ammo ?? MAG_SIZE);
        // the reload's motion: tipped over to the side and up, a shake, and back (0 to 1 and back to 0)
        const reTip = reload ? Math.sin(Math.PI * Math.min(1, reload * 1.15)) : 0, rattle = reload > .3 && reload < .8 ? Math.sin(reload * 90) * .03 : 0;
        it.kick *= Math.exp(-dt * 14); it.shake = Math.max(0, it.shake - dt);
        let origin = null, dir = null, eye = null;
        if (!(s.holder === myId && !thirdPerson) || s.type === 'flashlight') m.scale.setScalar(1);
        it.outline.visible = !s.holder && s.id === highlighted && !it.fall && !it.path && !it.fly;
        if (it.ghost) it.ghost.ghostAll.value = it.ghost.ghostOn.value = 0;     // (worn, it follows its wearer: below)
        if (!s.holder) {
          if (m.parent !== scene) scene.add(m);
          // not drawn where it can't be seen from here (src/cull.js); always while it's on the move
          m.visible = !cull || !!(it.path || it.fall || it.fly) || cull(s.x, s.z, u.painting ? Math.max(u.w, u.h) / 2 + .1 : .4);
          // lying on its side, head toward its yaw
          m.position.set(s.x, s.y + u.ground, s.z);
          m.rotation.set(0, s.yaw, u.groundRoll, 'YXZ');
          if (u.upright) { m.rotation.set(Math.PI / 2, s.yaw, 0, 'YXZ'); m.position.y = s.y + u.ground; }
          if (u.standing) { m.rotation.set(0, s.yaw, 0); m.position.y = s.y; }
          if (u.piece && shared.has(s.id)) m.position.add(shared.get(s.id));
          if (u.painting) {                   // hung, leant or laid as placed
            m.rotation.set(s.tilt || 0, s.yaw, s.roll || 0, 'YXZ'); m.position.set(s.x, s.y, s.z);
            showBack(m, u, !(typeof s.hung === 'boolean' ? s.hung : Math.abs(s.tilt || 0) < .3 && s.y > .5) || !!(it.path || it.fall || it.fly));
          }
          u.dock?.();
          if (it.path) {                      // tumbling down as it went for whoever let it go
            const f = it.path, at = (f.t += dt) * PATH_HZ, i = Math.floor(at), last = f.frames.length - 1;
            if (i >= last) it.path = null;
            else {
              const a = f.frames[i], b = f.frames[i + 1], k = at - i;
              m.position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
              m.quaternion.set(a[3], a[4], a[5], a[6]).slerp(tmpQ.set(b[3], b[4], b[5], b[6]), k);
            }
          }
          if (it.fly) {                       // let go of, its physics not back yet: carried on through the air
            const f = it.fly, t = (f.t += dt);
            m.position.set(f.from.x + f.v[0] * t, f.from.y + f.v[1] * t - 4.905 * t * t, f.from.z + f.v[2] * t);
            m.rotation.set(f.from.tilt || 0, f.from.yaw, f.from.roll || 0, 'YXZ');
            if (t > 1.5) it.fly = null;
          }
          if (it.fall) {                      // still on its way down: follow the path, already in its rest pose (no tumbling)
            const f = it.fall; f.t += dt;
            const at = f.t / FALL_DT, i = Math.floor(at), last = f.path.length - 1;
            if (i >= last) it.fall = null;
            else {
              const k = at - i;
              m.position.lerpVectors(f.path[i], f.path[i + 1], k); m.position.y += u.ground;
            }
          }
          bumps(it, m.position, !!(it.path || it.fall || it.fly), dt, clock);
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
            m.position.set(.0 - reTip * .03, -.05 + bob + it.kick * .012 - reTip * .05, -.02 + it.kick * .05 + reTip * .04);
            m.rotation.set(.04 + it.kick * .12 + reTip * .45, -.06 + reTip * .35, reTip * .9 + rattle);
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
            showBack(m, u, true);
            // carried at your side, turned so you can see the picture
            m.scale.setScalar(.5);
            m.position.set(.1, -.2 + bob, -.16);
            m.rotation.set(.08, -.95, .02);
          } else if (s.type === 'marker') {
            // held like a pen, nib out toward the crosshair; it bears down a touch while it's drawing
            const press = it.drawing ? .012 : 0;
            m.position.set(.06, -.085 + bob - press, -.05 - press);
            m.rotation.set(.32, -.22, .1);
          } else if (s.type === 'radio') {
            m.scale.setScalar(.9);
            m.position.set(.16, -.42 + bob, -.5);
            m.rotation.set(.12, -.45, 0);
          } else if (s.type === 'piece') {
            m.scale.setScalar(u.handScale || 1);
            m.position.set(.13, -.2 + bob, -.34);
            m.rotation.set(.25, -.45, 0);
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
          else if (s.type === 'bucket' || s.type === 'crown' || s.type === 'piece' || s.type === 'radio') m.rotation.set(0, yaw, 0);
          else m.rotation.set(pitch + reTip * .4, yaw, reTip * .9 + rattle, 'YXZ');
          if (u.painting) showBack(m, u, true);
          if (s.type === 'painting' && avatar?.root) {
            // held out in front in both hands, the picture turned toward its holder and its back out (it's a
            // shield: src/main.js trace); it goes with their chest (crouching, the walk's bob)
            const R = HELD_PAINTING, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
            avatar.root.updateMatrixWorld(true);
            const chest = avatar.chest ||= avatar.model.getObjectByName('Chest') || avatar.root;
            chest.getWorldPosition(m.position);
            m.position.x = avatar.root.position.x + fx * R.ahead + rx * R.right; m.position.z = avatar.root.position.z + fz * R.ahead + rz * R.right;
            m.position.y += R.up + R.grip * u.h;
            m.rotation.set(R.tilt + pitch * .25, yaw + R.turn, R.roll, 'YXZ');
            m.visible = avatar.root.visible && avatar.model.visible !== false;
            if (m.visible) { m.updateMatrixWorld(); holdPainting(avatar, m, u, yaw); }
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
            else if (s.type === 'marker') m.position.addScaledVector(dir, .05);
            else if (s.type === 'spray') m.position.y -= .07 * CAN_SCALE;
            else if (s.type === 'crown') m.position.addScaledVector(dir, .1).y -= .1;   // held by the band, out in front
            else if (s.type === 'piece') m.position.addScaledVector(dir, .07).y -= .1;
            else if (s.type === 'radio') m.position.addScaledVector(dir, .08).y -= .3;
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
        shadows?.assign(i, id, l.eye || l.origin, lighting.flDir.value[i], l.it.state.holder === myId ? 0 : l.origin.distanceTo(_eye));
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

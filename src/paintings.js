// Paintings: stretched canvases you can carry, hang on any wall, lean against one or lay down. The
// art and its proportions live here (shared by the client, and by the server for ids); everything
// else about a painting is an item like the others (where it is, which way it faces, how it tilts).
import * as THREE from 'three';

const CDN = 'https://cdn.lil.org/nft/111k/paintings/';
// art id -> the image and its pixel size (the canvas takes the image's proportions)
export const ART = {
  1: {url: `${CDN}1.png`, w: 932, h: 1006},
  // 29 more, picked at random from 1-30000 (scattered round the level by tools/scatter.py)
  5560: {url: `${CDN}5560.png`, w: 1864, h: 2012},
  6008: {url: `${CDN}6008.png`, w: 1864, h: 2012},
  6346: {url: `${CDN}6346.png`, w: 1864, h: 2012},
  6365: {url: `${CDN}6365.png`, w: 1864, h: 2012},
  6973: {url: `${CDN}6973.png`, w: 1864, h: 2012},
  7236: {url: `${CDN}7236.png`, w: 1864, h: 2012},
  7528: {url: `${CDN}7528.png`, w: 1864, h: 2012},
  9103: {url: `${CDN}9103.png`, w: 932, h: 1006},
  10355: {url: `${CDN}10355.png`, w: 932, h: 1006},
  12392: {url: `${CDN}12392.png`, w: 932, h: 1006},
  12569: {url: `${CDN}12569.png`, w: 932, h: 1006},
  13030: {url: `${CDN}13030.png`, w: 932, h: 1006},
  13641: {url: `${CDN}13641.png`, w: 932, h: 1006},
  13665: {url: `${CDN}13665.png`, w: 932, h: 1006},
  13818: {url: `${CDN}13818.png`, w: 932, h: 1006},
  15173: {url: `${CDN}15173.png`, w: 932, h: 1006},
  16186: {url: `${CDN}16186.png`, w: 932, h: 1006},
  18322: {url: `${CDN}18322.png`, w: 932, h: 1006},
  20225: {url: `${CDN}20225.png`, w: 932, h: 1006},
  20637: {url: `${CDN}20637.png`, w: 932, h: 1111},
  21970: {url: `${CDN}21970.png`, w: 932, h: 1111},
  22871: {url: `${CDN}22871.png`, w: 1207, h: 1303},
  23416: {url: `${CDN}23416.png`, w: 932, h: 1006},
  23470: {url: `${CDN}23470.png`, w: 932, h: 1006},
  23747: {url: `${CDN}23747.png`, w: 932, h: 1006},
  26422: {url: `${CDN}26422.png`, w: 932, h: 1006},
  26598: {url: `${CDN}26598.png`, w: 932, h: 1006},
  26920: {url: `${CDN}26920.png`, w: 932, h: 1006},
  27106: {url: `${CDN}27106.png`, w: 932, h: 1006},
};
export const PAINTING_LONG = .8;     // metres along the longer side
export const PAINTING_DEPTH = .05;   // the stretcher's depth (the canvas wraps round it)

// width, height, depth in metres
export function paintingSize(art) {
  const a = ART[art] || ART[1], k = PAINTING_LONG / Math.max(a.w, a.h);
  return {w: a.w * k, h: a.h * k, d: PAINTING_DEPTH};
}

// A painting's pose: its origin is the middle of its back, local +z out of the front, +y up the canvas.
// tilt 0 hangs it upright; a little negative leans its top back against a wall; -pi/2 lies it face up;
// roll turns it in its own plane (lying on a slope, it keeps its top pointing where it was put down).
export function paintingMatrix(x, y, z, yaw, tilt, roll = 0, out = new THREE.Matrix4()) {
  return out.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, roll, 'YXZ')), new THREE.Vector3(1, 1, 1));
}

// The canvas as a closed box in its own space (front, the four wrapped sides, the back): the
// surfaces paint lands on, and what a painting shadows behind it.
export function paintingTris(art) {
  const {w, h, d} = paintingSize(art), x = w / 2, y = h / 2;
  const V = (a, b, c) => new THREE.Vector3(a, b, c);
  const quads = [
    [[V(-x, -y, d), V(x, -y, d), V(x, y, d), V(-x, y, d)], V(0, 0, 1)],       // front
    [[V(x, -y, 0), V(-x, -y, 0), V(-x, y, 0), V(x, y, 0)], V(0, 0, -1)],      // back
    [[V(-x, y, d), V(x, y, d), V(x, y, 0), V(-x, y, 0)], V(0, 1, 0)],         // top
    [[V(-x, -y, 0), V(x, -y, 0), V(x, -y, d), V(-x, -y, d)], V(0, -1, 0)],    // bottom
    [[V(x, -y, d), V(x, -y, 0), V(x, y, 0), V(x, y, d)], V(1, 0, 0)],         // right
    [[V(-x, -y, 0), V(-x, -y, d), V(-x, y, d), V(-x, y, 0)], V(-1, 0, 0)],    // left
  ];
  return quads.flatMap(([q, n]) => [[q[0], q[1], q[2]], [q[0], q[2], q[3]]].map(p => ({p, n})));
}

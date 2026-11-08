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
  // and 70 more, picked the same way (tools/scatter.py places them as a second batch: keep the batches in order)
  534: {url: `${CDN}534.png`, w: 1864, h: 2012},
  787: {url: `${CDN}787.png`, w: 1864, h: 2012},
  958: {url: `${CDN}958.png`, w: 1864, h: 2012},
  1034: {url: `${CDN}1034.png`, w: 1864, h: 2012},
  2065: {url: `${CDN}2065.png`, w: 1864, h: 2012},
  2327: {url: `${CDN}2327.png`, w: 1864, h: 2012},
  2462: {url: `${CDN}2462.png`, w: 1864, h: 2012},
  2905: {url: `${CDN}2905.png`, w: 1864, h: 2012},
  3342: {url: `${CDN}3342.png`, w: 1864, h: 2012},
  3537: {url: `${CDN}3537.png`, w: 1864, h: 2012},
  4148: {url: `${CDN}4148.png`, w: 1864, h: 2012},
  5268: {url: `${CDN}5268.png`, w: 1864, h: 2012},
  5759: {url: `${CDN}5759.png`, w: 1864, h: 2012},
  5816: {url: `${CDN}5816.png`, w: 1864, h: 2012},
  6136: {url: `${CDN}6136.png`, w: 1864, h: 2012},
  6407: {url: `${CDN}6407.png`, w: 1864, h: 2012},
  6460: {url: `${CDN}6460.png`, w: 1864, h: 2012},
  6577: {url: `${CDN}6577.png`, w: 1864, h: 2012},
  6690: {url: `${CDN}6690.png`, w: 1864, h: 2012},
  7315: {url: `${CDN}7315.png`, w: 1864, h: 2012},
  7611: {url: `${CDN}7611.png`, w: 1864, h: 2012},
  7717: {url: `${CDN}7717.png`, w: 1864, h: 2012},
  8198: {url: `${CDN}8198.png`, w: 1864, h: 2012},
  9026: {url: `${CDN}9026.png`, w: 932, h: 1006},
  9314: {url: `${CDN}9314.png`, w: 932, h: 1006},
  9718: {url: `${CDN}9718.png`, w: 932, h: 1006},
  10041: {url: `${CDN}10041.png`, w: 932, h: 1006},
  10555: {url: `${CDN}10555.png`, w: 932, h: 1006},
  11019: {url: `${CDN}11019.png`, w: 932, h: 1006},
  12040: {url: `${CDN}12040.png`, w: 932, h: 1006},
  12254: {url: `${CDN}12254.png`, w: 932, h: 1006},
  12718: {url: `${CDN}12718.png`, w: 932, h: 1006},
  13310: {url: `${CDN}13310.png`, w: 932, h: 1006},
  13724: {url: `${CDN}13724.png`, w: 932, h: 1006},
  14386: {url: `${CDN}14386.png`, w: 932, h: 1006},
  14477: {url: `${CDN}14477.png`, w: 932, h: 1006},
  14486: {url: `${CDN}14486.png`, w: 932, h: 1006},
  14597: {url: `${CDN}14597.png`, w: 932, h: 1006},
  14833: {url: `${CDN}14833.png`, w: 932, h: 1006},
  15801: {url: `${CDN}15801.png`, w: 932, h: 1006},
  16087: {url: `${CDN}16087.png`, w: 932, h: 1006},
  16602: {url: `${CDN}16602.png`, w: 932, h: 1006},
  16737: {url: `${CDN}16737.png`, w: 932, h: 1006},
  16748: {url: `${CDN}16748.png`, w: 932, h: 1006},
  16906: {url: `${CDN}16906.png`, w: 932, h: 1006},
  17084: {url: `${CDN}17084.png`, w: 932, h: 1006},
  20208: {url: `${CDN}20208.png`, w: 932, h: 1006},
  20419: {url: `${CDN}20419.png`, w: 932, h: 1111},
  21145: {url: `${CDN}21145.png`, w: 932, h: 1111},
  21706: {url: `${CDN}21706.png`, w: 932, h: 1111},
  21951: {url: `${CDN}21951.png`, w: 932, h: 1111},
  22744: {url: `${CDN}22744.png`, w: 1207, h: 1303},
  22952: {url: `${CDN}22952.png`, w: 1207, h: 1303},
  23626: {url: `${CDN}23626.png`, w: 932, h: 1006},
  24282: {url: `${CDN}24282.png`, w: 932, h: 1006},
  24346: {url: `${CDN}24346.png`, w: 932, h: 1006},
  24447: {url: `${CDN}24447.png`, w: 932, h: 1006},
  25426: {url: `${CDN}25426.png`, w: 932, h: 1006},
  25547: {url: `${CDN}25547.png`, w: 932, h: 1006},
  25631: {url: `${CDN}25631.png`, w: 932, h: 1006},
  26641: {url: `${CDN}26641.png`, w: 932, h: 1006},
  26669: {url: `${CDN}26669.png`, w: 932, h: 1006},
  27459: {url: `${CDN}27459.png`, w: 932, h: 1006},
  28067: {url: `${CDN}28067.png`, w: 932, h: 1006},
  28932: {url: `${CDN}28932.png`, w: 932, h: 1006},
  28993: {url: `${CDN}28993.png`, w: 932, h: 1006},
  29516: {url: `${CDN}29516.png`, w: 932, h: 1006},
  29565: {url: `${CDN}29565.png`, w: 932, h: 1006},
  29579: {url: `${CDN}29579.png`, w: 932, h: 1006},
  29805: {url: `${CDN}29805.png`, w: 932, h: 1006},
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

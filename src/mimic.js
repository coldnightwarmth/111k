// The control room's mimic board: a lamp per room round the ring. The baked lamps blink;
// a room with someone in it gets a steady bright white lamp over its own.
import * as THREE from 'three';

const ROOMS = 20;
// where lamp i sits on the board's picture (the level builder draws them at these uvs)
const lampUV = i => {
  const a = 2 * Math.PI * i / ROOMS;
  return [0.5 + 180 / 1024 * Math.cos(a), (278 - 180 * Math.sin(a)) / 512];
};

export function createMimic(level, scene) {
  try { return build(level, scene); } catch (e) { console.warn('mimic board lamps unavailable', e); return {update() {}, roomAt: () => null}; }
}
function build(level, scene) {
  const mesh = level.meshes.find(m => m.material?.name === 'mimic');
  const bore = level.meta.bore;
  if (!mesh || !bore) return {update() {}, roomAt: () => null};
  // the board is one flat picture: map its uvs to the world from one of its triangles
  mesh.updateMatrixWorld();
  const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index;
  const vi = [0, 1, 2].map(k => idx ? idx.getX(k) : k);
  const P = vi.map(i => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  const T = vi.map(i => [uv.getX(i), uv.getY(i)]);
  const du1 = T[1][0] - T[0][0], dv1 = T[1][1] - T[0][1], du2 = T[2][0] - T[0][0], dv2 = T[2][1] - T[0][1];
  const det = du1 * dv2 - du2 * dv1;
  const e1 = P[1].clone().sub(P[0]), e2 = P[2].clone().sub(P[0]);
  const Pu = e1.clone().multiplyScalar(dv2).addScaledVector(e2, -dv1).divideScalar(det);   // d(world)/du
  const Pv = e2.clone().multiplyScalar(du1).addScaledVector(e1, -du2).divideScalar(det);   // d(world)/dv
  const at = (u, v) => P[0].clone().addScaledVector(Pu, u - T[0][0]).addScaledVector(Pv, v - T[0][1]);
  // out of the board, into the room: the picture's own facing (it's drawn one-sided, toward the room)
  // (front faces wind counter-clockwise)
  const normal = new THREE.Vector3().crossVectors(e1, e2).normalize();

  const group = new THREE.Group(); group.name = 'mimic-lamps'; scene.add(group);
  const lampMat = new THREE.MeshBasicMaterial({color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false});
  const haloMat = new THREE.MeshBasicMaterial({map: haloTexture(), color: 0xffffff, transparent: true, opacity: .55,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false});
  const lampGeo = new THREE.BoxGeometry(.05, .038, .018), haloGeo = new THREE.PlaneGeometry(.2, .2);
  const upv = Pv.clone().normalize().negate(), right = new THREE.Vector3().crossVectors(upv, normal).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, upv, normal);
  const lamps = [];
  for (let i = 0; i < ROOMS; i++) {
    const [u, v] = lampUV(i);
    const lamp = new THREE.Group();
    lamp.position.copy(at(u, v)).addScaledVector(normal, .016);
    lamp.quaternion.setFromRotationMatrix(basis);
    const box = new THREE.Mesh(lampGeo, lampMat); lamp.add(box);
    const halo = new THREE.Mesh(haloGeo, haloMat); halo.position.z = .012; halo.renderOrder = 5; lamp.add(halo);
    lamp.visible = false;
    group.add(lamp); lamps.push(lamp);
  }
  // which room a point is in (null in the tunnel or a doorway)
  const roomAt = (x, z) => {
    if (Math.hypot(x, z) - bore.loop <= bore.passage) return null;
    const a = Math.atan2(-z, x);
    return ((Math.round(a / (2 * Math.PI / ROOMS)) % ROOMS) + ROOMS) % ROOMS;
  };
  return {
    roomAt,
    // points: everyone's positions [{x, z}]
    update(points) {
      const lit = new Set();
      for (const p of points) { const r = roomAt(p.x, p.z); if (r !== null) lit.add(r); }
      lamps.forEach((l, i) => { l.visible = lit.has(i); });
    },
  };
}

function haloTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

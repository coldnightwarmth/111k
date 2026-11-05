// Loads a baked level: geometry (GLB), lightmap and metadata (colliders,
// lights, spawns). Surfaces use unlit materials + the baked lightmap, which is
// cheap enough for phones; avatars get a few real lights matched to the bake.
import * as THREE from 'three';
import {GLTFLoader} from '../vendor/three/GLTFLoader.js';

export async function loadLevel(name, renderer) {
  const base = new URL(`../assets/env/${name}`, import.meta.url).href;
  const [gltf, lightmap, meta] = await Promise.all([
    new GLTFLoader().loadAsync(`${base}.glb`),
    new THREE.TextureLoader().loadAsync(`${base}-lightmap.webp`),
    fetch(`${base}.json`).then(r => { if (!r.ok) throw Error(`Level data unavailable (${r.status})`); return r.json(); }),
  ]);
  lightmap.colorSpace = THREE.SRGBColorSpace;
  lightmap.flipY = false;
  lightmap.channel = 1;
  // Atlas charts are only padded by a few texels, so skip mipmaps to avoid bleeding.
  lightmap.generateMipmaps = false;
  lightmap.minFilter = THREE.LinearFilter;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const materials = new Map();
  const meshes = [];
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.matrixAutoUpdate = false; o.updateMatrix();
    meshes.push(o);
    const m = o.material;
    materials.set(m.name, m);
    if (m.map) { m.map.anisotropy = anisotropy; m.map.colorSpace = THREE.SRGBColorSpace; }
    if (m.userData.lightmap) {
      m.lightMap = lightmap;
      m.lightMapIntensity = Math.PI * meta.lightmapScale;
    }
    if (m.userData.emissive) m.toneMapped = false;
    if (m.transparent) { m.depthWrite = false; o.renderOrder = 1; m.polygonOffset = true; m.polygonOffsetFactor = -1; }
  });
  return {scene: gltf.scene, meta, materials, meshes, lightmap, baseIntensity: Math.PI * meta.lightmapScale};
}

// Lights that only exist to shade avatars so they sit in the baked lighting.
// The level can have dozens, so a small fixed pool follows the nearest ones.
export function createAvatarLights(meta, scene, poolSize = 6) {
  const group = new THREE.Group();
  const [ar, ag, ab] = meta.ambient || [.05, .05, .06];
  group.add(new THREE.HemisphereLight(new THREE.Color(ar * 6, ag * 6, ab * 6), new THREE.Color(ar * 3, ag * 2.6, ab * 2.4), 1.2));
  const pool = [];
  for (let i = 0; i < Math.min(poolSize, meta.lights.length); i++) {
    const light = new THREE.PointLight(0xffffff, 0, 1, 2);
    group.add(light);
    pool.push({light, base: 0, flicker: null, name: null, source: null});
  }
  scene.add(group);
  const sources = meta.lights.map(l => ({...l, color: new THREE.Color(...l.color)}));
  let lastX = Infinity, lastZ = Infinity;
  // Reassign the pool when the viewer has moved a little; cheap enough to call every frame.
  pool.update = (x, z) => {
    if (Math.hypot(x - lastX, z - lastZ) < .75) return;
    lastX = x; lastZ = z;
    const near = sources.map(s => ({s, d: Math.hypot(s.pos[0] - x, s.pos[2] - z) - s.range}))
      .sort((a, b) => a.d - b.d).slice(0, pool.length);
    pool.forEach((p, i) => {
      const s = near[i]?.s;
      p.source = s; p.name = s?.name; p.flicker = s?.flicker; p.base = s ? s.intensity * 7 : 0;
      if (!s) { p.light.intensity = 0; return; }
      p.light.position.set(...s.pos); p.light.color.copy(s.color); p.light.distance = s.range; p.light.intensity = p.base;
    });
  };
  return pool;
}

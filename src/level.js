// Loads a baked level: geometry (GLB), lightmap and metadata (colliders,
// lights, spawns). Surfaces use unlit materials + the baked lightmap, which is
// cheap enough for phones; avatars get a few real lights matched to the bake.
import * as THREE from 'three';
import {GLTFLoader} from '../vendor/three/GLTFLoader.js';

export async function loadLevel(name, renderer) {
  const base = new URL(`../assets/env/${name}`, import.meta.url).href;
  const [gltf, lightmap, meta] = await Promise.all([
    new GLTFLoader().loadAsync(`${base}.glb`),
    new THREE.TextureLoader().loadAsync(`${base}-lightmap.png`),
    fetch(`${base}.json`).then(r => { if (!r.ok) throw Error(`Level data unavailable (${r.status})`); return r.json(); }),
  ]);
  lightmap.colorSpace = THREE.SRGBColorSpace;
  lightmap.flipY = false;
  lightmap.channel = 1;
  // Atlas charts are only padded by 2 texels, so skip mipmaps to avoid bleeding.
  lightmap.generateMipmaps = false;
  lightmap.minFilter = THREE.LinearFilter;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const materials = new Map();
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.matrixAutoUpdate = false; o.updateMatrix();
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
  return {scene: gltf.scene, meta, materials, lightmap, baseIntensity: Math.PI * meta.lightmapScale};
}

// Lights that only exist to shade avatars so they sit in the baked lighting.
export function createAvatarLights(meta, scene) {
  const group = new THREE.Group();
  const [ar, ag, ab] = meta.ambient || [.05, .05, .06];
  group.add(new THREE.HemisphereLight(new THREE.Color(ar * 6, ag * 6, ab * 6), new THREE.Color(ar * 3, ag * 2.6, ab * 2.4), 1.2));
  const lights = [];
  for (const l of meta.lights) {
    const light = new THREE.PointLight(new THREE.Color(...l.color), l.intensity * 7, l.range, 2);
    light.position.set(...l.pos);
    group.add(light);
    lights.push({light, base: light.intensity, flicker: l.flicker, name: l.name});
  }
  scene.add(group);
  return lights;
}

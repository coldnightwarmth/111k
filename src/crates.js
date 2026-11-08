// The painting crates: closed, opened and smashed, about half the rooms and a few bits in the tunnel
// (tools/crates.py). They're added after the level loads rather than baked into it, but drawn the way the
// level is: the crate atlas times the level's own lightmap (each vertex carries the lightmap spot of the
// floor beside it), so they take each room's light, its flickering lamps and flashlight beams. Solid,
// paintable, and stood on like the level's furniture.
import * as THREE from 'three';
import {GLTFLoader} from '../vendor/three/GLTFLoader.js';
import {hookShader, LEVEL_VERSION} from './level.js';
export {CRATE_COLLIDERS} from './crates-placed.js';

const url = new URL('../assets/env/world-crates.glb', import.meta.url).href + (LEVEL_VERSION ? `?v=${LEVEL_VERSION}` : '');

// start fetching straight away (it's small); null if it can't be had: the level does fine without
export function loadCrates() {
  return new GLTFLoader().loadAsync(url).catch(err => { console.warn('crates:', err); return null; });
}

export function addCrates(gltf, level, scene) {
  if (!gltf) return null;
  const root = gltf.scene;
  root.traverse(o => {
    if (!o.isMesh) return;
    o.matrixAutoUpdate = false; o.updateMatrix();
    const m = o.material;
    if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 4; }
    if (m.userData.lightmap) {
      m.lightMap = level.lightmap;
      m.lightMapIntensity = level.baseIntensity;
      hookShader(m);
    } else if (m.transparent) {             // the soft shadows on the floor
      m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
      o.userData.noHit = true;
      o.renderOrder = 0.5;
    }
  });
  scene.add(root);
  root.updateMatrixWorld(true);
  return root;
}

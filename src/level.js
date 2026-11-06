// Loads a baked level: geometry (GLB), lightmap, flicker map and metadata
// (colliders, lights, spawns). Surfaces use unlit materials + the baked
// lightmap, which is cheap enough for phones. A small shader hook lets single
// lamps flicker (their share of the light is baked into a separate map, one
// lamp group per channel) and lets flashlights light the baked surfaces.
import * as THREE from 'three';
import {GLTFLoader} from '../vendor/three/GLTFLoader.js';

export const MAX_FLASHLIGHTS = 4;

// Shared by every level material: the game updates these each frame.
export const lighting = {
  flickerK: {value: new THREE.Vector4(1, 1, 1, 1)},      // 1 = lamp group fully on
  flickerMap: {value: null},
  flickerTint: {value: new THREE.Color(.89, 1, 1.11)},
  flPos: {value: Array.from({length: MAX_FLASHLIGHTS}, () => new THREE.Vector3())},
  flDir: {value: Array.from({length: MAX_FLASHLIGHTS}, () => new THREE.Vector3(0, 0, -1))},
  flOn: {value: new Array(MAX_FLASHLIGHTS).fill(0)},
};

const LIGHTMAP_LINE = 'reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;';

export function hookShader(material) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, lighting);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldPos;
uniform sampler2D flickerMap;
uniform vec4 flickerK;
uniform vec3 flickerTint;
uniform vec3 flPos[${MAX_FLASHLIGHTS}];
uniform vec3 flDir[${MAX_FLASHLIGHTS}];
uniform float flOn[${MAX_FLASHLIGHTS}];`)
      .replace(LIGHTMAP_LINE, `
    vec3 baked = lightMapTexel.rgb;
    // dim the share of each texel's light that comes from lamp groups currently flickering off
    float off = dot(texture2D(flickerMap, vLightMapUv), vec4(1.0) - flickerK);
    baked *= max(vec3(1.0) - flickerTint * off, vec3(0.0));
    reflectedLight.indirectDiffuse += baked * lightMapIntensity * RECIPROCAL_PI;
    // flashlights: a soft-edged cone with distance falloff, on the face normal
    vec3 faceN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    for (int i = 0; i < ${MAX_FLASHLIGHTS}; i++) {
      if (flOn[i] < 0.01) continue;
      vec3 toL = flPos[i] - vWorldPos;
      float d = length(toL);
      vec3 L = toL / max(d, 1e-4);
      float cosA = dot(-L, flDir[i]);
      float cone = smoothstep(0.80, 0.93, cosA) * (0.65 + 0.35 * smoothstep(0.93, 0.99, cosA));
      float facing = abs(dot(faceN, L));
      reflectedLight.indirectDiffuse += vec3(1.0, 0.94, 0.82) * flOn[i] * cone * facing * 9.0 / (1.0 + d * d * 0.45);
    }`);
  };
  material.customProgramCacheKey = () => 'level-lit';
}

export async function loadLevel(name, renderer) {
  const base = new URL(`../assets/env/${name}`, import.meta.url).href;
  const [gltf, lightmap, meta] = await Promise.all([
    new GLTFLoader().loadAsync(`${base}.glb`),
    new THREE.TextureLoader().loadAsync(`${base}-lightmap.webp`),
    fetch(`${base}.json`).then(r => { if (!r.ok) throw Error(`Level data unavailable (${r.status})`); return r.json(); }),
  ]);
  const flicker = meta.flickerMap
    ? await new THREE.TextureLoader().loadAsync(`${base}-flicker.webp`)
    : new THREE.DataTexture(new Uint8Array(4), 1, 1);
  for (const t of [lightmap, flicker]) {
    t.flipY = false; t.channel = 1;
    // Atlas charts are only padded by a few texels, so skip mipmaps to avoid bleeding.
    t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  }
  lightmap.colorSpace = THREE.SRGBColorSpace;
  lighting.flickerMap.value = flicker;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const materials = new Map();
  const meshes = [];
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.matrixAutoUpdate = false; o.updateMatrix();
    meshes.push(o);
    const m = o.material;
    if (materials.has(m.name)) return;
    materials.set(m.name, m);
    if (m.map) { m.map.anisotropy = anisotropy; m.map.colorSpace = THREE.SRGBColorSpace; }
    if (m.userData.lightmap) {
      m.lightMap = lightmap;
      m.lightMapIntensity = Math.PI * meta.lightmapScale;
      hookShader(m);
    }
    if (m.userData.emissive) m.toneMapped = false;
    if (m.transparent) { m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; }
  });
  // Decals never write depth, so overlapping ones are drawn in a fixed order (by name)
  // rather than re-sorted by distance every frame, which made them flicker.
  meshes.filter(o => o.material.transparent).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((o, i) => { o.renderOrder = 1 + i * .001; });
  return {scene: gltf.scene, meta, materials, meshes, lightmap, baseIntensity: Math.PI * meta.lightmapScale};
}

// Lights that only exist to shade avatars so they sit in the baked lighting.
// The level has dozens, so a small fixed pool follows the nearest ones.
export function createAvatarLights(meta, scene, poolSize = 6) {
  const group = new THREE.Group();
  const [ar, ag, ab] = meta.ambient || [.05, .05, .06];
  group.add(new THREE.HemisphereLight(new THREE.Color(ar * 6, ag * 6, ab * 6), new THREE.Color(ar * 3, ag * 2.6, ab * 2.4), 1.2));
  const pool = [];
  for (let i = 0; i < Math.min(poolSize, meta.lights.length); i++) {
    const light = new THREE.PointLight(0xffffff, 0, 1, 2);
    group.add(light);
    pool.push({light, base: 0, flicker: null, group: null, name: null, source: null});
  }
  scene.add(group);
  const sources = meta.lights.map(l => ({...l, color: new THREE.Color(...l.color)}));
  let lastX = Infinity, lastZ = Infinity;
  pool.update = (x, z) => {
    if (Math.hypot(x - lastX, z - lastZ) < .75) return;
    lastX = x; lastZ = z;
    const near = sources.map(s => ({s, d: Math.hypot(s.pos[0] - x, s.pos[2] - z) - s.range}))
      .sort((a, b) => a.d - b.d).slice(0, pool.length);
    pool.forEach((p, i) => {
      const s = near[i]?.s;
      p.source = s; p.name = s?.name; p.flicker = s?.flicker; p.group = s?.group ?? null; p.base = s ? s.intensity * 7 : 0;
      if (!s) { p.light.intensity = 0; return; }
      p.light.position.set(...s.pos); p.light.color.copy(s.color); p.light.distance = s.range; p.light.intensity = p.base;
    });
  };
  return pool;
}

// Fluorescent tubes that are failing: long steady stretches, then a stutter,
// a drop-out that restrikes, or a dim buzz. Each lamp group runs its own.
export function createFlicker(rand = Math.random, {calm = [8, 30], first = 3} = {}) {
  let level = 1, queue = [], next = performance.now() + first * 1000 * (0.5 + rand());
  const episode = now => {
    const kind = rand();
    const seq = [];
    if (kind < .5) {                       // stutter: a burst of quick blinks
      for (let i = 0, n = 2 + Math.floor(rand() * 6); i < n; i++)
        seq.push([30 + rand() * 120, rand() < .5 ? .08 : .45], [40 + rand() * 160, 1]);
    } else if (kind < .8) {                // drop-out, then the starter fights to restrike
      seq.push([400 + rand() * 2200, 0]);
      for (let i = 0, n = 1 + Math.floor(rand() * 4); i < n; i++) seq.push([40 + rand() * 90, .9], [60 + rand() * 260, .05]);
      seq.push([200 + rand() * 300, .7]);
    } else {                               // brown-out buzz
      const d = 600 + rand() * 1800;
      for (let t = 0; t < d; t += 40) seq.push([40, .55 + rand() * .25]);
    }
    let t = now;
    queue = seq.map(([dur, v]) => { t += dur; return {until: t, v}; });
    next = t + (calm[0] + rand() * (calm[1] - calm[0])) * 1000;
  };
  return {
    get level() { return level; },
    update(now) {
      if (!queue.length && now > next) episode(now);
      while (queue.length && now > queue[0].until) queue.shift();
      const target = queue.length ? queue[0].v : 1;
      // tubes don't snap: a few ms of glow either way
      level += (target - level) * (target > level ? .6 : .8);
      return level;
    },
  };
}

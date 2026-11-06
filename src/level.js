// Loads a baked level: geometry (GLB), lightmap, flicker map and metadata
// (colliders, lights, spawns). Surfaces use unlit materials + the baked
// lightmap, which is cheap enough for phones. A small shader hook lets single
// lamps flicker (their share of the light is baked into a separate map, one
// lamp group per channel) and lets flashlights light the baked surfaces.
import * as THREE from 'three';
import {GLTFLoader} from '../vendor/three/GLTFLoader.js';

export const MAX_FLASHLIGHTS = 8;   // beams painted onto the level (cheap: done in the lightmap shader)
export const MAX_SPOTLIGHTS = 4;    // of those, the nearest also get a real spotlight so avatars catch them (dearer)
// Each beam's shadows come from a depth map rendered from the torch (beamshadows.js), in a
// frustum spanning tan(angle) -FAN_TAN..FAN_TAN (the cone edge is ~.75) out to FAN_RANGE metres.
export const FAN_TAN = .78;
export const FAN_RANGE = 25;
const SHADOW_COLS = 4, SHADOW_ROWS = Math.ceil(MAX_FLASHLIGHTS / 4), SHADOW_TILE = 512;
// the beam's own frame, shared with the shader: right and up across the cone
export function beamFrame(dir, right, up) {
  const ref = Math.abs(dir.y) > .95 ? [1, 0, 0] : [0, 1, 0];
  right.set(dir.y * ref[2] - dir.z * ref[1], dir.z * ref[0] - dir.x * ref[2], dir.x * ref[1] - dir.y * ref[0]).normalize();
  up.crossVectors(right, dir);
}

// Shared by every level material: the game updates these each frame.
export const lighting = {
  flickerK: {value: new THREE.Vector4(1, 1, 1, 1)},      // 1 = lamp group fully on
  flickerMap: {value: null},
  flickerMap2: {value: null},
  flickerSplit: {value: 0},
  flickerTint: {value: new THREE.Color(.89, 1, 1.11)},
  flPos: {value: Array.from({length: MAX_FLASHLIGHTS}, () => new THREE.Vector3())},
  flDir: {value: Array.from({length: MAX_FLASHLIGHTS}, () => new THREE.Vector3(0, 0, -1))},
  flOn: {value: new Array(MAX_FLASHLIGHTS).fill(0)},
  flShadow: {value: null},
  flMat: {value: Array.from({length: MAX_FLASHLIGHTS}, () => new THREE.Matrix4())},
};

// Near-camera ghosting: anything closer than about half a metre to the camera dissolves
// through an ordered dither instead of being sliced by the near plane (third person only).
export const GHOST_GLSL = `
uniform float ghostOn;
float ghostBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float ghostBayer(vec2 a) { return ghostBayer2(0.25 * a) * 0.0625 + ghostBayer2(0.5 * a) * 0.25 + ghostBayer2(a); }
// camDist: this fragment's distance from the camera; all: 1 to ghost the whole object (an avatar the camera is inside)
void ghostClip(float camDist, float all) {
  float keep = ghostOn > 0.5 ? 0.22 + 0.78 * smoothstep(0.14, 0.6, camDist) : 1.0;
  keep = min(keep, 1.0 - 0.85 * all);
  if (keep < 1.0 && keep <= ghostBayer(gl_FragCoord.xy)) discard;
}`;
export const ghost = {ghostOn: {value: 0}};
// add the ghosting to a built-in material (avatars). `own` carries that avatar's whole-body ghost amount.
// A material already ghosted for another avatar is copied, so each avatar dissolves on its own.
export function ghostMaterial(material, own) {
  if (material.userData.ghosted) {
    const pre = material.userData.preGhost;
    const copy = material.clone();
    copy.onBeforeCompile = pre.before; copy.customProgramCacheKey = pre.key;
    copy.userData = {...material.userData, ghosted: false};
    material = copy;
  }
  material.userData.ghosted = true;
  const before = material.onBeforeCompile, key = material.customProgramCacheKey;
  material.userData.preGhost = {before, key};
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    Object.assign(shader.uniforms, ghost, own);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + GHOST_GLSL + '\nuniform float ghostAll;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  ghostClip(length(vViewPosition), ghostAll);');
  };
  material.customProgramCacheKey = () => key.call(material) + '|ghost';
  material.needsUpdate = true;
  return material;
}

const LIGHTMAP_LINE = 'reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;';

export function hookShader(material) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, lighting, ghost);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldPos;
uniform sampler2D flickerMap;
uniform sampler2D flickerMap2;
uniform float flickerSplit;
uniform vec4 flickerK;
uniform vec3 flickerTint;
uniform vec3 flPos[${MAX_FLASHLIGHTS}];
uniform vec3 flDir[${MAX_FLASHLIGHTS}];
uniform float flOn[${MAX_FLASHLIGHTS}];
uniform mat4 flMat[${MAX_FLASHLIGHTS}];
uniform highp sampler2DShadow flShadow;
// how much of beam i reaches this point: soft-edged PCF against its tile of the shadow atlas
float beamVisible(int i, vec3 p, vec3 n, float d) {
  vec4 sc = flMat[i] * vec4(p + n * (0.012 + 0.0045 * d), 1.0);   // nudged off the surface by about a texel
  if (sc.w <= 0.0) return 1.0;
  vec3 nd = sc.xyz / sc.w;
  float depth = nd.z * 0.5 + 0.5;
  if (depth >= 1.0 || abs(nd.x) > 1.0 || abs(nd.y) > 1.0) return 1.0;   // beyond what its shadow camera sees
  vec2 tile = vec2(mod(float(i), ${SHADOW_COLS.toFixed(1)}), floor(float(i) / ${SHADOW_COLS.toFixed(1)}));
  vec2 texel = 1.0 / vec2(${(SHADOW_COLS * SHADOW_TILE).toFixed(1)}, ${(SHADOW_ROWS * SHADOW_TILE).toFixed(1)});
  vec2 lo = tile / vec2(${SHADOW_COLS.toFixed(1)}, ${SHADOW_ROWS.toFixed(1)}) + texel * 1.5;
  vec2 hi = (tile + 1.0) / vec2(${SHADOW_COLS.toFixed(1)}, ${SHADOW_ROWS.toFixed(1)}) - texel * 1.5;
  vec2 uv = (tile + clamp(nd.xy * 0.5 + 0.5, 0.0, 1.0)) / vec2(${SHADOW_COLS.toFixed(1)}, ${SHADOW_ROWS.toFixed(1)});
  // four bilinear-filtered compares in a small rotated square: a smooth ~4-texel penumbra
  float v = 0.0;
  v += texture(flShadow, vec3(clamp(uv + texel * vec2(-1.0, -0.4), lo, hi), depth));
  v += texture(flShadow, vec3(clamp(uv + texel * vec2(0.4, -1.0), lo, hi), depth));
  v += texture(flShadow, vec3(clamp(uv + texel * vec2(1.0, 0.4), lo, hi), depth));
  v += texture(flShadow, vec3(clamp(uv + texel * vec2(-0.4, 1.0), lo, hi), depth));
  return v * 0.25;
}` + GHOST_GLSL)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  ghostClip(length(vWorldPos - cameraPosition), 0.0);')
      .replace(LIGHTMAP_LINE, `
    vec3 baked = lightMapTexel.rgb;
    // dim the share of each texel's light that comes from lamp groups currently flickering off
    vec4 share = texture2D(flickerMap, vLightMapUv);
    if (flickerSplit > 0.5) share.a = texture2D(flickerMap2, vLightMapUv).r;
    float off = dot(share, vec4(1.0) - flickerK);
    baked *= max(vec3(1.0) - flickerTint * off, vec3(0.0));
    reflectedLight.indirectDiffuse += baked * lightMapIntensity * RECIPROCAL_PI;
    // flashlights: a soft-edged cone with distance falloff. Only the side of a surface you're
    // looking at, and only if the light is on that side too; and only as far as the beam reaches
    vec3 faceN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    if (dot(faceN, cameraPosition - vWorldPos) < 0.0) faceN = -faceN;
    for (int i = 0; i < ${MAX_FLASHLIGHTS}; i++) {
      if (flOn[i] < 0.01) continue;
      vec3 toL = flPos[i] - vWorldPos;
      float d = length(toL);
      vec3 L = toL / max(d, 1e-4);
      vec3 fw = flDir[i];
      float cosA = dot(-L, fw);
      float facing = dot(faceN, L);
      if (cosA < 0.8 || facing <= 0.0) continue;
      float cone = smoothstep(0.80, 0.93, cosA) * (0.65 + 0.35 * smoothstep(0.93, 0.99, cosA));
      float open = beamVisible(i, vWorldPos, faceN, d);
      if (open <= 0.0) continue;
      reflectedLight.indirectDiffuse += vec3(1.0, 0.94, 0.82) * flOn[i] * cone * facing * open * 9.0 / (1.0 + d * d * 0.45);
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
  const blank = () => new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const loader = new THREE.TextureLoader();
  // groups 0-2 in one map's rgb; newer bakes keep group 3 in a second map instead of alpha
  const [flicker, flicker2] = await Promise.all([
    meta.flickerMap ? loader.loadAsync(`${base}-flicker.webp`) : blank(),
    meta.flickerMap === 'share2' ? loader.loadAsync(`${base}-flicker2.webp`) : blank(),
  ]);
  lighting.flickerSplit.value = meta.flickerMap === 'share2' ? 1 : 0;
  for (const t of [lightmap, flicker, flicker2]) {
    t.flipY = false; t.channel = 1;
    // Atlas charts are only padded by a few texels, so skip mipmaps to avoid bleeding.
    t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  }
  lightmap.colorSpace = THREE.SRGBColorSpace;
  lighting.flickerMap.value = flicker; lighting.flickerMap2.value = flicker2;
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

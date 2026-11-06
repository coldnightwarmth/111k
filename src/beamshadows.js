// Real shadows for flashlight beams. Each lit beam (up to MAX_FLASHLIGHTS) gets a tile in one
// depth atlas, rendered from the torch looking down its beam; the level shader compares against
// it with hardware-filtered (PCF) lookups, so light stops at whatever is in the way with a soft,
// stable edge. Beams that hold still keep their tile; moving ones re-render every frame.
import * as THREE from 'three';
import {lighting, MAX_FLASHLIGHTS, FAN_TAN, FAN_RANGE, beamFrame} from './level.js';

export const SHADOW_LAYER = 2;            // what casts beam shadows: the level, doors, machine, shelves
export const TILE = 512, COLS = 4, ROWS = Math.ceil(MAX_FLASHLIGHTS / COLS);

export function createBeamShadows(renderer, scene) {
  const depth = new THREE.DepthTexture(TILE * COLS, TILE * ROWS);
  depth.type = THREE.UnsignedIntType;
  depth.compareFunction = THREE.LessEqualCompare;        // a shadow sampler: hardware compare + bilinear PCF
  depth.minFilter = depth.magFilter = THREE.LinearFilter;
  const target = new THREE.WebGLRenderTarget(TILE * COLS, TILE * ROWS, {depthTexture: depth, depthBuffer: true,
    format: THREE.RedFormat, type: THREE.UnsignedByteType, generateMipmaps: false});
  target.scissorTest = true;
  lighting.flShadow.value = depth;
  const caster = new THREE.MeshBasicMaterial({colorWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 3});
  const fov = 2 * Math.atan(FAN_TAN) * 180 / Math.PI;
  const slots = Array.from({length: MAX_FLASHLIGHTS}, () => ({
    cam: Object.assign(new THREE.PerspectiveCamera(fov, 1, .06, FAN_RANGE), {}), key: null, pos: new THREE.Vector3(), dir: new THREE.Vector3(), age: 1e9,
  }));
  for (const s of slots) s.cam.layers.set(SHADOW_LAYER);
  const right = new THREE.Vector3(), up = new THREE.Vector3(), aim = new THREE.Vector3();
  const pending = [];
  let refreshAt = 0;

  function renderSlot(i) {
    const s = slots[i], x = (i % COLS) * TILE, y = Math.floor(i / COLS) * TILE;
    target.viewport.set(x, y, TILE, TILE); target.scissor.set(x, y, TILE, TILE);
    renderer.render(scene, s.cam);
    s.age = 0;
  }
  return {
    // slot i shows beam `key` from pos along dir this frame
    assign(i, key, pos, dir) {
      const s = slots[i];
      const moved = s.key !== key || s.pos.distanceToSquared(pos) > 1e-6 || s.dir.dot(dir) < .99999;
      if (!moved) return;
      const fresh = s.key !== key;
      s.key = key; s.pos.copy(pos); s.dir.copy(dir).normalize();
      beamFrame(s.dir, right, up);
      s.cam.position.copy(pos); s.cam.up.copy(up); s.cam.lookAt(aim.copy(pos).add(s.dir));
      s.cam.updateMatrixWorld(); s.cam.updateProjectionMatrix();
      lighting.flMat.value[i].multiplyMatrices(s.cam.projectionMatrix, s.cam.matrixWorldInverse);
      pending.push({i, fresh});
    },
    // draw the tiles that need it (before the frame is drawn)
    render(dt) {
      for (const s of slots) s.age += dt;
      // now and then redraw a still beam too, so doors swinging through it show up
      refreshAt -= dt;
      if (refreshAt <= 0 && !pending.length) {
        let oldest = -1;
        slots.forEach((s, i) => { if (s.key !== null && (oldest < 0 || s.age > slots[oldest].age)) oldest = i; });
        if (oldest >= 0 && slots[oldest].age > .5) pending.push({i: oldest});
        refreshAt = .12;
      }
      if (!pending.length) return;
      const prevTarget = renderer.getRenderTarget(), prevOverride = scene.overrideMaterial, prevAuto = renderer.autoClear;
      const prevShadow = renderer.shadowMap.autoUpdate;
      scene.overrideMaterial = caster; renderer.autoClear = true; renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(target);
      const done = new Set();
      for (const {i} of pending) if (!done.has(i)) { done.add(i); renderSlot(i); }
      pending.length = 0;
      renderer.setRenderTarget(prevTarget);
      scene.overrideMaterial = prevOverride; renderer.autoClear = prevAuto; renderer.shadowMap.autoUpdate = prevShadow;
    },
    // a slot with nothing in it
    clear(i) { slots[i].key = null; },
  };
}

// put an object (and everything under it) in the set of things that block beams
export function castsBeamShadow(object) {
  object.traverse(o => { if (o.isMesh && !o.material?.transparent) o.layers.enable(SHADOW_LAYER); });
}

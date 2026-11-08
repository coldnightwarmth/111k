// Real shadows for flashlight beams. Every flashlight has its own tile in one depth atlas,
// rendered from the torch looking down its beam; the level shader compares against it with
// hardware-filtered (PCF) lookups, so light stops at whatever is in the way with a soft, stable
// edge. A beam keeps its tile while it's lit, so one lying still is drawn once (and touched up
// now and then for doors swinging through it); any beam that moves is redrawn that same frame.
import * as THREE from 'three';
import {lighting, MAX_FLASHLIGHTS, FAN_TAN, FAN_RANGE, beamFrame, SHADOW_COLS, SHADOW_ROWS, SHADOW_TILE} from './level.js';

export const SHADOW_LAYER = 2;            // what casts beam shadows: the level, doors, machine, shelves
const STILL_REFRESH = .1, STILL_AGE = .5;   // every so often redraw the stalest still beam
// beams further than this from you that have moved are redrawn one a frame (oldest first), not all at once:
// a shadow a few metres off lagging a frame or two doesn't show, and a crowd of torches can't pile up the cost
const NEAR_BEAM = 10, FAR_PER_FRAME = 1;

export function createBeamShadows(renderer, scene) {
  const W = SHADOW_TILE * SHADOW_COLS, H = SHADOW_TILE * SHADOW_ROWS;
  const depth = new THREE.DepthTexture(W, H);
  depth.type = THREE.UnsignedIntType;
  depth.compareFunction = THREE.LessEqualCompare;        // a shadow sampler: hardware compare + bilinear PCF
  depth.minFilter = depth.magFilter = THREE.LinearFilter;
  const target = new THREE.WebGLRenderTarget(W, H, {depthTexture: depth, depthBuffer: true,
    format: THREE.RedFormat, type: THREE.UnsignedByteType, generateMipmaps: false});
  target.scissorTest = true;
  lighting.flShadow.value = depth;
  const caster = new THREE.MeshBasicMaterial({colorWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 3});
  const fov = 2 * Math.atan(FAN_TAN) * 180 / Math.PI;
  const slots = Array.from({length: MAX_FLASHLIGHTS}, () => ({
    cam: new THREE.PerspectiveCamera(fov, 1, .06, FAN_RANGE), key: null,
    pos: new THREE.Vector3(), dir: new THREE.Vector3(),      // where the beam is now
    dirty: false, age: 1e9,                                 // its tile needs drawing this frame
    far: 0,                                                 // how far it is from you
  }));
  for (const s of slots) s.cam.layers.set(SHADOW_LAYER);
  const right = new THREE.Vector3(), up = new THREE.Vector3(), aim = new THREE.Vector3();
  let refreshAt = 0;

  // draw slot i's tile from where its beam is now, and point the shader's lookup at it
  function renderSlot(i) {
    const s = slots[i], x = (i % SHADOW_COLS) * SHADOW_TILE, y = Math.floor(i / SHADOW_COLS) * SHADOW_TILE;
    beamFrame(s.dir, right, up);
    s.cam.position.copy(s.pos); s.cam.up.copy(up); s.cam.lookAt(aim.copy(s.pos).add(s.dir));
    s.cam.updateMatrixWorld(); s.cam.updateProjectionMatrix();
    lighting.flMat.value[i].multiplyMatrices(s.cam.projectionMatrix, s.cam.matrixWorldInverse);
    target.viewport.set(x, y, SHADOW_TILE, SHADOW_TILE); target.scissor.set(x, y, SHADOW_TILE, SHADOW_TILE);
    // three.js only reads a target's viewport when it is bound, so bind it again for each tile
    renderer.setRenderTarget(target);
    renderer.render(scene, s.cam);
    s.dirty = false; s.age = 0;
  }
  return {
    // slot i shows beam `key` from pos along dir this frame
    assign(i, key, pos, dir, far = 0) {
      const s = slots[i];
      s.far = far;
      const fresh = s.key !== key;
      const moved = fresh || s.pos.distanceToSquared(pos) > 1e-6 || s.dir.dot(dir) < .99999;
      if (!moved) return;
      s.key = key; s.pos.copy(pos); s.dir.copy(dir).normalize();
      s.dirty = true;
    },
    // draw the tiles that need it (before the frame is drawn)
    render(dt) {
      const todo = [], farOnes = [];
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        s.age += dt;
        if (s.key !== null && s.dirty) (s.far < NEAR_BEAM ? todo : farOnes).push(i);
      }
      farOnes.sort((a, b) => slots[b].age - slots[a].age);
      todo.push(...farOnes.slice(0, FAR_PER_FRAME));
      // now and then redraw a still beam too, so doors swinging through it show up
      refreshAt -= dt;
      if (refreshAt <= 0) {
        refreshAt = STILL_REFRESH;
        let oldest = -1;
        slots.forEach((s, i) => { if (s.key !== null && !todo.includes(i) && (oldest < 0 || s.age > slots[oldest].age)) oldest = i; });
        if (oldest >= 0 && slots[oldest].age > STILL_AGE) todo.push(oldest);
      }
      if (!todo.length) return;
      const prevTarget = renderer.getRenderTarget(), prevOverride = scene.overrideMaterial, prevAuto = renderer.autoClear;
      const prevShadow = renderer.shadowMap.autoUpdate;
      scene.overrideMaterial = caster; renderer.autoClear = true; renderer.shadowMap.autoUpdate = false;
      for (const i of todo) renderSlot(i);
      renderer.setRenderTarget(prevTarget);
      scene.overrideMaterial = prevOverride; renderer.autoClear = prevAuto; renderer.shadowMap.autoUpdate = prevShadow;
    },
    // a slot with nothing in it
    clear(i) { const s = slots[i]; s.key = null; s.dirty = false; },
  };
}

// put an object (and everything under it) in the set of things that block beams
export function castsBeamShadow(object) {
  object.traverse(o => { if (o.isMesh && !o.material?.transparent) o.layers.enable(SHADOW_LAYER); });
}

// B-04, the cinema: a pull-down screen on the back wall and a projector on a crate by the door, playing the films
// (assets/cinema/) one after another, round and round, the same moment for everyone (by the clock).
//
// The projection is a real light: a spotlight at the lens whose picture is the film. The film is drawn into that
// picture from the lens's own point of view onto exactly where the screen is, so it lands on the screen square,
// and on anyone who walks into the beam (their shadow falls on the screen, and the film plays across them).
// The beam through the dusty air, the glow round the screen and the screen's light thrown back into the room
// follow the film's colour as it plays. Everything's asleep unless you're near.
import * as THREE from 'three';
import {roomFrame, DOOR_X} from './room-frame.js';
import {FILMS} from './cinema-films.js';
import {SELF_SHADOW_LAYER} from './avatar.js';

export const ROOM = 3;
const F = roomFrame(ROOM, DOOR_X[ROOM]);
// in the room's frame (x across, z to the back wall, y up)
export const SCREEN = {x: 0, y: 1.62, z: 2.93, w: 3.2, h: 1.8};
export const CRATE = {x: .55, z: -2.3, top: .721};        // the crate the projector stands on (tools/crates.py puts it there)
const LENS = {x: .44, y: CRATE.top + .088, z: CRATE.z + .2};
const WAKE = 16, SLEEP = 22;                              // metres from the room's middle: start up, shut down
const CYCLE = FILMS.reduce((s, f) => s + f.dur, 0);
const base = new URL('../assets/cinema/', import.meta.url).href;

const toWorld = (x, y, z) => { const p = F.toWorld(x, z); return new THREE.Vector3(p.x, y, p.z); };

// which film is on now, and how far into it (everyone's on the same one: it goes by the clock)
export function nowShowing(ms = Date.now()) {
  let t = (ms / 1000) % CYCLE;
  for (let i = 0; i < FILMS.length; i++) { if (t < FILMS[i].dur) return {i, t}; t -= FILMS[i].dur; }
  return {i: 0, t: 0};
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// a soft-edged rectangle of light (for the glow round the screen and on the floor)
function softRect(inner = .55) {
  return canvasTexture(128, 128, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = Math.abs((x + .5) / w * 2 - 1), v = Math.abs((y + .5) / h * 2 - 1);
      const d = Math.max(0, Math.max(u, v) - inner) / (1 - inner), a = Math.pow(Math.max(0, 1 - d), 2.2) * (1 - .35 * Math.hypot(u, v) / 1.42);
      const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0);
  });
}
function part(parent, geo, mat, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
}
const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({color, roughness, metalness, ...extra});

// the beam: the pyramid from the lens to the screen's corners, glowing faintly in the dust, softest at its edges
function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {uColor: {value: new THREE.Color(0, 0, 0)}, uTime: {value: 0}},
    vertexShader: `
      attribute vec3 across; varying vec3 vAcross; varying vec3 vWorld;
      void main() { vAcross = across; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime; varying vec3 vAcross; varying vec3 vWorld;
      float hash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main() {
        float t = max(vAcross.z, 1e-3);
        vec2 q = abs(vAcross.xy / t);                       // where across the beam (-1..1 each way); each face is one edge
        float edge = smoothstep(1.0, .55, min(q.x, q.y));
        float along = mix(1.0, .3, sqrt(t));                // brighter near the lens
        float dust = .55 + .45 * noise(vWorld * 6.0 + vec3(0.0, uTime * .07, uTime * .05)) + .5 * pow(noise(vWorld * 23.0 - uTime * .1), 8.0);
        gl_FragColor = vec4(uColor * edge * along * dust, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false,
  });
}

export function createCinema(renderer, scene, sfx) {
  const root = new THREE.Group(); root.name = 'cinema';
  const o = F.toWorld(0, 0);
  root.position.set(o.x, 0, o.z); root.rotation.y = F.yaw;           // the room's frame
  scene.add(root);

  // ---- the screen: a roller case on the wall, the fabric down from it, a weight bar along its bottom
  const S = SCREEN, border = .05;
  const fabricW = S.w + 2 * border, top = 2.62, bottom = S.y - S.h / 2 - .1;
  const caseMat = std(0xd9d6cf, .5, .3), dark = std(0x16171a, .6, .4), black = std(0x050505, .9, 0);
  part(root, new THREE.CylinderGeometry(.065, .065, fabricW + .3, 20), caseMat, [S.x, top + .04, S.z + .005], [0, 0, Math.PI / 2]);
  for (const sx of [-1, 1]) {
    part(root, new THREE.CylinderGeometry(.07, .07, .05, 20), dark, [S.x + sx * (fabricW / 2 + .17), top + .04, S.z + .005], [0, 0, Math.PI / 2]);
    part(root, new THREE.BoxGeometry(.04, .12, 3 - S.z + .03), dark, [S.x + sx * (fabricW / 2 + .17), top + .04, (S.z + 3) / 2]);   // brackets to the wall
  }
  // the black border and the back of the fabric (the white is its own plane, lit by the projector)
  part(root, new THREE.PlaneGeometry(fabricW, top - bottom), new THREE.MeshLambertMaterial({color: 0x0b0b0c}), [S.x, (top + bottom) / 2, S.z + .002], [0, Math.PI, 0]);
  const screenMat = new THREE.MeshLambertMaterial({color: 0xf4f4f2, emissive: 0x0b0b0c, toneMapped: false});
  // lit by the projector only (and the room's dark): not the lamps that light people, nor the sky-and-ground fill
  screenMat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
      .replace('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )', '#if 0').replace('#if ( NUM_HEMI_LIGHTS > 0 )', '#if 0'));
  };
  const screen = part(root, new THREE.PlaneGeometry(S.w, S.h), screenMat, [S.x, S.y, S.z], [0, Math.PI, 0]);
  screen.receiveShadow = true;
  part(root, new THREE.CylinderGeometry(.018, .018, fabricW + .02, 10), dark, [S.x, bottom, S.z - .01], [0, 0, Math.PI / 2]);
  part(root, new THREE.BoxGeometry(.06, .04, .02), dark, [S.x, bottom - .04, S.z - .02]);          // the pull tab
  // the glow it throws round itself on the wall, and down on the floor in front
  const glowTex = softRect();
  const wallGlowMat = new THREE.MeshBasicMaterial({map: glowTex, color: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false});
  part(root, new THREE.PlaneGeometry(S.w * 1.7, S.h * 1.9), wallGlowMat, [S.x, S.y + .05, 2.996], [0, Math.PI, 0]).renderOrder = 4;
  const floorGlowMat = wallGlowMat.clone();
  part(root, new THREE.PlaneGeometry(S.w * 1.5, 2.6), floorGlowMat, [S.x, .006, S.z - 1.2], [-Math.PI / 2, 0, 0]).renderOrder = 4;
  const ceilGlowMat = wallGlowMat.clone();
  part(root, new THREE.PlaneGeometry(S.w * 1.4, 1.8), ceilGlowMat, [S.x, 2.97, S.z - .8], [Math.PI / 2, 0, 0]).renderOrder = 4;

  // ---- the projector, on its crate
  const proj = new THREE.Group(); proj.position.set(LENS.x, CRATE.top, CRATE.z); root.add(proj);
  const aim = toWorld(S.x, S.y, S.z), lensW = toWorld(LENS.x, LENS.y, LENS.z);
  const shell = std(0x2b2d31, .55, .35), trim = std(0x8c9096, .4, .8);
  proj.rotation.y = Math.atan2(S.x - LENS.x, S.z - CRATE.z);                       // facing the screen
  part(proj, new THREE.BoxGeometry(.34, .13, .3), shell, [0, .075, 0]);
  part(proj, new THREE.BoxGeometry(.32, .012, .28), trim, [0, .145, 0]);
  for (let i = 0; i < 6; i++) part(proj, new THREE.BoxGeometry(.012, .01, .2), dark, [-.13 + i * .022, .153, -.01]);   // vents
  for (const [x, z] of [[-.14, -.12], [.14, -.12], [-.14, .12], [.14, .12]]) part(proj, new THREE.CylinderGeometry(.015, .018, .012, 10), dark, [x, .006, z]);
  part(proj, new THREE.CylinderGeometry(.045, .05, .07, 20), dark, [0, .088, .17], [Math.PI / 2, 0, 0]);   // the lens barrel
  part(proj, new THREE.TorusGeometry(.046, .006, 6, 20), trim, [0, .088, .2]);
  const lensMat = new THREE.MeshBasicMaterial({color: 0x222222, toneMapped: false});
  part(proj, new THREE.CircleGeometry(.038, 20), lensMat, [0, .088, .2051]);
  const led = part(proj, new THREE.BoxGeometry(.012, .006, .004), new THREE.MeshBasicMaterial({color: 0x30ff70, toneMapped: false}), [.13, .12, .151]);
  // its cord off the back of the crate and away along the floor to the wall
  const cordMat = std(0x0c0c0c, .8, 0);
  const cord = new THREE.CatmullRomCurve3([new THREE.Vector3(LENS.x, CRATE.top + .05, CRATE.z - .15), new THREE.Vector3(LENS.x + .05, CRATE.top - .02, CRATE.z - .38),
    new THREE.Vector3(LENS.x + .1, .3, CRATE.z - .41), new THREE.Vector3(LENS.x + .2, .01, CRATE.z - .45), new THREE.Vector3(LENS.x + 1.4, .01, -2.92), new THREE.Vector3(LENS.x + 1.8, .25, -2.985)]);
  part(root, new THREE.TubeGeometry(cord, 40, .006, 5), cordMat);
  root.updateMatrixWorld(true);

  // ---- the light, and the picture it carries
  const light = new THREE.SpotLight(0xffffff, 0, 0, .4, .04, 0);
  light.position.copy(lensW); light.target.position.copy(aim);
  scene.add(light, light.target);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => toWorld(S.x + sx * S.w / 2, S.y + sy * S.h / 2, S.z));
  const axis = aim.clone().sub(lensW).normalize();
  light.angle = Math.max(...corners.map(c => c.clone().sub(lensW).normalize().angleTo(axis))) * 1.06;
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = .25; light.shadow.camera.far = 9;
  light.shadow.bias = -.0004; light.shadow.normalBias = .015;
  light.shadow.radius = 2;
  // your own body in first person: its shadow, not it. three.js only draws into a shadow what the view's camera can
  // see, so the camera takes on your body's layer just for this light's shadow pass (which comes after the frame's
  // list of what to draw is made, so it isn't drawn) and gives it back when the frame's done.
  const shadowMatrices = light.shadow.updateMatrices.bind(light.shadow);
  let viewCam = null;
  light.shadow.updateMatrices = (l, vp) => { viewCam?.layers.enable(SELF_SHADOW_LAYER); shadowMatrices(l, vp); };
  const afterRender = scene.onAfterRender;
  scene.onAfterRender = function (...a) { viewCam?.layers.disable(SELF_SHADOW_LAYER); return afterRender.apply(this, a); };
  const pictureRT = new THREE.WebGLRenderTarget(1024, 1024, {colorSpace: THREE.SRGBColorSpace, depthBuffer: false});
  light.map = pictureRT.texture;
  // the film where the screen is, as the lens sees it
  const film = new THREE.Scene(); film.background = new THREE.Color(0);
  const filmMat = new THREE.MeshBasicMaterial({color: 0x000000, toneMapped: false});
  const filmPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), filmMat);
  filmPlane.position.copy(aim); filmPlane.rotation.y = F.yaw + Math.PI; filmPlane.scale.set(S.w, S.h, 1);
  film.add(filmPlane);
  // the screen's light back into the room (it lights whoever's watching)
  // (a spot just off the screen facing out, so it lights the room and not the screen itself)
  const bounce = new THREE.SpotLight(0xffffff, 0, 8, 1.25, 1, 2);
  bounce.position.copy(toWorld(S.x, S.y - .1, S.z - .08)); bounce.target.position.copy(toWorld(S.x, 1.2, -3));
  scene.add(bounce, bounce.target);

  // ---- the beam
  const local = c => root.worldToLocal(c.clone());
  const beamGeo = new THREE.BufferGeometry();
  {
    const L = root.worldToLocal(lensW.clone()), C = corners.map(local), pos = [], acr = [];
    const ac = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const a = C[k], b = C[(k + 1) % 4];
      pos.push(L.x, L.y, L.z, a.x, a.y, a.z, b.x, b.y, b.z);
      acr.push(0, 0, 0, ac[k][0], ac[k][1], 1, ac[(k + 1) % 4][0], ac[(k + 1) % 4][1], 1);
    }
    beamGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    beamGeo.setAttribute('across', new THREE.Float32BufferAttribute(acr, 3));
  }
  const beamMat = beamMaterial();
  const beam = part(root, beamGeo, beamMat);
  beam.renderOrder = 5; beam.userData.noHit = true; beam.frustumCulled = false;

  // ---- the film itself
  const video = document.createElement('video');
  Object.assign(video, {muted: true, playsInline: true, crossOrigin: 'anonymous', preload: 'auto'});
  video.setAttribute('playsinline', '');
  const videoTex = new THREE.VideoTexture(video); videoTex.colorSpace = THREE.SRGBColorSpace;
  let on = false, showing = -1, sound = null, soundTried = 0, avgAt = 0, checkAt = 0;
  const avg = new THREE.Color(0, 0, 0), avgTarget = new THREE.Color(0, 0, 0);
  const sample = document.createElement('canvas'); sample.width = 16; sample.height = 9;
  const sg = sample.getContext('2d', {willReadFrequently: true});
  const audioAt = toWorld(S.x, S.y, S.z - .2);
  const middle = toWorld(0, 1.5, 0);

  function play(i, t) {
    showing = i;
    const f = FILMS[i];
    video.src = base + f.file;
    video.currentTime = 0;
    const go = () => { video.currentTime = Math.min(t, Math.max(0, f.dur - .5)); video.play().catch(() => {}); };
    if (video.readyState >= 1) go(); else video.addEventListener('loadedmetadata', go, {once: true});
  }
  video.addEventListener('ended', () => { if (on) { const n = nowShowing(); play(n.i === showing ? (showing + 1) % FILMS.length : n.i, n.i === showing ? 0 : n.t); } });
  // the film's picture fitted inside the screen (pillarboxed or letterboxed to keep its shape)
  function fit() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const k = Math.min(S.w / vw, S.h / vh);
    filmPlane.scale.set(vw * k, vh * k, 1);
  }
  video.addEventListener('loadeddata', () => { fit(); filmMat.map = videoTex; filmMat.color.setHex(0xffffff); filmMat.needsUpdate = true; });

  function start() {
    on = true;
    const n = nowShowing();
    play(n.i, n.t);
  }
  function stop() {
    on = false; showing = -1;
    video.pause(); video.removeAttribute('src'); video.load();
    filmMat.map = null; filmMat.color.setHex(0); filmMat.needsUpdate = true;
    light.intensity = 0; bounce.intensity = 0;
    avg.setRGB(0, 0, 0); avgTarget.setRGB(0, 0, 0);
    paintGlow();
  }
  function paintGlow() {
    const l = avg.r * .3 + avg.g * .55 + avg.b * .15;
    wallGlowMat.color.copy(avg).multiplyScalar(.2);
    floorGlowMat.color.copy(avg).multiplyScalar(.075);
    ceilGlowMat.color.copy(avg).multiplyScalar(.05);
    beamMat.uniforms.uColor.value.copy(avg).multiplyScalar(.42).addScalar(.04 * Math.min(1, l * 4));
    bounce.color.copy(avg); bounce.intensity = on ? 1.5 + l * 5 : 0;
    lensMat.color.setRGB(.15 + avg.r * .85, .15 + avg.g * .85, .15 + avg.b * .85);
  }
  return {
    root, screen,
    get on() { return on; },
    // within earshot and sight of it (for the shadow pass and first person's shadow)
    near(p) { return on && p.distanceTo(middle) < WAKE; },
    update(dt, camera, inRoom) {
      viewCam = camera; camera.layers.disable(SELF_SHADOW_LAYER);
      const camPos = camera.position, d = camPos.distanceTo(middle);
      if (!on && d < WAKE) start();
      else if (on && d > SLEEP) stop();
      if (!on) return;
      const now = performance.now();
      beamMat.uniforms.uTime.value = now / 1000;
      led.visible = Math.floor(now / 900) % 4 !== 0;
      // the sound, once there can be any (someone's clicked into the page)
      if (!sound && now - soundTried > 1000) {
        soundTried = now;
        sound = sfx.stream(video, audioAt, {level: .32, ref: 2.2, range: 24});
        if (sound) video.muted = false;
      }
      sound?.muffle(!inRoom);
      // kept with the clock (a stall, a tab in the background)
      if (now - checkAt > 4000 && video.readyState >= 2) {
        checkAt = now;
        const n = nowShowing();
        if (n.i !== showing) play(n.i, n.t);
        else if (Math.abs(video.currentTime - n.t) > 2.5) video.currentTime = n.t;
        if (video.paused) video.play().catch(() => {});
      }
      // the film's colour, a few times a second: the beam, the glow and the light back into the room follow it
      if (now - avgAt > 120 && video.readyState >= 2) {
        avgAt = now;
        try {
          sg.drawImage(video, 0, 0, 16, 9);
          const px = sg.getImageData(0, 0, 16, 9).data;
          let r = 0, g = 0, b = 0;
          for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
          const n = px.length / 4 * 255;
          avgTarget.setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace);
        } catch { avgTarget.setRGB(.3, .3, .32); }
      }
      avg.lerp(avgTarget, 1 - Math.exp(-dt * 8));
      paintGlow();
      light.intensity = video.readyState >= 2 ? Math.PI * 1.05 : 0;
      // the picture for the light: the film, from the lens, where the screen is
      light.updateMatrixWorld(); light.target.updateMatrixWorld();
      shadowMatrices(light);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(pictureRT);
      renderer.render(film, light.shadow.camera);
      renderer.setRenderTarget(prev);
      renderer.shadowMap.needsUpdate = true;
    },
  };
}

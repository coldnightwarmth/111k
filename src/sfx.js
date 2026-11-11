// Sound effects in the space: each plays from where it happens (through a 3D panner, quieter with distance,
// muffled through walls, with a little of the tunnel's echo), or straight to you for your own and the UI's.
// The sounds themselves are made in src/sfx-synth.js, a few takes of each so no two in a row are the same.
// They go out through voice chat's audio (src/voice.js), so Chrome's echo cancellation hears them too and
// your mic doesn't send the game's sounds back out.
import * as THREE from 'three';
import {SOUNDS, make, RATE} from './sfx-synth.js';

// Which version of each sound the game uses (the /sfx page tries them all; one picked there is used in that
// browser until it's set here). Set from the picks sent over on 10 November.
export const PICKS = {step: 'c', jump: 'a', land: 'c', hop: 'c', swing: 'a', hit: 'c', rattle: 'c', spray: 'a', fire: 'a',
  splat: 'c', splatBody: 'a', scrub: 'b', flashlight: 'b', grab: 'b', thunkWood: 'a', thunkMetal: 'b', thunkCan: 'a',
  thunkPlastic: 'a', place: 'b', doorOpen: 'a', doorBump: 'a', doorShut: 'b', button: 'a', raceStart: 'a', lap: 'a', finish: 'a',
  raceCancel: 'a', crownStart: 'b', crownTake: 'b', crownLost: 'b', crownWin: 'b', chat: 'b', hum: 'a'};
export const PICKS_KEY = '111k:sfx-picks';
export function picks() {
  let mine = {};
  try { mine = JSON.parse(localStorage.getItem(PICKS_KEY) || '{}') || {}; } catch {}
  const out = {...PICKS};
  for (const [k, v] of Object.entries(mine)) if (SOUNDS[k]?.versions[v]) out[k] = v;
  return out;
}

// how loud each is, how much echo it gets, how far it carries (metres)
export const MIX = {
  step: [.32, .22, 22], jump: [.28, .2, 18], land: [.5, .25, 24], hop: [.42, .25, 24],
  swing: [.32, .15, 14], hit: [.85, .3, 30],
  rattle: [.35, .15, 14], spray: [.42, .3, 22], fire: [.6, .4, 40], splat: [.5, .3, 30], splatBody: [.6, .3, 30], scrub: [.38, .2, 14],
  flashlight: [.4, .1, 10], grab: [.32, .1, 10], thunkWood: [.6, .3, 26], thunkMetal: [.5, .35, 26], thunkCan: [.5, .3, 24],
  thunkPlastic: [.55, .3, 24], place: [.42, .2, 16],
  doorOpen: [.38, .25, 22], doorBump: [.5, .3, 26], doorShut: [.6, .35, 30], button: [.55, .25, 20],
  raceStart: [.5, .35, 60], lap: [.55, .35, 60], finish: [.6, .4, 80], raceCancel: [.45, .35, 60],
  crownStart: [.32, 0, 0], crownTake: [.3, 0, 0], crownLost: [.28, 0, 0], crownWin: [.38, 0, 0], chat: [.22, 0, 0], hum: [.1, 0, 0],
};
const TAKES = 6;          // different takes of each kept ready
const MAX_PLAYING = 28;

// the tunnel's echo: a couple of seconds of noise dying away, darker as it goes, with a few early reflections
export function impulse(ctx) {
  const len = Math.round(2.4 * ctx.sampleRate), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate, k = .25 + .7 * Math.exp(-t / .5);            // the high end goes first
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * Math.exp(-t / .45) * Math.min(1, t / .012);
    }
    for (const [t, a] of [[.011, .5], [.019, .35], [.029, .3], [.043, .22], [.061, .18]]) d[Math.round((t + c * .003) * ctx.sampleRate)] += a * (c ? -1 : 1);
  }
  return ir;
}

export function createSfx(voice) {
  let ctx = null, out = null, wetIn = null, wetOut = null;
  const takes = new Map();       // name -> [AudioBuffer]
  const playing = new Set();
  let chosen = picks();
  const occl = new Map();        // key -> {at, muffled}
  const listener = new THREE.Vector3(), toward = new THREE.Vector3();
  let hits = null;

  function graph() {
    if (ctx) return true;
    const g = voice.effects?.();
    if (!g) return false;
    ({ctx, out} = g);
    wetIn = ctx.createGain();
    const conv = ctx.createConvolver(); conv.normalize = true; conv.buffer = impulse(ctx);
    wetOut = ctx.createGain(); wetOut.gain.value = .9;
    wetIn.connect(conv); conv.connect(wetOut); wetOut.connect(out);
    return true;
  }
  // one take of a sound, made now if there's none yet; more are made in quiet moments
  function take(name) {
    let list = takes.get(name);
    if (!list) { list = []; takes.set(name, list); }
    if (!list.length) list.push(render(name));
    else if (list.length < TAKES && !idleQueued.has(name)) { idleQueued.add(name); idle(() => { idleQueued.delete(name); if (list.length < TAKES) list.push(render(name)); }); }
    return list[Math.floor(Math.random() * list.length)];
  }
  const idleQueued = new Set();
  const idle = f => (window.requestIdleCallback || (g => setTimeout(g, 50)))(f, {timeout: 2000});
  function render(name) {
    const x = make(name, chosen[name]);
    const b = ctx.createBuffer(1, x.length, RATE); b.copyToChannel(x, 0);
    return b;
  }
  function muffled(at, key) {
    if (!hits || !key) return false;
    const now = performance.now(), c = occl.get(key);
    if (c && now - c.at < 250) return c.muffled;
    toward.set(at.x - listener.x, at.y - listener.y, at.z - listener.z);
    const d = toward.length();
    const m = d > .8 && !!hits.raycast(listener, toward.divideScalar(d), d - .3);
    occl.set(key, {at: now, muffled: m});
    return m;
  }

  const heard = [];            // what's played lately (for tests)
  const api = {
    heard,
    get running() { return graph() && ctx.state === 'running'; },
    // play a sound. at: where it is ({x, y, z}), or nothing for your own sounds and the UI's.
    // gain, rate (pitch), delay (seconds), key (a stable id for whoever makes it: their muffling's remembered)
    play(name, {at = null, gain = 1, rate = 1, delay = 0, key = null} = {}) {
      if (!SOUNDS[name] || !api.running) return;
      const [level, wet, range] = MIX[name] || [.5, .2, 25];
      let dist = 0;
      if (at) {
        dist = Math.hypot(at.x - listener.x, at.y - listener.y, at.z - listener.z);
        if (dist > range) return;
      }
      if (playing.size >= MAX_PLAYING) {             // too much at once: the farthest of what's playing makes way
        let far = null; for (const p of playing) if (!far || p.dist > far.dist) far = p;
        if (far && far.dist > dist) { try { far.src.stop(); } catch {} } else return;
      }
      const src = ctx.createBufferSource(); src.buffer = take(name);
      src.playbackRate.value = rate * (1 + (Math.random() - .5) * .06);
      const g = ctx.createGain(); g.gain.value = level * gain;
      src.connect(g);
      let last = g;
      if (at && muffled(at, key || name)) {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = .5;
        g.gain.value *= .6; last.connect(lp); last = lp;
      }
      if (at) {
        const p = ctx.createPanner();
        Object.assign(p, {panningModel: dist < 12 ? 'HRTF' : 'equalpower', distanceModel: 'inverse', refDistance: name in RACE ? 4 : 1.2,
          rolloffFactor: 1.1, maxDistance: range});
        if (p.positionX) { p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z; } else p.setPosition(at.x, at.y, at.z);
        last.connect(p); last = p;
      }
      last.connect(out);
      if (wet) {                                    // the farther off, the more of it is echo
        const w = ctx.createGain(); w.gain.value = wet * (at ? 1 / (1 + dist * .06) : .7);
        last.connect(w); w.connect(wetIn);
      }
      const p = {src, dist};
      playing.add(p);
      heard.push(`${name}${at ? '@' + dist.toFixed(1) : ''}`); if (heard.length > 200) heard.shift();
      src.onended = () => { playing.delete(p); src.disconnect(); };
      src.start(ctx.currentTime + delay);
    },
    // a sound that goes round and round (the tunnel's hum); returns {gain(v), stop()}
    loop(name, gain = 1) {
      if (!graph()) return null;
      const src = ctx.createBufferSource(); src.buffer = take(name); src.loop = true;
      const g = ctx.createGain(); g.gain.value = (MIX[name]?.[0] ?? .1) * gain;
      src.connect(g); g.connect(out); src.start();
      return {gain: v => g.gain.setTargetAtTime((MIX[name]?.[0] ?? .1) * v, ctx.currentTime, .4), stop: () => { try { src.stop(); } catch {} }};
    },
    // once a frame: where you hear from, and whether you're in a room (less echo) or the tunnel
    frame({camera, hits: h, inRoom = false}) {
      hits = h;
      if (!ctx) return;
      const e = camera.matrixWorld.elements;
      listener.x = e[12]; listener.y = e[13]; listener.z = e[14];
      const L = ctx.listener, fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
      if (L.positionX) {
        L.positionX.value = listener.x; L.positionY.value = listener.y; L.positionZ.value = listener.z;
        L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
      } else { L.setPosition(listener.x, listener.y, listener.z); L.setOrientation(fx, fy, fz, ux, uy, uz); }
      wetOut.gain.setTargetAtTime(inRoom ? .45 : .9, ctx.currentTime, .3);
    },
    ready(name) { return !!takes.get(name)?.length; },
    // make takes of these ahead of time, in quiet moments
    warm(names = Object.keys(PICKS)) {
      if (!graph()) return;
      const list = [...names];
      const next = () => { const n = list.shift(); if (!n) return; if (!takes.get(n)?.length) take(n); idle(next); };
      idle(next);
    },
    // the /sfx page's picks changed (in another tab): start again from fresh takes
    repick() { chosen = picks(); takes.clear(); },
  };
  addEventListener('storage', e => { if (e.key === PICKS_KEY) api.repick(); });
  return api;
}
const RACE = {raceStart: 1, lap: 1, finish: 1, raceCancel: 1};

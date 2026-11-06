// Proximity voice chat. Audio goes browser to browser over WebRTC (the room server only
// passes the setup notes along). You link up with players in voice within CONNECT metres
// and drop them past DROP. Each voice plays from that player's head through a 3D panner,
// fades with distance, and is muffled when a wall is in the way.
import * as THREE from 'three';

const CONNECT = 30, DROP = 40, FADE_FROM = 24;
// Public STUN servers find a direct route for most networks. Strict ones (some offices,
// some mobile carriers) also need a TURN relay: add {urls, username, credential} here.
const ICE_SERVERS = [{urls: 'stun:stun.cloudflare.com:3478'}, {urls: 'stun:stun.l.google.com:19302'}];
const KEY = '111k:voice';
const isChromium = !!(navigator.userAgentData?.brands || []).find(b => /Chromium|Google Chrome|Edge/.test(b.brand)) || /Chrome\//.test(navigator.userAgent);

function loadPrefs() {
  try { return {on: false, muted: false, deviceId: '', volume: 1, ...JSON.parse(localStorage.getItem(KEY) || '{}')}; } catch { return {on: false, muted: false, deviceId: '', volume: 1}; }
}

// Opus in stereo at a generous bitrate (the loopback below carries the spatial mix)
const stereoOpus = sdp => {
  const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  return sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`), (all, p) => `a=fmtp:${pt} ${p};stereo=1;sprop-stereo=1;maxaveragebitrate=256000`);
};

export function createVoice() {
  const prefs = loadPrefs();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} };
  const listeners = new Set();
  const changed = () => { save(); for (const f of listeners) f(api); };
  let ctx = null, master = null, mic = null, micSource = null, micAnalyser = null, micError = '';
  let send = null, myId = () => '';
  const peers = new Map();       // id -> link
  const levelBuf = new Float32Array(512);

  // ---------------------------------------------------------- audio output
  function audio() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)({latencyHint: 'interactive'});
    master = ctx.createGain(); master.gain.value = prefs.volume;
    const comp = ctx.createDynamicsCompressor();          // keep a shout from clipping
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp);
    if (isChromium) {
      // Chrome's echo cancellation only hears audio played through WebRTC, not Web Audio, so
      // the spatial mix goes round a local loopback link into an <audio> element.
      const dest = ctx.createMediaStreamDestination(); comp.connect(dest);
      const out = new Audio(); out.autoplay = true;
      const a = new RTCPeerConnection(), b = new RTCPeerConnection();
      a.onicecandidate = e => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
      b.onicecandidate = e => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
      b.ontrack = e => { out.srcObject = new MediaStream([e.track]); out.play().catch(() => {}); };
      a.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
      (async () => {
        const offer = await a.createOffer(); offer.sdp = stereoOpus(offer.sdp);
        await a.setLocalDescription(offer); await b.setRemoteDescription(offer);
        const answer = await b.createAnswer(); answer.sdp = stereoOpus(answer.sdp);
        await b.setLocalDescription(answer); await a.setRemoteDescription(answer);
      })().catch(err => { console.warn('voice loopback', err); comp.connect(ctx.destination); });
      api.unlock = () => { ctx.resume(); out.play().catch(() => {}); };
    } else comp.connect(ctx.destination);
    // browsers start audio suspended until the page is interacted with
    const wake = () => { ctx.resume(); api.unlock?.(); };
    for (const type of ['pointerdown', 'keydown', 'touchend']) addEventListener(type, wake, {passive: true});
    return ctx;
  }

  // ------------------------------------------------------------------ mic
  async function openMic() {
    micError = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: {deviceId: prefs.deviceId ? {exact: prefs.deviceId} : undefined,
        echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
      mic?.getTracks().forEach(t => t.stop());
      mic = stream;
      const track = mic.getAudioTracks()[0];
      track.enabled = !prefs.muted;
      if (!prefs.deviceId) prefs.deviceId = track.getSettings?.().deviceId || '';
      micSource?.disconnect();
      micSource = audio().createMediaStreamSource(mic);
      micAnalyser = ctx.createAnalyser(); micAnalyser.fftSize = 512;
      micSource.connect(micAnalyser);
      for (const p of peers.values()) p.sender?.replaceTrack(track).catch(() => {});
    } catch (err) {
      // no mic (or no permission): you can still listen
      micError = err?.name === 'NotAllowedError' ? 'mic blocked: you can still listen' : 'no mic found: you can still listen';
      if (prefs.deviceId && err?.name === 'OverconstrainedError') { prefs.deviceId = ''; return openMic(); }
    }
    changed();
  }
  function closeMic() { mic?.getTracks().forEach(t => t.stop()); mic = null; micSource?.disconnect(); micSource = null; micAnalyser = null; }
  const micTrack = () => mic?.getAudioTracks()[0] || null;

  // ---------------------------------------------------------------- links
  function link(id, initiator) {
    const pc = new RTCPeerConnection({iceServers: ICE_SERVERS});
    const p = {id, pc, sender: null, pending: [], audio: null, level: 0, gone: false, born: performance.now(), occluded: false, lastRay: 0};
    peers.set(id, p);
    pc.onicecandidate = e => { if (e.candidate) send?.({type: 'rtc', to: id, d: {ice: e.candidate.toJSON()}}); };
    pc.ontrack = e => hear(p, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') drop(id, false, 8000);
    };
    if (initiator) {
      p.sender = pc.addTransceiver('audio', {direction: 'sendrecv'}).sender;
      p.sender.replaceTrack(micTrack()).catch(() => {});
      (async () => {
        const offer = await pc.createOffer(); offer.sdp = stereoOpus(offer.sdp);
        await pc.setLocalDescription(offer);
        send?.({type: 'rtc', to: id, d: {sdp: {type: offer.type, sdp: offer.sdp}}});
      })().catch(err => { console.warn('voice offer', err); drop(id, false, 8000); });
    }
    return p;
  }
  const retryAfter = new Map();   // id -> time before which we don't try again
  function drop(id, tell = true, wait = 0) {
    const p = peers.get(id);
    if (!p) return;
    peers.delete(id); p.gone = true;
    if (tell) send?.({type: 'rtc', to: id, d: {bye: true}});
    try { p.pc.close(); } catch {}
    if (p.audio) { p.audio.el.srcObject = null; for (const n of Object.values(p.audio.nodes)) n.disconnect(); }
    if (wait) retryAfter.set(id, performance.now() + wait);
  }
  // a voice arrives: route it through its own filter, gain and 3D panner
  function hear(p, stream) {
    if (p.audio) return;
    const c = audio();
    // Chrome only feeds a remote stream into Web Audio while a media element is playing it
    const el = new Audio(); el.muted = true; el.srcObject = stream; el.play().catch(() => {});
    const src = c.createMediaStreamSource(stream);
    const analyser = c.createAnalyser(); analyser.fftSize = 512;
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 18000; filter.Q.value = .5;
    const gain = c.createGain();
    const panner = c.createPanner();
    Object.assign(panner, {panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.4, maxDistance: DROP, rolloffFactor: 1.25,
      coneInnerAngle: 360, coneOuterAngle: 360});
    src.connect(analyser); src.connect(filter); filter.connect(gain); gain.connect(panner); panner.connect(master);
    p.audio = {el, nodes: {src, analyser, filter, gain, panner}};
  }

  async function signal(from, d) {
    if (!prefs.on || !send) return;
    if (d.bye) { drop(from, false, 3000); return; }
    let p = peers.get(from);
    try {
      if (d.sdp?.type === 'offer') {
        if (p && p.pc.signalingState !== 'stable') return;      // already mid-handshake with them
        if (p) drop(from, false);
        p = link(from, false);
        await p.pc.setRemoteDescription(d.sdp);
        const tr = p.pc.getTransceivers()[0];
        if (tr) { tr.direction = 'sendrecv'; p.sender = tr.sender; await p.sender.replaceTrack(micTrack()); }
        const answer = await p.pc.createAnswer(); answer.sdp = stereoOpus(answer.sdp);
        await p.pc.setLocalDescription(answer);
        send({type: 'rtc', to: from, d: {sdp: {type: answer.type, sdp: answer.sdp}}});
      } else if (d.sdp?.type === 'answer' && p && p.pc.signalingState === 'have-local-offer') {
        await p.pc.setRemoteDescription(d.sdp);
      } else if (d.ice && p) {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(d.ice); else p.pending.push(d.ice);
        return;
      } else return;
      for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
    } catch (err) { console.warn('voice signal', err); if (p) drop(from, true, 5000); }
  }

  function rms(analyser) {
    analyser.getFloatTimeDomainData(levelBuf);
    let s = 0; for (const v of levelBuf) s += v * v;
    return Math.min(1, Math.sqrt(s / levelBuf.length) * 6);
  }
  const fwd = new THREE.Vector3(), up = new THREE.Vector3(), camPos = new THREE.Vector3(), head = new THREE.Vector3(), dirV = new THREE.Vector3();

  const api = {
    get enabled() { return prefs.on; },
    get muted() { return prefs.muted; },
    get volume() { return prefs.volume; },
    get deviceId() { return prefs.deviceId; },
    get hasMic() { return !!mic; },
    get error() { return micError; },
    get talking() { return !!mic && !prefs.muted && micAnalyser && rms(micAnalyser) > .08; },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    unlock: null,
    async setEnabled(on) {
      prefs.on = on;
      if (on) { audio(); api.unlock?.(); ctx.resume(); await openMic(); }
      else { for (const id of [...peers.keys()]) drop(id); closeMic(); micError = ''; changed(); }
    },
    setMuted(m) { prefs.muted = m; const t = micTrack(); if (t) t.enabled = !m; changed(); },
    setVolume(v) { prefs.volume = v; if (master) master.gain.setTargetAtTime(v, ctx.currentTime, .05); changed(); },
    async setDevice(id) { prefs.deviceId = id; if (prefs.on) await openMic(); else changed(); },
    async devices() {
      try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch { return []; }
    },
    // for tests: each link's state
    debug() { return [...peers.values()].map(p => `${p.id}:${p.pc.connectionState}/${p.pc.signalingState}/${p.audio ? 'audio' : 'none'}`).join(' ') || 'no links'; },
    micLevel() { return micAnalyser && !prefs.muted ? rms(micAnalyser) : 0; },
    // how loud someone is right now (0..1), for the speaking marker over their head
    levelOf(id) { return peers.get(id)?.level || 0; },
    // join the room's signalling once connected
    attach(sendFn, idFn) { send = sendFn; myId = idFn; },
    signal,
    // once a frame: who to link with, where everyone is, what's between you
    update({camera, peers: others, hits}) {
      if (!prefs.on || !send || !myId()) return;
      const now = performance.now(), me = myId();
      camera.getWorldPosition(camPos); camera.getWorldDirection(fwd); up.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
      if (ctx) {
        const L = ctx.listener;
        if (L.positionX) {
          L.positionX.value = camPos.x; L.positionY.value = camPos.y; L.positionZ.value = camPos.z;
          L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
        } else { L.setPosition(camPos.x, camPos.y, camPos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
      }
      const seen = new Set();
      for (const o of others) {
        if (!o.vc) continue;
        const d = Math.hypot(o.x - camPos.x, o.z - camPos.z);
        seen.add(o.id);
        let p = peers.get(o.id);
        if (!p && d < CONNECT && me < o.id && now > (retryAfter.get(o.id) || 0)) p = link(o.id, true);   // the lower id calls
        if (p && d > DROP) { drop(o.id); continue; }
        if (!p?.audio) continue;
        const {panner, gain, filter, analyser} = p.audio.nodes;
        head.set(o.x, o.y, o.z);
        if (panner.positionX) { panner.positionX.value = head.x; panner.positionY.value = head.y; panner.positionZ.value = head.z; }
        else panner.setPosition(head.x, head.y, head.z);
        // a wall in between muffles them (checked a few times a second)
        if (hits && now - p.lastRay > 220) {
          p.lastRay = now;
          const dist = head.distanceTo(camPos);
          dirV.copy(head).sub(camPos).normalize();
          p.occluded = dist > .5 && !!hits.raycast(camPos, dirV, dist - .3);
        }
        const fade = 1 - Math.min(1, Math.max(0, (d - FADE_FROM) / (DROP - FADE_FROM)));
        gain.gain.setTargetAtTime(fade * (p.occluded ? .55 : 1), ctx.currentTime, .12);
        filter.frequency.setTargetAtTime(p.occluded ? 750 : 18000, ctx.currentTime, .12);
        p.level = p.level * .6 + rms(analyser) * .4;
      }
      // anyone who left voice (or the room)
      for (const [id, p] of [...peers]) if (!seen.has(id) && now - p.born > 6000) drop(id, false);
    },
  };
  return api;
}

// ------------------------------------------------------------------- panel
// The same small panel on the start screen and the Esc screen.
export function voicePanel(voice) {
  const el = document.createElement('section');
  el.className = 'voice-panel';
  el.innerHTML = `
    <h2>voice chat</h2>
    <label class="row toggle"><input type="checkbox" class="on"><span>proximity voice</span></label>
    <div class="more">
      <label class="row"><span>mic</span><select class="mic"><option value="">default mic</option></select></label>
      <div class="meter" aria-hidden="true"><i></i></div>
      <label class="row toggle"><input type="checkbox" class="mute"><span>mute mic <kbd>M</kbd></span></label>
      <label class="row"><span>voices</span><input type="range" class="vol" min="0" max="1.5" step="0.05"></label>
      <p class="note"></p>
    </div>`;
  const $ = s => el.querySelector(s);
  const on = $('.on'), mic = $('.mic'), mute = $('.mute'), vol = $('.vol'), note = $('.note'), bar = $('.meter i');
  for (const type of ['keydown', 'keyup']) el.addEventListener(type, e => { if (e.key !== 'Escape') e.stopPropagation(); });
  async function fillDevices() {
    const list = await voice.devices();
    mic.replaceChildren(...(list.length ? list : [{deviceId: '', label: 'default mic'}]).map((d, i) => {
      const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `mic ${i + 1}`; return o;
    }));
    mic.value = voice.deviceId && list.some(d => d.deviceId === voice.deviceId) ? voice.deviceId : (list[0]?.deviceId || '');
  }
  function sync() {
    on.checked = voice.enabled; mute.checked = voice.muted; vol.value = voice.volume;
    el.classList.toggle('enabled', voice.enabled);
    note.textContent = voice.error || (voice.enabled ? 'players near you hear you. headphones sound best.' : 'talk to players near you.');
  }
  on.addEventListener('change', async () => { await voice.setEnabled(on.checked); fillDevices(); });
  mic.addEventListener('change', () => voice.setDevice(mic.value));
  mute.addEventListener('change', () => voice.setMuted(mute.checked));
  vol.addEventListener('input', () => voice.setVolume(Number(vol.value)));
  voice.onChange(sync);
  sync(); fillDevices();
  navigator.mediaDevices?.addEventListener?.('devicechange', fillDevices);
  // the level meter runs while the panel is on screen
  (function meter() {
    if (el.isConnected && el.offsetParent) bar.style.transform = `scaleX(${voice.micLevel().toFixed(3)})`;
    requestAnimationFrame(meter);
  })();
  return el;
}

// Proximity voice chat, always listening. Audio goes browser to browser over WebRTC (the
// room server only passes the setup notes along). Two players link up within CONNECT metres
// when at least one of them has their mic on, and drop past DROP. Each voice plays from that player's head through a 3D panner,
// fades with distance, and is muffled when a wall is in the way.
// Text-to-speech rides the same links: with it on, your chat messages are read out in your avatar's voice
// (src/tts.js) and mixed into what you send, so they come from your head like your mic would.
import * as THREE from 'three';
import {createTTS, RATE} from './tts.js';

const CONNECT = 30, DROP = 40, FADE_FROM = 24;
// Public STUN servers find a direct route for most networks. Strict ones (some offices,
// some mobile carriers) also need a TURN relay: add {urls, username, credential} here.
const ICE_SERVERS = [{urls: 'stun:stun.cloudflare.com:3478'}, {urls: 'stun:stun.l.google.com:19302'}];
const KEY = '111k:voice';
const isChromium = !!(navigator.userAgentData?.brands || []).find(b => /Chromium|Google Chrome|Edge/.test(b.brand)) || /Chrome\//.test(navigator.userAgent);

function loadPrefs() {
  const prefs = {mic: false, deviceId: '', volume: 1, tts: false, ttsPitch: 'lower'};
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (saved.mic === undefined && saved.on) saved.mic = !saved.muted;   // from when voice had an on switch
    Object.assign(prefs, {mic: !!saved.mic, deviceId: saved.deviceId || '', volume: Number.isFinite(saved.volume) ? saved.volume : 1,
      tts: !!saved.tts, ttsPitch: saved.ttsPitch === 'higher' ? 'higher' : 'lower'});
  } catch {}
  return prefs;
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
  // text-to-speech: what's said plays to you through `speech`, and (unless it's a preview) into `outMix`,
  // which is what your links send while it's on (your mic goes in there too)
  let speech = null, sendBus = null, outMix = null, speechEnd = 0;
  const playing = new Set();
  const tts = createTTS({onSpeech: (pcm, job) => play(pcm, job), onState: () => changed()});
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
    speech = ctx.createGain(); speech.connect(master);
    sendBus = ctx.createGain(); outMix = ctx.createMediaStreamDestination(); sendBus.connect(outMix);
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
      if (!prefs.deviceId) prefs.deviceId = track.getSettings?.().deviceId || '';
      micSource?.disconnect();
      micSource = audio().createMediaStreamSource(mic);
      micAnalyser = ctx.createAnalyser(); micAnalyser.fftSize = 512;
      micSource.connect(micAnalyser); micSource.connect(sendBus);
      retrack();
    } catch (err) {
      // no mic (or no permission): you can still listen
      micError = err?.name === 'NotAllowedError' ? 'mic blocked: allow it in the browser to talk' : 'no mic found';
      prefs.mic = false;
      if (prefs.deviceId && err?.name === 'OverconstrainedError') { prefs.deviceId = ''; return openMic(); }
    }
    changed();
  }
  function closeMic() {
    mic?.getTracks().forEach(t => t.stop()); mic = null; micSource?.disconnect(); micSource = null; micAnalyser = null;
    retrack();
  }
  // what the links send: the mic as it is, or with text-to-speech on, the mix of it and the speech
  const outTrack = () => prefs.tts && outMix ? outMix.stream.getAudioTracks()[0] : mic?.getAudioTracks()[0] || null;
  const retrack = () => { for (const p of peers.values()) p.sender?.replaceTrack(outTrack()).catch(() => {}); };

  // ------------------------------------------------------- text-to-speech
  // drifella: hugo (higher) or bruno (lower); drilady: kiki or rosie
  const voiceFor = kind => kind === 'drilady' ? (prefs.ttsPitch === 'higher' ? 'kiki' : 'rosie') : (prefs.ttsPitch === 'higher' ? 'hugo' : 'bruno');
  function play(pcm, job) {
    if (!pcm.length) return;
    const c = audio();
    const buf = c.createBuffer(1, pcm.length, RATE); buf.copyToChannel(pcm, 0);
    const src = c.createBufferSource(); src.buffer = buf;
    src.connect(speech); if (job.send) src.connect(sendBus);
    const at = Math.max(c.currentTime + .03, speechEnd);       // back to back, in order
    src.start(at); speechEnd = at + buf.duration;
    src.job = job; src.end = speechEnd; playing.add(src);
    src.onended = () => { playing.delete(src); src.disconnect(); };
  }
  function hush(pred) {
    tts.cancel(pred);
    for (const src of [...playing]) if (pred(src.job)) { try { src.stop(); } catch {} playing.delete(src); src.disconnect(); }
    speechEnd = Math.max(0, ...[...playing].map(src => src.end));
  }
  // The previews ("hi, this is how i sound.") are made already (assets/tts/preview-*.mp3, a few KB each), so
  // they play the moment you choose a voice, without waiting on the model.
  const clips = {};
  function loadPreviews() {
    for (const v of ['hugo', 'bruno', 'kiki', 'rosie']) clips[v] ||= fetch(new URL(`../assets/tts/preview-${v}.mp3`, import.meta.url))
      .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(b => new OfflineAudioContext(1, 1, RATE).decodeAudioData(b))
      .then(buf => (clips[v] = buf))
      .catch(() => (clips[v] = null));          // (then it's made on the spot)
  }
  function preview(kind) {
    hush(job => !job.send);                    // a new preview cuts off the last
    const v = voiceFor(kind), clip = clips[v];
    if (clip instanceof AudioBuffer) play(clip.getChannelData(0), {send: false});
    else tts.say('hi, this is how i sound.', v, {send: false});
  }

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
      p.sender.replaceTrack(outTrack()).catch(() => {});
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
    if (!send) return;
    if (d.bye) { drop(from, false, 3000); return; }
    let p = peers.get(from);
    try {
      if (d.sdp?.type === 'offer') {
        if (p && p.pc.signalingState !== 'stable') return;      // already mid-handshake with them
        if (p) drop(from, false);
        p = link(from, false);
        await p.pc.setRemoteDescription(d.sdp);
        const tr = p.pc.getTransceivers()[0];
        if (tr) { tr.direction = 'sendrecv'; p.sender = tr.sender; await p.sender.replaceTrack(outTrack()); }
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
    get enabled() { return true; },                // always listening
    get micOn() { return prefs.mic && !!mic; },
    get wantsMic() { return prefs.mic; },
    get volume() { return prefs.volume; },
    get deviceId() { return prefs.deviceId; },
    get hasMic() { return !!mic; },
    get error() { return micError; },
    get talking() { return !!mic && micAnalyser && rms(micAnalyser) > .08; },
    // something to send: your mic, or text-to-speech ready to read your messages out
    get sending() { return api.micOn || prefs.tts; },
    get ttsOn() { return prefs.tts; },
    get ttsPitch() { return prefs.ttsPitch; },
    get ttsState() { return tts.state; },      // idle, loading, ready or error
    // kind: whose voice to play a short preview in (drifella or drilady), or none for no preview
    setTTS(on, kind) {
      prefs.tts = !!on;
      audio(); api.unlock?.(); ctx.resume();
      if (on) { tts.warm(); if (kind) preview(kind); } else hush(() => true);
      retrack(); changed();
    },
    loadPreviews,
    setTTSPitch(pitch, kind) {
      prefs.ttsPitch = pitch === 'higher' ? 'higher' : 'lower';
      if (prefs.tts && kind) preview(kind);
      changed();
    },
    // read a chat message out (if text-to-speech is on) in that kind of avatar's voice
    say(text, kind) {
      if (!prefs.tts) return;
      audio(); ctx.resume();
      tts.say(text, voiceFor(kind));
    },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    unlock: null,
    // talking is opt-in; hearing others is always on
    async setMicOn(on) {
      prefs.mic = on;
      if (on) { audio(); api.unlock?.(); ctx.resume(); await openMic(); }
      else { closeMic(); micError = ''; changed(); }
    },
    setVolume(v) { prefs.volume = v; if (master) master.gain.setTargetAtTime(v, ctx.currentTime, .05); changed(); },
    async setDevice(id) { prefs.deviceId = id; if (prefs.mic) await openMic(); else changed(); },
    async devices() {
      try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch { return []; }
    },
    // for tests: each link's state
    debug() { return [...peers.values()].map(p => `${p.id}:${p.pc.connectionState}/${p.pc.signalingState}/${p.audio ? 'audio' : 'none'}`).join(' ') || 'no links'; },
    micLevel() { return micAnalyser ? rms(micAnalyser) : 0; },
    // how loud someone is right now (0..1), for the speaking marker over their head
    levelOf(id) { return peers.get(id)?.level || 0; },
    // join the room's signalling once connected
    attach(sendFn, idFn) { send = sendFn; myId = idFn; if (prefs.tts) { audio(); tts.warm(); } },
    signal,
    // once a frame: who to link with, where everyone is, what's between you
    update({camera, peers: others, hits}) {
      if (!send || !myId()) return;
      const now = performance.now(), me = myId();
      camera.getWorldPosition(camPos); camera.getWorldDirection(fwd); up.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
      if (ctx && peers.size) {
        const L = ctx.listener;
        if (L.positionX) {
          L.positionX.value = camPos.x; L.positionY.value = camPos.y; L.positionZ.value = camPos.z;
          L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
        } else { L.setPosition(camPos.x, camPos.y, camPos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
      }
      const seen = new Set();
      const talking = api.sending;
      for (const o of others) {
        const d = Math.hypot(o.x - camPos.x, o.z - camPos.z);
        const wanted = talking || !!o.vc;            // someone in the pair has something to say
        if (wanted) seen.add(o.id);
        let p = peers.get(o.id);
        if (!p && wanted && d < CONNECT && me < o.id && now > (retryAfter.get(o.id) || 0)) p = link(o.id, true);   // the lower id calls
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
// The same small panel on the start screen and the Esc screen: you always hear people near
// you; your mic and text-to-speech are up to you.
// kind: which avatar's voices to offer (drifella or drilady), asked whenever they're needed
// preview: choosing a voice plays a line in it, just for you (the start screen; in the game it'd talk over things)
let panels = 0;
export function voicePanel(voice, {kind = () => 'drifella', preview = true} = {}) {
  const el = document.createElement('section');
  el.className = 'voice-panel';
  const group = `tts-pitch-${++panels}`;
  el.innerHTML = `
    <h2>voice chat</h2>
    <button type="button" class="row toggle tts" role="checkbox"><span class="label">text-to-speech</span></button>
    <div class="row pitch" role="radiogroup" aria-label="voice">
      <label><input type="radio" name="${group}" value="higher"><span>higher</span></label>
      <label><input type="radio" name="${group}" value="lower"><span>lower</span></label>
    </div>
    <button type="button" class="row toggle on" role="checkbox"><span class="label">enable mic</span> <kbd>M</kbd></button>
    <div class="more">
      <label class="row"><span>mic</span><select class="mic"><option value="">default mic</option></select></label>
      <div class="meter" aria-hidden="true"><i></i></div>
    </div>
    <label class="row"><span>voices</span><input type="range" class="vol" min="0" max="1.5" step="0.05"></label>
    <p class="note"></p>`;
  const $ = s => el.querySelector(s);
  const on = $('.on'), ttsOn = $('.tts'), mic = $('.mic'), vol = $('.vol'), note = $('.note'), bar = $('.meter i');
  const pitches = [...el.querySelectorAll('.pitch input')];
  for (const type of ['keydown', 'keyup']) el.addEventListener(type, e => { if (e.key !== 'Escape') e.stopPropagation(); });
  async function fillDevices() {
    const list = await voice.devices();
    mic.replaceChildren(...(list.length ? list : [{deviceId: '', label: 'default mic'}]).map((d, i) => {
      const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `mic ${i + 1}`; return o;
    }));
    mic.value = voice.deviceId && list.some(d => d.deviceId === voice.deviceId) ? voice.deviceId : (list[0]?.deviceId || '');
  }
  // each choice says whose voice it is (hugo or bruno, kiki or rosie)
  const NAMES = {drifella: {higher: 'hugo', lower: 'bruno'}, drilady: {higher: 'kiki', lower: 'rosie'}};
  function names() {
    const n = NAMES[kind() === 'drilady' ? 'drilady' : 'drifella'];
    for (const r of pitches) r.parentElement.title = n[r.value];
  }
  function sync() {
    on.setAttribute('aria-checked', voice.micOn ? 'true' : 'false');
    ttsOn.setAttribute('aria-checked', voice.ttsOn ? 'true' : 'false');
    for (const r of pitches) r.checked = r.value === voice.ttsPitch;
    vol.value = voice.volume;
    el.classList.toggle('enabled', voice.micOn);
    el.classList.toggle('tts-on', voice.ttsOn);
    // only when something's wrong (or the voices are still on their way)
    note.textContent = voice.error || (voice.ttsOn && voice.ttsState === 'error' ? "text-to-speech couldn't load" :
      voice.ttsOn && voice.ttsState === 'loading' ? 'loading voices…' : '');
    note.hidden = !note.textContent;
  }
  on.addEventListener('click', async () => { await voice.setMicOn(!voice.micOn); fillDevices(); });
  ttsOn.addEventListener('click', () => voice.setTTS(!voice.ttsOn, preview && kind()));
  // (click, not change: choosing the voice you already have plays it again)
  for (const r of pitches) r.addEventListener('click', () => voice.setTTSPitch(r.value, preview && kind()));
  if (preview) voice.loadPreviews();
  el.addEventListener('pointerenter', names); el.addEventListener('focusin', names);
  mic.addEventListener('change', () => voice.setDevice(mic.value));
  vol.addEventListener('input', () => voice.setVolume(Number(vol.value)));
  voice.onChange(sync);
  sync(); fillDevices(); names();
  navigator.mediaDevices?.addEventListener?.('devicechange', fillDevices);
  // the level meter runs while the panel is on screen
  (function meter() {
    if (el.isConnected && el.offsetParent) bar.style.transform = `scaleX(${voice.micLevel().toFixed(3)})`;
    requestAnimationFrame(meter);
  })();
  return el;
}

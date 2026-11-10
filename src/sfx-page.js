// /sfx: every sound effect in every version, to listen to and pick (src/sfx-synth.js makes them; src/sfx.js
// says which the game uses). A pick here is used by the game in this browser; "copy picks" is for sending on.
import {SOUNDS, make, RATE} from './sfx-synth.js';
import {PICKS, PICKS_KEY, picks, MIX, impulse} from './sfx.js';

const ctx = new (window.AudioContext || window.webkitAudioContext)();
const out = ctx.createGain(), comp = ctx.createDynamicsCompressor();
comp.threshold.value = -14; comp.ratio.value = 4;
out.connect(comp); comp.connect(ctx.destination);
const wet = ctx.createGain(), conv = ctx.createConvolver();
conv.normalize = true; conv.buffer = impulse(ctx); wet.connect(conv); conv.connect(out);
let echo = true;
const $ = id => document.getElementById(id);
$('echo').addEventListener('change', e => { echo = e.target.checked; });
$('vol').addEventListener('input', e => out.gain.setTargetAtTime(Number(e.target.value), ctx.currentTime, .05));

let mine = {};
try { mine = JSON.parse(localStorage.getItem(PICKS_KEY) || '{}') || {}; } catch {}
const save = () => { try { localStorage.setItem(PICKS_KEY, JSON.stringify(mine)); } catch {} };
const say = (text, ms = 1600) => { $('status').textContent = text; clearTimeout(say.t); say.t = setTimeout(() => { $('status').textContent = ''; }, ms); };

// one take, played as the game would (at its level, with its share of echo, a touch of pitch wobble)
let hum = null;
function play(name, version, {at = 0, gain = 1, rate = 1} = {}) {
  ctx.resume();
  const x = make(name, version), b = ctx.createBuffer(1, x.length, RATE); b.copyToChannel(x, 0);
  const [level, send] = MIX[name] || [.5, .2];
  if (SOUNDS[name].kind === 'ambience') {           // the hum: plays on until clicked again
    hum?.src.stop();
    if (hum?.key === `${name}${version}`) { hum = null; return false; }
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const g = ctx.createGain(); g.gain.value = level * 4;      // (louder than in the game, to hear it here on its own)
    src.connect(g); g.connect(out); src.start();
    hum = {src, key: `${name}${version}`};
    return true;
  }
  const src = ctx.createBufferSource(); src.buffer = b;
  src.playbackRate.value = rate * (1 + (Math.random() - .5) * .06);
  const g = ctx.createGain(); g.gain.value = level * gain * 1.6;
  src.connect(g); g.connect(out);
  if (echo && send) { const w = ctx.createGain(); w.gain.value = send * .7; g.connect(w); w.connect(wet); }
  src.start(ctx.currentTime + at);
  return true;
}
// a few in a row, like they come in the game
const RUNS = {
  step: [['walk', Array.from({length: 8}, (_, i) => [i * .34, .85, 1])], ['run', Array.from({length: 10}, (_, i) => [i * .25, 1.1, 1.06])],
    ['crouch', Array.from({length: 6}, (_, i) => [i * .55, .45, .92])]],
  hop: [['hop run', Array.from({length: 8}, (_, i) => [i * .52, .9, 1 + i * .015])]],
  land: [['soft / hard', [[0, .4, 1.04], [.7, .8, 1], [1.4, 1.5, .93]]]],
  hit: [['jab-cross', [[0, 1, 1], [.45, 1, 1.08]]]],
  fire: [['hold the trigger', Array.from({length: 6}, (_, i) => [i * .18, 1, 1])]],
};
const KINDS = {feet: 'feet', fists: 'fists', paint: 'paint', things: 'things', machine: 'the lap timer', crown: "king's crown", chat: 'chat', ambience: 'the tunnel'};

function render() {
  const list = $('list'); list.replaceChildren();
  const current = picks();
  for (const [kind, title] of Object.entries(KINDS)) {
    const h = document.createElement('h2'); h.textContent = title; list.append(h);
    for (const s of Object.values(SOUNDS).filter(s => s.kind === kind)) {
      const el = document.createElement('section'); el.className = 'sound';
      el.innerHTML = `<div class="name">${s.label}<small>${s.name}</small></div><div><div class="versions"></div><div class="extra"></div></div>`;
      const vs = el.querySelector('.versions');
      for (const [k, ver] of Object.entries(s.versions)) {
        const v = document.createElement('span'); v.className = 'ver' + (current[s.name] === k ? ' picked' : '');
        v.innerHTML = `<button type="button" class="play">${k} · ${ver.label}</button>${PICKS[s.name] === k ? '<span class="game">game\'s</span>' : ''}<button type="button" class="use">${current[s.name] === k ? 'used' : 'use'}</button>`;
        const p = v.querySelector('.play');
        p.addEventListener('click', () => {
          const on = play(s.name, k);
          if (s.kind === 'ambience') { for (const b of list.querySelectorAll('.play.on')) b.classList.remove('on'); p.classList.toggle('on', on); }
        });
        v.querySelector('.use').addEventListener('click', () => {
          if (k === PICKS[s.name]) delete mine[s.name]; else mine[s.name] = k;
          save(); render(); say(`${s.label}: ${k}`);
        });
        vs.append(v);
      }
      for (const [label, hits] of RUNS[s.name] || []) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = `▸ ${label} (${current[s.name]})`;
        b.addEventListener('click', () => { for (const [at, gain, rate] of hits) play(s.name, current[s.name], {at, gain, rate}); });
        el.querySelector('.extra').append(b);
      }
      list.append(el);
    }
  }
}
render();

$('copy').addEventListener('click', async () => {
  const all = picks();
  const text = `111k sound picks: ${Object.entries(all).map(([n, k]) => `${n} ${k}`).join(', ')}`;
  try { await navigator.clipboard.writeText(text); say('copied'); }
  catch { prompt('your picks', text); }
});
$('reset').addEventListener('click', () => { mine = {}; save(); render(); say("the game's again"); });

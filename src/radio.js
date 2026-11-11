// The radio (an item: src/items.js draws it): right-click one that's put down and paste a YouTube or SoundCloud
// link; everyone near hears it, at the same point in it (by the server's clock), louder the nearer they are and
// muffled through walls. It plays through YouTube's or SoundCloud's own player, kept out of sight (their sound
// can't be taken into the game's own audio, so it's loud or quiet with distance, not to one side or the other).
// A link only goes on while it's quiet, and stops at five minutes (the server keeps to that: server/room.js).
import {radioLink} from './protocol.js';

let ytLoad = null, scLoad = null;
const script = (src, ready) => new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = src; s.async = true; s.onerror = rej;
  if (ready) ready(res); else s.onload = res;
  document.head.append(s);
});
const loadYT = () => ytLoad ||= (window.YT?.Player ? Promise.resolve() : script('https://www.youtube.com/iframe_api', res => {
  const prev = window.onYouTubeIframeAPIReady; window.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
}));
const loadSC = () => scLoad ||= (window.SC?.Widget ? Promise.resolve() : script('https://w.soundcloud.com/player/api.js'));

const NEAR = 1.2, FAR = 34, FALL = 2.6;  // full volume this close, silent this far; how fast it drops away (a long tail)
const CHECK_MS = 5000, DRIFT = 3;        // keep in step with the clock: every so often, jumped back if this far out (s)

export function createRadio({network, onOpenChange}) {
  // somewhere off to the side for the players (they have to be in the page to play)
  const holder = document.createElement('div');
  Object.assign(holder.style, {position: 'fixed', left: '0', top: '0', width: '200px', height: '120px', opacity: '0', pointerEvents: 'none', zIndex: '-1', overflow: 'hidden'});
  document.body.append(holder);
  const playing = new Map();     // radio id -> {key, kind, player, ready, vol, checkAt, reported, el}

  function stop(id) {
    const p = playing.get(id);
    if (!p) return;
    try { p.kind === 'yt' ? p.player?.destroy() : p.widget?.pause(); } catch {}
    p.el?.remove();
    playing.delete(id);
  }
  const offset = play => Math.max(0, (network.now() - play.at) / 1000);
  function start(id, play) {
    const p = {key: `${play.u}@${play.at}`, kind: play.u.startsWith('yt:') ? 'yt' : 'sc', ready: false, vol: -1, checkAt: 0, reported: false, play};
    playing.set(id, p);
    const report = ms => {                           // how long it is (only whoever put it on is listened to)
      if (p.reported || !(ms > 1000) || play.by !== network.id) return;
      p.reported = true; network.send({type: 'radio-len', id, ms: Math.round(ms)});
    };
    if (p.kind === 'yt') {
      p.el = document.createElement('div'); holder.append(p.el);
      loadYT().then(() => {
        if (playing.get(id) !== p) return;
        p.player = new window.YT.Player(p.el, {width: 200, height: 120, videoId: play.u.slice(3),
          playerVars: {autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, start: Math.floor(offset(play))},
          events: {
            onReady: e => { p.ready = true; e.target.setVolume(0); e.target.seekTo(offset(play), true); e.target.playVideo(); },
            onStateChange: e => { if (e.data === 1) report(p.player.getDuration() * 1000); },
          }});
      }).catch(() => {});
    } else {
      p.el = document.createElement('iframe');
      p.el.allow = 'autoplay'; p.el.width = '200'; p.el.height = '120';
      p.el.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(play.u)}&auto_play=true&visual=false&show_artwork=false&buying=false&sharing=false&download=false`;
      holder.append(p.el);
      loadSC().then(() => {
        if (playing.get(id) !== p) return;
        const w = p.widget = window.SC.Widget(p.el);
        w.bind(window.SC.Widget.Events.READY, () => {
          p.ready = true; w.setVolume(0); w.seekTo(offset(play) * 1000); w.play();
          w.getDuration(ms => report(ms));
        });
      }).catch(() => {});
    }
  }
  function volume(p, v) {
    const n = Math.round(v * 100);
    if (!p.ready || Math.abs(n - p.vol) < 2) return;
    p.vol = n;
    try { p.kind === 'yt' ? p.player.setVolume(n) : p.widget.setVolume(n); } catch {}
  }
  // keep it with the clock (a stall, a tab in the background)
  function keepUp(p, now) {
    if (!p.ready || now < p.checkAt) return;
    p.checkAt = now + CHECK_MS;
    const want = offset(p.play);
    try {
      if (p.kind === 'yt') { if (Math.abs(p.player.getCurrentTime() - want) > DRIFT) p.player.seekTo(want, true); if (p.player.getPlayerState() !== 1) p.player.playVideo(); }
      else p.widget.getPosition(ms => { if (Math.abs(ms / 1000 - want) > DRIFT) p.widget.seekTo(want * 1000); });
    } catch {}
  }

  // ---- the box for a link
  const panel = document.createElement('form');
  Object.assign(panel.style, {position: 'fixed', left: '50%', top: '38%', transform: 'translate(-50%, -50%)', zIndex: '40', display: 'none',
    background: 'rgba(8,8,10,.86)', border: '1px solid rgba(233,230,220,.25)', borderRadius: '8px', padding: '14px 16px', width: 'min(440px, 88vw)',
    font: '13px/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace', color: 'rgba(233,230,220,.9)', boxShadow: '0 8px 30px rgba(0,0,0,.5)'});
  panel.innerHTML = '<div style="margin-bottom:8px;letter-spacing:.08em">radio</div>'
    + '<input type="url" autocomplete="off" spellcheck="false" placeholder="a YouTube or SoundCloud link" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:5px;border:1px solid rgba(233,230,220,.3);background:rgba(255,255,255,.06);color:inherit;font:inherit;outline:none">'
    + '<div class="note" style="margin-top:8px;opacity:.6">enter: play (up to 5 minutes) · esc: close</div>';
  document.body.append(panel);
  const input = panel.querySelector('input'), note = panel.querySelector('.note');
  for (const type of ['keydown', 'keyup', 'keypress', 'pointerdown', 'wheel']) panel.addEventListener(type, e => e.stopPropagation());
  let openFor = null;
  const hint = 'enter: play (up to 5 minutes) · esc: close';
  function close() {
    if (!openFor) return;
    openFor = null; panel.style.display = 'none'; input.value = ''; input.blur();
    onOpenChange?.(false);
  }
  panel.addEventListener('submit', e => {
    e.preventDefault();
    if (!openFor) return;
    if (!radioLink(input.value)) { note.textContent = 'only YouTube or SoundCloud links'; return; }
    network.send({type: 'radio', id: openFor, url: input.value.trim()});
    close();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  document.addEventListener('pointerdown', e => { if (openFor && !panel.contains(e.target)) close(); }, true);   // clicking back into the world

  return {
    get open() { return !!openFor; },
    // the link box for radio `id` (or, while it's playing, just a word that it is)
    prompt(id, busy) {
      openFor = id; panel.style.display = 'block'; onOpenChange?.(true);
      input.disabled = !!busy; input.value = '';
      note.textContent = busy ? 'something’s playing: a new link can go on when it’s done' : hint;
      if (!busy) setTimeout(() => input.focus({preventScroll: true}), 0);
    },
    close,
    // once a frame: radios = [{id, play, x, y, z}]; from: where you're listening; muffled(p): a wall between
    update(radios, from, muffled) {
      const now = performance.now(), seen = new Set();
      for (const r of radios) {
        const play = r.play;
        if (!play || network.now() >= play.until || network.now() < play.at - 200) continue;
        seen.add(r.id);
        let p = playing.get(r.id);
        if (p && p.key !== `${play.u}@${play.at}`) { stop(r.id); p = null; }
        if (!p) { start(r.id, play); p = playing.get(r.id); }
        p.play = play;
        const d = Math.hypot(r.x - from.x, r.y - from.y, r.z - from.z);
        let v = Math.max(0, Math.min(1, (FAR - d) / (FAR - NEAR))) ** FALL;
        if (v > 0 && (p.muffleAt || 0) < now) { p.muffleAt = now + 250; p.muffled = muffled(r); }
        if (p.muffled) v *= .4;
        volume(p, v);
        keepUp(p, now);
      }
      for (const id of [...playing.keys()]) if (!seen.has(id)) stop(id);
      if (openFor && !radios.some(r => r.id === openFor)) close();
    },
  };
}

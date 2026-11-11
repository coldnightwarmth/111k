// /radio: everything put on the radio in the game (GET /radio-log: server/worker.js), newest first, with each
// track's title and picture (from YouTube's or SoundCloud's oEmbed, as each comes in), who put it on, and how it
// went (how long it played, or that it wouldn't play).
import {radioLogUrl} from './config.js';

const list = document.getElementById('log'), more = document.getElementById('more'), status = document.getElementById('status');
let oldest = null, shown = 0, lastDay = '';

const linkOf = e => e.url || (e.u.startsWith('yt:') ? `https://www.youtube.com/watch?v=${e.u.slice(3)}` : e.u);
const minutes = ms => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// a track's title and picture: YouTube's thumbnail straight away, the title (and SoundCloud's art) when it comes
const titles = new Map();
function lookUp(e) {
  const key = e.u;
  if (!titles.has(key)) {
    const watch = e.u.startsWith('yt:') ? `https://www.youtube.com/watch?v=${e.u.slice(3)}` : e.u;
    const tries = [`https://noembed.com/embed?url=${encodeURIComponent(watch)}`,
      e.u.startsWith('yt:') ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`
        : `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(watch)}`];
    titles.set(key, (async () => {
      for (const t of tries) {
        try { const j = await (await fetch(t)).json(); if (j && j.title) return j; } catch {}
      }
      return null;
    })());
  }
  return titles.get(key);
}

function row(e) {
  const at = new Date(e.at);
  const day = at.toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'});
  if (day !== lastDay) { lastDay = day; list.append(el('li', 'day', day)); }
  const li = el('li', 'play'), thumb = el('div', 'thumb'), what = el('div', 'what');
  const yt = e.u.startsWith('yt:');
  if (yt) thumb.style.backgroundImage = `url(https://i.ytimg.com/vi/${e.u.slice(3)}/mqdefault.jpg)`;
  else thumb.textContent = 'soundcloud';
  const a = el('a', 'title', linkOf(e)); a.href = linkOf(e); a.target = '_blank'; a.rel = 'noopener';
  const meta = el('div', 'meta');
  meta.append(at.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}), ' · ');
  meta.append(el('span', 'who', e.name || (e.by ? `player ${e.by.slice(0, 6)}` : 'someone')));
  if (e.dead) { meta.append(' · '); meta.append(el('span', 'bad', 'wouldn\u2019t play' + (e.ended ? ` (off after ${minutes(Math.max(0, e.ended - e.at))})` : ''))); }
  else if (e.ms) meta.append(` · ${minutes(Math.min(e.ms, 300000))}${e.ms > 300000 ? ` of ${minutes(e.ms)} (cut at 5:00)` : ''}`);
  else if (e.ended) meta.append(` · ${minutes(Math.max(0, e.ended - e.at))}`);
  meta.append(' · ', el('span', '', yt ? 'youtube' : 'soundcloud'));
  what.append(a, meta);
  li.append(thumb, what);
  list.append(li);
  lookUp(e).then(j => {
    if (!j) return;
    a.textContent = j.author_name ? `${j.title} \u2014 ${j.author_name}` : j.title;
    if (!yt && j.thumbnail_url) { thumb.textContent = ''; thumb.style.backgroundImage = `url(${j.thumbnail_url})`; }
  });
}

async function load() {
  more.hidden = true; status.textContent = 'loading…';
  try {
    const u = new URL(radioLogUrl());
    if (oldest) u.searchParams.set('before', oldest);
    const got = await (await fetch(u, {cache: 'no-store'})).json();
    for (const e of got) row(e);
    shown += got.length;
    if (got.length) oldest = got[got.length - 1].at;
    more.hidden = got.length < 500;
    status.textContent = `${shown} played`;
    if (!shown) list.append(el('li', 'empty', 'nothing\u2019s been played yet'));
  } catch (err) {
    status.textContent = 'couldn\u2019t load the log';
  }
}
more.addEventListener('click', load);
load();

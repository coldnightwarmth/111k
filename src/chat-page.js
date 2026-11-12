// /chat: everything said in the game's chat (GET /chat-log: server/worker.js), newest first, by day, each
// player's name in a colour of its own; a box to find what was said (or who said it) in what's loaded.
import {chatLogUrl} from './config.js';

const list = document.getElementById('log'), more = document.getElementById('more'), status = document.getElementById('status');
const find = document.getElementById('find');
const PAGE = 1000;
let oldest = null, shown = 0, lastDay = '';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
// a name's colour, the same every time
const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };

function row(c) {
  const at = new Date(c.at);
  const day = at.toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'});
  if (day !== lastDay) { lastDay = day; list.append(el('li', 'day', day)); }
  const li = el('li', 'line'), name = c.name || `player ${(c.id || '').slice(0, 6)}`;
  li.append(el('span', 'time', at.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})));
  const who = el('span', 'who', name); who.style.color = `hsl(${hue(c.id || name)}, 70%, 72%)`; who.title = c.id || '';
  li.append(who, el('span', 'text', c.text));
  li.dataset.find = `${name}\n${c.text}`.toLowerCase();
  list.append(li);
}
// what's loaded narrowed to lines with the words in them (and the days they're on)
function filter() {
  const q = find.value.trim().toLowerCase();
  let day = null, any = false;
  for (const li of list.children) {
    if (li.classList.contains('day')) { if (day) day.hidden = !any; day = li; any = false; continue; }
    if (!li.dataset.find) continue;
    li.hidden = !!q && !li.dataset.find.includes(q);
    if (!li.hidden) any = true;
  }
  if (day) day.hidden = !any;
}
find.addEventListener('input', filter);

async function load() {
  more.hidden = true; status.textContent = 'loading…';
  try {
    const u = new URL(chatLogUrl());
    if (oldest) u.searchParams.set('before', oldest);
    const got = await (await fetch(u, {cache: 'no-store'})).json();
    for (const c of got) row(c);
    shown += got.length;
    if (got.length) oldest = got[got.length - 1].at;
    more.hidden = got.length < PAGE;
    status.textContent = `${shown} message${shown === 1 ? '' : 's'}`;
    if (!shown) list.append(el('li', 'empty', 'nothing\u2019s been said yet'));
    filter();
  } catch {
    status.textContent = 'couldn\u2019t load the log';
  }
}
more.addEventListener('click', load);
load();

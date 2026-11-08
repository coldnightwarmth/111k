// /graffiti: every graffiti piece in the game, A to Z, to go through and mark: good, remove, redo, or a
// kerning pass, with notes. The review is kept by the server (so it's the same on any device, and removed
// pieces leave the game straight away) and downloads as json.
import {LEVEL_VERSION} from './level.js';
import {reviewUrl} from './config.js';
import {cleanReview, REVIEW_STATUSES, REVIEW_NOTE_MAX} from './review.js';

const $ = id => document.getElementById(id);
const LABEL = {good: 'good', remove: 'remove', redo: 'redo', kern: 'kerning', nodrips: 'remove drips'};
const STYLE = {tag: 'tag', wk: 'philly wickets', bf: 'busflow', mp: 'mop', tu: 'throw-up', pc: 'piece', ol: 'hollow 3D', pl: 'placa',
  hs: 'chisel handstyle', sp: 'brush script', fx: 'extinguisher', rl: 'roller', sc: 'sprayed writing', sn: 'stencil', mk: 'marker',
  ex: 'scratched', dd: 'doodle', bb: 'blockbuster', sl: 'sticker', ps: 'wheatpaste poster', rn: 'ransom cut-up', mo: 'tile mosaic',
  tk: 'LED ticker', ne: 'neon', gl: 'glitch', ht: 'pop-art halftone', ch: 'chalk', sb: 'speech balloon', sg: 'sign', cx: 'chart',
  rb: 'ribbon letters'};
// the latest batch's families (tools/graffiti_third.py), for the "latest batch" filter
const LATEST = new Set(['bb', 'sl', 'ps', 'rn', 'mo', 'tk', 'ne', 'gl', 'ht', 'ch', 'sb', 'sg', 'cx', 'rb']);
const isLatest = p => LATEST.has(p.name.split('_')[0]);
const STYLE_ORDER = ['tag', 'wk', 'bf', 'mp', 'tu', 'pc', 'bb', 'ol', 'pl', 'hs', 'sp', 'ne', 'rb', 'ht', 'gl', 'fx', 'rl', 'sc', 'sn',
  'mo', 'tk', 'cx', 'sb', 'sl', 'ps', 'rn', 'sg', 'ch', 'mk', 'ex', 'dd'];
const keyOf = name => { const [style, word = '', ...rest] = name.split('_'), k = STYLE_ORDER.indexOf(style);
  return [word, k < 0 ? STYLE_ORDER.length : k, rest.join('_')]; };
const byWord = (a, b) => { const x = keyOf(a.name), y = keyOf(b.name);
  return x[0].localeCompare(y[0], undefined, {numeric: true}) || x[1] - y[1] || x[2].localeCompare(y[2]); };

// ------------------------------------------------------------------ status line
function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = cls; }

// ------------------------------------------------------------------ the atlas pages
const base = new URL('../assets/env/world', import.meta.url).href, v = LEVEL_VERSION ? `?v=${LEVEL_VERSION}` : '';
async function levelPages() {
  // the level's own graffiti pages live inside the level model: read them straight out of the .glb
  const buf = await (await fetch(`${base}.glb${v}`)).arrayBuffer();
  const dv = new DataView(buf), jsonLen = dv.getUint32(12, true);
  const gl = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const bin = 20 + jsonLen + 8, pages = new Map();
  await Promise.all((gl.materials || []).filter(m => /^graffiti_\d+$/.test(m.name)).map(async m => {
    const t = gl.textures[m.pbrMetallicRoughness.baseColorTexture.index];
    const im = gl.images[t.source ?? t.extensions?.EXT_texture_webp?.source], bv = gl.bufferViews[im.bufferView];
    const blob = new Blob([new Uint8Array(buf, bin + (bv.byteOffset || 0), bv.byteLength)], {type: im.mimeType});
    pages.set(m.name.slice('graffiti_'.length), await createImageBitmap(blob));
  }));
  return pages;
}
async function load() {
  setStatus('loading the pieces…');
  const [meta, tags, pages] = await Promise.all([
    fetch(`${base}.json${v}`).then(r => r.json()),
    fetch(`${base}-tags.json${v}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
    levelPages(),
  ]);
  const pieces = (meta.graffiti || []).map(p => ({...p, walls: true}));
  if (tags) {
    await Promise.all(Array.from({length: tags.pages}, async (_, i) => {
      const blob = await (await fetch(`${base}-tags-${i}.webp${v}`)).blob();
      pages.set(`t${i}`, await createImageBitmap(blob));
    }));
    const known = new Set(pieces.map(p => p.name));
    for (const p of tags.graffiti) if (!known.has(p.name)) pieces.push({...p, walls: false});
  }
  return {pieces: pieces.sort(byWord), pages};
}

// draw one piece from its page, fitted into w × h (never past its own resolution unless allowed)
function draw(canvas, piece, pages, w, h, upTo = 1) {
  const img = pages.get(String(piece.page));
  if (!img) return;
  const [u0, v0, u1, v1] = piece.uv;
  const sx = Math.min(u0, u1) * img.width, sy = Math.min(v0, v1) * img.height;
  const sw = Math.abs(u1 - u0) * img.width, sh = Math.abs(v1 - v0) * img.height;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const s = Math.min(w * dpr / sw, h * dpr / sh, upTo * dpr);
  canvas.width = Math.max(1, Math.round(sw * s)); canvas.height = Math.max(1, Math.round(sh * s));
  canvas.style.width = `${canvas.width / dpr}px`; canvas.style.height = `${canvas.height / dpr}px`;
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
}

// ------------------------------------------------------------------ the review
let review = cleanReview(null), all = [], pages = null, filter = 'all', query = '';
const entry = name => review.pieces[name] || {};
function setEntry(name, patch) {
  const e = {...entry(name), ...patch};
  if (!e.s) delete e.s;
  if (!e.note || !e.note.trim()) delete e.note;
  if (e.s || e.note) review.pieces[name] = e; else delete review.pieces[name];
  backup(true);
  scheduleSave();
  refreshCard(name);
  refreshFilters();
}
function backup(dirty) {
  try { localStorage.setItem('111k:review', JSON.stringify({...review, dirty, at: Date.now()})); } catch {}
}

let saveTimer = 0, saving = false, again = false;
function scheduleSave() { setStatus('unsaved changes', 'dirty'); clearTimeout(saveTimer); saveTimer = setTimeout(save, 900); }
async function save() {
  if (saving) { again = true; return; }
  saving = true;
  const body = JSON.stringify(review);
  let key = null; try { key = localStorage.getItem('111k:emotesKey'); } catch {}
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      setStatus('saving…');
      const r = await fetch(reviewUrl(), {method: 'POST', body, headers: {'Content-Type': 'application/json', ...(key ? {'X-Emotes-Key': key} : {})}});
      if (r.status === 401 && attempt === 0) {
        key = prompt('The server wants its key to save the review:');
        if (!key) { setStatus('not saved (no key): download the json to keep it', 'err'); return; }
        try { localStorage.setItem('111k:emotesKey', key); } catch {}
        continue;
      }
      if (!r.ok) throw Error(r.status);
      const saved = await r.json();
      review.updated = saved.updated;
      backup(false);
      setStatus(`saved · ${counts().done} of ${all.length} reviewed`, 'ok');
      return;
    }
  } catch {
    setStatus("couldn't reach the server: kept in this browser, and the json download still works", 'err');
  } finally {
    saving = false;
    if (again) { again = false; save(); }
  }
}
async function loadReview() {
  let server = null, local = null;
  try { const r = await fetch(reviewUrl(), {cache: 'no-store'}); if (r.ok) server = cleanReview(await r.json()); } catch {}
  try { local = JSON.parse(localStorage.getItem('111k:review') || 'null'); } catch {}
  // changes made here that never reached the server win over an older server copy
  if (local?.dirty && (!server || (local.updated || 0) >= (server.updated || 0))) {
    review = cleanReview(local);
    review.updated = local.updated || 0;
    scheduleSave();
  } else if (server) review = server;
  else if (local) review = cleanReview(local);
  return !!server;
}

// ------------------------------------------------------------------ the list
const cards = new Map();   // name -> {el, piece}
const counts = () => {
  const c = {all: all.length, todo: 0, good: 0, remove: 0, redo: 0, kern: 0, nodrips: 0, notes: 0, cans: 0, walls: 0, latest: 0, done: 0};
  for (const p of all) {
    const e = entry(p.name);
    if (e.s) { c[e.s]++; c.done++; } else c.todo++;
    if (e.note) c.notes++;
    c[p.walls ? 'walls' : 'cans']++;
    if (isLatest(p)) c.latest++;
  }
  return c;
};
const FILTERS = [['all', 'all'], ['latest', 'latest batch'], ['todo', 'to review'], ['good', 'good'], ['remove', 'remove'], ['redo', 'redo'], ['kern', 'kerning'], ['nodrips', 'remove drips'],
  ['notes', 'with notes'], ['cans', 'new (cans only)'], ['walls', 'on the walls']];
function refreshFilters() {
  const c = counts(), nav = $('filters');
  if (!nav.childElementCount) for (const [k, label] of FILTERS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.f = k; b.className = k;
    b.append(label, document.createElement('b'));
    b.addEventListener('click', () => { filter = k; applyFilter(); });
    nav.append(b);
  }
  for (const b of nav.children) { b.querySelector('b').textContent = c[b.dataset.f]; b.setAttribute('aria-pressed', String(b.dataset.f === filter)); }
}
function matches(p) {
  const e = entry(p.name);
  if (query && !p.name.toLowerCase().includes(query) && !(e.note || '').toLowerCase().includes(query)) return false;
  switch (filter) {
    case 'todo': return !e.s;
    case 'good': case 'remove': case 'redo': case 'kern': case 'nodrips': return e.s === filter;
    case 'notes': return !!e.note;
    case 'cans': return !p.walls;
    case 'walls': return p.walls;
    case 'latest': return isLatest(p);
    default: return true;
  }
}
function applyFilter() {
  let shown = 0;
  for (const sec of document.querySelectorAll('.group')) {
    let any = false;
    for (const el of sec.querySelectorAll('.card')) { const ok = matches(cards.get(el.dataset.name).piece); el.hidden = !ok; any ||= ok; shown += ok; }
    sec.hidden = !any;
  }
  $('none').hidden = shown > 0;
  refreshFilters();
}
function refreshCard(name) {
  const c = cards.get(name); if (!c) return;
  const e = entry(name);
  c.el.className = `card${e.s ? ` s-${e.s}` : ''}${c.el.classList.contains('focus') ? ' focus' : ''}`;
  for (const b of c.el.querySelectorAll('.states button')) b.setAttribute('aria-pressed', String(b.dataset.s === e.s));
  const ta = c.el.querySelector('textarea');
  if (document.activeElement !== ta && ta.value !== (e.note || '')) ta.value = e.note || '';
}

const seen = new IntersectionObserver(es => {
  for (const en of es) if (en.isIntersecting) {
    const c = cards.get(en.target.dataset.name);
    draw(en.target.querySelector('canvas'), c.piece, pages, 520, 170);
    seen.unobserve(en.target);
  }
}, {rootMargin: '600px'});

function build() {
  const list = $('list'); list.replaceChildren();
  let group = null, word = null;
  for (const p of all) {
    const w = keyOf(p.name)[0];
    if (w !== word) {
      word = w;
      group = document.createElement('section'); group.className = 'group';
      const h = document.createElement('h2'); h.className = 'word'; h.textContent = w || '—';
      const grid = document.createElement('div'); grid.className = 'cards';
      group.append(h, grid); list.append(group);
    }
    const el = document.createElement('article');
    el.className = 'card'; el.tabIndex = 0; el.dataset.name = p.name;
    const art = document.createElement('div'); art.className = 'art'; art.dataset.name = p.name;
    art.append(document.createElement('canvas'));
    art.addEventListener('click', () => zoom(p));
    const meta = document.createElement('div'); meta.className = 'meta';
    const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = p.name;
    const st = document.createElement('span'); st.className = 'chip'; st.textContent = STYLE[p.name.split('_')[0]] || p.name.split('_')[0];
    const src = document.createElement('span'); src.className = `chip${p.walls ? ' walls' : ''}`; src.textContent = p.walls ? 'on the walls' : 'cans only';
    const size = document.createElement('span'); size.className = 'chip'; size.textContent = `${p.w.toFixed(2)} × ${p.h.toFixed(2)} m`;
    meta.append(nm, st, src, size);
    const states = document.createElement('div'); states.className = 'states';
    for (const s of REVIEW_STATUSES) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.s = s; b.textContent = LABEL[s];
      b.addEventListener('click', () => setEntry(p.name, {s: entry(p.name).s === s ? undefined : s}));
      states.append(b);
    }
    const ta = document.createElement('textarea');
    ta.placeholder = 'notes for this one (what to change)'; ta.maxLength = REVIEW_NOTE_MAX; ta.rows = 1;
    ta.addEventListener('input', () => setEntry(p.name, {note: ta.value}));
    ta.addEventListener('keydown', e => { if (e.key === 'Escape') { ta.blur(); el.focus(); } });
    el.append(art, meta, states, ta);
    el.addEventListener('focus', () => focusCard(el, false));
    group.querySelector('.cards').append(el);
    cards.set(p.name, {el, piece: p});
    seen.observe(art);
    refreshCard(p.name);
  }
  const none = document.createElement('p'); none.id = 'none'; none.className = 'empty'; none.textContent = 'nothing here'; none.hidden = true;
  list.append(none);
}

// ------------------------------------------------------------------ zoom, keys
function zoom(p) {
  const z = $('zoom'), c = z.querySelector('canvas');
  draw(c, p, pages, innerWidth - 60, innerHeight - 90, 2.5);
  z.querySelector('p').textContent = p.name;
  z.hidden = false;
}
$('zoom').addEventListener('click', () => { $('zoom').hidden = true; });

let focused = null;
function focusCard(el, move = true) {
  if (focused && focused !== el) focused.classList.remove('focus');
  focused = el; el.classList.add('focus');
  if (move) { el.focus({preventScroll: true}); el.scrollIntoView({block: 'nearest', behavior: 'smooth'}); }
}
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('zoom').hidden) { $('zoom').hidden = true; return; }
  if (e.target.closest?.('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement?.closest?.('.card') || focused;
  const visible = [...document.querySelectorAll('.card')].filter(c => !c.hidden && !c.closest('.group').hidden);
  if (e.key === 'j' || e.key === 'k') {
    e.preventDefault();
    const i = el ? visible.indexOf(el) : -1;
    const next = visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === 'j' ? 1 : -1)))];
    if (next) focusCard(next);
    return;
  }
  if (!el) return;
  const name = el.dataset.name;
  const pick = {1: 'good', 2: 'remove', 3: 'redo', 4: 'kern', 5: 'nodrips'}[e.key];
  if (pick) { e.preventDefault(); setEntry(name, {s: entry(name).s === pick ? undefined : pick}); }
  else if (e.key === '0') { e.preventDefault(); setEntry(name, {s: undefined}); }
  else if (e.key === 'n') { e.preventDefault(); el.querySelector('textarea').focus(); }
  else if (e.key === 'Enter' || e.key === ' ') { if (e.target === el) { e.preventDefault(); zoom(cards.get(name).piece); } }
});

// ------------------------------------------------------------------ search, background, json
let searchTimer = 0;
$('search').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { query = e.target.value.trim().toLowerCase(); applyFilter(); }, 120); });
for (const b of document.querySelectorAll('.bg button')) b.addEventListener('click', () => {
  document.body.classList.remove('bg-dark', 'bg-light');
  if (b.dataset.bg !== 'wall') document.body.classList.add(`bg-${b.dataset.bg}`);
  for (const o of document.querySelectorAll('.bg button')) o.setAttribute('aria-pressed', String(o === b));
  try { localStorage.setItem('111k:reviewBg', b.dataset.bg); } catch {}
});
try { const bg = localStorage.getItem('111k:reviewBg'); if (bg) document.querySelector(`.bg button[data-bg="${bg}"]`)?.click(); } catch {}

function exportDoc() {
  const c = counts();
  return {
    kind: '111k graffiti review', exported: new Date().toISOString(),
    counts: {pieces: c.all, reviewed: c.done, good: c.good, remove: c.remove, redo: c.redo, kerning: c.kern, removeDrips: c.nodrips, notes: c.notes, unreviewed: c.todo},
    pieces: all.map(p => {
      const e = entry(p.name);
      return {name: p.name, style: STYLE[p.name.split('_')[0]] || p.name.split('_')[0], where: p.walls ? 'walls' : 'cans',
        status: e.s ? LABEL[e.s] : 'unreviewed', ...(e.note ? {note: e.note} : {})};
    }),
  };
}
$('download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(exportDoc(), null, 2)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `111k-graffiti-review-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('import').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async e => {
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f) return;
  try {
    const doc = JSON.parse(await f.text());
    const back = Object.fromEntries(Object.entries(LABEL).map(([k, l]) => [l, k]));
    const map = Array.isArray(doc.pieces)      // a downloaded review, or the server's own shape
      ? Object.fromEntries(doc.pieces.map(p => [p.name, {s: back[p.status] || (REVIEW_STATUSES.includes(p.status) ? p.status : undefined), note: p.note}]))
      : doc.pieces;
    const next = cleanReview({pieces: map});
    if (!confirm(`Replace the review with this file (${Object.keys(next.pieces).length} pieces marked)?`)) return;
    review = {...next, updated: review.updated};
    for (const name of cards.keys()) refreshCard(name);
    applyFilter(); backup(true); scheduleSave();
  } catch { setStatus("that file isn't a review json", 'err'); }
});

// ------------------------------------------------------------------ go
(async () => {
  try {
    const [{pieces, pages: pg}, reachable] = await Promise.all([load(), loadReview()]);
    all = pieces; pages = pg;
    build(); applyFilter();
    const c = counts();
    if (!saving && $('status').className !== 'dirty')
      setStatus(reachable ? `${c.done} of ${all.length} reviewed` : "couldn't reach the server: changes stay in this browser until it's back", reachable ? '' : 'err');
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash && cards.has(hash)) focusCard(cards.get(hash).el);
  } catch (err) {
    console.error(err);
    setStatus(`couldn't load the pieces (${err.message || err})`, 'err');
  }
})();
window.__review = {get review() { return review; }, get all() { return all; }, setEntry, exportDoc};

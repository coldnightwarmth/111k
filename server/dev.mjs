// Local development server with zero dependencies:
//   node server/dev.mjs            -> http://localhost:8000
// Serves the site and runs the same room logic as the Cloudflare Worker over
// a minimal built-in WebSocket implementation at ws://localhost:8000/connect.
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {INACTIVE_MS, IDLE_RESET_MS, MAX_PLAYERS} from '../src/protocol.js';
import {freshRace, publicRace} from '../src/race.js';
import {handleMessage, newPlayer, snapshot, freshItems, releaseItems, letGo, freshMarks, marksMessage, itemsAtSpawn, kothTick, freshKoth, publicKoth, logError} from './room.js';
import {cleanEmoteConfig} from '../src/emotes.js';
import {cleanReview, hiddenPieces} from '../src/review.js';

// (SITE_ROOT=_site serves the built site instead: tools/build_site.sh, tools/smoke.mjs)
const ROOT = resolve(process.env.SITE_ROOT || fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8000);
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'};

let emotes = cleanEmoteConfig(null), review = cleanReview(null), errors = [];
const server = createServer(async (req, res) => {
  // the emote settings, as the worker serves them (GET, and POST from /anim)
  if (new URL(req.url, 'http://x').pathname === '/emotes') {
    if (req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      try { emotes = cleanEmoteConfig(JSON.parse(body)); } catch { res.writeHead(400); res.end('Bad JSON'); return; }
      broadcast({type: 'emotes', config: emotes});
    }
    res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(emotes)); return;
  }
  // the error log, as the worker keeps it
  if (new URL(req.url, 'http://x').pathname === '/errors') {
    res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(errors)); return;
  }
  // the graffiti review, the same way (GET, and POST from /graffiti)
  if (new URL(req.url, 'http://x').pathname === '/graffiti') {
    if (req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      try { review = cleanReview({...JSON.parse(body), updated: Date.now()}); } catch { res.writeHead(400); res.end('Bad JSON'); return; }
      broadcast({type: 'graffiti', hidden: hiddenPieces(review)});
    }
    res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(review)); return;
  }
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || /[\\/]\.(git|github)[\\/]/.test(file)) throw Error('forbidden');
    if (!(await stat(file)).isFile()) throw Error('not a file');
    res.writeHead(200, {'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    res.end(await readFile(file));
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

// ---------------------------------------------------------------- websocket
const clients = new Set();
function frame(text) {
  const payload = Buffer.from(text);
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255])
    : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, payload]);
}
function send(c, msg) { if (!c.closed) c.socket.write(frame(typeof msg === 'string' ? msg : JSON.stringify(msg))); }
function broadcast(msg) { const data = JSON.stringify(msg); for (const c of clients) send(c, data); }
const players = () => [...clients].map(c => c.player);
let items = freshItems();
const race = freshRace();
let koth = freshKoth();
// move a king of the hill game along (grace running out, paintballs landing, a winner)
function runKoth(cause) {
  if (cause) koth.cause = cause;
  for (const {msg} of kothTick({items, koth, players}, Date.now()).out) broadcast(msg);
}
const marks = freshMarks();

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  const session = url.searchParams.get('session') || '';
  if (url.pathname !== '/connect' || !/^[a-f0-9-]{36}$/.test(session)) { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const id = createHash('sha256').update(session).digest('hex').slice(0, 16);
  for (const c of clients) if (c.player.id === id) close(c);
  if (clients.size >= MAX_PLAYERS) { socket.destroy(); return; }
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const now = Date.now();
  const c = {socket, player: newPlayer(id, now), buffer: Buffer.alloc(0), fragments: [], closed: false};
  clients.add(c);
  send(c, {type: 'welcome', id, now});
  send(c, {type: 'emotes', config: emotes});
  send(c, {type: 'graffiti', hidden: hiddenPieces(review)});
  send(c, snapshot(players(), now, items));
  send(c, marksMessage(marks));
  send(c, {type: 'race', race: publicRace(race, now)});
  send(c, {type: 'koth', koth: publicKoth(koth, now)});
  socket.on('data', chunk => { c.buffer = Buffer.concat([c.buffer, chunk]); parse(c); });
  socket.on('close', () => close(c));
  socket.on('error', () => close(c));
});

function parse(c) {
  for (;;) {
    const b = c.buffer;
    if (b.length < 2) return;
    const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    if (len > 65536) { close(c); return; }
    const need = off + (masked ? 4 : 0) + len;
    if (b.length < need) return;
    let payload = b.subarray(off + (masked ? 4 : 0), need);
    if (masked) {
      const mask = b.subarray(off, off + 4);
      payload = Buffer.from(payload.map((x, i) => x ^ mask[i & 3]));
    }
    c.buffer = b.subarray(need);
    if (op === 0x8) { close(c); return; }
    if (op === 0x9) { c.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
    if (op === 0x1 || op === 0x0) {
      c.fragments.push(payload);
      if (!fin) continue;
      const text = Buffer.concat(c.fragments).toString('utf8'); c.fragments = [];
      onText(c, text);
    }
  }
}

function onText(c, text) {
  if (text === 'ping') { send(c, 'pong'); return; }
  const now = Date.now();
  const result = handleMessage(c.player, text, now, {items, marks, race, koth, players});
  if (result.report) errors = logError(errors, result.report);
  if (result.close) { close(c); return; }
  for (const {to, msg} of result.out) {
    if (to === 'all') broadcast(msg);
    else if (to === 'self') send(c, msg);
    else for (const other of clients) if (other.player.id === to) send(other, msg);
  }
  if (result.returning) broadcast(snapshot(players(), now, items));
}

function close(c) {
  if (c.closed) return;
  c.closed = true; clients.delete(c);
  try { c.socket.end(Buffer.from([0x88, 0])); } catch {}
  if (![...clients].some(o => o.player.id === c.player.id)) {
    broadcast({type: 'leave', id: c.player.id});
    // the crown comes off now; anything else waits for a refresh to come back within a few seconds
    const crowns = Object.fromEntries(Object.values(items).filter(it => it.holder === c.player.id && it.type === 'crown').map(it => [it.id, it]));
    if (Object.keys(crowns).length) {
      for (const {msg} of letGo(crowns, c.player, {others: [...clients].some(o => !o.player.inactive), koth})) broadcast(msg);
      runKoth('left');
    }
    setTimeout(() => {
      if ([...clients].some(o => o.player.id === c.player.id)) return;
      if (!clients.size) { items = freshItems(); koth = freshKoth(); return; }   // the last one out didn't come back
      const others = [...clients].some(o => !o.player.inactive);
      for (const {msg} of letGo(items, c.player, {others, koth})) broadcast(msg);
      runKoth('left');
    }, 8000);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const c of clients) {
    if (c.player.inactive || now - c.player.lastActive < INACTIVE_MS) continue;
    c.player.inactive = true; broadcast({type: 'leave', id: c.player.id});
    const others = [...clients].some(o => o !== c && !o.player.inactive);
    for (const {msg} of letGo(items, c.player, {others, koth})) broadcast(msg);
    runKoth('left');
  }
  // nobody's done anything for a while: every item goes back where it started
  const last = Math.max(0, ...[...clients].map(c => c.player.lastActive));
  if (clients.size && now - last >= (Number(process.env.IDLE_RESET_MS) || IDLE_RESET_MS) && !itemsAtSpawn(items)) {
    items = freshItems();
    for (const item of Object.values(items)) broadcast({type: 'item', item});
    runKoth('reset');
  }
}, Number(process.env.IDLE_RESET_MS) ? 1000 : 5000);
setInterval(runKoth, 100);

server.listen(PORT, () => console.log(`111k dev server: http://localhost:${PORT}  (multiplayer on the same port)`));

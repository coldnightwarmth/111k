// Cloudflare Worker + Durable Object for the shared hangout (free tier).
// One Durable Object instance ("public-v1") holds every socket. Hibernating
// WebSockets plus automatic ping/pong mean an idle room costs nothing.
import {INACTIVE_MS, IDLE_RESET_MS, MAX_PLAYERS, cleanItem, unpackInk, encodeInk, decodeInk} from '../src/protocol.js';
const QUIET_MS = 20000, QUIET_CHECK_MS = 7000;
const INK_CHUNK_PTS = 40000;      // points to a stored chunk (packed as 32-bit numbers: about 1.3 MB, under a value's 2 MiB)     // let go after this long without a word (pages ping every 6 s)
import {cleanEmoteConfig} from '../src/emotes.js';
import {cleanReview, hiddenPieces} from '../src/review.js';
import {freshRace, publicRace} from '../src/race.js';
import {handleMessage, newPlayer, snapshot, freshItems, freshMarks, validItems, releaseItems, letGo, validMarks, marksMessage, joinMarks, joinInk, rejoinInk, itemsAtSpawn, inkPacked, inkCount, finishInk,
  kothTick, kothNext, freshKoth, publicKoth, logError, RADIO_LOG_PREFIX, radioLogKey, patchRadioEntry, promoteRadio, CHAT_LOG_PREFIX, chatLogKey} from './room.js';

// The scene: everything players have done to the space (items moved, pieces sprayed, paint, the level's own
// graffiti scrubbed off, the lap timer, king of the hill). When this changes, the room starts over once with
// the space as it was built: bump it and deploy. (The graffiti review and the emote settings stay.)
//   1: as it was up to the playtest  2: cleared for the playtest on 1-1-1k.online/playtest (9 Nov 2026)
//   3: cleared for the launch (11 Nov 2026)
export const SCENE = 3;

function allowedOrigins(env) {
  const list = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (env.ALLOW_LOCALHOST_ORIGINS === 'true') list.push('http://localhost:8000', 'http://127.0.0.1:8000');
  return list;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ok: true});
    const origin = request.headers.get('Origin');
    if (!allowedOrigins(env).includes(origin)) return new Response('Forbidden', {status: 403});
    // the emote settings (changed from /anim) and the graffiti review (made at /graffiti): read by anyone
    // on the site, handled by the room itself
    if (url.pathname === '/emotes' || url.pathname === '/graffiti' || url.pathname === '/errors' || url.pathname === '/radio-log' || url.pathname === '/chat-log') {
      const cors = {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-Emotes-Key'};
      if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
      if (request.method === 'POST' && env.EMOTES_KEY && request.headers.get('X-Emotes-Key') !== env.EMOTES_KEY)
        return new Response('Wrong key', {status: 401, headers: cors});
      const res = await env.ROOM.get(env.ROOM.idFromName('public-v1')).fetch(request);
      return new Response(res.body, {status: res.status, headers: {...Object.fromEntries(res.headers), ...cors}});
    }
    if (url.pathname !== '/connect' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('WebSocket required', {status: 400});
    if (!/^[a-f0-9-]{36}$/.test(url.searchParams.get('session') || '')) return new Response('Invalid session', {status: 400});
    return env.ROOM.get(env.ROOM.idFromName('public-v1')).fetch(request);
  },
};

export class Room {
  constructor(ctx) {
    this.ctx = ctx;
    this.items = null;
    this.marks = null;
    this.marksTimer = null;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  // a new SCENE: start over (once, before anything's read)
  sceneReady() {
    return this.scene ||= (async () => {
      if ((await this.ctx.storage.get?.('scene')) === SCENE) return;
      await this.ctx.storage.put?.({items: freshItems(), marks: freshMarks(), race: freshRace(), koth: freshKoth(), scene: SCENE});
      await this.ctx.storage.delete?.('left');
      this.items = this.marks = this.race = this.koth = null;
    })();
  }
  // held items are the room's only shared state; they survive hibernation in storage
  async loadItems() {
    await this.sceneReady();
    if (!this.items) this.items = validItems(await this.ctx.storage.get?.('items'));
    return this.items;
  }
  // (unconfirmed: everyone's next messages aren't held back waiting for the write to be confirmed; if it ever
  // failed the room would restart from what was last saved, which is all an item move could cost)
  async saveItems() { await this.ctx.storage.put?.('items', this.items, {allowUnconfirmed: true}); }
  // paint marks change often; write them at most every few seconds
  async loadMarks() {
    await this.sceneReady();
    if (!this.marks) {
      const stored = await this.ctx.storage.get?.('marks'), chunks = (await this.ctx.storage.get?.('inkChunks')) || 0;
      // the ink's kept apart from the rest, packed, in chunks (one value can't be over 2 MiB); before, it was in 'marks'
      // (each chunk: encodeInk's bytes; before, a list of strokes with their numbers in p)
      let old = false;
      if (stored && chunks > 0) {
        const got = await this.ctx.storage.get?.(Array.from({length: chunks}, (_, i) => `ink${i}`));
        stored.ink = [];
        for (let i = 0; i < chunks; i++) {
          const v = got?.get?.(`ink${i}`);
          if (v instanceof Uint8Array) for (const s of decodeInk(v) || []) stored.ink.push(s);
          else for (const s of v || []) { old = true; stored.ink.push({id: s.id, h: s.h, c: s.c, t: s.t, at: s.at, g: s.g, joined: s.joined, pts: unpackInk(s.p) || []}); }
        }
      }
      this.marks = validMarks(stored);
      // ink from before strokes were made lighter once done: made so now, and kept that way
      for (const s of this.marks.ink) if (s.joined && !s.lite) { if (s.q) { s.pts = unpackInk(Array.from(s.q)); delete s.q; } finishInk(s); old = true; }
      if (old) this.saveMarksSoon();
    }
    return this.marks;
  }
  // the lap timer's state (survives the room sleeping)
  async loadRace() {
    await this.sceneReady();
    if (!this.race) { const r = await this.ctx.storage.get?.('race'); this.race = r && typeof r.state === 'string' ? r : freshRace(); }
    return this.race;
  }
  async saveRace() { await this.ctx.storage.put?.('race', this.race); }
  // king of the hill (survives the room sleeping too)
  async loadKoth() {
    await this.sceneReady();
    if (!this.koth) { const k = await this.ctx.storage.get?.('koth'); this.koth = k && typeof k.state === 'string' && k.times ? k : freshKoth(); }
    return this.koth;
  }
  async saveKoth() { await this.ctx.storage.put?.('koth', this.koth); }
  // move the game along (the grace running out, a paintball landing, someone getting to a minute)
  async runKoth(now, cause) {
    const koth = await this.loadKoth();
    if (cause) koth.cause = cause;
    const r = kothTick({items: await this.loadItems(), koth, players: () => this.players()}, now);
    for (const {msg} of r.out) this.broadcast(msg);
    if (r.itemsChanged) await this.saveItems();
    if (r.kothChanged) await this.saveKoth();
  }
  saveMarksSoon() {
    this.inkSent = null;                       // (what's sent to someone joining, made again)
    if (this.marksTimer) return;
    this.marksTimer = setTimeout(() => { this.marksTimer = null; this.saveMarks().catch(() => {}); }, 4000);
  }
  // the marks, the ink in chunks (encodeInk's bytes), only the chunks that have changed since they were last
  // written (new ink goes on the end: mostly just the last one)
  async saveMarks() {
    const m = this.marks, put = {marks: {...m, ink: []}}, chunk = [];
    let n = 0, k = 0, sig = '';
    const saved = this.savedChunks ||= [];
    const flush = () => {
      if (saved[k] !== sig) {
        put[`ink${k}`] = encodeInk(chunk.map(s => ({id: s.id, h: s.h, c: s.c, t: s.t, at: s.at, g: s.g, joined: s.joined, lite: s.lite, q: inkPacked(s)})));
        saved[k] = sig;
      }
      k++; chunk.length = 0; n = 0; sig = '';
    };
    for (const s of m.ink || []) {
      const c = inkCount(s);
      if (n + c > INK_CHUNK_PTS && chunk.length) flush();
      chunk.push(s); n += c; sig += `${s.id}|${c}|${s.g || ''}|${s.joined ? 1 : 0}|${s.lite ? 1 : 0};`;
    }
    if (chunk.length) flush();
    saved.length = k;
    const before = (await this.ctx.storage.get?.('inkChunks')) || 0;
    put.inkChunks = k;
    const entries = Object.entries(put);
    for (let i = 0; i < entries.length; i += 100) await this.ctx.storage.put?.(Object.fromEntries(entries.slice(i, i + 100)), {allowUnconfirmed: true});
    if (before > k) await this.ctx.storage.delete?.(Array.from({length: before - k}, (_, i) => `ink${k + i}`));
  }
  // (not one that's been let go for going quiet: it can linger in the list a moment while it closes)
  sockets() { return this.ctx.getWebSockets().filter(ws => !ws.deserializeAttachment()?.gone); }
  players() { return this.sockets().map(ws => ws.deserializeAttachment()).filter(Boolean); }
  send(ws, msg) { try { ws.send(typeof msg === 'string' || msg instanceof Uint8Array ? msg : JSON.stringify(msg)); } catch {} }
  broadcast(msg) { const data = JSON.stringify(msg); for (const ws of this.sockets()) this.send(ws, data); }
  async scheduleAlarm() {
    const everyone = this.players(), live = everyone.filter(p => !p.inactive);
    const times = [];
    if (everyone.length) times.push(Date.now() + QUIET_CHECK_MS);     // (who's gone quiet: alarm)
    if (live.length) times.push(Math.min(...live.map(p => p.lastActive)) + INACTIVE_MS + 1000);
    // items out of place: put them back once the room has been idle long enough
    if (everyone.length && !itemsAtSpawn(await this.loadItems())) times.push(Math.max(...everyone.map(p => p.lastActive)) + IDLE_RESET_MS + 500);
    // a queued link due on (a radio's play stopping with another waiting)
    for (const it of Object.values(await this.loadItems())) if (it.type === 'radio' && it.next && it.play) times.push(Math.max(Date.now() + 50, it.play.until));
    const koth = kothNext(await this.loadKoth());
    if (koth !== null && everyone.length) times.push(koth + 20);
    if (!times.length) return;
    let at = Math.min(...times);
    const pending = await this.ctx.storage.getAlarm?.();
    if (pending && pending > Date.now() && pending < at) at = pending;   // keep a sooner one (dropped items)
    await this.ctx.storage.setAlarm(at);
  }

  async loadEmotes() {
    if (!this.emotes) this.emotes = cleanEmoteConfig(await this.ctx.storage.get?.('emotes'));
    return this.emotes;
  }
  // GET /emotes: the settings; POST /emotes: new ones, saved and sent to everyone here
  async emotesRequest(request) {
    if (request.method === 'POST') {
      let body; try { body = await request.json(); } catch { return new Response('Bad JSON', {status: 400}); }
      this.emotes = cleanEmoteConfig(body);
      await this.ctx.storage.put?.('emotes', this.emotes);
      this.broadcast({type: 'emotes', config: this.emotes});
    }
    return Response.json(await this.loadEmotes(), {headers: {'Cache-Control': 'no-store'}});
  }

  async loadReview() {
    if (!this.review) this.review = cleanReview(await this.ctx.storage.get?.('review'));
    return this.review;
  }
  // GET /graffiti: the whole review; POST /graffiti: a new one, saved, and the pieces it removes sent to everyone
  async reviewRequest(request) {
    if (request.method === 'POST') {
      const text = await request.text();
      if (text.length > 120000) return new Response('Too big', {status: 413});
      let body; try { body = JSON.parse(text); } catch { return new Response('Bad JSON', {status: 400}); }
      this.review = cleanReview({...body, updated: Date.now()});
      await this.ctx.storage.put?.('review', this.review);
      this.broadcast({type: 'graffiti', hidden: hiddenPieces(this.review)});
    }
    return Response.json(await this.loadReview(), {headers: {'Cache-Control': 'no-store'}});
  }

  // the radio log: one stored record per link put on (kept through scene resets). It started on 11 Nov 2026;
  // the plays the radios still remember from before then go in once, the first time it's looked at or added to
  async radioLogReady() {
    return this.radioSeeded ||= (async () => {
      if (await this.ctx.storage.get?.('radioLogSeeded')) return;
      const items = await this.loadItems(), seed = {};
      for (const it of Object.values(items)) {
        const p = it.type === 'radio' && it.play;
        if (p && Number.isFinite(p.at)) seed[radioLogKey(p.at)] = {at: p.at, u: p.u, url: '', radio: it.id, by: p.by, name: '',
          ...(p.until < p.at + 299000 ? {ended: p.until} : {}), ...(p.dead ? {dead: true} : {})};
      }
      await this.ctx.storage.put?.({...seed, radioLogSeeded: Date.now()});
    })();
  }
  // a radio's queued link on, once the one playing has stopped (before each message, and by the alarm then)
  async promoteRadios(now) {
    const items = await this.loadItems();
    let any = false;
    for (const it of Object.values(items)) {
      let log, moved = false;
      while ((log = promoteRadio(it, now))) { moved = any = true; await this.logRadio(log); }
      if (moved) this.broadcast({type: 'item', item: cleanItem(it)});
    }
    if (any) { await this.saveItems(); await this.scheduleAlarm(); }
  }
  async logRadio({at, set, patch}) {
    await this.radioLogReady();
    const key = radioLogKey(at);
    const entry = set || patchRadioEntry(await this.ctx.storage.get?.(key), patch);
    if (entry) await this.ctx.storage.put?.(key, entry);
  }
  async chatLogRequest(request) {
    const before = Number(new URL(request.url).searchParams.get('before'));
    const opts = {prefix: CHAT_LOG_PREFIX, reverse: true, limit: 1000};
    if (Number.isFinite(before) && before > 0) opts.end = chatLogKey(before);
    const list = this.ctx.storage.list ? [...(await this.ctx.storage.list(opts)).values()] : [];
    return Response.json(list, {headers: {'Cache-Control': 'no-store'}});
  }
  async radioLogRequest(request) {
    await this.radioLogReady();
    const before = Number(new URL(request.url).searchParams.get('before'));
    const opts = {prefix: RADIO_LOG_PREFIX, reverse: true, limit: 500};
    if (Number.isFinite(before) && before > 0) opts.end = radioLogKey(before);
    const list = this.ctx.storage.list ? [...(await this.ctx.storage.list(opts)).values()] : [];
    return Response.json(list, {headers: {'Cache-Control': 'no-store'}});
  }

  async fetch(request) {
    if (new URL(request.url).pathname === '/emotes') return this.emotesRequest(request);
    if (new URL(request.url).pathname === '/graffiti') return this.reviewRequest(request);
    // GET /errors: what's gone wrong in visitors' browsers lately (src/errors.js)
    if (new URL(request.url).pathname === '/errors')
      return Response.json((await this.ctx.storage.get?.('errors')) || [], {headers: {'Cache-Control': 'no-store'}});
    // GET /radio-log: every link put on the radio, newest first (?before=<at> for older ones)
    if (new URL(request.url).pathname === '/radio-log') return this.radioLogRequest(request);
    // GET /chat-log: everything said in the chat, newest first (?before=<at> for older)
    if (new URL(request.url).pathname === '/chat-log') return this.chatLogRequest(request);
    // Public player IDs must not expose the session token that can resume a socket.
    const session = new URL(request.url).searchParams.get('session');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(session));
    const id = Array.from(new Uint8Array(digest).slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
    const existing = this.sockets().filter(ws => ws.deserializeAttachment()?.id === id);
    if (this.sockets().length - existing.length >= MAX_PLAYERS) return new Response('Room full', {status: 503});
    for (const ws of existing) { try { ws.close(1000, 'Reconnected'); } catch {} }
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    const now = Date.now();
    server.serializeAttachment(newPlayer(id, now));
    this.send(server, {type: 'welcome', id, now});
    this.send(server, snapshot(this.players(), now, await this.loadItems()));
    // (the ink in binary for a page that can take it; made once and kept till the marks change. The marks go
    // now, the ink as it's ready: anything drawn meanwhile comes after, and the page holds it till the ink's in)
    const binary = new URL(request.url).searchParams.get('z') === '1';
    if (binary) this.inkSent ||= {parts: null};
    const join = joinMarks(await this.loadMarks(), binary, now, binary ? this.inkSent : null);
    for (const msg of join.head) this.send(server, msg);
    this.send(server, {type: 'race', race: publicRace(await this.loadRace(), now)});
    this.send(server, {type: 'koth', koth: publicKoth(await this.loadKoth(), now)});
    this.send(server, {type: 'keypad', entry: this.converter?.entry || ''});
    this.send(server, {type: 'emotes', config: await this.loadEmotes()});
    this.send(server, {type: 'graffiti', hidden: hiddenPieces(await this.loadReview())});
    // (if it can't be deflated, the lot again as JSON: the page starts over with that)
    try { for (const msg of await join.parts) this.send(server, msg); }
    catch { this.inkSent = null; for (const msg of joinMarks(await this.loadMarks(), false).head) this.send(server, msg); }
    await this.scheduleAlarm();
    return new Response(null, {status: 101, webSocket: client});
  }

  async webSocketMessage(ws, data) {
    const player = ws.deserializeAttachment();
    if (!player) return;
    const now = Date.now();
    const items = await this.loadItems(), marks = await this.loadMarks();
    await this.radioLogReady();           // (before anything's put on over what the radio last played)
    const race = await this.loadRace(), koth = await this.loadKoth();
    this.converter ||= {entry: '', busyUntil: 0, id: null};     // (the keypad: kept while the room's awake)
    await this.promoteRadios(now);
    const result = handleMessage(player, data, now, {items, marks, race, koth, converter: this.converter, players: () => this.players()});
    if (result.close) { ws.close(1009, result.close); return; }
    const quiet = now - (player.heard || 0) > 4000;            // (heard from: kept now and then, not every message)
    if (quiet) player.heard = now;
    if (result.changed || quiet) ws.serializeAttachment(player);
    for (const {to, msg} of result.out) {
      if (to === 'all') this.broadcast(msg);
      else if (to === 'self') this.send(ws, msg);
      else for (const other of this.sockets()) if (other.deserializeAttachment()?.id === to) this.send(other, msg);
    }
    for (const l of result.radioLogs || []) await this.logRadio(l);
    if (result.chatLog) await this.ctx.storage.put?.(chatLogKey(result.chatLog.at, result.chatLog.id), result.chatLog);
    if (result.report) await this.ctx.storage.put?.('errors', logError((await this.ctx.storage.get?.('errors')) || [], result.report), {allowUnconfirmed: true});
    if (result.itemsChanged) { await this.saveItems(); await this.scheduleAlarm(); }
    if (result.marksChanged) this.saveMarksSoon();
    if (result.raceChanged) await this.saveRace();
    if (result.kothChanged) await this.saveKoth();
    if (result.kothChanged && !result.itemsChanged) await this.scheduleAlarm();
    if (result.returning) { this.broadcast(snapshot(this.players(), now, items)); await this.scheduleAlarm(); }
  }

  async alarm() {
    const now = Date.now();
    if (await this.closeIfEmpty()) return;
    // gone quiet: a phone asleep or out of signal can leave its connection half open, and they'd stand there
    // frozen (unpunchable: a punch's knockback is their own game's to do) for minutes. Nothing from them (not
    // even the pings their page sends every few seconds, answered without waking us) for QUIET_MS: let go,
    // as if they'd closed it. (A page that's still there reconnects as the same player.)
    for (const ws of this.ctx.getWebSocketAutoResponseTimestamp ? this.sockets() : []) {
      const p = ws.deserializeAttachment();
      if (!p) continue;
      const ping = this.ctx.getWebSocketAutoResponseTimestamp(ws);
      const heard = Math.max(ping ? +ping : 0, p.lastActive || 0, p.joinedAt || 0, p.heard || 0);
      if (now - heard < QUIET_MS) continue;
      await this.depart(ws);
      p.gone = true; try { ws.serializeAttachment(p); } catch {}
      try { ws.close(4000, 'Gone quiet'); } catch {}
    }
    await this.releaseOrphans();
    await this.promoteRadios(now);
    // marker strokes that cross, left a minute: one drawing (kept or let go whole; drawn as one)
    const marks = await this.loadMarks();
    const joined = joinInk(marks.ink || [], now);
    for (const d of joined) this.broadcast({type: 'inkgroup', g: d.g, ids: d.ids});
    if (joined.length || joined.finished) this.saveMarksSoon();
    // once: all the ink gone over again with joining as it is now (11 Nov 2026: crossings found both ways round;
    // then the same colour within a metre joining too). A new pass: a new key.
    if (!this.rejoinChecked) {
      this.rejoinChecked = true;
      if (!(await this.ctx.storage.get?.('inkRejoined2'))) {
        const merged = rejoinInk(marks.ink || [], now);
        for (const d of merged) this.broadcast({type: 'inkgroup', g: d.g, ids: d.ids});
        if (merged.length) await this.saveMarks();
        await this.ctx.storage.put?.('inkRejoined2', now);
      }
    }
    for (const ws of this.sockets()) {
      const p = ws.deserializeAttachment();
      if (!p || p.inactive || now - p.lastActive < INACTIVE_MS) continue;
      p.inactive = true; ws.serializeAttachment(p);
      this.broadcast({type: 'leave', id: p.id});
      const others = this.players().some(o => o.id !== p.id && !o.inactive);
      const dropped = letGo(await this.loadItems(), p, {others, koth: await this.loadKoth()});
      for (const {msg} of dropped) this.broadcast(msg);
      if (dropped.length) { await this.saveItems(); await this.runKoth(now, 'left'); }
    }
    await this.runKoth(now);
    // nobody connected has done anything for a while: tidy up
    const everyone = this.players();
    const lastActive = everyone.length ? Math.max(...everyone.map(p => p.lastActive)) : 0;
    if (now - lastActive >= IDLE_RESET_MS && !itemsAtSpawn(await this.loadItems())) await this.resetItems();
    await this.scheduleAlarm();
  }
  async resetItems() {
    this.items = freshItems(); await this.saveItems();
    for (const item of Object.values(this.items)) this.broadcast({type: 'item', item});
    await this.runKoth(Date.now(), 'reset');
  }

  async webSocketClose(ws) { await this.depart(ws); }
  async webSocketError(ws) { try { ws.close(1011, 'Connection interrupted'); } catch {} await this.depart(ws); }
  async depart(ws) {
    const p = ws.deserializeAttachment();
    if (!p?.id || p.gone || this.sockets().some(o => o !== ws && o.deserializeAttachment()?.id === p.id)) return;   // (gone: done already)
    this.broadcast({type: 'leave', id: p.id});
    const items = await this.loadItems(), alone = !this.sockets().some(o => o !== ws);
    // the crown never waits for anyone: it comes off now (on the floor where they were if anyone else is
    // about or a game is on, otherwise back on its stand)
    const crowns = Object.fromEntries(Object.values(items).filter(it => it.holder === p.id && it.type === 'crown').map(it => [it.id, it]));
    if (Object.keys(crowns).length) {
      const others = this.players().some(o => o.id !== p.id && !o.inactive);
      for (const {msg} of letGo(crowns, p, {others, koth: await this.loadKoth()})) this.broadcast(msg);
      await this.saveItems(); await this.runKoth(Date.now(), 'left');
    }
    // a refresh reconnects within a few seconds as the same player: keep what's in their hands for them,
    // and let an alarm (which survives hibernation) drop it where they were if they don't come back
    // (or, if they were the last one here, put everything back and call off any game)
    if (p.pose && Object.values(items).some(it => it.holder === p.id)) { const left = (await this.ctx.storage.get?.('left')) || {}; left[p.id] = p.pose; await this.ctx.storage.put?.('left', left); }
    if (alone) await this.ctx.storage.put?.('emptied', Date.now());
    const soon = Date.now() + 9000, current = await this.ctx.storage.getAlarm?.();
    if (!current || current > soon) await this.ctx.storage.setAlarm(soon);
  }
  // the last one out didn't come back: everything goes back where it started, and any game is off
  async closeIfEmpty() {
    if (!(await this.ctx.storage.get?.('emptied'))) return false;
    await this.ctx.storage.delete?.('emptied');
    if (this.sockets().length) return false;
    this.items = freshItems(); await this.saveItems();
    this.koth = freshKoth(); await this.saveKoth();
    await this.ctx.storage.delete?.('left');
    return true;
  }
  // items held by someone who is no longer connected go down where they were
  async releaseOrphans() {
    const items = await this.loadItems(), here = new Set(this.players().map(p => p.id));
    const left = (await this.ctx.storage.get?.('left')) || {}, others = this.players().some(p => !p.inactive);
    let changed = false;
    for (const it of Object.values(items)) {
      if (!it.holder || here.has(it.holder)) continue;
      const id = it.holder;
      for (const {msg} of letGo(items, {id, pose: left[id] || null}, {others, koth: await this.loadKoth()})) this.broadcast(msg);
      delete left[id];
      changed = true;
    }
    if (changed) { await this.ctx.storage.put?.('left', left); await this.saveItems(); await this.runKoth(Date.now(), 'left'); }
  }
}

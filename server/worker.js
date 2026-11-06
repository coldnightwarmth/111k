// Cloudflare Worker + Durable Object for the shared hangout (free tier).
// One Durable Object instance ("public-v1") holds every socket. Hibernating
// WebSockets plus automatic ping/pong mean an idle room costs nothing.
import {INACTIVE_MS, IDLE_RESET_MS, MAX_PLAYERS} from '../src/protocol.js';
import {freshRace, publicRace} from '../src/race.js';
import {handleMessage, newPlayer, snapshot, freshItems, validItems, releaseItems, validMarks, marksMessage, itemsAtSpawn} from './room.js';

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
  // held items are the room's only shared state; they survive hibernation in storage
  async loadItems() {
    if (!this.items) this.items = validItems(await this.ctx.storage.get?.('items'));
    return this.items;
  }
  async saveItems() { await this.ctx.storage.put?.('items', this.items); }
  // paint marks change often; write them at most every few seconds
  async loadMarks() {
    if (!this.marks) this.marks = validMarks(await this.ctx.storage.get?.('marks'));
    return this.marks;
  }
  // the lap timer's state (survives the room sleeping)
  async loadRace() {
    if (!this.race) { const r = await this.ctx.storage.get?.('race'); this.race = r && typeof r.state === 'string' ? r : freshRace(); }
    return this.race;
  }
  async saveRace() { await this.ctx.storage.put?.('race', this.race); }
  saveMarksSoon() {
    if (this.marksTimer) return;
    this.marksTimer = setTimeout(() => { this.marksTimer = null; this.ctx.storage.put?.('marks', this.marks); }, 4000);
  }
  sockets() { return this.ctx.getWebSockets(); }
  players() { return this.sockets().map(ws => ws.deserializeAttachment()).filter(Boolean); }
  send(ws, msg) { try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch {} }
  broadcast(msg) { const data = JSON.stringify(msg); for (const ws of this.sockets()) this.send(ws, data); }
  async scheduleAlarm() {
    const everyone = this.players(), live = everyone.filter(p => !p.inactive);
    const times = [];
    if (live.length) times.push(Math.min(...live.map(p => p.lastActive)) + INACTIVE_MS + 1000);
    // items out of place: put them back once the room has been idle long enough
    if (everyone.length && !itemsAtSpawn(await this.loadItems())) times.push(Math.max(...everyone.map(p => p.lastActive)) + IDLE_RESET_MS + 500);
    if (!times.length) return;
    let at = Math.min(...times);
    const pending = await this.ctx.storage.getAlarm?.();
    if (pending && pending > Date.now() && pending < at) at = pending;   // keep a sooner one (dropped items)
    await this.ctx.storage.setAlarm(at);
  }

  async fetch(request) {
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
    this.send(server, marksMessage(await this.loadMarks()));
    this.send(server, {type: 'race', race: publicRace(await this.loadRace(), now)});
    await this.scheduleAlarm();
    return new Response(null, {status: 101, webSocket: client});
  }

  async webSocketMessage(ws, data) {
    const player = ws.deserializeAttachment();
    if (!player) return;
    const now = Date.now();
    const items = await this.loadItems(), marks = await this.loadMarks();
    const race = await this.loadRace();
    const result = handleMessage(player, data, now, {items, marks, race, players: () => this.players()});
    if (result.close) { ws.close(1009, result.close); return; }
    if (result.changed) ws.serializeAttachment(player);
    for (const {to, msg} of result.out) {
      if (to === 'all') this.broadcast(msg);
      else if (to === 'self') this.send(ws, msg);
      else for (const other of this.sockets()) if (other.deserializeAttachment()?.id === to) this.send(other, msg);
    }
    if (result.itemsChanged) { await this.saveItems(); await this.scheduleAlarm(); }
    if (result.marksChanged) this.saveMarksSoon();
    if (result.raceChanged) await this.saveRace();
    if (result.returning) { this.broadcast(snapshot(this.players(), now, items)); await this.scheduleAlarm(); }
  }

  async alarm() {
    const now = Date.now();
    await this.releaseOrphans();
    for (const ws of this.sockets()) {
      const p = ws.deserializeAttachment();
      if (!p || p.inactive || now - p.lastActive < INACTIVE_MS) continue;
      p.inactive = true; ws.serializeAttachment(p);
      this.broadcast({type: 'leave', id: p.id});
      const dropped = releaseItems(await this.loadItems(), p);
      for (const {msg} of dropped) this.broadcast(msg);
      if (dropped.length) await this.saveItems();
    }
    // nobody connected has done anything for a while: tidy up
    const everyone = this.players();
    const lastActive = everyone.length ? Math.max(...everyone.map(p => p.lastActive)) : 0;
    if (now - lastActive >= IDLE_RESET_MS && !itemsAtSpawn(await this.loadItems())) await this.resetItems();
    await this.scheduleAlarm();
  }
  async resetItems() {
    this.items = freshItems(); await this.saveItems();
    for (const item of Object.values(this.items)) this.broadcast({type: 'item', item});
  }

  async webSocketClose(ws) { await this.depart(ws); }
  async webSocketError(ws) { try { ws.close(1011, 'Connection interrupted'); } catch {} await this.depart(ws); }
  async depart(ws) {
    const p = ws.deserializeAttachment();
    if (!p?.id || this.sockets().some(o => o !== ws && o.deserializeAttachment()?.id === p.id)) return;
    this.broadcast({type: 'leave', id: p.id});
    const items = await this.loadItems();
    if (!this.sockets().some(o => o !== ws)) {
      // last one out: everything goes back where it started
      this.items = freshItems(); await this.saveItems(); return;
    }
    // a refresh reconnects within a few seconds as the same player: keep their item for them,
    // and let an alarm (which survives hibernation) drop it if they don't come back
    const soon = Date.now() + 9000, current = await this.ctx.storage.getAlarm?.();
    if (!current || current > soon) await this.ctx.storage.setAlarm(soon);
  }
  // items held by someone who is no longer connected go down where they were
  async releaseOrphans() {
    const items = await this.loadItems(), here = new Set(this.players().map(p => p.id));
    let changed = false;
    for (const it of Object.values(items)) {
      if (!it.holder || here.has(it.holder)) continue;
      for (const {msg} of releaseItems(items, {id: it.holder, pose: null})) this.broadcast(msg);
      changed = true;
    }
    if (changed) await this.saveItems();
  }
}

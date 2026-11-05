// Cloudflare Worker + Durable Object for the shared hangout (free tier).
// One Durable Object instance ("public-v1") holds every socket. Hibernating
// WebSockets plus automatic ping/pong mean an idle room costs nothing.
import {INACTIVE_MS, MAX_PLAYERS} from '../src/protocol.js';
import {handleMessage, newPlayer, snapshot} from './room.js';

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
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  sockets() { return this.ctx.getWebSockets(); }
  players() { return this.sockets().map(ws => ws.deserializeAttachment()).filter(Boolean); }
  send(ws, msg) { try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch {} }
  broadcast(msg) { const data = JSON.stringify(msg); for (const ws of this.sockets()) this.send(ws, data); }
  async scheduleAlarm() {
    const live = this.players().filter(p => !p.inactive);
    if (live.length) await this.ctx.storage.setAlarm(Math.min(...live.map(p => p.lastActive)) + INACTIVE_MS + 1000);
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
    this.send(server, snapshot(this.players(), now));
    await this.scheduleAlarm();
    return new Response(null, {status: 101, webSocket: client});
  }

  async webSocketMessage(ws, data) {
    const player = ws.deserializeAttachment();
    if (!player) return;
    const now = Date.now();
    const result = handleMessage(player, data, now);
    if (result.close) { ws.close(1009, result.close); return; }
    if (result.changed) ws.serializeAttachment(player);
    for (const {to, msg} of result.out) to === 'all' ? this.broadcast(msg) : this.send(ws, msg);
    if (result.returning) { this.broadcast(snapshot(this.players(), now)); await this.scheduleAlarm(); }
  }

  async alarm() {
    const now = Date.now();
    for (const ws of this.sockets()) {
      const p = ws.deserializeAttachment();
      if (!p || p.inactive || now - p.lastActive < INACTIVE_MS) continue;
      p.inactive = true; ws.serializeAttachment(p);
      this.broadcast({type: 'leave', id: p.id});
    }
    await this.scheduleAlarm();
  }

  async webSocketClose(ws) { this.depart(ws); }
  async webSocketError(ws) { try { ws.close(1011, 'Connection interrupted'); } catch {} this.depart(ws); }
  depart(ws) {
    const id = ws.deserializeAttachment()?.id;
    if (!id || this.sockets().some(o => o !== ws && o.deserializeAttachment()?.id === id)) return;
    this.broadcast({type: 'leave', id});
  }
}

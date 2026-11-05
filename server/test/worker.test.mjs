// Exercises the Durable Object with a mocked Cloudflare runtime: node --test server/test
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeSocket {
  constructor() { this.sent = []; this.attachment = null; this.closed = null; }
  send(d) { this.sent.push(d); }
  close(code, reason) { this.closed = {code, reason}; }
  serializeAttachment(v) { this.attachment = structuredClone(v); }
  deserializeAttachment() { return structuredClone(this.attachment); }
  messages() { return this.sent.filter(s => s !== 'pong').map(s => JSON.parse(s)); }
}
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeSocket(); this[1] = new FakeSocket(); } };
globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { this.a = a; this.b = b; } };
const RealResponse = Response;
globalThis.Response = class extends RealResponse {
  constructor(body, init = {}) { super(body, init.status === 101 ? {} : init); this.fakeStatus = init.status; this.webSocket = init.webSocket; }
};

const {Room, default: worker} = await import('../worker.js');

function makeRoom() {
  const sockets = [];
  const ctx = {
    getWebSockets: () => sockets.filter(s => !s.closed),
    acceptWebSocket: ws => sockets.push(ws),
    setWebSocketAutoResponse() {},
    storage: {alarm: null, setAlarm(t) { this.alarm = t; }},
  };
  return {room: new Room(ctx), sockets, ctx};
}
const join = async (room, session) => {
  await room.fetch(new Request(`https://x/connect?session=${session}`));
};
const S1 = '11111111-1111-4111-8111-111111111111', S2 = '22222222-2222-4222-8222-222222222222';
const pose = {x: 1, y: 1.65, z: 2, yaw: 0.5, pitch: 0, room: 'office', crouch: 0, jumpTime: -1, emote: 'wave', emoteTime: 0.4, typing: false};

test('join, pose relay and chat', async () => {
  const {room, sockets} = makeRoom();
  await join(room, S1); await join(room, S2);
  const [a, b] = sockets;
  assert.equal(a.messages()[0].type, 'welcome');
  const idA = a.messages()[0].id;
  assert.ok(!idA.includes('1111'), 'public id must not reveal the session');
  await room.webSocketMessage(a, JSON.stringify({type: 'pose', pose}));
  const relayed = b.messages().find(m => m.type === 'pose');
  assert.equal(relayed.id, idA); assert.equal(relayed.pose.emote, 'wave');
  await room.webSocketMessage(a, JSON.stringify({type: 'chat', text: '  hello\nworld  '}));
  assert.equal(b.messages().find(m => m.type === 'chat').text, 'hello world');
  // chat rate limit
  await room.webSocketMessage(a, JSON.stringify({type: 'chat', text: 'spam'}));
  assert.equal(b.messages().filter(m => m.type === 'chat').length, 1);
});

test('rejects bad poses and oversized messages', async () => {
  const {room, sockets} = makeRoom();
  await join(room, S1); await join(room, S2);
  const [a, b] = sockets;
  await room.webSocketMessage(a, JSON.stringify({type: 'pose', pose: {...pose, x: NaN}}));
  await room.webSocketMessage(a, JSON.stringify({type: 'pose', pose: {...pose, emote: 'nonsense'}}));
  const poses = b.messages().filter(m => m.type === 'pose');
  assert.equal(poses.length, 1); assert.equal(poses[0].pose.emote, '');
  await room.webSocketMessage(a, 'x'.repeat(5000));
  assert.equal(a.closed.code, 1009);
});

test('late joiner receives existing players, leave is broadcast', async () => {
  const {room, sockets} = makeRoom();
  await join(room, S1);
  await room.webSocketMessage(sockets[0], JSON.stringify({type: 'pose', pose}));
  await join(room, S2);
  const state = sockets[1].messages().find(m => m.type === 'state');
  assert.equal(state.players.length, 1);
  sockets[0].closed = {code: 1000};
  await room.webSocketClose(sockets[0]);
  assert.ok(sockets[1].messages().some(m => m.type === 'leave'));
});

test('worker checks origin and session', async () => {
  const env = {ALLOWED_ORIGINS: 'https://coldnightwarmth.github.io', ROOM: {idFromName: () => 1, get: () => ({fetch: () => new Response('ok')})}};
  const bad = await worker.fetch(new Request('https://w/connect?session=' + S1, {headers: {Origin: 'https://evil.example', Upgrade: 'websocket'}}), env);
  assert.equal(bad.status, 403);
  const badSession = await worker.fetch(new Request('https://w/connect?session=nope', {headers: {Origin: 'https://coldnightwarmth.github.io', Upgrade: 'websocket'}}), env);
  assert.equal(badSession.status, 400);
  const ok = await worker.fetch(new Request('https://w/connect?session=' + S1, {headers: {Origin: 'https://coldnightwarmth.github.io', Upgrade: 'websocket'}}), env);
  assert.equal(await ok.text(), 'ok');
});

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

test('flashlights: pick up, toggle, drop, punched out of your hand', async () => {
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {room, sockets, ctx} = makeRoom();
  const store = new Map();
  ctx.storage.get = async k => store.get(k);
  ctx.storage.put = async (k, v) => { store.set(k, structuredClone(v)); };
  await join(room, S1); await join(room, S2);
  const [a, b] = sockets;
  const spawn = ITEM_SPAWNS[0];
  const state = a.messages().find(m => m.type === 'state');
  assert.equal(state.items.length, ITEM_SPAWNS.length);
  const idA = a.messages()[0].id, idB = b.messages()[0].id;
  // too far away: refused
  await room.webSocketMessage(a, JSON.stringify({type: 'pose', pose: {...pose, x: spawn.x + 10, z: spawn.z}}));
  await room.webSocketMessage(a, JSON.stringify({type: 'pickup', id: spawn.id}));
  assert.equal(b.messages().filter(m => m.type === 'item').length, 0);
  // close enough: picked up, and saved
  await new Promise(r => setTimeout(r, 50));
  await room.webSocketMessage(a, JSON.stringify({type: 'pose', pose: {...pose, x: spawn.x + 0.5, z: spawn.z}}));
  await room.webSocketMessage(a, JSON.stringify({type: 'pickup', id: spawn.id}));
  let item = b.messages().filter(m => m.type === 'item').at(-1).item;
  assert.equal(item.holder, idA);
  assert.equal(store.get('items')[spawn.id].holder, idA);
  // only the holder can switch it on
  await room.webSocketMessage(b, JSON.stringify({type: 'toggle', id: spawn.id, on: true}));
  assert.equal(b.messages().filter(m => m.type === 'item').at(-1).item.on, false);
  await room.webSocketMessage(a, JSON.stringify({type: 'toggle', id: spawn.id, on: true}));
  assert.equal(b.messages().filter(m => m.type === 'item').at(-1).item.on, true);
  // b walks up and punches a: knock-back and the torch drops at a's feet
  await new Promise(r => setTimeout(r, 50));
  await room.webSocketMessage(b, JSON.stringify({type: 'pose', pose: {...pose, x: spawn.x + 1.5, z: spawn.z}}));
  await room.webSocketMessage(b, JSON.stringify({type: 'punch', target: idA}));
  const punch = a.messages().find(m => m.type === 'punch');
  assert.equal(punch.target, idA); assert.equal(punch.from, idB);
  assert.ok(punch.dir[0] < 0, 'pushed away from the puncher');
  item = a.messages().filter(m => m.type === 'item').at(-1).item;
  assert.equal(item.holder, null); assert.equal(item.on, true);
  // punches are rate limited
  await room.webSocketMessage(b, JSON.stringify({type: 'punch', target: idA}));
  assert.equal(a.messages().filter(m => m.type === 'punch').length, 1);
});

test('items go home when the last player leaves', async () => {
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {room, sockets, ctx} = makeRoom();
  const store = new Map();
  ctx.storage.get = async k => store.get(k);
  ctx.storage.put = async (k, v) => { store.set(k, structuredClone(v)); };
  await join(room, S1);
  const [a] = sockets;
  const spawn = ITEM_SPAWNS[0];
  await room.webSocketMessage(a, JSON.stringify({type: 'pose', pose: {...pose, x: spawn.x, z: spawn.z}}));
  await room.webSocketMessage(a, JSON.stringify({type: 'pickup', id: spawn.id}));
  assert.equal(store.get('items')[spawn.id].holder !== null, true);
  a.closed = {code: 1000};
  await room.webSocketClose(a);
  assert.equal(store.get('items')[spawn.id].holder, null);
  assert.equal(store.get('items')[spawn.id].x, spawn.x);
});

test('looks and names: shared on change, names only in chat', async () => {
  const {room, sockets} = makeRoom();
  await join(room, S1); await join(room, S2);
  const [a, b] = sockets;
  const idA = a.messages()[0].id;
  await room.webSocketMessage(a, JSON.stringify({type: 'pose', pose}));
  await room.webSocketMessage(a, JSON.stringify({type: 'look', look: {character: 'drilady', hat: 'ladycrown', bad: {x: 1}, 'no way': 'x'}, name: '  mein <3 '}));
  const look = b.messages().find(m => m.type === 'look');
  assert.deepEqual(look, {type: 'look', id: idA, look: {character: 'drilady', hat: 'ladycrown'}});
  await room.webSocketMessage(a, JSON.stringify({type: 'chat', text: 'yo'}));
  assert.equal(b.messages().find(m => m.type === 'chat').name, 'mein 3');
  // a late joiner gets the look in the snapshot
  await join(room, '33333333-3333-4333-8333-333333333333');
  const c = sockets[2];
  assert.equal(c.messages().find(m => m.type === 'state').players.find(p => p.id === idA).look.hat, 'ladycrown');
});

test('paintball and spray: holder checks, marks kept and sent to newcomers, hits drop items', async () => {
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {room, sockets, ctx} = makeRoom();
  const store = new Map();
  ctx.storage.get = async k => store.get(k);
  ctx.storage.put = async (k, v) => { store.set(k, structuredClone(v)); };
  await join(room, S1); await join(room, S2);
  const [a, b] = sockets;
  const idA = a.messages()[0].id, idB = b.messages()[0].id;
  const gun = ITEM_SPAWNS.find(s => s.type === 'paintball'), torch = ITEM_SPAWNS.find(s => s.type === 'flashlight');
  const can = ITEM_SPAWNS.find(s => s.type === 'spray');
  const shot = {type: 'shoot', o: [gun.x, 1.2, gun.z], v: [-30, 1, 0], c: 0xff00ff, s: 77, t: .3, hit: {p: [gun.x - 9, 1.2, gun.z], n: [1, 0, 0]}};
  // not holding the marker: ignored
  await room.webSocketMessage(a, JSON.stringify({type: 'pose', pose: {...pose, x: gun.x, z: gun.z}}));
  await room.webSocketMessage(a, JSON.stringify(shot));
  assert.equal(b.messages().filter(m => m.type === 'shot').length, 0);
  await room.webSocketMessage(a, JSON.stringify({type: 'pickup', id: gun.id}));
  await room.webSocketMessage(a, JSON.stringify(shot));
  const got = b.messages().find(m => m.type === 'shot');
  assert.equal(got.from, idA); assert.deepEqual(got.hit.n, [1, 0, 0]);
  assert.equal(room.marks.splats.length, 1);
  // rate limited
  await room.webSocketMessage(a, JSON.stringify(shot));
  assert.equal(b.messages().filter(m => m.type === 'shot').length, 1);
  // b holds the torch; a paints b: b drops it, and the mark goes on b, not the wall
  await room.webSocketMessage(b, JSON.stringify({type: 'pose', pose: {...pose, x: torch.x, z: torch.z}}));
  await room.webSocketMessage(b, JSON.stringify({type: 'pickup', id: torch.id}));
  await new Promise(r => setTimeout(r, 200));
  await room.webSocketMessage(a, JSON.stringify({...shot, target: idB, local: {p: [0, 1, .2], n: [0, 0, 1]}}));
  const hit = b.messages().filter(m => m.type === 'shot').at(-1);
  assert.equal(hit.target, idB); assert.equal(hit.hit, null);
  assert.equal(b.messages().filter(m => m.type === 'item').at(-1).item.holder, null);
  assert.equal(room.marks.splats.length, 1);
  // spray: needs a can, near the wall
  await room.webSocketMessage(b, JSON.stringify({type: 'pose', pose: {...pose, x: can.x, z: can.z}}));
  await room.webSocketMessage(b, JSON.stringify({type: 'pickup', id: can.id}));
  const tag = {type: 'spray', p: [can.x + 1, 1.5, can.z], n: [-1, 0, 0], up: [0, 1, 0], piece: 'tag_111k_big', size: 1.1};
  await room.webSocketMessage(b, JSON.stringify(tag));
  assert.equal(a.messages().filter(m => m.type === 'spray').length, 1);
  await room.webSocketMessage(b, JSON.stringify({...tag, p: [can.x + 20, 1.5, can.z]}));
  assert.equal(room.marks.sprays.length, 1);
  // newcomers get every mark
  await join(room, '33333333-3333-4333-8333-333333333333');
  const marks = sockets[2].messages().find(m => m.type === 'marks');
  assert.equal(marks.splats.length, 1); assert.equal(marks.sprays.length, 1);
  await new Promise(r => setTimeout(r, 4200));
  assert.equal(store.get('marks').sprays.length, 1);
});

test('paint splats: door splats keep their door, and paint is gone after a minute', async () => {
  const {cleanSplat, SPLAT_LIFE_MS} = await import('../../src/protocol.js');
  const {marksMessage, validMarks, pruneSplats} = await import('../room.js');
  assert.equal(cleanSplat({p: [.4, 1, 0], n: [0, 0, 1], c: 5, s: 9, d: 12}).d, 12);
  assert.equal(cleanSplat({p: [.4, 1, 0], n: [0, 0, 1], c: 5, s: 9, d: 'x'}), null);
  assert.equal(cleanSplat({p: [.4, 1, 0], n: [0, 0, 1], c: 5, s: 9}).d, undefined);
  const now = 1_000_000;
  const marks = validMarks({splats: [{p: [0, 1, 0], n: [1, 0, 0], c: 1, s: 1, at: now - SPLAT_LIFE_MS - 1},
    {p: [0, 1, 0], n: [1, 0, 0], c: 2, s: 2, d: 3, at: now - 1000}, {p: [0, 1, 0], n: [1, 0, 0], c: 3, s: 3}], sprays: []});
  assert.equal(marks.splats.length, 2);           // the one with no time is dropped
  const msg = marksMessage(marks, now);
  assert.equal(msg.splats.length, 1);
  assert.equal(msg.splats[0].d, 3); assert.equal(msg.splats[0].age, 1000); assert.equal(msg.splats[0].at, undefined);
  assert.equal(pruneSplats(marks, now), true); assert.equal(marks.splats.length, 1);
});

test('items: scattered flashlights start lit or not, and an idle room puts everything back', async () => {
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {IDLE_RESET_MS} = await import('../../src/protocol.js');
  const lights = ITEM_SPAWNS.filter(s => s.type === 'flashlight');
  assert.equal(lights.length, 20); assert.equal(lights.filter(s => s.on).length, 6);
  const {room, sockets, ctx} = makeRoom();
  await join(room, S1); await join(room, S2);
  const [a, b] = sockets;
  const items = a.messages().find(m => m.type === 'state').items;
  assert.equal(items.filter(it => it.on).length, 6);
  // a picks a torch up and wanders off with it
  const torch = lights.find(s => s.on);
  await room.webSocketMessage(a, JSON.stringify({type: 'pose', pose: {...pose, x: torch.x, z: torch.z}}));
  await room.webSocketMessage(a, JSON.stringify({type: 'pickup', id: torch.id}));
  assert.equal(room.items[torch.id].holder, a.messages()[0].id);
  // still busy: nothing happens
  await room.alarm();
  assert.equal(room.items[torch.id].holder, a.messages()[0].id);
  assert.ok(ctx.storage.alarm <= Date.now() + IDLE_RESET_MS + 1000, 'an alarm is set for the idle reset');
  // three minutes with nobody doing anything: all back where it started (and still lit)
  for (const ws of sockets) { const p = ws.deserializeAttachment(); p.lastActive -= IDLE_RESET_MS + 1000; ws.serializeAttachment(p); }
  await room.alarm();
  assert.equal(room.items[torch.id].holder, null);
  assert.equal(room.items[torch.id].x, torch.x); assert.equal(room.items[torch.id].on, true);
  assert.ok(b.messages().some(m => m.type === 'item' && m.item.id === torch.id && m.item.holder === null));
});

test('lap timer: start, busy for others, laps either way then the same way, finish, cancel, takeover', async () => {
  const {handleMessage, newPlayer} = await import('../room.js');
  const R = await import('../../src/race.js');
  const race = R.freshRace();
  const a = newPlayer('aaa', 0), b = newPlayer('bbb', 0);
  a.name = 'alice';
  const players = [a, b];
  const room = {items: {}, marks: null, race, players: () => players};
  let now = 1_000_000;
  const at = (ang, off = 1.5) => R.loopPoint(ang, off);
  const pose = (p, where) => { now += 200; return handleMessage(p, JSON.stringify({type: 'pose', pose: {x: where.x, y: 1.45, z: where.z, yaw: 0, pitch: 0}}), now, room); };
  const press = p => { now += 500; return handleMessage(p, JSON.stringify({type: 'button'}), now, room); };
  const near = R.loopPoint(R.MACHINE_ANGLE, 2.1);
  pose(a, near); pose(b, near);
  let r = press(a);
  assert.equal(race.state, 'running'); assert.equal(race.runner, 'aaa'); assert.equal(race.laps, 3);
  assert.equal(r.out[0].msg.event, 'start');
  // someone else can't stop it while the runner's here and inside 3 minutes
  r = press(b);
  assert.equal(race.state, 'running'); assert.ok(r.out[0].msg.busy);
  // walk round the loop: angle decreasing (clockwise) for the first lap
  const lap = dir => { for (let k = 1; k <= 64; k++) pose(a, at(R.MACHINE_ANGLE + dir * k * 2 * Math.PI / 64)); };
  lap(-1);
  assert.equal(race.laps, 2, 'first lap counts either way');
  lap(1);                      // turning back: unwinds, earns nothing
  assert.equal(race.laps, 2);
  lap(-1); lap(-1);            // back to where lap 1 ended, then a real second lap
  assert.equal(race.laps, 1);
  lap(-1);
  assert.equal(race.laps, 0);
  r = press(a);
  assert.equal(race.state, 'done'); assert.ok(race.time > 0); assert.equal(r.out[0].msg.event, 'finish');
  // next run: the runner stops early -> cancelled
  press(a); assert.equal(race.state, 'running');
  press(a); assert.equal(race.state, 'cancelled');
  // a run whose runner leaves can be called off by anyone
  press(a); assert.equal(race.state, 'running');
  a.inactive = true;
  press(b); assert.equal(race.state, 'cancelled');
  a.inactive = false;
  // ...as can one that's gone on for over 3 minutes
  press(a); now += R.RACE_TIMEOUT_MS + 1000;
  press(b); assert.equal(race.state, 'cancelled');
  // too far from the button: nothing happens
  pose(b, at(R.MACHINE_ANGLE + 1)); press(b); assert.equal(race.state, 'cancelled');
});

test('voice: setup notes go only to the named player, big offers allowed, others still capped', async () => {
  const {room, sockets} = makeRoom();
  await join(room, S1); await join(room, S2);
  const [a, b] = sockets;
  const idA = a.messages()[0].id, idB = b.messages()[0].id;
  const offer = {type: 'rtc', to: idB, d: {sdp: {type: 'offer', sdp: 'v=0 ' + 'x'.repeat(6000)}}};
  await room.webSocketMessage(a, JSON.stringify(offer));
  const got = b.messages().find(m => m.type === 'rtc');
  assert.equal(got.from, idA); assert.equal(got.d.sdp.type, 'offer');
  assert.equal(a.messages().filter(m => m.type === 'rtc').length, 0, 'not echoed to the sender');
  // a big non-voice message is still refused
  await room.webSocketMessage(a, JSON.stringify({type: 'chat', text: 'y'.repeat(6000)}));
  assert.equal(a.closed?.reason, 'Message too large');
});

test('bucket: scrubbing splats, tags and the level graffiti, only with the bucket in hand', async () => {
  const {handleMessage, newPlayer, freshMarks, marksMessage, validMarks, sprayId} = await import('../room.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const items = Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, {...s, holder: null, on: false}]));
  const marks = freshMarks();
  marks.splats.push({p: [1, 1, 1], n: [1, 0, 0], c: 5, s: 4242, at: Date.now()});
  const tag = {p: [2, 1.5, 3], n: [0, 0, 1], up: [0, 1, 0], piece: 'tag_ruse', size: 1};
  marks.sprays.push(tag);
  const a = newPlayer('aaa', 0); a.pose = {x: 0, y: 1.45, z: 0, yaw: 0, pitch: 0};
  const room = {items, marks, race: null, players: () => [a]};
  let now = 10_000;
  const erase = (kind, id) => { now += 200; return handleMessage(a, JSON.stringify({type: 'erase', kind, id}), now, room); };
  assert.equal(erase('splat', '4242').out.length, 0, 'no bucket, no scrubbing');
  const bucket = ITEM_SPAWNS.find(s => s.type === 'bucket');
  items[bucket.id].holder = 'aaa';
  assert.equal(erase('splat', '4242').out[0].msg.type, 'erase');
  assert.equal(marks.splats.length, 0);
  erase('spray', sprayId(tag)); assert.equal(marks.sprays.length, 0);
  erase('baked', 'graffiti_0:1.00,2.00,3.00'); erase('baked', 'graffiti_0:1.00,2.00,3.00');
  assert.deepEqual(marks.erased, ['graffiti_0:1.00,2.00,3.00']);
  assert.deepEqual(marksMessage(validMarks(structuredClone(marks))).erased, ['graffiti_0:1.00,2.00,3.00'], 'kept and sent to newcomers');
  assert.equal(erase('nonsense', 'x').out.length, 0);
});

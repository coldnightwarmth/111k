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
  ctx.storage.get = async k => (Array.isArray(k) ? new Map(k.map(x => [x, store.get(x)])) : store.get(k));
  ctx.storage.put = async (k, v) => { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) store.set(kk, structuredClone(vv)); else store.set(k, structuredClone(v)); };
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

test('a refresh keeps what you hold (not the crown); items go home if the last player never comes back', async () => {
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {room, sockets, ctx} = makeRoom();
  const store = new Map();
  ctx.storage.get = async k => (Array.isArray(k) ? new Map(k.map(x => [x, store.get(x)])) : store.get(k));
  ctx.storage.put = async (k, v) => { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) store.set(kk, structuredClone(vv)); else store.set(k, structuredClone(v)); };
  ctx.storage.delete = async k => store.delete(k);
  await join(room, S1);
  const spawn = ITEM_SPAWNS.find(s => s.type !== 'crown'), crown = ITEM_SPAWNS.find(s => s.type === 'crown');
  const take = async (ws, s) => {
    await room.webSocketMessage(ws, JSON.stringify({type: 'pose', pose: {...pose, x: s.x, z: s.z}}));
    await new Promise(r => setTimeout(r, 1100));
    await room.webSocketMessage(ws, JSON.stringify({type: 'pickup', id: s.id}));
  };
  await take(sockets[0], crown); await room.webSocketMessage(sockets[0], JSON.stringify({type: 'koth'}));   // on the head, hands free
  await take(sockets[0], spawn);
  const id = sockets[0].messages()[0].id;
  assert.equal(store.get('items')[spawn.id].holder, id);
  assert.equal(store.get('items')[crown.id].holder, id);
  // refresh: the crown comes off straight away, the rest is still theirs when they're back
  sockets[0].closed = {code: 1001};
  await room.webSocketClose(sockets[0]);
  assert.equal(store.get('items')[crown.id].holder, null);
  assert.equal(store.get('items')[spawn.id].holder, id);
  await join(room, S1);
  assert.equal(sockets[1].messages().find(m => m.type === 'state').items.find(i => i.id === spawn.id).holder, id);
  await room.alarm();
  assert.equal(store.get('items')[spawn.id].holder, id, 'still held after the alarm');
  // they leave for good: once the alarm comes round, it all goes home
  sockets[1].closed = {code: 1000};
  await room.webSocketClose(sockets[1]);
  assert.equal(store.get('items')[spawn.id].holder, id);
  await room.alarm();
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

test('paintball and spray: holder checks, marks kept and sent to newcomers, hits keep items', async () => {
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {room, sockets, ctx} = makeRoom();
  const store = new Map();
  ctx.storage.get = async k => (Array.isArray(k) ? new Map(k.map(x => [x, store.get(x)])) : store.get(k));
  ctx.storage.put = async (k, v) => { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) store.set(kk, structuredClone(vv)); else store.set(k, structuredClone(v)); };
  await join(room, S1); await join(room, S2);
  const [a, b] = sockets;
  const idA = a.messages()[0].id, idB = b.messages()[0].id;
  const gun = ITEM_SPAWNS.find(s => s.type === 'paintball'), torch = ITEM_SPAWNS.find(s => s.type === 'flashlight');
  const can = ITEM_SPAWNS.find(s => s.type === 'spray');
  const shot = {type: 'shoot', o: [gun.x, 1.2, gun.z], v: [-30, 1, 0], c: 0xff00ff, s: 77, t: .3, hit: {p: [gun.x - 9, 1.2, gun.z], n: [1, 0, 0]}};
  // not holding the paintball gun: ignored
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
  // b holds the torch; a paints b: b keeps it (just gets knocked back), and the mark goes on b, not the wall
  await room.webSocketMessage(b, JSON.stringify({type: 'pose', pose: {...pose, x: torch.x, z: torch.z}}));
  await room.webSocketMessage(b, JSON.stringify({type: 'pickup', id: torch.id}));
  await new Promise(r => setTimeout(r, 200));
  await room.webSocketMessage(a, JSON.stringify({...shot, target: idB, local: {p: [0, 1, .2], n: [0, 0, 1]}}));
  const hit = b.messages().filter(m => m.type === 'shot').at(-1);
  assert.equal(hit.target, idB); assert.equal(hit.hit, null);
  assert.equal(room.items[torch.id].holder, b.messages()[0].id);
  assert.equal(room.marks.splats.length, 1);
  await room.webSocketMessage(b, JSON.stringify({type: 'drop', id: torch.id, x: torch.x, z: torch.z}));
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
  assert.equal(lights.length, 21); assert.equal(lights.filter(s => s.on).length, 6);
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

test('lap timer: a lap counts as you cross the line just before the machine, anywhere across the tunnel, at any speed', async () => {
  const {handleMessage, newPlayer} = await import('../room.js');
  const R = await import('../../src/race.js');
  const race = R.freshRace();
  const a = newPlayer('aaa', 0);
  const room = {items: {}, marks: null, race, players: () => [a]};
  let now = 1_000_000;
  const pose = (where, dt) => { now += dt; return handleMessage(a, JSON.stringify({type: 'pose', pose: {x: where.x, y: 1.45, z: where.z, yaw: 0, pitch: 0}}), now, room); };
  pose(R.loopPoint(R.MACHINE_ANGLE, 2.1), 100);
  now += 500; handleMessage(a, JSON.stringify({type: 'button'}), now, room);
  const start = now;
  // flat out along the far (inner) wall, 5 m from the machine at the closest, a pose every 0.5 rad
  // (19 m): the old 'near the machine' check never saw these laps until the next one, then gave two at once
  const step = .5, dt = 1000;
  const laps = [];
  let ang = 0;
  for (let k = 0; k < 40 && race.laps > 0; k++) {
    ang += step;
    const r = pose(R.loopPoint(R.MACHINE_ANGLE + ang, -2.4), dt);
    if (r.out.some(o => o.msg.type === 'race' && o.msg.event === 'lap')) laps.push({k, split: race.splits.at(-1)});
  }
  assert.equal(race.laps, 0, 'all three laps');
  // each on the pose that crossed the line, at the time it crossed (between the two poses)
  laps.forEach(({k, split}, i) => {
    const lapAng = 2 * Math.PI * (i + 1) - R.LAP_LINE;   // (the line's LAP_LINE short of the machine)
    assert.equal(k, Math.ceil(lapAng / step) - 1, `lap ${i + 1} on the pose that crossed`);
    assert.ok(Math.abs(split - lapAng / step * dt) < 25, `lap ${i + 1} split ${split} ≈ ${lapAng / step * dt}`);
  });
  assert.equal(new Set(race.splits).size, 3, 'no two laps at once');
  assert.ok(start > 0);
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

test('king of the hill: start with the crown, grace, knocked off by punch and paintball, cumulative times, a winner', async () => {
  const {handleMessage, newPlayer, kothTick, kothNext} = await import('../room.js');
  const K = await import('../../src/koth.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const items = Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, {...s, holder: null, on: false}]));
  const crown = items.cr1, gun = items.pb1;
  assert.equal(crown.type, 'crown');
  const koth = K.freshKoth();
  const a = newPlayer('aaa', 0), b = newPlayer('bbb', 0);
  a.name = 'alice'; b.name = 'bob';
  const players = [a, b];
  const room = {items, marks: null, race: null, koth, players: () => players};
  let now = 1_000_000;
  const send = (p, m, dt = 300) => { now += dt; p.lastPunch = 0; p.lastShot = 0; return handleMessage(p, JSON.stringify(m), now, room); };
  const tick = dt => { now += dt; return kothTick(room, now).out.map(o => o.msg); };
  const events = r => r.out.filter(o => o.msg.type === 'koth').map(o => o.msg.event);
  a.pose = {x: crown.x, y: 1.45, z: crown.z, yaw: 0, pitch: 0, g: 0};
  b.pose = {x: crown.x + .5, y: 1.45, z: crown.z, yaw: 0, pitch: 0, g: 0};

  assert.equal(send(a, {type: 'koth'}).out.length, 0, 'no crown in hand, no game');
  send(a, {type: 'pickup', id: 'cr1'});
  assert.equal(crown.holder, 'aaa'); assert.equal(crown.on, false, 'picked up normally: in the hand');
  let r = send(a, {type: 'koth'});
  assert.deepEqual(events(r), ['start']);
  assert.equal(koth.state, 'grace'); assert.equal(crown.on, true); assert.equal(koth.wearer, 'aaa');
  r = send(a, {type: 'drop', id: 'cr1', x: crown.x, z: crown.z});
  assert.equal(crown.holder, 'aaa', 'no taking it off mid-game');
  assert.deepEqual(r.out.map(o => [o.to, o.msg.type, o.msg.refused]), [['self', 'item', true]], 'told so (it was shown off already)');
  assert.equal(r.out[0].msg.item.on, true);
  // someone else's pickup of what she has: turned down, and they're told where it really is
  r = send(b, {type: 'pickup', id: 'cr1'});
  assert.equal(crown.holder, 'aaa');
  assert.deepEqual(r.out.map(o => [o.to, o.msg.refused, o.msg.item.holder]), [['self', true, 'aaa']]);
  // hands are free while it's on your head
  items.pb1.holder = null; a.pose.x = gun.x; a.pose.z = gun.z; b.pose.x = gun.x + .5; b.pose.z = gun.z;
  send(a, {type: 'pickup', id: 'pb1'});
  assert.equal(gun.holder, 'aaa');
  assert.ok(kothNext(koth) <= koth.graceEnds);
  assert.deepEqual(tick(K.KOTH_GRACE_MS).map(m => m.event), ['grace']);
  assert.equal(koth.state, 'running');
  // 5 s on, then punched: it comes off with a pop, and the loss says how long they've had it
  now = koth.graceEnds + 5000;
  r = send(b, {type: 'punch', target: 'aaa'}, 0);
  const lost = r.out.find(o => o.msg.type === 'koth' && o.msg.event === 'lost').msg;
  assert.equal(lost.by, 'aaa'); assert.equal(lost.time, 5000); assert.equal(lost.how, 'punch');
  assert.equal(lost.from, 'bbb'); assert.equal(lost.fromName, 'bob');
  // the crown and the paintball gun she was holding land apart, both with a fall
  assert.ok(Math.hypot(crown.x - gun.x, crown.z - gun.z) > .7, 'spread apart');
  assert.equal(r.out.filter(o => o.msg.type === 'item' && o.msg.fall).length, 2);
  assert.equal(crown.holder, null); assert.equal(crown.on, false);
  assert.ok(r.out.find(o => o.msg.type === 'item' && o.msg.item.id === 'cr1').msg.fall, 'pops off the head');
  // picking it up mid-game puts it straight on, even with full hands
  items.fl1.holder = 'bbb';
  b.pose.x = crown.x; b.pose.z = crown.z;
  r = send(b, {type: 'pickup', id: 'cr1'}, 1000);
  assert.equal(crown.holder, 'bbb'); assert.equal(crown.on, true); assert.equal(koth.wearer, 'bbb');
  assert.deepEqual(events(r), ['take']);
  // a paintball knocks it off when it lands, not when it's fired
  a.pose.x = b.pose.x + 5; a.pose.z = b.pose.z; gun.holder = "aaa";   // (the punch knocked the gun out of her hand too)
  r = send(a, {type: 'shoot', o: [a.pose.x, 1.3, a.pose.z], v: [-20, 0, 0], c: 0xff0000, s: 1, t: .25, target: 'bbb', local: {p: [0, 1, 0], n: [1, 0, 0]}}, 2000);
  assert.ok(r.out.some(o => o.msg.type === "shot"), JSON.stringify(r.out)); assert.equal(koth.hits.length, 1);
  assert.equal(crown.holder, 'bbb', 'still on while the ball is in the air');
  // the first one only counts; it takes a second
  let msgs = tick(300);
  assert.ok(msgs.some(m => m.event === 'struck' && m.n === 1 && m.from === 'aaa'));
  assert.equal(crown.on, true, 'one hit: still on');
  r = send(a, {type: 'shoot', o: [a.pose.x, 1.3, a.pose.z], v: [-20, 0, 0], c: 0xff0000, s: 2, t: .25, target: 'bbb', local: {p: [0, 1, 0], n: [1, 0, 0]}}, 200);
  assert.equal(crown.holder, 'bbb', 'still on while the second is in the air');
  msgs = tick(300);
  const shot = msgs.find(m => m.event === 'lost');
  assert.equal(shot.how, 'paintball'); assert.equal(shot.by, 'bbb'); assert.equal(shot.from, 'aaa');
  assert.equal(shot.time, 2750, 'banked up to when the second ball landed');
  assert.equal(crown.on, false);
  // alice takes it back and her time carries on from where it was
  a.pose.x = crown.x; a.pose.z = crown.z; gun.holder = null;
  send(a, {type: 'pickup', id: 'cr1'}, 100);
  assert.equal(koth.wearer, 'aaa');
  assert.equal(K.kothTime(koth, 'aaa', now + 1000), 6000);
  const due = kothNext(koth);
  assert.equal(due, now + 55000);
  assert.equal(tick(54000).length, 0);
  const win = tick(1000);
  assert.deepEqual(win.map(m => m.event), ['win']);
  assert.equal(win[0].by, 'aaa'); assert.equal(win[0].byName, 'alice');
  assert.equal(koth.state, 'done'); assert.equal(crown.on, true, 'the winner keeps it on');
  assert.equal(kothNext(koth), null);
  // after the game the winner can take it off and start another
  send(a, {type: 'drop', id: 'cr1', x: a.pose.x, z: a.pose.z});
  assert.equal(crown.holder, null);
  send(a, {type: 'pickup', id: 'cr1'});
  assert.equal(crown.on, false);
  assert.deepEqual(events(send(a, {type: 'koth'})), ['start']);
  assert.deepEqual(koth.times, {}, 'a new game starts everyone from zero');
  // left lying too long, the game is called off
  items.pb1.holder = 'bbb'; b.pose.x = a.pose.x + .5; b.pose.z = a.pose.z;
  send(b, {type: 'punch', target: 'aaa'});
  const off = tick(K.KOTH_UNCLAIMED_MS);
  assert.deepEqual(off.filter(m => m.type === 'koth').map(m => m.event), ['grace', 'cancel']);
  assert.equal(koth.state, 'cancelled');
  const home = ITEM_SPAWNS.find(s => s.id === 'cr1');
  assert.deepEqual([crown.x, crown.y, crown.z, crown.holder, crown.on], [home.x, home.y, home.z, null, false], 'the crown goes home');
  assert.ok(off.some(m => m.type === 'item' && m.item.id === 'cr1'));
});

test('leaving: what you held drops where you were if anyone else is here, otherwise goes home (a crown mid-game always drops)', async () => {
  const {letGo, newPlayer} = await import('../room.js');
  const K = await import('../../src/koth.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const fresh = () => Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, {...s, holder: null, on: s.on === true}]));
  const a = newPlayer('aaa', 0); a.pose = {x: 10, y: 1.45, z: 5, yaw: 0, pitch: 0, g: 0};
  let items = fresh(); items.fl1.holder = 'aaa';
  letGo(items, a, {others: true});
  assert.deepEqual([items.fl1.x, items.fl1.z, items.fl1.holder], [10, 5, null], 'dropped where they stood');
  items = fresh(); items.fl1.holder = 'aaa';
  const spawn = ITEM_SPAWNS.find(s => s.id === 'fl1');
  letGo(items, a, {others: false});
  assert.deepEqual([items.fl1.x, items.fl1.z, items.fl1.holder], [spawn.x, spawn.z, null], 'nobody else here: back home');
  items = fresh(); items.cr1.holder = 'aaa'; items.cr1.on = true;
  letGo(items, a, {others: false, koth: {...K.freshKoth(), state: 'running'}});
  assert.deepEqual([items.cr1.x, items.cr1.z, items.cr1.on], [10, 5, false], 'a crown mid-game drops for the game to go on');
  items = fresh(); items.cr1.holder = 'aaa'; items.cr1.on = true;
  letGo(items, a, {others: false, koth: {...K.freshKoth(), state: 'done'}});
  assert.equal(items.cr1.x, ITEM_SPAWNS.find(s => s.id === 'cr1').x, 'after a game it goes home like anything else');
});

test('paintings: hung, leant and laid with a tilt, fall flat when let go, and paint on them kept in their own space', async () => {
  const {handleMessage, newPlayer, freshMarks, sprayId, splatId, releaseItems} = await import('../room.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {cleanItem} = await import('../../src/protocol.js');
  const items = Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, {...s, holder: null, on: false}]));
  const pt = items.pt1;
  assert.equal(pt.type, 'painting');
  assert.deepEqual([cleanItem(pt).tilt, cleanItem(pt).roll, cleanItem(pt).art], [0, 0, 1]);
  const marks = freshMarks();
  const a = newPlayer('aaa', 0); a.pose = {x: pt.x, y: 1.45, z: pt.z + 1, yaw: 0, pitch: 0, g: 0};
  const room = {items, marks, race: null, players: () => [a]};
  let now = 10_000;
  const send = m => { now += 400; a.lastShot = a.lastSpray = 0; return handleMessage(a, JSON.stringify(m), now, room); };
  send({type: 'pickup', id: 'pt1'});
  assert.equal(pt.holder, 'aaa');
  send({type: 'drop', id: 'pt1', x: pt.x + 1, y: .5, z: pt.z + .3, yaw: 1, tilt: -1.4, roll: 2.5});
  assert.deepEqual([pt.holder, pt.tilt, pt.roll], [null, -1.4, 2.5], 'laid on a slope, turned in its plane');
  send({type: 'pickup', id: 'pt1'});
  send({type: 'drop', id: 'pt1', x: pt.x, y: .5, z: pt.z, yaw: 1, tilt: -.2});
  assert.deepEqual([pt.holder, pt.tilt, pt.yaw, pt.roll], [null, -.2, 1, 0], 'leant on a wall');
  // a tag across the painting and the wall: the wall part remembers the painting's shape, the painting keeps its part
  items.sp1.holder = 'aaa';
  const tag = {p: [pt.x, 1.2, pt.z + .1], n: [0, 0, 1], up: [0, 1, 0], piece: 'tag_ruse', size: 1, occ: [[pt.x, pt.y, pt.z, 1, -.2, 1]]};
  const r = send({type: 'spray', ...tag, parts: [{...tag, occ: undefined, p: [.1, .2, .04], pi: 'pt1'}, {...tag, p: [0, 0, 0], pi: 'pt999'}]});
  const msg = r.out.find(o => o.msg.type === 'spray').msg;
  assert.equal(msg.parts.length, 1, 'only parts on paintings that exist');
  assert.deepEqual(msg.mark.occ, [[pt.x, pt.y, pt.z, 1, -.2, 1]]);
  assert.equal(marks.sprays.length, 2);
  assert.notEqual(sprayId(marks.sprays[0]), sprayId(marks.sprays[1]));
  // scrubbing the part on the painting leaves the wall's part
  items.sp1.holder = null; items.bk1.holder = 'aaa';
  send({type: 'erase', kind: 'spray', id: sprayId(msg.parts[0])});
  assert.deepEqual(marks.sprays.map(s => s.pi || 'wall'), ['wall']);
  // a paintball's splat on it, the same way
  items.bk1.holder = null; items.pb1.holder = 'aaa';
  send({type: 'shoot', o: [a.pose.x, 1.3, a.pose.z], v: [0, 0, -10], c: 0xff0000, s: 77, t: .2,
    hit: {p: [pt.x, 1.2, pt.z + .1], n: [0, 0, 1], occ: [[pt.x, pt.y, pt.z, 1, -.2, 1]]}, parts: [{p: [0, 0, .035], n: [0, 0, 1], pi: 'pt1'}]});
  assert.deepEqual(marks.splats.map(splatId), ['77', '77@pt1']);
  // knocked out of your hands it lands flat
  items.pb1.holder = null; pt.holder = 'aaa';
  releaseItems(items, a);
  assert.equal(pt.tilt, -Math.PI / 2);
});

test('paintings: hung on a nail or settled by physics, with the tumble passed on; others knocked about near you', async () => {
  const {handleMessage, newPlayer, freshMarks} = await import('../room.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const items = Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, {...s, holder: null, on: false}]));
  const pt = items.pt1, other = items.pt2;
  const a = newPlayer('aaa', 0); a.pose = {x: pt.x, y: 1.45, z: pt.z + 1, yaw: 0, pitch: 0, g: 0};
  const room = {items, marks: freshMarks(), race: null, players: () => [a]};
  let now = 10_000;
  const send = m => { now += 400; return handleMessage(a, JSON.stringify(m), now, room); };
  send({type: 'pickup', id: 'pt1'});
  // hung: on its nail
  let r = send({type: 'drop', id: 'pt1', x: pt.x, y: 1.5, z: pt.z, yaw: 0, tilt: 0, roll: 0, hung: true});
  assert.equal(pt.hung, true);
  assert.equal(r.out[0].msg.item.hung, true);
  // settled: the path goes out with it, ending where it rests
  send({type: 'pickup', id: 'pt1'});
  const path = [[pt.x, 1.2, pt.z, 0, 0, 0, 1], [pt.x, .6, pt.z, -.5, 0, 0, .866], [pt.x + .1, .03, pt.z, -.7071, 0, 0, .7071]];
  r = send({type: 'drop', id: 'pt1', x: pt.x + .1, y: .03, z: pt.z, yaw: 0, tilt: -1.571, roll: 0, path});
  assert.equal(pt.hung, false);
  assert.deepEqual(r.out[0].msg.path, path);
  assert.equal(r.out[0].msg.fall, undefined);
  // a path that doesn't end where it rests, or jumps about, isn't passed on
  send({type: 'pickup', id: 'pt1'});
  r = send({type: 'drop', id: 'pt1', x: pt.x + 1, y: .03, z: pt.z, yaw: 0, tilt: -1.571, roll: 0, path});
  assert.equal(r.out[0].msg.path, undefined);
  send({type: 'pickup', id: 'pt1'});
  r = send({type: 'drop', id: 'pt1', x: pt.x + .1, y: .03, z: pt.z, yaw: 0, tilt: -1.571, roll: 0, path: [path[0], [pt.x + 5, 0, pt.z, 0, 0, 0, 1], path[2]]});
  assert.equal(r.out[0].msg.path, undefined);
  // knocked: another painting near you moves, and stops being on a nail
  Object.assign(other, {x: pt.x + .5, y: .03, z: pt.z, hung: true});
  r = send({type: 'settle', items: [{id: other.id, x: pt.x + .9, y: .01, z: pt.z, yaw: .5, tilt: -1.571, roll: 0,
    path: [[pt.x + .5, .03, pt.z, 0, 0, 0, 1], [pt.x + .9, .01, pt.z, 0, 0, 0, 1]]}]});
  assert.deepEqual([other.x, other.y, other.yaw, other.hung], [pt.x + .9, .01, .5, false].map((v, i) => (i < 3 ? Math.round(v * 1000) / 1000 : v)));
  assert.equal(r.out.length, 1);
  assert.ok(r.out[0].msg.path);
  // but not one far away, one in someone's hands, or one sent miles from where it was
  const far = items.pt3, before = {...far};
  r = send({type: 'settle', items: [{id: far.id, x: far.x, y: far.y, z: far.z, yaw: 1, tilt: 0, roll: 0}]});
  assert.equal(far.yaw, before.yaw);
  other.holder = 'bbb';
  r = send({type: 'settle', items: [{id: other.id, x: pt.x, y: .01, z: pt.z, yaw: 0, tilt: 0, roll: 0}]});
  assert.equal(other.x, Math.round((pt.x + .9) * 1000) / 1000);
  other.holder = null;
  r = send({type: 'settle', items: [{id: other.id, x: pt.x + 7, y: .01, z: pt.z, yaw: 0, tilt: 0, roll: 0}]});
  assert.equal(r.out.length, 0);
  // a pile coming down: a message well past the usual size is fine (a tower's tumbles), within reason
  const long = Array.from({length: 60}, (_, i) => [pt.x + .9, .5 - i * .008, pt.z, 0, 0, 0, 1]);
  r = send({type: 'settle', items: [{id: other.id, x: pt.x + .9, y: long.at(-1)[1], z: pt.z, yaw: 0, tilt: 0, roll: 0, path: long}]});
  assert.ok(!r.close); assert.equal(r.out.length, 1); assert.ok(r.out[0].msg.path);
  r = send({type: 'settle', items: [{id: other.id, x: pt.x, y: .01, z: pt.z, yaw: 0, tilt: 0, roll: 0, junk: 'x'.repeat(20000)}]});
  assert.ok(r.close);
  // and only so many a second
  now += 2000;
  let through = 0;
  for (let i = 0; i < 20; i++) if (handleMessage(a, JSON.stringify({type: 'settle', items: [{id: other.id, x: pt.x, y: .01, z: pt.z, yaw: i / 100, tilt: 0, roll: 0}]}), now, room).out.length) through++;
  assert.equal(through, 12);
  // not a flashlight either
  r = send({type: 'settle', items: [{id: 'fl1', x: items.fl1.x, y: 1, z: items.fl1.z, yaw: 0, tilt: 0, roll: 0}]});
  assert.equal(r.out.length, 0);
});

test('emote settings: saved from /anim, cleaned, sent to everyone here and to newcomers', async () => {
  const {room, sockets, ctx} = makeRoom();
  const store = new Map();
  ctx.storage.get = async k => (Array.isArray(k) ? new Map(k.map(x => [x, store.get(x)])) : store.get(k));
  ctx.storage.put = async (k, v) => { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) store.set(kk, structuredClone(vv)); else store.set(k, structuredClone(v)); };
  await join(room, S1);
  const first = sockets[0].messages().find(m => m.type === 'emotes');
  assert.ok(first && Array.isArray(first.config.off), 'a newcomer gets the settings');
  const body = JSON.stringify({variant: {wave: 'redo', groove: 'redo', nope: 'redo', dab: 'sideways'}, off: ['tpose', 'tpose', 'bogus']});
  const res = await room.fetch(new Request('https://room/emotes', {method: 'POST', body}));
  const saved = await res.json();
  assert.deepEqual(saved, {variant: {wave: 'redo'}, off: ['tpose']});   // only originals have versions; unknown ids go
  assert.deepEqual(store.get('emotes'), saved);
  const pushed = sockets[0].messages().filter(m => m.type === 'emotes').at(-1);
  assert.deepEqual(pushed.config, saved);
  assert.deepEqual(await (await room.fetch(new Request('https://room/emotes'))).json(), saved);
  await join(room, S2);
  assert.deepEqual(sockets[1].messages().find(m => m.type === 'emotes').config, saved);
});

test('graffiti review: saved from /graffiti, cleaned, removed pieces sent to everyone here and to newcomers', async () => {
  const {room, sockets, ctx} = makeRoom();
  const store = new Map();
  ctx.storage.get = async k => (Array.isArray(k) ? new Map(k.map(x => [x, store.get(x)])) : store.get(k));
  ctx.storage.put = async (k, v) => { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) store.set(kk, structuredClone(vv)); else store.set(k, structuredClone(v)); };
  await join(room, S1);
  assert.deepEqual(sockets[0].messages().find(m => m.type === 'graffiti').hidden, [], 'nothing is removed to start with');
  const body = JSON.stringify({pieces: {tu_loop: {s: 'remove'}, pl_walmart: {s: 'kern', note: 'R and T touch'}, 'bad name!': {s: 'remove'},
    tag_nova: {s: 'sideways'}, sc_greed: {s: 'good', note: '   '}, pc_waxy: {}}});
  const saved = await (await room.fetch(new Request('https://room/graffiti', {method: 'POST', body}))).json();
  assert.deepEqual(saved.pieces, {tu_loop: {s: 'remove'}, pl_walmart: {s: 'kern', note: 'R and T touch'}, sc_greed: {s: 'good'}});
  assert.ok(saved.updated > 0);
  assert.deepEqual(store.get('review'), saved);
  assert.deepEqual(sockets[0].messages().filter(m => m.type === 'graffiti').at(-1).hidden, ['tu_loop']);
  assert.deepEqual(await (await room.fetch(new Request('https://room/graffiti'))).json(), saved);
  await join(room, S2);
  assert.deepEqual(sockets[1].messages().find(m => m.type === 'graffiti').hidden, ['tu_loop']);
  const big = await room.fetch(new Request('https://room/graffiti', {method: 'POST', body: 'x'.repeat(130000)}));
  assert.equal(big.status, 413);
});

test('client errors: logged by kind with a count, a few per player, read at /errors', async () => {
  const {handleMessage, newPlayer, logError, ERROR_LOG_MAX} = await import('../room.js');
  const p = newPlayer('aaa', 0);
  let list = [];
  const send = m => { const r = handleMessage(p, JSON.stringify({type: 'clientError', ...m}), 1000, {items: {}, players: () => [p]}); if (r.report) list = logError(list, r.report); return r; };
  send({msg: 'boom', where: 'Error: boom\n  at frame (main.js:1:2)', ua: 'test', page: '/'});
  send({msg: 'boom', where: 'Error: boom\n  at frame (main.js:1:2)', ua: 'test', page: '/'});
  send({msg: 'x'.repeat(2000), where: 42, ua: null});
  assert.equal(list.length, 2);
  assert.equal(list.find(e => e.msg === 'boom').count, 2);
  assert.equal(list.find(e => e.msg !== 'boom').msg.length, 300, 'trimmed');
  for (let i = 0; i < 20; i++) send({msg: `m${i}`, where: ''});
  assert.equal(list.length, 11, 'no more than a dozen reports from one player (two of them the same kind)');
  for (let i = 0; i < ERROR_LOG_MAX + 10; i++) list = logError(list, {msg: `k${i}`, where: '', ua: '', page: '', at: i});
  assert.equal(list.length, ERROR_LOG_MAX);
  const {room} = makeRoom();
  const res = await room.fetch(new Request('https://room/errors'));
  assert.deepEqual(await res.json(), []);
});

test('a new SCENE starts the room over once: items home, no tags or paint, nothing scrubbed; the review stays', async () => {
  const {SCENE} = await import('../worker.js');
  const {freshItems} = await import('../room.js');
  const store = s => {
    const m = new Map(Object.entries(s));
    return {alarm: null, setAlarm(t) { this.alarm = t; }, getAlarm() { return this.alarm; },
      async get(k) { return structuredClone(m.get(k)); },
      async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, structuredClone(b)); else m.set(k, structuredClone(v)); },
      async delete(k) { m.delete(k); }, m};
  };
  const lived = () => {
    const items = freshItems(); items.pt1 = {...items.pt1, x: 1, y: .03, z: 2, tilt: -1.571, hung: false};
    return {items, review: {hidden: ['some_piece']},
      marks: {splats: [], sprays: [{p: [1, 1, 1], n: [0, 0, 1], up: [0, 1, 0], piece: 'tag_111k_big', size: 1}], erased: ['baked_1']}};
  };
  const room = (storage) => {
    const sockets = [];
    const ctx = {getWebSockets: () => sockets.filter(s => !s.closed), acceptWebSocket: ws => sockets.push(ws), setWebSocketAutoResponse() {}, storage};
    return {room: new Room(ctx), sockets};
  };
  // an older scene: starts over
  const old = store({...lived(), scene: SCENE - 1});
  let r = room(old);
  await join(r.room, S1);
  let msgs = r.sockets[0].messages();
  const snap = msgs.find(m => m.type === 'state'), marks = msgs.find(m => m.type === 'marks');
  const pt1 = (snap.items || []).find(i => i.id === 'pt1');
  assert.deepEqual([pt1.x, pt1.y], [freshItems().pt1.x, freshItems().pt1.y], 'the painting back where it started');
  assert.deepEqual([marks.sprays.length, marks.splats.length, marks.erased.length], [0, 0, 0], 'no tags, no paint, nothing scrubbed');
  assert.equal(old.m.get('scene'), SCENE);
  assert.deepEqual(old.m.get('review'), {hidden: ['some_piece']}, 'the graffiti review stays');
  // the current scene: left as it is
  const now = store({...lived(), scene: SCENE});
  r = room(now);
  await join(r.room, S2);
  msgs = r.sockets[0].messages();
  assert.equal(msgs.find(m => m.type === 'state').items.find(i => i.id === 'pt1').x, 1);
  assert.equal(msgs.find(m => m.type === 'marks').sprays.length, 1);
});

test('paintball hopper: a ball a shot, nothing when it is empty, a reload fills it after a moment', async () => {
  const {handleMessage, newPlayer, freshMarks} = await import('../room.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {MAG_SIZE, RELOAD_MS, SHOT_INTERVAL_MS, cleanItem} = await import('../../src/protocol.js');
  const items = Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, {...s, holder: null, on: false}]));
  const gun = Object.values(items).find(it => it.type === 'paintball');
  const a = newPlayer('aaa', 0); a.pose = {x: gun.x, y: 1.45, z: gun.z, yaw: 0, pitch: 0, g: 0};
  const room = {items, marks: freshMarks(), race: null, players: () => [a]};
  let now = 10_000;
  const send = (m, dt = SHOT_INTERVAL_MS + 1) => { now += dt; return handleMessage(a, JSON.stringify(m), now, room); };
  send({type: 'pickup', id: gun.id});
  assert.equal(cleanItem(gun).ammo, MAG_SIZE);
  const shot = {type: 'shoot', o: [gun.x, 1.2, gun.z], v: [-30, 1, 0], c: 0xff00ff, s: 7, t: .3};
  // nothing to reload while it's full
  assert.equal(send({type: 'reload'}).out.length, 0);
  let fired = 0;
  for (let i = 0; i < MAG_SIZE + 5; i++) if (send(shot).out.some(o => o.msg.type === 'shot')) fired++;
  assert.equal(fired, MAG_SIZE); assert.equal(gun.ammo, 0);
  const r = send({type: 'reload'});
  assert.equal(r.out[0].msg.type, 'reload'); assert.equal(r.out[0].msg.from, 'aaa'); assert.equal(gun.ammo, MAG_SIZE);
  assert.equal(send(shot, 200).out.length, 0, 'still reloading');
  assert.ok(send(shot, RELOAD_MS).out.some(o => o.msg.type === 'shot'));
  assert.equal(gun.ammo, MAG_SIZE - 1);
});

test('loop runs: a lap counts at the line just before the machine either way round, and the button counts the last one', async () => {
  const {handleMessage, newPlayer} = await import('../room.js');
  const {loopPoint, MACHINE_ANGLE, BUTTON, RACE_LAPS, freshRace} = await import('../../src/race.js');
  for (const way of [1, -1]) {
    const a = newPlayer('aaa', 0);
    const room = {items: {}, race: freshRace(), players: () => [a]};
    let now = 10_000;
    const at = (ang, off) => { const p = loopPoint(ang, off); a.pose = {x: p.x, y: 1.45, z: p.z, yaw: 0, pitch: 0, g: 0}; };
    const send = m => { now += 700; return handleMessage(a, JSON.stringify(m), now, room); };
    at(MACHINE_ANGLE, 2.2);
    send({type: 'button'});
    assert.equal(room.race.state, 'running');
    // round the far side of the tunnel (well away from the machine), in steps
    const step = .25, lapEvents = [];
    let ang = MACHINE_ANGLE;
    for (let lap = 0; lap < RACE_LAPS; lap++) {
      const end = lap < RACE_LAPS - 1 ? 2 * Math.PI : 2 * Math.PI - .3;   // the last stops at the button, short of the line
      for (let t = step; t <= end + 1e-9; t += step) {
        ang += way * step;
        at(ang, -2.4);
        const r = send({type: 'pose', pose: {...a.pose}});
        for (const o of r.out) if (o.msg.type === 'race' && o.msg.event === 'lap') lapEvents.push(o.msg);
      }
    }
    assert.equal(lapEvents.length, RACE_LAPS - 1, `way ${way}: laps counted at the line`);
    // ...walk up to the button: the line's before it (out of its reach), so the last lap's in by then; pushing it finishes
    for (const short of [.3, .2, .12, .06]) {
      at(MACHINE_ANGLE + way * (2 * Math.PI * RACE_LAPS - short), 2.2);
      for (const o of send({type: 'pose', pose: {...a.pose}}).out) if (o.msg.event === 'lap') lapEvents.push(o.msg);
      if (short === .2) assert.equal(lapEvents.length, RACE_LAPS - 1, `way ${way}: not yet at the line 8 m out`);
    }
    assert.equal(lapEvents.length, RACE_LAPS, `way ${way}: counted at the line`);
    const r = send({type: 'button'});
    assert.ok(r.out.some(o => o.msg.event === 'finish'), `way ${way}: ${JSON.stringify(r.out.map(o => o.msg.event))}`);
    assert.equal(room.race.state, 'done');
  }
});

test('items: a stored set from an older version keeps where things were, adds what is new, drops what is gone', async () => {
  const {validItems} = await import('../room.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const old = Object.fromEntries(ITEM_SPAWNS.slice(0, 50).map(s => [s.id, {...s, holder: null, on: false}]));
  old.pt1 = {...old.pt1, x: 1.234, y: 2, z: 3, hung: false};
  old.zz9 = {id: 'zz9', type: 'spray', x: 0, y: 0, z: 0, yaw: 0, holder: null, on: false};
  const v = validItems(old);
  assert.equal(Object.keys(v).length, ITEM_SPAWNS.length);
  assert.equal(v.pt1.x, 1.234, 'kept where it was left');
  assert.equal(v.zz9, undefined, 'gone from the level, gone');
  const fresh = ITEM_SPAWNS.find(s => s.type === 'marker');
  assert.equal(v[fresh.id].type, 'marker'); assert.equal(v[fresh.id].x, Math.round(fresh.x * 1000) / 1000);
});

test('marker ink: kept as it is drawn, only with a marker, the oldest go, scrubbed off with the sponge, never on players', async () => {
  const {handleMessage, newPlayer, freshMarks, marksMessage} = await import('../room.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {MAX_INK_STROKES} = await import('../../src/protocol.js');
  const items = Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, {...s, holder: null, on: false}]));
  const marker = Object.values(items).find(it => it.type === 'marker'), bucket = Object.values(items).find(it => it.type === 'bucket');
  const id = '0123456789abcdef';
  const a = newPlayer(id, 0); a.pose = {x: marker.x, y: 1.45, z: marker.z, yaw: 0, pitch: 0, g: 0};
  const room = {items, marks: freshMarks(), race: null, players: () => [a]};
  let now = 10_000;
  const send = m => { now += 60; return handleMessage(a, JSON.stringify(m), now, room); };
  const pts = n => Array.from({length: n}, (_, i) => [marker.x + i * .01, 1, marker.z + 1, 0, 0, -1, .5, .5]);
  // no marker in hand: nothing
  assert.equal(send({type: 'ink', id: id + ':1', h: 'w', c: 0xff0000, p: pts(3)}).out.length, 0);
  send({type: 'pickup', id: marker.id});
  let r = send({type: 'ink', id: id + ':1', h: 'w', c: 0xff0000, p: pts(3)});
  assert.equal(r.out[0].msg.type, 'ink'); assert.equal(r.out[0].msg.p.length, 3); assert.ok(r.marksChanged);
  send({type: 'ink', id: id + ':1', h: 'w', c: 0xff0000, p: pts(4)});
  assert.equal(room.marks.ink.length, 1); assert.equal(room.marks.ink[0].pts.length, 7, 'more of the same stroke');
  assert.equal(marksMessage(room.marks).ink.length, 1, 'newcomers get it');
  // someone else's stroke id, a stroke miles away, a bad host: ignored
  assert.equal(send({type: 'ink', id: 'ffffffffffffffff:1', h: 'w', c: 1, p: pts(2)}).out.length, 0);
  assert.equal(send({type: 'ink', id: id + ':2', h: 'w', c: 1, p: [[marker.x + 50, 1, marker.z, 0, 0, 1, 0, 0]]}).out.length, 0);
  assert.equal(send({type: 'ink', id: id + ':2', h: 'zz', c: 1, p: pts(2)}).out.length, 0);
  // on a player: not at all (neither passed on nor kept)
  r = send({type: 'ink', id: id + ':3', h: 'a' + 'aaaaaaaaaaaaaaaa', c: 1, p: [[0, 1, .2, 0, 0, 1, 0, 0]]});
  assert.equal(r.out.length, 0); assert.equal(room.marks.ink.length, 1);
  // too many strokes: some go (trimmed to a little under the limit in one go), and everyone's told
  let erased = 0;
  for (let k = 0; k < MAX_INK_STROKES + 3; k++) { now += 1000; erased += send({type: 'ink', id: `${id}:s${k}`, h: 'w', c: 1, p: pts(1)}).out.filter(o => o.msg.type === 'erase').length; }
  assert.ok(room.marks.ink.length <= MAX_INK_STROKES && room.marks.ink.length >= MAX_INK_STROKES * .98 - 1); assert.ok(erased >= 4);
  // the sponge scrubs one off
  send({type: 'drop', id: marker.id, x: a.pose.x, y: 0, z: a.pose.z});
  a.pose = {...a.pose, x: bucket.x, z: bucket.z}; send({type: 'pickup', id: bucket.id});
  const victim = room.marks.ink[5].id;
  r = send({type: 'erase', kind: 'ink', id: victim});
  assert.equal(r.out[0].msg.kind, 'ink'); assert.ok(!room.marks.ink.some(s => s.id === victim));
});

test('the converter: keypad, a painting in the chamber, convert, busy', async () => {
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {PANEL, standPose} = await import('../../src/converter-spec.js');
  const {room, sockets, ctx} = makeRoom();
  const store = new Map();
  ctx.storage.get = async k => (Array.isArray(k) ? new Map(k.map(x => [x, store.get(x)])) : store.get(k));
  ctx.storage.put = async (k, v) => { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) store.set(kk, structuredClone(vv)); else store.set(k, structuredClone(v)); };
  await join(room, S1); await join(room, S2);
  const [a, b] = sockets;
  assert.equal(a.messages().find(m => m.type === 'keypad').entry, '');
  const at = {...pose, x: PANEL.x, z: PANEL.z, emote: '', emoteTime: 0};
  await room.webSocketMessage(a, JSON.stringify({type: 'pose', pose: at}));
  const key = async k => { await room.webSocketMessage(a, JSON.stringify({type: 'keypad', k})); await new Promise(r => setTimeout(r, 70)); };
  for (const k of ['0', '6', '0', '0', '0', '0', '0', '0', '<']) await key(k);
  // a leading 0 doesn't count, and it stops at six digits
  assert.equal(b.messages().filter(m => m.type === 'keypad').at(-1).entry, '60000');
  // nothing in the chamber: refused
  await room.webSocketMessage(a, JSON.stringify({type: 'convert'}));
  assert.equal(a.messages().filter(m => m.type === 'keypad').at(-1).denied, 'empty');
  // a painting stood in it
  const pt = ITEM_SPAWNS.find(s => s.type === 'painting');
  const items = await room.loadItems();
  Object.assign(items[pt.id], standPose(items[pt.id].art), {holder: null});
  await room.webSocketMessage(a, JSON.stringify({type: 'convert'}));
  const msg = b.messages().filter(m => m.type === 'item').at(-1);
  assert.equal(msg.item.id, pt.id); assert.equal(msg.item.art, 60000); assert.equal(msg.convert.n, 60000);
  assert.equal(store.get('items')[pt.id].art, 60000);
  assert.equal(b.messages().filter(m => m.type === 'keypad').at(-1).entry, '');
  // it can't be taken out while the shutter's down, nor converted again at once
  await room.webSocketMessage(b, JSON.stringify({type: 'pose', pose: {...at, x: msg.item.x, z: msg.item.z}}));
  await room.webSocketMessage(b, JSON.stringify({type: 'pickup', id: pt.id}));
  assert.equal(b.messages().filter(m => m.type === 'item').at(-1).refused, true);
  for (const k of ['1', '2']) await key(k);
  await room.webSocketMessage(a, JSON.stringify({type: 'convert'}));
  assert.equal(a.messages().filter(m => m.type === 'keypad').at(-1).denied, 'busy');
  // too far from the panel: the keypad does nothing
  await room.webSocketMessage(a, JSON.stringify({type: 'pose', pose: {...at, x: at.x + 6}}));
  await new Promise(r => setTimeout(r, 70));
  const before = b.messages().filter(m => m.type === 'keypad').length;
  await room.webSocketMessage(a, JSON.stringify({type: 'keypad', k: '3'}));
  assert.equal(b.messages().filter(m => m.type === 'keypad').length, before);
});

test('the collection: numbers across the CDN folders, and each piece its own proportions', async () => {
  const {artUrl, artDims, piece, ART_MAX} = await import('../../src/collection.js');
  assert.equal(ART_MAX, 111111);
  assert.equal(artUrl(1), 'https://cdn.lil.org/nft/111k/paintings/1.png');
  assert.equal(artUrl(56329), 'https://cdn.lil.org/nft/111k/paintings/56329.png');
  assert.equal(artUrl(56330), 'https://cdn.lil.org/nft/111k/3d/1.png');
  assert.equal(artUrl(59330), 'https://cdn.lil.org/nft/111k/animated/1.png');
  assert.equal(artUrl(59751), 'https://cdn.lil.org/nft/111k/eggs/1.png');
  assert.equal(artUrl(111111), 'https://cdn.lil.org/nft/111k/eggs/51361.png');
  assert.equal(piece(111112), null);
  assert.deepEqual(artDims(20637), {w: 932, h: 1111});
  assert.deepEqual(artDims(70000), {w: 1024, h: 1024});
});

test('a mon carries the mana on its square along when it is moved', async () => {
  const {handleMessage, newPlayer, freshMarks} = await import('../room.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const items = Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, {...s, holder: null, on: false}]));
  const mon = items['mon-hatchat'], mana = items['mana-w1'];
  Object.assign(mana, {x: mon.x, y: mon.y, z: mon.z});
  const a = newPlayer('aaa', 0); a.pose = {x: mon.x, y: 1.45, z: mon.z + .5, yaw: 0, pitch: 0, g: 0};
  const room = {items, marks: freshMarks(), race: null, players: () => [a]};
  let now = 10_000;
  const send = m => { now += 400; return handleMessage(a, JSON.stringify(m), now, room); };
  send({type: 'pickup', id: 'mon-hatchat'});
  assert.equal(mon.holder, 'aaa'); assert.equal(mon.carrying, 'mana-w1');
  const r = send({type: 'drop', id: 'mon-hatchat', x: mon.x + .5, y: 0, z: mon.z, yaw: 0});
  assert.ok(Math.abs(mana.x - mon.x) < 1e-9 && Math.abs(mana.z - mon.z) < 1e-9, 'the mana came along');
  assert.ok(r.out.some(o => o.msg.item?.id === 'mana-w1'));
  assert.equal(mon.carrying, undefined);
  // carried onto another mana: that's the one it has now, and the first stays put
  const other = items['mana-w2'], was = {x: mana.x, z: mana.z};
  send({type: 'pickup', id: 'mon-hatchat'});
  assert.equal(mon.carrying, 'mana-w1');
  send({type: 'drop', id: 'mon-hatchat', x: other.x, y: other.y, z: other.z, yaw: 0});
  assert.ok(Math.abs(mon.x - other.x) < 1e-6 && Math.abs(mon.z - other.z) < 1e-6);
  assert.deepEqual({x: mana.x, z: mana.z}, was, 'the old mana stays');
});

test('the radio: a YouTube or SoundCloud link, only while quiet, five minutes at most, cut to the track', async () => {
  const {handleMessage, newPlayer, freshMarks} = await import('../room.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {radioLink, RADIO_MAX_MS} = await import('../../src/protocol.js');
  assert.deepEqual(radioLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), {kind: 'yt', id: 'dQw4w9WgXcQ'});
  assert.deepEqual(radioLink('https://youtu.be/dQw4w9WgXcQ'), {kind: 'yt', id: 'dQw4w9WgXcQ'});
  assert.equal(radioLink('https://soundcloud.com/artist/track').kind, 'sc');
  assert.equal(radioLink('https://example.com/x.mp3'), null);
  assert.equal(radioLink('javascript:alert(1)'), null);
  const items = Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, {...s, holder: null, on: false}]));
  const r = items.rd1;
  const a = newPlayer('aaa', 0); a.pose = {x: r.x + .5, y: 1.45, z: r.z, yaw: 0, pitch: 0, g: 0};
  const b = newPlayer('bbb', 0); b.pose = {...a.pose};
  const room = {items, marks: freshMarks(), race: null, players: () => [a, b]};
  let now = 10_000;
  const send = (p, m) => { now += 400; return handleMessage(p, JSON.stringify(m), now, room); };
  assert.equal(send(a, {type: 'radio', id: 'rd1', url: 'https://example.com/song'}).out[0].msg.refused, true);
  send(a, {type: 'radio', id: 'rd1', url: 'https://youtu.be/dQw4w9WgXcQ'});
  assert.equal(r.play.u, 'yt:dQw4w9WgXcQ'); assert.equal(r.play.until - r.play.at, RADIO_MAX_MS);
  // busy: one more waits its turn, and that's all
  assert.ok(!send(b, {type: 'radio', id: 'rd1', url: 'https://youtu.be/aaaaaaaaaaa'}).out[0].msg.refused);
  assert.equal(r.next.u, 'yt:aaaaaaaaaaa'); assert.equal(r.play.u, 'yt:dQw4w9WgXcQ');
  assert.equal(send(a, {type: 'radio', id: 'rd1', url: 'https://youtu.be/bbbbbbbbbbb'}).out[0].msg.refused, true);
  send(b, {type: 'radio-len', id: 'rd1', ms: 60_000});                     // not theirs to say
  assert.equal(r.play.until - r.play.at, RADIO_MAX_MS);
  send(a, {type: 'radio-len', id: 'rd1', ms: 60_000});
  assert.ok(r.play.until - r.play.at <= 61_000);
  // when it stops, the queued one's on (as every page has already worked out)
  const {promoteRadio} = await import('../room.js'), {radioNow, RADIO_GAP_MS} = await import('../../src/protocol.js');
  now = r.play.until + 1;
  const expected = radioNow(r, now);
  assert.equal(expected.u, 'yt:aaaaaaaaaaa'); assert.equal(expected.at, r.play.until + RADIO_GAP_MS);
  assert.equal(promoteRadio(r, now).set.u, 'yt:aaaaaaaaaaa');
  assert.deepEqual(r.play, expected); assert.equal(r.next, undefined);
  now = r.play.until + 1;
  send(b, {type: 'radio', id: 'rd1', url: 'https://soundcloud.com/artist/track'});
  assert.equal(r.play.u, 'https://soundcloud.com/artist/track');
});

test('the chat log: every message kept, newest first, pageable', async () => {
  const {room, sockets, ctx} = makeRoom();
  const store = new Map();
  ctx.storage.get = async k => (Array.isArray(k) ? new Map(k.map(x => [x, store.get(x)])) : store.get(k));
  ctx.storage.put = async (k, v) => { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) store.set(kk, structuredClone(vv)); else store.set(k, structuredClone(v)); };
  ctx.storage.delete = async k => { for (const x of [k].flat()) store.delete(x); };
  ctx.storage.list = async ({prefix = '', reverse = false, limit = Infinity, end} = {}) => {
    let keys = [...store.keys()].filter(k => k.startsWith(prefix) && (end === undefined || k < end)).sort();
    if (reverse) keys.reverse();
    return new Map(keys.slice(0, limit).map(k => [k, structuredClone(store.get(k))]));
  };
  await join(room, S1); await join(room, S2);
  const [a, b] = sockets;
  await room.webSocketMessage(a, JSON.stringify({type: 'chat', text: 'first'}));
  await new Promise(r => setTimeout(r, 5));
  await room.webSocketMessage(b, JSON.stringify({type: 'chat', text: '  second\nline '}));
  const log = await (await room.fetch(new Request('https://x/chat-log'))).json();
  assert.deepEqual(log.map(c => c.text), ['second line', 'first']);
  assert.ok(log[0].at >= log[1].at && log[0].id && log[0].id !== log[1].id);
  const older = await (await room.fetch(new Request(`https://x/chat-log?before=${log[0].at}`))).json();
  assert.deepEqual(older.map(c => c.text), ['first']);
});

test('the radio log: every link put on, kept with who and how long, and what the radio remembered from before', async () => {
  const {room, sockets, ctx} = makeRoom();
  const store = new Map();
  ctx.storage.get = async k => (Array.isArray(k) ? new Map(k.map(x => [x, store.get(x)])) : store.get(k));
  ctx.storage.put = async (k, v) => { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) store.set(kk, structuredClone(vv)); else store.set(k, structuredClone(v)); };
  ctx.storage.delete = async k => { for (const x of [k].flat()) store.delete(x); };
  ctx.storage.list = async ({prefix = '', reverse = false, limit = Infinity, end} = {}) => {
    let keys = [...store.keys()].filter(k => k.startsWith(prefix) && (end === undefined || k < end)).sort();
    if (reverse) keys.reverse();
    return new Map(keys.slice(0, limit).map(k => [k, structuredClone(store.get(k))]));
  };
  await join(room, S1);
  const [a] = sockets;
  // a play from before the log began, still on the radio
  const items = await room.loadItems();
  items.rd1.play = {u: 'yt:BThCK0HF1Dw', at: Date.now() - 600_000, until: Date.now() - 400_000, by: 'old'};
  const r = items.rd1;
  await room.webSocketMessage(a, JSON.stringify({type: 'pose', pose: {...pose, x: r.x + .5, z: r.z, y: 1.45}}));
  await room.webSocketMessage(a, JSON.stringify({type: 'radio', id: 'rd1', url: 'https://youtu.be/dQw4w9WgXcQ?si=x'}));
  assert.equal(items.rd1.play.u, 'yt:dQw4w9WgXcQ');
  await room.webSocketMessage(a, JSON.stringify({type: 'radio-len', id: 'rd1', ms: 61_000}));
  const res = await room.fetch(new Request('https://x/radio-log'));
  const log = await res.json();
  assert.equal(log.length, 2);
  assert.equal(log[0].u, 'yt:dQw4w9WgXcQ'); assert.equal(log[0].by, a.deserializeAttachment().id); assert.equal(log[0].url, 'https://youtu.be/dQw4w9WgXcQ?si=x'); assert.equal(log[0].ms, 61_000);
  assert.equal(log[1].u, 'yt:BThCK0HF1Dw');
  // and older than a time, for paging back
  const older = await (await room.fetch(new Request(`https://x/radio-log?before=${log[0].at}`))).json();
  assert.deepEqual(older.map(e => e.u), ['yt:BThCK0HF1Dw']);
});

test('someone gone quiet (no word, not even a ping, for 20 s) is let go: everyone sees them leave', async () => {
  const {room, sockets, ctx} = makeRoom();
  await join(room, S1); await join(room, S2);
  const [a, b] = sockets;
  const pings = new Map([[a, Date.now()], [b, Date.now()]]);
  ctx.getWebSocketAutoResponseTimestamp = ws => new Date(pings.get(ws));
  const idB = b.deserializeAttachment().id;
  await room.alarm();
  assert.equal(room.players().length, 2, 'both still here');
  // b's phone goes to sleep: no pings, nothing, for 21 s (a's page keeps pinging)
  pings.set(b, Date.now() - 21000);
  for (const ws of [b]) { const p = ws.deserializeAttachment(); p.lastActive -= 21000; p.heard = 0; ws.serializeAttachment(p); }
  await room.alarm();
  assert.deepEqual(room.players().map(p => p.id), [a.deserializeAttachment().id]);
  assert.ok(a.messages().some(m => m.type === 'leave' && m.id === idB));
  // and when its close comes in afterwards, nothing more happens
  const before = a.messages().length;
  await room.webSocketClose(b);
  assert.equal(a.messages().filter(m => m.type === 'leave').length, a.messages().slice(0, before).filter(m => m.type === 'leave').length);
});

test('ink: kept apart and packed, sent to a joiner in parts, and the loneliest strokes go first', async () => {
  const {marksMessages, loneliest, freshMarks} = await import('../room.js');
  const {packInk, unpackInk, INK_PART_PTS} = await import('../../src/protocol.js');
  const pt = (x, y, z) => [x, y, z, 0, 0, 1, .25, .5];
  const q = [pt(12.345, 1.2, -3.456)];
  assert.deepEqual(unpackInk(packInk(q)), q);
  // lots of ink: in parts, each a fair size, all of it there
  const marks = freshMarks();
  for (let i = 0; i < 60; i++) marks.ink.push({id: 'a:' + i, h: 'w', c: 1, t: i, pts: Array.from({length: 500}, (_, k) => pt(i, 1, k / 100))});
  const msgs = marksMessages(marks);
  assert.equal(msgs[0].type, 'marks'); assert.equal(msgs[0].ink.length, 0); assert.equal(msgs[0].inkParts, msgs.length - 1);
  assert.ok(msgs.length > 2);
  for (const m of msgs.slice(1)) assert.ok(JSON.stringify(m).length < 900 * 1024, 'a part under 1 MiB');
  assert.equal(msgs.slice(1).reduce((n, m) => n + m.ink.length, 0), 60);
  // the loneliest of the older half goes: a cluster of three, a stroke on its own, then newer ones
  const s = (id, x) => ({id, h: 'w', pts: [pt(x, 1, 0), pt(x + .2, 1, 0)]});
  const ink = [s('c1', 0), s('c2', .3), s('alone', 20), s('c3', .6), s('n1', 40), s('n2', 40.3), s('n3', 40.6), s('n4', 41)];
  assert.equal(ink[loneliest(ink, null)].id, 'alone');
  // with nothing on its own, the oldest
  const all = [s('a', 0), s('b', .1), s('c', .2), s('d', .3)];
  assert.equal(all[loneliest(all, null)].id, 'a');
});

test('ink is kept across the room going to sleep: packed in chunks, all of it back', async () => {
  const {room, ctx} = makeRoom();
  const store = new Map();
  ctx.storage.get = async k => (Array.isArray(k) ? new Map(k.map(x => [x, store.get(x)])) : store.get(k));
  ctx.storage.put = async (k, v) => { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) store.set(kk, structuredClone(vv)); else store.set(k, structuredClone(v)); };
  ctx.storage.delete = async k => { for (const x of [].concat(k)) store.delete(x); };
  const marks = await room.loadMarks();
  const pt = (x, k) => [x, 1.5, k / 1000, 0, 0, 1, .5, .25];
  for (let i = 0; i < 120; i++) marks.ink.push({id: 'aaaaaaaaaaaaaaaa:' + i, h: 'w', c: 0xff0000, t: 1000 + i, pts: Array.from({length: 500}, (_, k) => pt(i / 10, k))});
  await room.saveMarks();
  assert.ok(store.get('inkChunks') >= 2, 'in more than one chunk');
  const again = new Room(ctx);
  const back = await again.loadMarks();
  assert.equal(back.ink.length, 120);
  const {unpackInk} = await import('../../src/protocol.js');
  assert.deepEqual(unpackInk(Array.from(back.ink[37].q))[123], pt(3.7, 123));
  // fewer afterwards: the spare chunks go
  marks.ink.splice(10);
  await room.saveMarks();
  assert.equal(store.get('inkChunks'), 1); assert.equal(store.has('ink1'), false);
});

test('ink: strokes that cross, a minute after, become one drawing, counted and let go as one', async () => {
  const {joinInk, inkUnits, loneliest} = await import('../room.js');
  const pt = (x, y) => [x, y, 0, 0, 0, 1, .5, .5];
  const line = (id, t, pts) => ({id, h: 'w', c: 1, t, at: t, pts});
  const across = line('u:1', 1000, Array.from({length: 40}, (_, k) => pt(k * .01, .2)));        // a stroke across
  const down = line('u:2', 2000, Array.from({length: 40}, (_, k) => pt(.2, k * .01)));          // and one down through it
  const apart = line('u:3', 3000, Array.from({length: 40}, (_, k) => pt(5 + k * .01, .2)));     // one elsewhere
  const ink = [across, down, apart];
  assert.deepEqual(joinInk(ink, 30_000), [], 'not yet: a minute after they were drawn');
  const d = joinInk(ink, 70_000);
  assert.equal(d.length, 1); assert.equal(d[0].g, 'u:1'); assert.deepEqual(d[0].ids.sort(), ['u:1', 'u:2']);
  assert.equal(apart.g, undefined);
  assert.deepEqual(joinInk(ink, 80_000), [], 'each looked at once');
  // one drawing and a stroke on its own: two to count, and the one on its own is let go first
  const units = inkUnits(ink);
  assert.equal(units.length, 2);
  assert.equal(units[loneliest(units, null)].strokes[0].id, 'u:3');
  // a third stroke crossing the drawing joins it
  const third = line('u:4', 90_000, Array.from({length: 40}, (_, k) => pt(.1, k * .01)));
  ink.push(third);
  const d2 = joinInk(ink, 160_000);
  assert.equal(d2.length, 1); assert.deepEqual(d2[0].ids.sort(), ['u:1', 'u:2', 'u:4']);
});

test('ink: over the limit, trimmed a little under it in one go, lone strokes first, drawings last', async () => {
  const {handleMessage, newPlayer, freshMarks} = await import('../room.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {MAX_INK_PTS} = await import('../../src/protocol.js');
  const items = Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, {...s, holder: null, on: false}]));
  const mk = Object.values(items).find(it => it.type === 'marker');
  const a = newPlayer('aaaaaaaaaaaaaaaa', 0); a.pose = {x: mk.x, y: 1.45, z: mk.z, yaw: 0, pitch: 0, g: 0};
  mk.holder = a.id;
  const marks = freshMarks(), room = {items, marks, race: null, players: () => [a]};
  const pt = (x, y, z) => [x, y, z, 0, 0, 1, .5, .5];
  // a big drawing (joined) of 30,000 points, then lone strokes of 1,000 points spread far apart, filling it up
  for (let i = 0; i < 60; i++) marks.ink.push({id: `${a.id}:d${i}`, h: 'w', c: 1, t: i, at: i, g: `${a.id}:d0`, pts: Array.from({length: 500}, (_, k) => pt(0, 1 + i * .001, k * .001))});
  for (let i = 0, n = Math.ceil((MAX_INK_PTS - 30000) / 1000); i < n; i++) marks.ink.push({id: `${a.id}:l${i}`, h: 'w', c: 1, t: 100 + i, at: 100 + i, pts: Array.from({length: 1000}, (_, k) => pt(10 + i * 3, 1, k * .001))});
  let now = 10_000;
  const r = handleMessage(a, JSON.stringify({type: 'ink', id: `${a.id}:new`, h: 'w', c: 1, p: [pt(mk.x, 1, mk.z)]}), now, room);
  const total = marks.ink.reduce((t, s) => t + s.pts.length, 0);
  assert.ok(total <= MAX_INK_PTS * .98, 'a little under');
  assert.equal(marks.ink.filter(s => s.g === `${a.id}:d0`).length, 60, 'the drawing is all still there');
  assert.ok(r.out.filter(o => o.msg.type === 'erase').length >= 2);
});

test('crossing strokes found either way round, and the whole lot gone over again joins without letting anything go', async () => {
  const {crosses, rejoinInk, finishInk, inkUnits} = await import('../room.js');
  const pt = (x, y) => [x, y, 0, 0, 0, 1, .5, .5];
  // a long wiggle and a short dash across it (the dash's points fall between the wiggle's)
  const long = {id: 'aaaaaaaaaaaaaaaa:l', h: 'w', c: 1, t: 1, at: 1, pts: Array.from({length: 200}, (_, k) => pt(k * .012, Math.sin(k / 5) * .05))};
  const dash = {id: 'aaaaaaaaaaaaaaaa:d', h: 'w', c: 1, t: 2, at: 2, pts: [pt(.6, -.2), pt(.6, .2)]};
  finishInk(long); finishInk(dash);
  assert.equal(crosses(long, dash), true); assert.equal(crosses(dash, long), true);
  // three drawings, two of which cross, one apart; and one recent stroke that's not looked at yet
  const far = {id: 'aaaaaaaaaaaaaaaa:f', h: 'w', c: 1, t: 3, at: 3, pts: [pt(5, 5), pt(5.3, 5)]};
  finishInk(far);
  const recent = {id: 'aaaaaaaaaaaaaaaa:r', h: 'w', c: 1, t: 99_000, at: 99_000, pts: [pt(.3, -.2), pt(.3, .2)]};
  const ink = [long, dash, far, recent];
  for (const s of [long, dash, far]) s.joined = true;
  const out = rejoinInk(ink, 100_000);
  assert.equal(ink.length, 4);
  assert.deepEqual(out, [{g: long.id, ids: [long.id, dash.id]}]);
  assert.equal(dash.g, long.id); assert.equal(far.g, undefined); assert.equal(recent.g, undefined);
  assert.equal(inkUnits(ink).length, 3);
});

test('ink for someone joining: binary (packed, deflated) or JSON, the same strokes either way; finished strokes made lighter', async () => {
  const {joinMarks, freshMarks, finishInk, inkCount} = await import('../room.js');
  const {decodeInk, inflate, inkFloats, unpackInk} = await import('../../src/protocol.js');
  const marks = freshMarks();
  const pt = (x, y, z) => [x, y, z, 0, 0, 1, .5, .5];
  for (let i = 0; i < 300; i++) marks.ink.push({id: 'aaaaaaaaaaaaaaaa:' + i, h: i % 7 ? 'w' : 'd3', c: 0x123456 + i, t: i, ...(i % 5 ? {} : {g: 'aaaaaaaaaaaaaaaa:0'}),
    pts: Array.from({length: 400}, (_, k) => pt(i * .1 + Math.sin(k / 9) * .2, 1 + k * .002, Math.cos(k / 7) * .1))});
  // a finished one: lighter (a wiggle keeps more of its points than a straight line would), and the same shape
  const before = marks.ink[3].pts.slice();
  finishInk(marks.ink[3]);
  assert.ok(inkCount(marks.ink[3]) < 400 && inkCount(marks.ink[3]) > 20, `${inkCount(marks.ink[3])} points`);
  const after = unpackInk(Array.from(marks.ink[3].q));
  const {packInk} = await import('../../src/protocol.js'), mm = q => unpackInk(packInk([q]))[0];
  assert.deepEqual(after[0], mm(before[0])); assert.deepEqual(after.at(-1), mm(before.at(-1)));
  const json = joinMarks(marks, false), bin = joinMarks(marks, true);
  const jsonInk = json.head.filter(m => m.type === 'inkpart').flatMap(m => m.ink);
  const parts = await bin.parts;
  assert.equal(bin.head[0].inkParts, parts.length); assert.ok(bin.head[0].inkBin);
  const binInk = [];
  for (const b of parts) { assert.equal(b[0], 1); binInk.push(...decodeInk(await inflate(b.subarray(5)))); }
  assert.equal(binInk.length, 300); assert.equal(jsonInk.length, 300);
  for (let i = 0; i < 300; i += 37) {
    const a = jsonInk[i], b = binInk[i];
    assert.equal(a.id, b.id); assert.equal(a.h, b.h); assert.equal(a.c, b.c); assert.equal(a.g, b.g);
    assert.deepEqual(Array.from(inkFloats(a.p)), Array.from(inkFloats(b.q)));
  }
  const jsonBytes = JSON.stringify(json.head).length, binBytes = parts.reduce((t, b) => t + b.length, 0);
  assert.ok(binBytes * 4 < jsonBytes, `binary ${binBytes} vs JSON ${jsonBytes}`);
});

test('a room full of ink: new strokes and trimming stay quick', async () => {
  const {handleMessage, newPlayer, freshMarks, finishInk} = await import('../room.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const {MAX_INK_PTS, MAX_INK_STROKES} = await import('../../src/protocol.js');
  const items = Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, {...s, holder: null, on: false}]));
  const mk = Object.values(items).find(it => it.type === 'marker');
  const a = newPlayer('aaaaaaaaaaaaaaaa', 0); a.pose = {x: mk.x, y: 1.45, z: mk.z, yaw: 0, pitch: 0, g: 0};
  mk.holder = a.id;
  const marks = freshMarks(), room = {items, marks, race: null, players: () => [a]};
  // full: strokes all round the loop, each finished (packed)
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const per = Math.ceil(MAX_INK_PTS / (MAX_INK_STROKES - 10));
  for (let i = 0; i < MAX_INK_STROKES - 10; i++) {
    const ang = rnd() * 6.28, y = 1 + rnd(), wig = rnd() * 9;
    const s = {id: `${a.id}:f${i}`, h: 'w', c: 1, t: i, at: i, joined: true, pts: Array.from({length: per}, (_, k) => [Math.cos(ang) * 41.4 + Math.sin(k / wig) * .05, y + k * .01, -Math.sin(ang) * 41.4, -Math.cos(ang), 0, Math.sin(ang), .5, .5])};
    finishInk(s); marks.ink.push(s);
  }
  let now = 10_000, worst = 0;
  const pt = k => [mk.x + k * .01, 1, mk.z, 0, 0, 1, .5, .5];
  for (let k = 0; k < 400; k++) {
    now += 41;
    const t0 = performance.now();
    handleMessage(a, JSON.stringify({type: 'ink', id: `${a.id}:n${k >> 6}`, h: 'w', c: 1, p: [pt(k % 64), pt(k % 64 + .5)]}), now, room);
    worst = Math.max(worst, performance.now() - t0);
  }
  assert.ok(worst < 250, `slowest message ${worst.toFixed(1)} ms`);
  console.log(`# full room: slowest ink message ${worst.toFixed(1)} ms`);
});

test('the radio: a track that will not play is called off by whoever put it on, or two others', async () => {
  const {handleMessage, newPlayer, freshMarks} = await import('../room.js');
  const {ITEM_SPAWNS} = await import('../../src/world-items.js');
  const items = Object.fromEntries(ITEM_SPAWNS.map(s => [s.id, {...s, holder: null, on: false}]));
  const r = items.rd1, near = {x: r.x + .5, y: 1.45, z: r.z, yaw: 0, pitch: 0, g: 0};
  const [a, b, c] = ['aaa', 'bbb', 'ccc'].map(id => { const p = newPlayer(id, 0); p.pose = {...near}; return p; });
  const room = {items, marks: freshMarks(), race: null, players: () => [a, b, c]};
  let now = 10_000;
  const send = (p, m) => { now += 400; return handleMessage(p, JSON.stringify(m), now, room); };
  send(a, {type: 'radio', id: 'rd1', url: 'https://youtu.be/dQw4w9WgXcQ'});
  send(b, {type: 'radio-dead', id: 'rd1'});
  assert.ok(now < r.play.until, 'one other: not enough');
  send(c, {type: 'radio-dead', id: 'rd1'});
  assert.ok(now >= r.play.until, 'two others: off');
  send(b, {type: 'radio', id: 'rd1', url: 'https://youtu.be/aaaaaaaaaaa'});
  assert.equal(r.play.u, 'yt:aaaaaaaaaaa', 'and another can go on');
  send(b, {type: 'radio-dead', id: 'rd1'});
  assert.ok(now >= r.play.until, 'whoever put it on: off');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, RECONNECT_GRACE_MS } from '../server/room.js';
import { attach, admit, roomOptions } from '../server/session.js';
import { signTicket, verifyTicket, rejoinMode, baseMode, REJOIN_TTL_MS } from '../server/gate.js';

// A stand-in socket: records what the server sends, and fires its close listener like a real one.
function fakeSocket() {
  return {
    readyState: 1,
    sent: [],
    closed: null,
    send(s) { this.sent.push(JSON.parse(s)); },
    close(code) { this.closed = code ?? 1000; this.readyState = 3; },
    of(t) { return this.sent.filter((m) => m.t === t); },
  };
}

function joinRoom(room, ws, extra = {}) {
  const session = attach(ws, room, { rejoinTicket: async () => 'T' });
  session.onMessage(JSON.stringify({ t: 'join', name: 'Ana', char: 0, ...extra }));
  return session;
}

test('a dropped player keeps their spot and gets it back with their key', () => {
  const room = new Room('ABCD', false);
  const ws1 = fakeSocket();
  const s1 = joinRoom(room, ws1);
  const { id, key } = ws1.of('welcome')[0];
  assert.ok(key);
  s1.onClose();
  const held = room.players.find((p) => p.id === id);
  assert.ok(held, 'still in the room');
  assert.equal(held.ws, null);
  assert.equal(room.humanCount, 1, 'held spots count as humans');

  const ws2 = fakeSocket();
  joinRoom(room, ws2, { key });
  assert.equal(ws2.of('welcome')[0].id, id, 'same player back');
  assert.equal(held.ws, ws2);
  assert.equal(held.heldUntil, 0);
  assert.equal(room.humanCount, 1);
});

test('a reconnect replaces a half-dead socket without the old close removing the player', () => {
  const room = new Room('ABCD', false);
  const ws1 = fakeSocket();
  const s1 = joinRoom(room, ws1);
  const { key, id } = ws1.of('welcome')[0];
  const ws2 = fakeSocket();
  joinRoom(room, ws2, { key });
  assert.equal(ws1.closed, 4002);
  s1.onClose(); // the old socket's close finally arrives
  const p = room.players.find((q) => q.id === id);
  assert.equal(p.ws, ws2);
  assert.equal(p.heldUntil, 0);
});

test('a held spot is released after the grace period, then the room counts as empty', () => {
  const room = new Room('ABCD', false);
  const ws = fakeSocket();
  joinRoom(room, ws).onClose();
  const p = room.players.find((q) => !q.bot);
  p.heldUntil = Date.now() - 1;
  room.checkAfk();
  assert.equal(room.humanCount, 0);
  assert.ok(!room.players.includes(p));
  room.checkAfk();
  assert.ok(room.emptyFor >= 1);
  assert.ok(RECONNECT_GRACE_MS >= 10_000);
});

test('an unknown or released key joins as a new player instead', () => {
  const room = new Room('ABCD', false);
  const ws = fakeSocket();
  joinRoom(room, ws, { key: 'nope' });
  assert.equal(ws.of('welcome').length, 1);
  assert.equal(room.humanCount, 1);
});

test('leaving on purpose and kicks free the spot immediately', () => {
  const room = new Room('ABCD', false);
  const ws = fakeSocket();
  const s = joinRoom(room, ws);
  s.onMessage(JSON.stringify({ t: 'leave' }));
  s.onClose();
  assert.equal(room.humanCount, 0);

  const ws2 = fakeSocket();
  joinRoom(room, ws2);
  const p = room.players.find((q) => !q.bot);
  room.kick(p, 'afk', 4000);
  assert.equal(room.humanCount, 0, 'no waiting for a close event that may never come');
  assert.equal(ws2.closed, 4000);
  assert.equal(room.reattach(p.key, fakeSocket()), null, 'kicked players cannot reattach');
});

test('the server sends a rejoin ticket on join', async () => {
  const room = new Room('ABCD', false);
  const ws = fakeSocket();
  joinRoom(room, ws);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ws.of('ticket')[0]?.ticket, 'T');
});

test('rejoin modes recreate a restarted room with its original settings', async () => {
  assert.equal(admit(null, 'code'), 'roomNotFound');
  assert.equal(admit(null, rejoinMode('code')), 'create');
  assert.equal(admit({}, rejoinMode('create')), 'join');
  assert.equal(admit({}, 'create'), 'roomTaken');
  assert.deepEqual(roomOptions(rejoinMode('quick')), { isPublic: true, tutorial: false });
  assert.deepEqual(roomOptions(rejoinMode('tutorial')), { isPublic: false, tutorial: true });
  assert.equal(baseMode('rejoin-quick'), 'quick');

  const ticket = await signTicket('s3cret', 'ABCD', rejoinMode('quick'), REJOIN_TTL_MS);
  assert.ok(await verifyTicket('s3cret', ticket, 'ABCD', 'rejoin-quick'));
  assert.ok(!(await verifyTicket('s3cret', ticket, 'ABCD', 'quick')), 'not a plain join ticket');
  assert.ok(!(await verifyTicket('s3cret', ticket, 'WXYZ', 'rejoin-quick')), 'only for its own room');
});

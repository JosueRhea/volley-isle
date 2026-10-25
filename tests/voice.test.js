import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { attach } from '../server/session.js';

function socket() { return { readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); }, close() { this.readyState = 3; } }; }
function join(room) {
  const ws = socket(), session = attach(ws, room);
  session.onMessage(JSON.stringify({ t: 'join', name: 'Player', char: 0 }));
  return { ws, session, p: room.players.find((p) => p.ws === ws), say: (m) => session.onMessage(JSON.stringify(m)) };
}
const sdp = (n) => 'v=0\r\n' + 'a=x\r\n'.repeat(n);

test('voice flag shows up in the roster', () => {
  const room = new Room('TALK', false), a = join(room);
  a.say({ t: 'voice', on: true });
  room.flush();
  assert.equal(a.ws.sent.findLast((m) => m.t === 'roster').players.find((p) => p.id === a.p.id).vc, 1);
  a.say({ t: 'voice', on: false });
  room.flush();
  assert.equal(a.ws.sent.findLast((m) => m.t === 'roster').players.find((p) => p.id === a.p.id).vc, 0);
});

test('signaling is relayed to one player, with full-size session descriptions', () => {
  const room = new Room('TALK', false), a = join(room), b = join(room), c = join(room);
  const offer = { type: 'offer', sdp: sdp(1500) }; // ~7.5KB, bigger than a normal game message
  a.say({ t: 'rtc', to: b.p.id, d: offer });
  assert.equal(b.ws.sent.filter((m) => m.t === 'rtc').length, 0, 'not in voice yet');
  a.say({ t: 'voice', on: true });
  a.say({ t: 'rtc', to: b.p.id, d: { ...offer, extra: 'dropped' } });
  assert.deepEqual(b.ws.sent.findLast((m) => m.t === 'rtc'), { t: 'rtc', from: a.p.id, d: offer });
  assert.equal(c.ws.sent.filter((m) => m.t === 'rtc').length, 0, 'only the addressee hears it');
});

test('bad signaling is ignored', () => {
  const room = new Room('TALK', false), a = join(room), b = join(room);
  a.say({ t: 'voice', on: true });
  const bot = room.players.find((p) => p.bot);
  for (const [to, d] of [
    [b.p.id, { type: 'candidate', sdp: 'x' }],
    [b.p.id, { type: 'offer', sdp: 42 }],
    [b.p.id, null],
    [a.p.id, { type: 'offer', sdp: 'x' }],
    [bot?.id ?? -1, { type: 'offer', sdp: 'x' }],
    [999, { type: 'offer', sdp: 'x' }],
  ]) a.say({ t: 'rtc', to, d });
  a.say({ t: 'rtc', to: b.p.id, d: { type: 'offer', sdp: sdp(2500) } }); // over the size limit
  assert.equal(b.ws.sent.filter((m) => m.t === 'rtc').length, 0);
  assert.equal(a.ws.sent.filter((m) => m.t === 'rtc').length, 0);
  // Other messages keep the normal size limit.
  const team = a.p.team;
  a.say({ t: 'team', team: 1 - team, pad: 'x'.repeat(3000) });
  assert.equal(a.p.team, team);
});

test('mic flag and restart requests', () => {
  const room = new Room('TALK', false), a = join(room), b = join(room);
  const me = () => (room.flush(), a.ws.sent.findLast((m) => m.t === 'roster').players.find((p) => p.id === a.p.id));
  a.say({ t: 'voice', on: true, mic: false });
  assert.deepEqual([me().vc, me().mc], [1, 0]);
  a.say({ t: 'voice', on: true, mic: true });
  assert.deepEqual([me().vc, me().mc], [1, 1]);
  a.say({ t: 'voice', on: false, mic: true });
  assert.deepEqual([me().vc, me().mc], [0, 0], 'no mic flag outside voice');
  a.say({ t: 'voice', on: true });
  a.say({ t: 'rtc', to: b.p.id, d: { type: 'restart', sdp: 'x'.repeat(50), junk: 1 } });
  assert.deepEqual(b.ws.sent.findLast((m) => m.t === 'rtc'), { t: 'rtc', from: a.p.id, d: { type: 'restart' } });
});

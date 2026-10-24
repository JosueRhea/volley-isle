import { TEAM_SIZE, CHARACTERS } from '../shared/constants.js';
import { cleanName } from './names.js';
import { baseMode } from './gate.js';

// One player's connection to one room. Shared by the Node server and the Cloudflare Durable Object,
// so both run the exact same protocol. `ws` just needs send() and readyState (1 = open).
export const MAX_HUMANS = TEAM_SIZE * 2;
// Hosts shut a room down after this many seconds with no humans (held reconnect spots count as humans).
export const EMPTY_ROOM_S = 10;

const cleanSpecies = (c) => (Number.isInteger(c) && c >= 0 && c < CHARACTERS.length ? c : 0);
// Flood protection: a normal client sends ~35 messages/s. Allow bursts, drop the excess,
// and disconnect anyone who keeps flooding.
const MSG_RATE = 60; // per second
const MSG_BURST = 120;
const MAX_DROPPED = 300;
const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

// Rooms are created/found by the host before the socket is attached; mode comes from the connect URL:
//   quick | create | tutorial → the room is made if it doesn't exist yet; code → it must already exist.
//   rejoin-<mode> → a reconnect; recreates the room with its original settings if it restarted.
export function roomOptions(mode) {
  const base = baseMode(mode);
  return { isPublic: base === 'quick', tutorial: base === 'tutorial' };
}

// How a host treats a connection for `room` (null if the code isn't live): 'create', 'join', or an error code.
export function admit(room, mode) {
  if (!room) return mode === 'code' ? 'roomNotFound' : 'create';
  if (mode === 'create' || mode === 'tutorial') return 'roomTaken';
  return 'join';
}

export function rejectSocket(ws, code) {
  send(ws, { t: 'error', code });
  try {
    ws.close(1000, code);
  } catch {
    // already closed
  }
}

const TICKET_REFRESH_MS = 2 * 60_000;

// rejoinTicket: () => Promise<string>, a signed ticket the client can use to reconnect to this room.
export function attach(ws, room, { onJoin, onLeave, rejoinTicket } = {}) {
  let player = null;
  let ticketAt = 0;
  room.sockets.add(ws);
  const sendTicket = () => {
    if (!rejoinTicket) return;
    ticketAt = Date.now();
    rejoinTicket().then((ticket) => send(ws, { t: 'ticket', ticket }), () => {});
  };
  let tokens = MSG_BURST;
  let refillAt = Date.now();
  let dropped = 0;

  function onMessage(raw) {
    const now = Date.now();
    tokens = Math.min(MSG_BURST, tokens + ((now - refillAt) / 1000) * MSG_RATE);
    refillAt = now;
    if (tokens < 1) {
      if (++dropped > MAX_DROPPED) {
        if (player) player.gone = true;
        rejectSocket(ws, 'flood');
      }
      return;
    }
    tokens -= 1;
    const text = typeof raw === 'string' ? raw : raw.toString();
    if (text.length > 2048) return;
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    switch (m.t) {
      case 'in':
        if (player) room.handleInput(player, m);
        break;
      case 'ping':
        send(ws, { t: 'pong', c: m.c });
        // Clients report their measured round trip so everyone can see each other's connection.
        if (player && Number.isFinite(m.rtt)) player.ping = Math.max(0, Math.min(9999, Math.round(m.rtt)));
        if (player && Date.now() - ticketAt > TICKET_REFRESH_MS) sendTicket();
        break;
      case 'charge':
        if (player) room.charge(player);
        break;
      case 'team':
        if (player) room.pickTeam(player, m.team), room.markActive(player);
        break;
      case 'cpu':
        if (player) room.setCpu(player, m.on), room.markActive(player);
        break;
      case 'format':
        if (player) room.setTeamSize(player, m.teamSize), room.markActive(player);
        break;
      case 'rules':
        if (player) room.setRules(player, m.rules), room.markActive(player);
        break;
      case 'ball':
        if (player) room.setBallColor(player, m.color), room.markActive(player);
        break;
      case 'start':
        if (player) room.startMatch(player), room.markActive(player);
        break;
      case 'drill':
        if (player) room.drill(player, String(m.kind)), room.markActive(player);
        break;
      case 'leave': // leaving on purpose: free the spot now instead of holding it
        if (player) player.gone = true;
        ws.close(1000, 'leave');
        break;
      case 'join':
        if (player) break;
        // A reconnect with a key we're still holding a spot for takes that spot back.
        player = typeof m.key === 'string' ? room.reattach(m.key, ws) : null;
        if (!player) {
          if (room.humanCount >= room.teamSize * 2) return rejectSocket(ws, 'roomFull');
          player = room.addHuman(ws, cleanName(m.name), cleanSpecies(m.char));
          if (!player) return rejectSocket(ws, 'roomFull');
        }
        sendTicket();
        onJoin?.(player);
        break;
    }
  }

  function onClose() {
    room.sockets.delete(ws);
    const p = player;
    player = null;
    // Superseded by a reconnect on a new socket: that one owns the player now.
    if (!p || p.ws !== ws) return;
    // A dropped connection keeps its spot for a little while; kicks and leaves don't.
    if (p.gone) room.removeHuman(p);
    else room.hold(p);
    onLeave?.(p);
  }

  return { onMessage, onClose };
}

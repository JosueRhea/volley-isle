// Cloudflare host. The Worker serves the built game and routes each room to its own Durable Object:
//   /api/config     → public client config (Turnstile site key)
//   /api/join       → origin + rate limit + Turnstile check, then a room code and a signed join ticket
//                     (quick: the Matchmaker picks a public room with space; create/tutorial: a fresh code)
//   /ws/<CODE>      → that room's RoomObject, only with a valid ticket (one Durable Object per room)
//   everything else → static assets from dist/
import { DurableObject } from 'cloudflare:workers';
import { Room } from '../server/room.js';
import { attach, admit, rejectSocket, roomOptions, MAX_HUMANS, EMPTY_ROOM_S } from '../server/session.js';
import { newCode, CODE_RE } from '../server/codes.js';
import { originAllowed, verifyTurnstile, signTicket, verifyTicket, listFrom, JOIN_MODES, REJOIN_TTL_MS, rejoinMode, baseMode } from '../server/gate.js';
import { TICK_HZ, SNAPSHOT_HZ } from '../shared/constants.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const matchmaker = (env) => env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));

const allowedOrigins = (env) => listFrom(env.ALLOWED_ORIGINS);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (url.pathname === '/health') return json({ ok: true });
    // Public config the client needs (the Turnstile site key is public by design).
    if (url.pathname === '/api/config') return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null });

    if (url.pathname === '/api/join' || url.pathname.startsWith('/ws/')) {
      // 1. Only the game's own pages.
      if (!originAllowed(request.headers.get('Origin'), allowedOrigins(env))) return json({ error: 'origin' }, 403);
      // 2. Per-IP rate limit on everything that creates or joins rooms.
      if (env.JOIN_LIMITER && !(await env.JOIN_LIMITER.limit({ key: ip })).success) return json({ error: 'rateLimited' }, 429);
    }

    // Prove you're human (Turnstile), get a room code + a signed ticket for it.
    if (url.pathname === '/api/join') {
      if (request.method !== 'POST') return json({ error: 'method' }, 405);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'badRequest' }, 400);
      }
      const mode = JOIN_MODES.includes(body?.mode) ? body.mode : null;
      if (!mode) return json({ error: 'badRequest' }, 400);
      const token = body['cf-turnstile-response'];
      if (!(await verifyTurnstile(env.TURNSTILE_SECRET, token, ip, { hostnames: listFrom(env.TURNSTILE_HOSTNAMES) }))) {
        return json({ error: 'human' }, 403);
      }
      let code;
      if (mode === 'quick') code = await matchmaker(env).quick();
      else if (mode === 'code') code = String(body.code ?? '').toUpperCase();
      else code = newCode();
      if (!CODE_RE.test(code)) return json({ error: 'roomNotFound' }, 404);
      return json({ code, ticket: await signTicket(env.TICKET_SECRET, code, mode) });
    }

    // 3. Rooms only accept connections with a valid ticket for that exact room and mode.
    if (url.pathname.startsWith('/ws/')) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const code = url.pathname.split('/')[2]?.toUpperCase() ?? '';
      const mode = url.searchParams.get('mode');
      if (!CODE_RE.test(code)) return new Response('Bad room code', { status: 400 });
      if (!(await verifyTicket(env.TICKET_SECRET, url.searchParams.get('ticket'), code, mode))) return json({ error: 'ticket' }, 403);
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

// One live match. Holds the Room in memory and ticks it while anyone is connected; when the last
// player leaves (and nobody's reconnect spot is still held) the loop stops and the object goes away.
export class RoomObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.code = null;
    this.timer = null;
    this.lastReport = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const code = url.pathname.split('/')[2].toUpperCase();
    const mode = url.searchParams.get('mode');
    const [client, socket] = Object.values(new WebSocketPair());
    socket.accept();

    const verdict = admit(this.room, mode);
    if (verdict !== 'create' && verdict !== 'join') {
      rejectSocket(socket, verdict);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (verdict === 'create') {
      const opts = roomOptions(mode);
      this.code = code;
      this.room = new Room(code, opts.isPublic, { tutorial: opts.tutorial });
      this.startLoop();
    }

    const room = this.room;
    const session = attach(socket, room, {
      onJoin: () => this.report(),
      onLeave: () => this.report(),
      rejoinTicket: () => signTicket(this.env.TICKET_SECRET, code, rejoinMode(baseMode(mode)), REJOIN_TTL_MS),
    });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      session.onClose();
      if (this.room === room && room.humanCount === 0) this.shutdown();
    };
    socket.addEventListener('message', (e) => session.onMessage(e.data));
    socket.addEventListener('close', close);
    socket.addEventListener('error', close);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Fixed 60 Hz simulation with 30 Hz snapshots, same as the Node host.
  startLoop() {
    const STEP = 1 / TICK_HZ;
    let acc = 0;
    let snapAcc = 0;
    let last = Date.now();
    this.timer = setInterval(() => {
      const room = this.room;
      if (!room) return;
      const now = Date.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= STEP) {
        room.tick(STEP);
        acc -= STEP;
        snapAcc += STEP;
      }
      if (snapAcc >= 1 / SNAPSHOT_HZ - 1e-6) {
        snapAcc = 0;
        room.flush();
      }
      // Nobody's played here for a while (never joined, or dropped and didn't come back): stop.
      if (room.emptyFor >= EMPTY_ROOM_S) return this.shutdown();
      // Keep the matchmaker's list fresh for long-running public rooms.
      if (now - this.lastReport > 30000) this.report();
    }, 1000 / TICK_HZ);
  }

  shutdown() {
    clearInterval(this.timer);
    this.timer = null;
    this.report(0);
    for (const ws of this.room?.sockets ?? []) {
      try {
        ws.close(1001, 'roomClosed');
      } catch {
        // already closed
      }
    }
    this.room = null;
  }

  // Tell the matchmaker how many humans a public room has (0 removes it from Quick Play).
  report(humans = this.room?.humanCount ?? 0) {
    this.lastReport = Date.now();
    if (!this.room?.isPublic && humans > 0) return;
    this.ctx.waitUntil(matchmaker(this.env).report(this.code, humans).catch(() => {}));
  }
}

// Directory of public rooms with open spots, for Quick Play. In-memory on purpose: if it's ever
// evicted, Quick Play just starts fresh rooms until public rooms report back in.
export class Matchmaker extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rooms = new Map(); // code → { humans, at }
  }

  quick() {
    const now = Date.now();
    for (const [code, r] of this.rooms) {
      if (now - r.at > 120000) this.rooms.delete(code); // stale: never joined, or stopped reporting
      else if (r.humans < MAX_HUMANS) {
        r.humans++; // hold the spot until the room reports its real count
        r.at = now;
        return code;
      }
    }
    const code = newCode((c) => this.rooms.has(c));
    this.rooms.set(code, { humans: 1, at: now });
    return code;
  }

  report(code, humans) {
    if (humans <= 0) this.rooms.delete(code);
    else this.rooms.set(code, { humans, at: Date.now() });
  }
}

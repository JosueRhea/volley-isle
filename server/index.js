// Node host: runs every room in one process. Used for local dev (`npm run dev`) and the Docker image.
// The Cloudflare host (worker/index.js) runs the same rooms as Durable Objects.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { attach, rejectSocket, roomOptions, MAX_HUMANS } from './session.js';
import { newCode, CODE_RE } from './codes.js';
import { originAllowed, verifyTurnstile, signTicket, verifyTicket, listFrom, JOIN_MODES } from './gate.js';
import { TICK_HZ, SNAPSHOT_HZ } from '../shared/constants.js';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const PORT = Number(process.env.PORT) || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const rooms = new Map();

// Join gate (same rules as the Cloudflare host). Turnstile is off unless TURNSTILE_SECRET is set.
const GATE = {
  siteKey: process.env.TURNSTILE_SITE_KEY || null,
  secret: process.env.TURNSTILE_SECRET || null,
  hostnames: listFrom(process.env.TURNSTILE_HOSTNAMES || 'localhost'),
  origins: listFrom(process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:3000'),
  ticketSecret: process.env.TICKET_SECRET || crypto.randomUUID() + crypto.randomUUID(),
};

// Same per-IP limit as the Cloudflare host: 30 room creates/joins per minute.
const hits = new Map(); // ip → { n, resetAt }
function rateLimited(req) {
  const ip = req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.resetAt) {
    hits.set(ip, { n: 1, resetAt: now + 60_000 });
    return false;
  }
  return ++h.n > 30;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, h] of hits) if (now > h.resetAt) hits.delete(ip);
}, 60_000);

const json = (res, body) => {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return json(res, { ok: true, rooms: rooms.size });
  if (url.pathname === '/api/config') return json(res, { turnstileSiteKey: GATE.siteKey });
  if (url.pathname === '/api/join') return join(req, res);

  let file;
  try {
    file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) file = path.join(DIST, 'index.html');
    fs.readFile(file, (err2, data) => {
      if (err2) {
        res.writeHead(404);
        return res.end('Client not built. Run `npm run build`, or use `npm run dev`.');
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(data);
    });
  });
});

const fail = (res, status, error) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error }));
};

// Origin + rate limit + Turnstile, then a room code and a signed ticket for it.
function join(req, res) {
  if (!originAllowed(req.headers.origin, GATE.origins)) return fail(res, 403, 'origin');
  if (rateLimited(req)) return fail(res, 429, 'rateLimited');
  if (req.method !== 'POST') return fail(res, 405, 'method');
  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 4096) req.destroy();
  });
  req.on('end', async () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(res, 400, 'badRequest');
    }
    const mode = JOIN_MODES.includes(body?.mode) ? body.mode : null;
    if (!mode) return fail(res, 400, 'badRequest');
    const ok = await verifyTurnstile(GATE.secret, body['cf-turnstile-response'], req.socket.remoteAddress, { hostnames: GATE.hostnames });
    if (!ok) return fail(res, 403, 'human');
    let code;
    if (mode === 'quick') code = [...rooms.values()].find((r) => r.isPublic && r.humanCount < MAX_HUMANS)?.code;
    else if (mode === 'code') code = String(body.code ?? '').toUpperCase();
    code ??= newCode((c) => rooms.has(c));
    if (!CODE_RE.test(code)) return fail(res, 404, 'roomNotFound');
    json(res, { code, ticket: await signTicket(GATE.ticketSecret, code, mode) });
  });
}

// WebSockets connect to /ws/<CODE>?mode=quick|create|tutorial|code&ticket=…
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const code = url.pathname.split('/')[2]?.toUpperCase() ?? '';
  if (!url.pathname.startsWith('/ws/') || !CODE_RE.test(code)) return socket.destroy();
  const reject = (status) => {
    socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
    socket.destroy();
  };
  if (!originAllowed(req.headers.origin, GATE.origins)) return reject('403 Forbidden');
  if (rateLimited(req)) return reject('429 Too Many Requests');
  const mode = url.searchParams.get('mode');
  verifyTicket(GATE.ticketSecret, url.searchParams.get('ticket'), code, mode).then((ok) => {
    if (!ok) return reject('403 Forbidden');
    wss.handleUpgrade(req, socket, head, (ws) => connect(ws, code, mode));
  });
});

function connect(ws, code, mode) {
  let room = rooms.get(code);
  if (!room) {
    if (mode === 'code') return rejectSocket(ws, 'roomNotFound');
    const opts = roomOptions(mode);
    room = new Room(code, opts.isPublic, { tutorial: opts.tutorial });
    rooms.set(code, room);
  } else if (mode === 'create' || mode === 'tutorial') {
    return rejectSocket(ws, 'roomTaken');
  }

  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  const session = attach(ws, room, {
    onJoin: (p) => console.log(`[${code}] ${p.name} joined (${room.humanCount} humans)`),
    onLeave: (p) => {
      console.log(`[${code}] ${p.name} left (${room.humanCount} humans)`);
      if (room.humanCount === 0) rooms.delete(code);
    },
  });
  ws.on('message', (raw) => session.onMessage(raw));
  ws.on('close', () => {
    session.onClose();
    if (room.humanCount === 0 && rooms.get(code) === room) rooms.delete(code); // nobody left (or never joined)
  });
}

// Drop dead connections so their slots go back to bots.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) ws.terminate();
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// Fixed-step simulation, snapshots at a lower rate.
const STEP = 1 / TICK_HZ;
let acc = 0;
let snapAcc = 0;
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= STEP) {
    for (const r of rooms.values()) r.tick(STEP);
    acc -= STEP;
    snapAcc += STEP;
  }
  if (snapAcc >= 1 / SNAPSHOT_HZ - 1e-6) {
    snapAcc = 0;
    for (const r of rooms.values()) r.flush();
  }
}, 4);

server.listen(PORT, () => console.log(`Volley Isle server on http://localhost:${PORT}`));

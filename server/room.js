import {
  COURT, NET, BALL_RADIUS, PLAYER, SWING_TIME, HIT_COOLDOWN, MAX_TOUCHES, TEAM_SIZE, WIN_SCORE, CHARACTERS, SLOWMO,
  DIVE, BALL_COLORS,
} from '../shared/constants.js';
import {
  sideSign, stepBall, clampPlayer, arcVelocity, directVelocity, yAtX, clamp, diveState, serveZone, meterValue,
} from '../shared/physics.js';
import { updateBot, homePos } from './bot.js';

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
let nextId = 1;

// Anti-AFK: players who don't move or press anything get a warning, then are sent back to the title.
export const AFK_WARN_MS = 270_000;
export const AFK_KICK_MS = 300_000;
// A player whose connection drops keeps their spot this long, so a reconnect puts them right back.
export const RECONNECT_GRACE_MS = 20_000;
// Movement check: clients report their own position, so the server only accepts what's physically possible.
const MOVE_RATE = PLAYER.speed * 1.4; // m/s of movement budget (a bit of slack for network jitter)
const MOVE_BURST = 3; // m: max saved-up budget (covers lag spikes / bursts of packets)
const MAX_Y = PLAYER.jumpVel ** 2 / (2 * PLAYER.gravity) + 0.2; // jump apex + margin

// "Too perfect" detection: how fast a player changes direction after the other team hits.
// People need ~200ms+ (plus their network lag); a script reading the game state reacts almost
// instantly. Only reactions from a steady state count, so wiggling around can't trigger it.
const REACT_STEADY_MS = 300; // direction must have been unchanged this long before the hit
const REACT_WINDOW_MS = 1500; // a direction change later than this isn't a reaction
const REACT_SAMPLES = 12; // judge only once we have this many
const REACT_BOT_MS = 120; // median below this = not a person

// Match formats. Quick Play is always a 3-minute timed match; private hosts can pick.
export const MATCH_MINUTES = [2, 3, 5];
export const MATCH_POINTS = [7, 11, 15];
const DEFAULT_RULES = { mode: 'time', minutes: 3, points: WIN_SCORE };

// Phases: 'lobby' (pre-match warm-up, host starts the match) → 'serve' → 'rally' → 'point' … → 'over' → 'lobby'
export class Room {
  // tutorial: a private practice court (you + a passive teammate, no opponents, no scoring)
  // where the client's coach requests drills.
  constructor(code, isPublic, { tutorial = false } = {}) {
    this.code = code;
    this.isPublic = isPublic;
    this.tutorial = tutorial;
    this.rules = { ...DEFAULT_RULES };
    this.teamSize = TEAM_SIZE;
    this.clock = null; // seconds left in a timed match (null in points mode / outside matches)
    this.suddenDeath = false;
    this.players = [];
    this.sockets = new Set(); // every open connection, joined or not (hosts close them on shutdown)
    this.emptyFor = 0; // seconds without a single human (the hosts' idle watchdog reads this)
    this.hostId = null;
    this.fillCpu = true;
    this.ballColor = BALL_COLORS[0];
    this.score = [0, 0];
    this.servingTeam = 0;
    this.serveIdx = [0, 0];
    this.ball = { x: 0, y: 3, z: 0, vx: 0, vy: 0, vz: 0 };
    this.touches = 0;
    this.lastTeam = null;
    this.lastHitter = null;
    this.lastPointTeam = null;
    this.lastKind = null;
    this.hitSeq = 0;
    this.time = 0;
    this.slow = 0; // real seconds of slow-motion left
    this.timeScale = 1;
    this.events = [];
    this.rosterDirty = true;
    if (tutorial) this.fillCpu = false;
    else this.fillBots();
    this.enterLobby();
  }

  get humanCount() {
    return this.players.filter((p) => !p.bot).length;
  }

  members(team) {
    return this.players.filter((p) => p.team === team).sort((a, b) => a.slot - b.slot);
  }

  get server() {
    const m = this.members(this.servingTeam);
    return m.length ? m[this.serveIdx[this.servingTeam] % m.length] : null;
  }

  makePlayer(team, slot, name, ws, species) {
    const h = homePos(team, slot, this.teamSize);
    return {
      id: nextId++, name, team, slot, bot: !ws, ws,
      key: ws ? crypto.randomUUID() : null, heldUntil: 0, gone: false, // reconnect identity / state
      x: h.x, y: 0, z: h.z, vy: 0, ry: 0, mx: 0, mz: 0, aimF: 0, aimZ: 0,
      swingT: 0, cooldown: 0, hitCount: 0, ignoreUntil: 0, dive: 0, diveT: -1, servePower: 0.6, tipNext: false, blockCd: 0,
      lastActive: Date.now(), afkWarned: false, moveBudget: MOVE_BURST, lastInputAt: Date.now(), chargeAt: null,
      dirX: 0, dirZ: 0, dirSince: Date.now(), react: null, reactions: [],
      look: { species },
      ai: { lastSeq: -1, willPlay: true, err: 0 },
    };
  }

  // Bots are the cast themselves, preferring characters nobody in the room is using.
  makeBot(team, slot) {
    const used = new Set(this.players.map((p) => p.look.species));
    const free = CHARACTERS.map((_, i) => i).filter((i) => !used.has(i));
    const pool = free.length ? free : CHARACTERS.map((_, i) => i);
    const species = pool[Math.floor(Math.random() * pool.length)];
    return this.makePlayer(team, slot, CHARACTERS[species], null, species);
  }

  freeSlot(team) {
    const used = new Set(this.members(team).map((p) => p.slot));
    for (let s = 0; s < this.teamSize; s++) if (!used.has(s)) return s;
    return -1;
  }

  fillBots() {
    for (const team of [0, 1]) {
      for (let slot = this.freeSlot(team); slot >= 0; slot = this.freeSlot(team)) this.players.push(this.makeBot(team, slot));
    }
    this.rosterDirty = true;
  }

  // Claims a spot on `team`: an empty slot, or a bot's slot (the bot leaves). Returns slot or -1.
  claimSlot(team) {
    const free = this.freeSlot(team);
    if (free >= 0) return free;
    const bot = this.players.find((p) => p.bot && p.team === team);
    if (!bot) return -1;
    this.players.splice(this.players.indexOf(bot), 1);
    return bot.slot;
  }

  addHuman(ws, name, species) {
    const humans = [0, 1].map((t) => this.players.filter((p) => !p.bot && p.team === t).length);
    const order = humans[0] <= humans[1] ? [0, 1] : [1, 0];
    for (const team of order) {
      const slot = this.claimSlot(team);
      if (slot < 0) continue;
      const p = this.makePlayer(team, slot, name, ws, species);
      this.players.push(p);
      if (this.tutorial) this.players.push(this.makeBot(team, 1 - slot)); // your practice partner
      this.hostId ??= p.id;
      this.rosterDirty = true;
      this.welcome(p);
      const h = homePos(team, slot, this.teamSize);
      this.teleport(p, h.x, h.z);
      return p;
    }
    return null;
  }

  welcome(p) {
    this.send(p, { t: 'welcome', id: p.id, key: p.key, code: this.code, team: p.team, isPublic: this.isPublic, tutorial: this.tutorial });
  }

  // The connection dropped: keep the spot (standing still) until the grace period runs out.
  hold(p) {
    if (!this.players.includes(p)) return;
    p.ws = null;
    p.heldUntil = Date.now() + RECONNECT_GRACE_MS;
    Object.assign(p, { mx: 0, mz: 0, aimF: 0, aimZ: 0 });
    this.rosterDirty = true;
  }

  // A reconnect with the secret key of a player we're holding (or whose old socket is half-dead).
  reattach(key, ws) {
    const p = this.players.find((q) => !q.bot && q.key === key);
    if (!p || p.gone) return null;
    const old = p.ws;
    p.ws = ws;
    p.heldUntil = 0;
    p.lastInputAt = Date.now();
    this.markActive(p);
    try {
      old?.close(4002, 'replaced');
    } catch {
      // already gone
    }
    this.rosterDirty = true;
    this.welcome(p);
    this.teleport(p, p.x, p.z);
    return p;
  }

  // Kicks don't wait for the socket's close event (a dead connection may never send one).
  kick(p, reason, closeCode) {
    p.gone = true;
    this.send(p, { t: 'kicked', reason });
    try {
      p.ws?.close(closeCode, reason);
    } catch {
      // already gone
    }
    this.removeHuman(p);
  }

  removeHuman(p) {
    const i = this.players.indexOf(p);
    if (i < 0) return;
    this.players.splice(i, 1);
    if (this.fillCpu) {
      const bot = this.makeBot(p.team, p.slot);
      Object.assign(bot, { x: p.x, y: p.y, z: p.z });
      this.players.push(bot);
    }
    if (this.hostId === p.id) this.hostId = this.players.find((q) => !q.bot)?.id ?? null;
    this.rosterDirty = true;
    if (this.phase !== 'lobby' && (!this.members(0).length || !this.members(1).length)) {
      this.events.push({ k: 'abort' });
      this.enterLobby();
    }
  }

  // ----- Pre-match controls -----

  pickTeam(p, team) {
    if (this.phase !== 'lobby' || (team !== 0 && team !== 1) || p.team === team) return;
    const slot = this.claimSlot(team);
    if (slot < 0) return this.send(p, { t: 'notice', code: 'teamFull', msg: 'That team is full' });
    const oldTeam = p.team;
    const oldSlot = p.slot;
    p.team = team;
    p.slot = slot;
    if (this.fillCpu) this.players.push(this.makeBot(oldTeam, oldSlot));
    const h = homePos(team, slot, this.teamSize);
    this.teleport(p, h.x, h.z);
    this.rosterDirty = true;
  }

  setCpu(p, on) {
    if (this.phase !== 'lobby' || p.id !== this.hostId) return;
    this.fillCpu = !!on;
    if (this.fillCpu) this.fillBots();
    else this.players = this.players.filter((q) => !q.bot);
    this.rosterDirty = true;
  }

  // Host picks the ball colour during warm-up; everyone in the room plays with it.
  setBallColor(p, color) {
    if (this.tutorial || this.phase !== 'lobby' || p.id !== this.hostId || !BALL_COLORS.includes(color)) return;
    this.ballColor = color;
    this.rosterDirty = true;
  }

  // Host picks the match format in private rooms (Quick Play stays on the default 3 minutes).
  setRules(p, r) {
    if (this.isPublic || this.tutorial || this.phase !== 'lobby' || p.id !== this.hostId || !r) return;
    if (r.mode === 'time' && MATCH_MINUTES.includes(r.minutes)) this.rules = { ...this.rules, mode: 'time', minutes: r.minutes };
    if (r.mode === 'points' && MATCH_POINTS.includes(r.points)) this.rules = { ...this.rules, mode: 'points', points: r.points };
    this.rosterDirty = true;
  }

  setTeamSize(p, size) {
    if (this.isPublic || this.tutorial || this.phase !== 'lobby' || p.id !== this.hostId || ![1, 2].includes(size) || size === this.teamSize) return;
    const humans = this.players.filter(q => !q.bot);
    if (humans.length > size * 2) return this.send(p, { t: 'notice', code: 'singlesFull', msg: '1v1 needs at most two players in the room' });
    // Keep human identities and reconnect keys. Remove only bots, then refill the new format.
    this.players = humans;
    this.teamSize = size;
    if (size === 1 && humans.length === 2 && humans[0].team === humans[1].team) {
      const guest = humans.find(q => q.id !== this.hostId);
      guest.team = 1 - p.team;
    }
    for (const team of [0, 1]) this.members(team).forEach((q, slot) => { q.slot = slot; });
    if (this.fillCpu) this.fillBots();
    this.serveIdx = [0, 0];
    this.enterLobby();
    this.rosterDirty = true;
  }

  startMatch(p) {
    if (this.tutorial || this.phase !== 'lobby' || p.id !== this.hostId) return;
    if (!this.members(0).length || !this.members(1).length) {
      return this.send(p, { t: 'notice', code: 'needPlayers', msg: 'Each team needs at least one player' });
    }
    this.clock = this.rules.mode === 'time' ? this.rules.minutes * 60 : null;
    this.suddenDeath = false;
    this.timeAnnounced = false;
    this.score = [0, 0];
    this.servingTeam = Math.random() < 0.5 ? 0 : 1;
    this.serveIdx = [0, 0];
    this.lastPointTeam = null;
    this.events.push({ k: 'start', rules: this.rules });
    this.startServe();
  }

  // Timed matches: the clock runs while the ball is being served or in play.
  // At 0 a live rally gets to finish; a tie goes to sudden death (next point wins).
  runClock(realDt) {
    if (this.clock === null || this.clock <= 0 || (this.phase !== 'serve' && this.phase !== 'rally')) return;
    this.clock = Math.max(0, this.clock - realDt);
    if (this.clock > 0) return;
    if (this.phase === 'rally') {
      this.timeAnnounced = true;
      this.events.push({ k: 'timeup', lastRally: true });
    } else this.endOnTime();
  }

  endOnTime() {
    if (this.score[0] !== this.score[1]) {
      const team = this.score[0] > this.score[1] ? 0 : 1;
      this.phase = 'over';
      this.phaseT = 0;
      this.lastPointTeam = team;
      if (!this.timeAnnounced) this.events.push({ k: 'timeup', lastRally: false });
      this.events.push({ k: 'over', team });
    } else if (!this.suddenDeath) {
      this.suddenDeath = true;
      this.events.push({ k: 'sudden' });
    }
  }

  enterLobby() {
    this.phase = 'lobby';
    this.phaseT = 0;
    this.touches = 0;
    this.lastTeam = null;
    for (const p of this.players) {
      const h = homePos(p.team, p.slot, this.teamSize);
      this.teleport(p, h.x, h.z);
    }
    this.tossWarmupBall();
  }

  // Warm-up: drop a fresh ball in from above one side of the court.
  // In the tutorial the ball just rests on the far side until the coach asks for a drill.
  tossWarmupBall() {
    if (this.tutorial) {
      this.warmupT = Infinity;
      Object.assign(this.ball, { x: 4, y: BALL_RADIUS, z: 0, vx: 0, vy: 0, vz: 0 });
      return;
    }
    this.warmupT = -1;
    const side = Math.random() < 0.5 ? -1 : 1;
    Object.assign(this.ball, { x: side * 4, y: 5, z: (Math.random() - 0.5) * 4, vx: 0, vy: 1, vz: 0 });
    this.lastTeam = null;
    this.touches = 0;
  }

  // ----- Tutorial drills -----

  drill(p, kind) {
    if (!this.tutorial || p.bot) return;
    const b = this.ball;
    const s = sideSign(p.team);
    const mate = this.members(p.team).find((q) => q !== p);
    if (kind === 'serve') {
      this.servingTeam = p.team;
      this.serveIdx[p.team] = this.members(p.team).indexOf(p);
      this.startServe();
      return;
    }
    if (this.phase !== 'lobby') return;
    this.warmupT = -1; // ball is live
    this.lastTeam = null;
    this.touches = 0;
    if (kind === 'pass') {
      // Coach lobs one over the net, right to you.
      Object.assign(b, { x: -s * 4, y: 2.2, z: clamp(p.z + (Math.random() - 0.5), -3, 3) });
      Object.assign(b, arcVelocity(b, { x: p.x, y: 1.0, z: p.z }, 5.2));
    } else if (kind === 'set' && mate) {
      // Your teammate sets you up right where you're standing by the net.
      Object.assign(b, { x: mate.x, y: 2.0, z: mate.z });
      Object.assign(b, arcVelocity(b, { x: p.x - s * 0.3, y: BALL_RADIUS, z: p.z }, 5.4));
      this.lastTeam = p.team;
      this.touches = 2;
      this.lastHitter = mate.id;
    } else if (kind === 'dive') {
      // A quick, low ball that lands about 3m to your side: too far to run to.
      const dir = p.z > 0 ? -1 : 1;
      Object.assign(b, { x: -s * 4, y: 2.4, z: clamp(p.z + dir * 3, -4, 4) });
      Object.assign(b, arcVelocity(b, { x: p.x - s * 0.5, y: BALL_RADIUS, z: clamp(p.z + dir * 3, -4.2, 4.2) }, 3.6));
    }
  }

  // ----- Input -----

  // Clients own their position (for responsive movement); the server clamps it and owns the ball.
  handleInput(p, m) {
    const s = sideSign(p.team);
    const now = Date.now();
    p.mx = clamp(num(m.mx), -1, 1);
    p.mz = clamp(num(m.mz), -1, 1);
    p.aimF = p.mx * -s;
    p.aimZ = p.mz;
    p.dive = clamp(num(m.dv) | 0, 0, 2);

    // Movement budget refills with real time; a move can't spend more than the budget holds.
    const dtReal = Math.min(1, (now - p.lastInputAt) / 1000);
    p.lastInputAt = now;
    p.moveBudget = Math.min(MOVE_BURST, p.moveBudget + (MOVE_RATE + (p.dive ? DIVE.speed : 0)) * dtReal);
    if (this.time >= p.ignoreUntil) {
      let x = num(m.x);
      let z = num(m.z);
      const dist = Math.hypot(x - p.x, z - p.z);
      if (dist > p.moveBudget) {
        // Too fast to be real (speed hack or teleport): only move as far as is possible, then resync the client.
        const allowed = p.moveBudget;
        const k = allowed / dist;
        x = p.x + (x - p.x) * k;
        z = p.z + (z - p.z) * k;
        p.moveBudget = 0;
        if (dist - allowed > 1) this.send(p, { t: 'tp', x, z });
      } else {
        p.moveBudget -= dist;
      }
      p.x = x;
      p.z = z;
      p.y = clamp(num(m.y), 0, MAX_Y);
      clampPlayer(p, p.team, this.phase === 'serve' && this.server === p);
    }

    const h = num(m.h) | 0;
    const pressed = h !== p.hitCount;
    if (pressed) {
      p.hitCount = h;
      p.tipNext = !!m.tp;
      if (p.cooldown <= 0) p.swingT = SWING_TIME;
    }
    if (pressed || Math.abs(p.mx) > 0.1 || Math.abs(p.mz) > 0.1 || p.y > 0.05 || p.dive) this.markActive(p);
    this.trackReaction(p, now);
  }

  // A direction change = starting to move, or turning more than 60°.
  trackReaction(p, now) {
    const len = Math.hypot(p.mx, p.mz);
    const oldLen = Math.hypot(p.dirX, p.dirZ);
    let changed = false;
    if (oldLen < 0.1) changed = len > 0.5;
    else if (len > 0.5) changed = (p.mx * p.dirX + p.mz * p.dirZ) / (len * oldLen) < 0.5;
    if (!changed) {
      if (len < 0.1 && oldLen >= 0.1) {
        p.dirX = 0;
        p.dirZ = 0;
        p.dirSince = now;
      }
      return;
    }
    p.dirX = p.mx;
    p.dirZ = p.mz;
    p.dirSince = now;
    if (!p.react) return;
    const ms = now - p.react;
    p.react = null;
    if (ms > REACT_WINDOW_MS) return;
    p.reactions.push(ms);
    if (p.reactions.length > 20) p.reactions.shift();
    if (p.reactions.length >= REACT_SAMPLES) {
      const sorted = [...p.reactions].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median < REACT_BOT_MS) this.removeBot(p, median);
    }
  }

  removeBot(p, median) {
    console.warn(`[${this.code}] removed ${p.name}: median reaction ${median}ms over ${p.reactions.length} samples (automated play)`);
    this.kick(p, 'bot', 4001);
  }

  markActive(p) {
    p.lastActive = Date.now();
    if (p.afkWarned) {
      p.afkWarned = false;
      this.send(p, { t: 'afk', s: 0 });
    }
  }

  // Serve meter, timed by the server: the client says when the needle starts; the serve itself stops it.
  // Both messages travel the same path, so lag cancels out and only jitter (a few %) remains.
  charge(p) {
    if (this.phase === 'serve' && this.server === p) p.chargeAt = Date.now();
    this.markActive(p);
  }

  // Warn idle players, then send them back to the title. Called about once a second.
  // Also lets go of dropped players who didn't come back, and counts how long the room's been empty.
  checkAfk() {
    const now = Date.now();
    for (const p of [...this.players]) {
      if (p.bot) continue;
      const idle = now - p.lastActive;
      if (p.heldUntil && now > p.heldUntil) {
        p.gone = true;
        this.removeHuman(p);
      } else if (idle > AFK_KICK_MS) {
        this.kick(p, 'afk', 4000);
      } else if (idle > AFK_WARN_MS && !p.afkWarned) {
        p.afkWarned = true;
        this.send(p, { t: 'afk', s: Math.round((AFK_KICK_MS - idle) / 1000) });
      }
    }
    this.emptyFor = this.humanCount ? 0 : this.emptyFor + 1;
  }

  teleport(p, x, z) {
    Object.assign(p, { x, z, y: 0, vy: 0, diveT: -1, ignoreUntil: this.time + 0.25, moveBudget: MOVE_BURST, chargeAt: null });
    if (!p.bot) this.send(p, { t: 'tp', x, z });
  }

  // 0 = not diving, 1 = lunging (can hit), 2 = down on the sand.
  diveOf(p) {
    if (!p.bot) return p.dive;
    const st = diveState(p);
    return st === 'lunge' ? 1 : st === 'down' ? 2 : 0;
  }

  startServe() {
    this.phase = 'serve';
    this.phaseT = 0;
    this.touches = 0;
    this.lastTeam = null;
    this.lastHitter = null;
    for (const p of this.players) {
      const h = homePos(p.team, p.slot, this.teamSize);
      p.swingT = 0;
      this.teleport(p, h.x, h.z);
    }
    const sv = this.server;
    this.teleport(sv, sideSign(sv.team) * (COURT.halfLength + 1.2), sv.slot === 0 ? -1.5 : 1.5);
  }

  // ----- Simulation -----

  // dt is real time; the game runs at timeScale (slowed briefly after spikes).
  tick(realDt) {
    this.afkClock = (this.afkClock ?? 0) + realDt;
    if (this.afkClock >= 1) {
      this.afkClock = 0;
      this.checkAfk();
    }
    this.slow = Math.max(0, this.slow - realDt);
    const { scale, rampOut } = SLOWMO;
    this.timeScale = this.slow > rampOut ? scale : scale + (1 - scale) * (1 - this.slow / rampOut);
    const dt = realDt * this.timeScale;
    this.time += dt;
    this.phaseT += dt;
    const live = this.phase === 'rally' || this.phase === 'lobby';
    for (const p of this.players) {
      if (live && !p.bot && p.swingT > 0 && p.swingT <= dt) this.whiff(p);
      p.cooldown = Math.max(0, p.cooldown - dt);
      p.blockCd = Math.max(0, p.blockCd - dt);
      p.swingT = Math.max(0, p.swingT - dt);
    }
    for (const p of this.players) if (p.bot) updateBot(p, this, dt);
    this.runClock(dt); // game time: the clock slows down with slow-mo too

    const b = this.ball;
    if (this.phase === 'serve') {
      const sv = this.server;
      Object.assign(b, { x: sv.x - sideSign(sv.team) * 0.45, y: sv.y + 1.55, z: sv.z, vx: 0, vy: 0, vz: 0 });
      if (sv.swingT > 0) this.serve(sv);
      else if (!sv.bot && this.phaseT > 12) {
        sv.servePower = 0.55; // AFK: a plain serve so the game keeps moving
        this.serve(sv);
      }
      return;
    }

    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const dirX = Math.sign(b.vx);
    const ev = stepBall(b, dt);
    if (this.phase === 'rally' || (this.phase === 'lobby' && this.warmupT < 0)) {
      if (ev === 'net' || ev === 'cord') {
        this.events.push({ k: 'net', cord: ev === 'cord' ? 1 : 0, z: r2(b.z), y: r2(b.y), v: r2(speed), dir: dirX });
      }
      if (ev === 'ground') {
        if (this.phase === 'rally') this.landed();
        else {
          this.warmupT = 1.2;
          this.events.push({ k: 'bounce', x: r2(b.x), z: r2(b.z) });
          if (this.tutorial) this.events.push({ k: 'drill', result: 'landed', x: r2(b.x), z: r2(b.z) });
        }
      } else {
        if (speed > 7.5) for (const p of this.players) this.tryBlock(p); // tips (~4 m/s) float over the hands
        for (const p of this.players) if (p.swingT > 0 && (this.phase === 'rally' || this.phase === 'lobby')) this.tryHit(p);
      }
    } else if (this.phase === 'lobby') {
      this.warmupT -= dt;
      if (this.warmupT <= 0) this.tossWarmupBall();
    } else if (this.phase === 'point' && this.phaseT > 2.4) {
      this.startServe();
    } else if (this.phase === 'over' && this.phaseT > 6) {
      this.clock = null;
      this.enterLobby();
    }
  }

  // Tell a player why their swing missed, if the ball was anywhere close.
  whiff(p) {
    const b = this.ball;
    const horiz = Math.hypot(b.x - p.x, b.z - p.z);
    if (horiz > 4.5) return;
    const diving = this.diveOf(p) === 1;
    const reach = diving ? DIVE.reach : PLAYER.reach;
    const rel = b.y - p.y;
    const why = horiz > reach ? 'far' : rel > (diving ? DIVE.reachHigh : PLAYER.reachHigh) ? 'early' : 'late';
    this.events.push({ k: 'whiff', id: p.id, why });
  }

  // A player in the air right at the net gets their hands on a hard-hit ball from the other side
  // and stuffs it straight back down. Soft balls (tips, lobs) float over the block.
  tryBlock(p) {
    const b = this.ball;
    const s = sideSign(p.team);
    if (p.y < 0.3 || p.blockCd > 0 || Math.abs(p.x) > 1.4 || this.lastTeam === p.team || b.vx * s <= 0) return;
    if (Math.abs(b.x) > 1.1 || Math.abs(b.z - p.z) > 0.75) return;
    const rel = b.y - p.y;
    if (rel < 1.3 || rel > 2.8 || b.y < NET.height - 0.1) return;
    if (p.bot && Math.random() < 0.4) {
      p.blockCd = 0.8; // CPU mistimed it: the spike gets past
      return;
    }
    if (Math.random() < 0.45) {
      // Soft block: fingertips slow it and pop it up on the blocker's side, still playable.
      b.vx *= 0.25;
      b.vy = Math.abs(b.vy) * 0.2 + 3.5;
      b.vz *= 0.5;
    } else {
      // Stuff block: straight back down on the attacker's side.
      b.x = -s * Math.max(Math.abs(b.x), BALL_RADIUS + 0.05);
      b.vx = -s * (Math.abs(b.vx) * 0.3 + 1.2);
      b.vy = -2 - Math.abs(b.vy) * 0.2;
      b.vz = b.vz * 0.4 + (Math.random() - 0.5) * 2;
    }
    p.blockCd = 0.8;
    this.slow = Math.max(this.slow, 0.6);
    // A block isn't one of the team's three touches.
    this.registerHit(p, 'block', 0);
  }

  // Lob toward target, raising the apex until it clears the net.
  launchArc(target, apex) {
    const b = this.ball;
    let v;
    for (let a = apex, i = 0; i < 12; i++, a += 0.5) {
      v = arcVelocity(b, target, a);
      const y0 = yAtX(b, v, 0);
      if (y0 === null || y0 > NET.height + BALL_RADIUS + 0.2) break;
    }
    Object.assign(b, v);
  }

  registerHit(p, kind, touches, perfect = false) {
    const b = this.ball;
    this.touches = touches;
    this.lastTeam = p.team;
    this.lastHitter = p.id;
    this.hitSeq++;
    this.lastKind = kind;
    this.lastPerfect = perfect;
    if (kind === 'spike') this.slow = SLOWMO.spike;
    p.cooldown = HIT_COOLDOWN;
    p.swingT = 0;
    this.events.push({ k: 'hit', kind, id: p.id, q: perfect ? 1 : 0, x: r2(b.x), y: r2(b.y), z: r2(b.z) });
    // Start the reaction clock for everyone on the other side who was holding steady.
    const now = Date.now();
    for (const q of this.players) {
      if (!q.bot && q.team !== p.team && now - q.dirSince >= REACT_STEADY_MS) q.react = now;
    }
  }

  // The serve meter decides the serve: too weak dies on your own side, too strong sails long.
  serve(sv) {
    const b = this.ball;
    const s = sideSign(sv.team);
    // Humans: power from the server's own timing of the meter. Bots pick theirs directly.
    let power = sv.servePower ?? 0.6;
    if (!sv.bot) {
      power = sv.chargeAt ? meterValue((Date.now() - sv.chargeAt) / 1000) : 0.55;
      sv.chargeAt = null;
    }
    const zone = serveZone(power);
    const z = clamp(sv.aimZ * 3.5 + (Math.random() - 0.5) * 0.6, -4, 4);
    // depth: how far past the net the ball lands (negative = still on your own side)
    if (zone === 'short') {
      const depth = -3 + (power / 0.3) * 2.5;
      Object.assign(b, arcVelocity(b, { x: -s * depth, y: BALL_RADIUS, z }, 2.8));
    } else if (zone === 'long') {
      const depth = 9.9 + ((power - 0.85) / 0.15) * 3;
      this.launchArc({ x: -s * depth, y: BALL_RADIUS, z }, 5.6);
    } else {
      const depth = clamp(2.5 + ((power - 0.3) / 0.55) * 5.8 + sv.aimF * 0.8, 2.2, 8.4);
      this.launchArc({ x: -s * depth, y: BALL_RADIUS, z }, zone === 'perfect' ? 4.3 : 5.4);
    }
    this.phase = 'rally';
    this.phaseT = 0;
    // The serve uses up the serving side's touches: it must go over.
    this.registerHit(sv, 'serve', MAX_TOUCHES, zone === 'perfect');
    this.events[this.events.length - 1].zone = zone;
  }

  tryHit(p) {
    const b = this.ball;
    const s = sideSign(p.team);
    const dive = this.diveOf(p);
    if (p.cooldown > 0 || dive === 2 || b.x * s < -0.8) return;
    const horiz = Math.hypot(b.x - p.x, b.z - p.z);
    const rel = b.y - p.y;
    const reach = dive ? DIVE.reach : PLAYER.reach;
    if (horiz > reach || rel < 0.05 || rel > (dive ? DIVE.reachHigh : PLAYER.reachHigh)) return;

    const warmup = this.phase === 'lobby' || this.tutorial;
    let touches = this.lastTeam === p.team ? this.touches + 1 : 1;
    if (touches > MAX_TOUCHES) {
      if (!warmup) return this.awardPoint(1 - p.team, 'touches', b);
      touches = 1;
    }

    const perfect = horiz < (dive ? 1.2 : 0.55);
    const airborne = p.y > 0.3;
    let kind;
    if (dive) kind = 'dig';
    else if (airborne && p.tipNext && b.y > NET.height - 0.2) kind = 'tip';
    else if (airborne && b.y > NET.height + 0.1 && Math.abs(p.x) < 5) kind = 'spike';
    else {
      // Smart touches: pass to your teammate, then set them up. Push toward the net to send it over
      // instead; the third touch always goes over.
      const over = touches >= MAX_TOUCHES || (p.bot ? p.wantOver : p.aimF > 0.5);
      kind = over ? 'bump' : touches === 1 ? 'pass' : 'set';
    }

    if (kind === 'spike') {
      const target = {
        x: -s * clamp(4 + p.aimF * 3, 1.5, 8.3),
        y: BALL_RADIUS,
        z: clamp(b.z + p.aimZ * 3.2, -4.1, 4.1),
      };
      let v;
      for (let T = perfect ? 0.34 : 0.4; T < 1.4; T += 0.05) {
        v = directVelocity(b, target, T);
        const y0 = yAtX(b, v, 0);
        if (y0 === null || y0 > NET.height + BALL_RADIUS + 0.1) break;
      }
      Object.assign(b, v);
    } else if (kind === 'tip') {
      // Soft touch just over the net, into the gap the blockers left.
      const target = {
        x: -s * clamp(1.4 + p.aimF * 0.8, 0.8, 3),
        y: BALL_RADIUS,
        z: clamp(b.z + p.aimZ * 2.5, -4.1, 4.1),
      };
      this.launchArc(target, Math.max(b.y + 0.5, NET.height + 1.1));
    } else if (kind === 'pass' || kind === 'set') {
      // Up to the net, right in front of your teammate (or yourself if you're playing alone).
      const mate = this.members(p.team).find((q) => q !== p);
      const laneZ = mate ? mate.z : p.z * 0.8;
      const target = { x: s * 1.5, y: BALL_RADIUS, z: clamp(laneZ + p.aimZ * 1.2, -3.5, 3.5) };
      Object.assign(b, arcVelocity(b, target, Math.max(b.y + 1.6, kind === 'pass' ? 4.8 : 5.4)));
    } else if (kind === 'dig' && touches < MAX_TOUCHES) {
      // A save pops the ball up high on your own side so the team can play it.
      const target = { x: s * 3, y: BALL_RADIUS, z: clamp(p.z * 0.5, -3, 3) };
      Object.assign(b, arcVelocity(b, target, Math.max(b.y + 2.5, 4.8)));
    } else {
      const target = {
        x: -s * clamp(4.5 + p.aimF * 3, 2, 8.3),
        y: BALL_RADIUS,
        z: clamp(b.z * 0.4 + p.aimZ * 3.5, -4.1, 4.1),
      };
      this.launchArc(target, 4.8);
    }
    p.tipNext = false;
    this.registerHit(p, kind, touches, perfect);
  }

  landed() {
    const b = this.ball;
    if (this.tutorial) {
      // Practice serves aren't scored: report where it landed and reset.
      this.events.push({ k: 'drill', result: 'landed', x: r2(b.x), z: r2(b.z) });
      this.phase = 'lobby';
      this.phaseT = 0;
      this.warmupT = 1.2;
      return;
    }
    const inside = Math.abs(b.x) <= COURT.halfLength + BALL_RADIUS && Math.abs(b.z) <= COURT.halfWidth + BALL_RADIUS;
    const landedTeam = b.x < 0 ? 0 : 1;
    const winner = inside ? 1 - landedTeam : 1 - this.lastTeam;
    if (inside && this.lastKind === 'spike') this.slow = SLOWMO.kill;
    this.awardPoint(winner, inside ? 'in' : 'out', b);
  }

  awardPoint(team, reason, where) {
    this.score[team]++;
    this.lastPointTeam = team;
    if (team !== this.servingTeam) {
      this.servingTeam = team;
      this.serveIdx[team]++;
    }
    this.events.push({ k: 'point', team, reason, x: r2(where.x), z: r2(where.z) });
    const lead = this.score[team] - this.score[1 - team];
    const timed = this.clock !== null;
    let won = false;
    if (timed && this.suddenDeath) won = true; // golden point
    else if (!timed && this.score[team] >= this.rules.points && lead >= 2) won = true;
    this.phaseT = 0;
    if (won) {
      this.phase = 'over';
      this.events.push({ k: 'over', team });
    } else {
      this.phase = 'point';
      if (timed && this.clock <= 0) this.endOnTime(); // the last rally just ended
    }
  }

  // ----- Voice chat -----
  // Voice is peer-to-peer (WebRTC); the room only says who's in voice and passes along the
  // offers/answers that set each connection up. Audio never goes through the server.

  setVoice(p, on) {
    const voice = !!on;
    if (p.bot || p.voice === voice) return;
    p.voice = voice;
    this.rosterDirty = true;
  }

  relayRtc(p, to, d) {
    if (!d || (d.type !== 'offer' && d.type !== 'answer') || typeof d.sdp !== 'string' || d.sdp.length > 10000) return;
    const q = this.players.find((x) => x.id === to && !x.bot);
    if (!q || q === p || !p.voice) return;
    this.send(q, { t: 'rtc', from: p.id, d: { type: d.type, sdp: d.sdp } });
  }

  // ----- Networking -----

  send(p, msg) {
    if (p.ws?.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  broadcast(str) {
    for (const p of this.players) if (p.ws?.readyState === 1) p.ws.send(str);
  }

  flush() {
    // Everyone's ping, every couple of seconds.
    this.pingTick = ((this.pingTick ?? 0) + 1) % 60;
    if (this.pingTick === 0) {
      this.broadcast(JSON.stringify({ t: 'pings', p: this.players.filter((p) => !p.bot && p.ping != null).map((p) => [p.id, p.ping]) }));
    }
    if (this.rosterDirty) {
      this.rosterDirty = false;
      this.broadcast(JSON.stringify({
        t: 'roster',
        code: this.code,
        host: this.hostId,
        cpu: this.fillCpu,
        rules: this.rules,
        ball: this.ballColor,
        isPublic: this.isPublic,
        teamSize: this.teamSize,
        players: this.players.map(({ id, name, team, slot, bot, look, heldUntil, voice }) => ({ id, name, team, slot, bot, look, off: heldUntil ? 1 : 0, vc: voice ? 1 : 0 })),
      }));
    }
    const b = this.ball;
    this.broadcast(JSON.stringify({
      t: 's',
      ph: this.phase,
      ts: Math.round(this.timeScale * 100) / 100,
      clk: this.clock === null ? null : Math.ceil(this.clock),
      sd: this.suddenDeath ? 1 : 0,
      sv: this.phase === 'serve' ? this.server?.id : null,
      sc: this.score,
      tc: this.touches,
      lt: this.lastTeam,
      lp: this.lastPointTeam,
      b: [b.x, b.y, b.z, b.vx, b.vy, b.vz].map(r3),
      // flags: bit0 swinging, bits1-2 dive state (1 lunge, 2 down)
      p: this.players.map((p) => [p.id, r2(p.x), r2(p.y), r2(p.z), (p.swingT > 0 ? 1 : 0) | (this.diveOf(p) << 1)]),
      ev: this.events,
    }));
    this.events = [];
  }
}

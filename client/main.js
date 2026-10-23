import * as THREE from 'three';
import { buildWorld } from './scene/world.js';
import { Character } from './scene/character.js';
import { SPECIES } from './scene/species.js';
import { createBall } from './scene/ball.js';
import { Effects } from './scene/effects.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { Hud } from './hud.js';
import { sfx, music, setVolumes } from './audio.js';
import { settings, onSettings, setSetting } from './settings.js';
import { setupMenus } from './menus.js';
import { Tutorial } from './tutorial.js';
import { initTurnstile, humanToken, spendToken } from './turnstile.js';
import { CameraDirector } from './camera.js';
import { setupTouch } from './touch.js';
import { stepPlayer, stepBall, predictLanding, sideSign, startDive, diveState, meterValue } from '../shared/physics.js';
import { BALL_RADIUS, SWING_TIME, PLAYER, DIVE, NET } from '../shared/constants.js';
import { t, teamName, applyStatic } from './i18n.js';

const SEND_HZ = 30;

// ---------- Renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1400);
camera.position.set(-20, 10, 0);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const world = buildWorld(scene);
const ballView = createBall(scene);
const effects = new Effects(scene, camera);
const director = new CameraDirector(camera);

// Graphics quality: resolution scale and shadows.
function applyQuality(q) {
  const ratio = { high: Math.min(devicePixelRatio, 2), medium: Math.min(devicePixelRatio, 1.5), low: 1 }[q] ?? 1;
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight);
  const shadows = q !== 'low';
  if (renderer.shadowMap.enabled !== shadows) {
    renderer.shadowMap.enabled = shadows;
    scene.traverse((o) => {
      for (const m of [].concat(o.material ?? [])) m.needsUpdate = true;
    });
  }
}
const input = new Input(renderer.domElement);
const hud = new Hud();
const net = new Net();
setupTouch(input);

onSettings((st) => {
  setVolumes({ master: st.master, music: st.music, sfx: st.sfx });
  applyQuality(st.quality);
});

// Leaving drops the connection (the server hands your spot back to a CPU) and returns to the title.
setupMenus({
  input,
  inGame: () => state.joined,
  onInvite: () => hud.copyInvite(),
  onLeave: () => {
    net.ws?.close();
    location.href = `${location.origin}/`;
  },
});

// Soft pop on every button press.
addEventListener('click', (e) => {
  if (e.target.closest('button')) sfx.click();
});

// Music needs a user gesture to start (browser autoplay rules).
const muteBtn = document.getElementById('mute');
const syncMute = () => (muteBtn.textContent = music.muted ? '🔇' : '🎵');
syncMute();
addEventListener('pointerdown', () => music.start(), { once: true });
addEventListener('keydown', () => music.start(), { once: true });
muteBtn.onclick = (e) => {
  e.stopPropagation();
  music.start();
  music.toggleMute();
  syncMute();
};
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) {
    music.toggleMute();
    syncMute();
  }
});

// Lobby showcase: the whole cast lined up, your pick steps forward.
const SHOWCASE = new THREE.Vector3(-5, 0, 0);
const lineup = SPECIES.map((_, i) => {
  const c = new Character({ team: i % 2, species: i });
  scene.add(c.root);
  return c;
});
let picked = Number(localStorage.getItem('volley:char')) || 0;
function pick(i) {
  picked = (i + SPECIES.length) % SPECIES.length;
  localStorage.setItem('volley:char', picked);
  const sp = SPECIES[picked];
  document.getElementById('char-name').textContent = sp.name;
  document.getElementById('char-title').textContent = t(`species.${picked}.title`);
  document.getElementById('char-line').textContent = t(`species.${picked}.tagline`);
  lineup[picked].landT = 0; // little jelly bounce when chosen
}
document.getElementById('char-prev').onclick = () => pick(picked - 1);
document.getElementById('char-next').onclick = () => pick(picked + 1);
pick(picked);

// ---------- Game state ----------
const state = {
  joined: false,
  myId: null,
  myTeam: 0,
  phase: 'serve',
  serverId: null,
  score: [0, 0],
  touches: 0,
  lastTeam: null,
  lastPointTeam: null,
  players: new Map(), // id -> { info, char, x,y,z (rendered), tx,ty,tz (latest snapshot), swingT, swingKind }
  ball: { snap: null, snapAt: 0, render: new THREE.Vector3(0, 3, 0), offset: new THREE.Vector3() },
  rtt: 80,
  ts: 1, // server time scale (< 1 during slow-mo)
  tsView: 1, // smoothed copy used for local simulation and animation
  phaseAt: 0,
  lastHitKind: null,
  room: null, // latest roster: { players, host, cpu, teamSize }
};
const me = { x: 0, y: 0, z: 0, vy: 0, ry: 0, mx: 0, mz: 0, hitCount: 0, diveT: -1, charge: -1, servePower: 0.6 };
let sendAcc = 0;
let pingAcc = 0;
const meVel = new THREE.Vector3();
let tutorial = null; // set when this room is the tutorial

const r3 = (v) => Math.round(v * 1000) / 1000;

function sendInput() {
  const dv = { lunge: 1, down: 2 }[diveState(me)] ?? 0;
  net.send({ t: 'in', x: r3(me.x), y: r3(me.y), z: r3(me.z), mx: r3(me.mx), mz: r3(me.mz), h: me.hitCount, dv, pw: r3(me.servePower), tp: me.tip ? 1 : 0 });
}

// Hands-overhead position for whoever is holding the serve.
function holdPos(p, team) {
  return { x: p.x - sideSign(team) * 0.45, y: p.y + 1.55, z: p.z, vx: 0, vy: 0, vz: 0 };
}

// The ball is fully deterministic between hits, so extrapolate it to "now" (plus half the RTT)
// instead of showing it in the past.
function predictBall(now) {
  const snap = state.ball.snap;
  if (state.phase === 'serve') {
    if (state.serverId === state.myId) {
      // While charging, the ball bounces in your hands and rises with the power.
      const b = holdPos(me, state.myTeam);
      if (me.charge >= 0) b.y += meterValue(me.charge) * 0.35 + Math.abs(Math.sin(me.charge * 14)) * 0.05;
      return b;
    }
    const holder = state.players.get(state.serverId);
    return holder ? holdPos(holder, holder.info.team) : { ...snap };
  }
  const b = { ...snap };
  let lead = Math.min(0.35, (now - state.ball.snapAt) / 1000 + state.rtt / 2000) * state.tsView;
  while (lead > 1e-6) {
    const d = Math.min(1 / 120, lead);
    stepBall(b, d);
    lead -= d;
  }
  return b;
}

// ---------- Network handlers ----------
net.on('welcome', (m) => {
  joinWait?.(null);
  state.joined = true;
  if (m.tutorial) {
    tutorial = new Tutorial({ scene, net, sfx, state, me, input });
    tutorial.start();
  }
  state.myId = m.id;
  state.myTeam = m.team;
  lineup.forEach((c) => c.dispose(scene));
  director.sync(lobbyLook);
  hud.enterGame(m.code);
  const url = new URL(location.href);
  url.searchParams.set('room', m.code);
  history.replaceState(null, '', url);
});

net.on('roster', (m) => {
  const seen = new Set();
  for (const info of m.players) {
    seen.add(info.id);
    let p = state.players.get(info.id);
    if (!p || p.info.team !== info.team) {
      p?.char.dispose(scene);
      const char = new Character({ team: info.team, species: info.look?.species });
      scene.add(char.root);
      p = {
        info, char, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0,
        swingT: 0, swingKind: 'bump', swingFlag: 0, dive: 0, init: false, stride: 0, effort: false,
      };
      state.players.set(info.id, p);
    }
    p.info = info;
    p.char.setLabel(info.name, info.id === state.myId);
    if (info.id === state.myId) state.myTeam = info.team;
  }
  for (const [id, p] of state.players) {
    if (!seen.has(id)) {
      p.char.dispose(scene);
      state.players.delete(id);
    }
  }
  state.room = { players: m.players, host: m.host, cpu: m.cpu, teamSize: m.teamSize, rules: m.rules, isPublic: m.isPublic, myId: state.myId };
  refreshRoster();
});
net.on('notice', (m) => hud.toast(m.code ? t(`err.${m.code}`) : m.msg));

// Anti-AFK: the server warns 30s before sending an idle player back to the title.
let afkDeadline = 0;
net.on('afk', (m) => (afkDeadline = m.s > 0 ? performance.now() + m.s * 1000 : 0));
net.on('kicked', (m) => {
  sessionStorage.setItem('volley:notice', m.reason);
  location.href = `${location.origin}/`;
});
setInterval(() => {
  const left = Math.ceil((afkDeadline - performance.now()) / 1000);
  const el = document.getElementById('afk');
  el.classList.toggle('hidden', !(afkDeadline && left > 0));
  if (afkDeadline && left > 0) el.textContent = t('afk.warn', { s: left });
}, 250);
initTurnstile().catch(() => {});
const notice = sessionStorage.getItem('volley:notice');
if (notice === 'afk') hud.lobbyError(t('afk.kicked'));
if (notice === 'bot') hud.lobbyError(t('bot.kicked'));
sessionStorage.removeItem('volley:notice');

net.on('tp', (m) => Object.assign(me, { x: m.x, z: m.z, y: 0, vy: 0, diveT: -1 }));

net.on('s', (m) => {
  state.clock = m.clk;
  state.suddenDeath = !!m.sd;
  if (m.ph !== state.phase) state.phaseAt = performance.now();
  state.phase = m.ph;
  state.ts = m.ts ?? 1;
  state.serverId = m.sv;
  state.score = m.sc;
  state.touches = m.tc;
  state.lastTeam = m.lt;
  state.lastPointTeam = m.lp;

  for (const [id, x, y, z, flags] of m.p) {
    const sw = flags & 1;
    const p = state.players.get(id);
    if (!p) continue;
    Object.assign(p, { tx: x, ty: y, tz: z });
    if (!p.init) Object.assign(p, { x, y, z, init: true });
    if (sw && !p.swingFlag && id !== state.myId) {
      p.swingT = SWING_TIME;
      p.swingKind = y > 0.3 ? 'spike' : 'bump';
    }
    p.swingFlag = sw;
    if (id !== state.myId) p.dive = flags >> 1;
  }

  // Re-anchor ball prediction; keep the visual continuous by blending out the correction.
  const now = performance.now();
  const before = state.ball.render.clone();
  const hadSnap = !!state.ball.snap;
  const [x, y, z, vx, vy, vz] = m.b;
  state.ball.snap = { x, y, z, vx, vy, vz };
  state.ball.snapAt = now;
  const pred = predictBall(now);
  const off = before.sub(new THREE.Vector3(pred.x, pred.y, pred.z));
  if (!hadSnap || off.length() > 3 || m.ph === 'serve') off.set(0, 0, 0);
  state.ball.offset.copy(off);

  for (const ev of m.ev) handleEvent(ev);
  hud.score(m.sc);
});

net.on('pong', (m) => {
  const sample = performance.now() - m.c;
  state.rtt = state.measured ? state.rtt * 0.7 + sample * 0.3 : sample;
  state.measured = true;
});
net.on('pings', (m) => {
  state.pings = new Map(m.p);
  refreshRoster();
});
function currentPings() {
  const pings = new Map(state.pings ?? []);
  if (state.measured) pings.set(state.myId, Math.round(state.rtt)); // your own is always fresh
  return pings;
}
function refreshRoster() {
  if (state.room) hud.roster(state.room.players, state.myId, currentPings());
}
net.on('error', (m) => {
  joinWait?.(m.code);
  if (m.code !== 'roomTaken') hud.lobbyError(m.code ? t(`err.${m.code}`) : m.msg);
});
net.on('close', () => {
  if (state.joined) hud.banner(t('ban.disconnected'), t('ban.refresh'), 1e9);
});

const SERVE_CALL_STYLE = { short: 'miss', long: 'miss', good: '', perfect: 'perfect' };
const screenV = new THREE.Vector3();
function toScreen(x, y, z) {
  screenV.set(x, y, z).project(camera);
  return { x: (screenV.x * 0.5 + 0.5) * innerWidth, y: (-screenV.y * 0.5 + 0.5) * innerHeight, behind: screenV.z > 1 };
}
// Stereo pan from where it happens on screen, a bit quieter the farther from the camera.
function spatial(x, y, z) {
  const p = toScreen(x, y, z);
  const dist = camera.position.distanceTo(screenV.set(x, y, z));
  return { pan: p.behind ? 0 : Math.max(-0.8, Math.min(0.8, (p.x / innerWidth) * 2 - 1)), vol: Math.max(0.45, Math.min(1, 1.25 - dist / 30)) };
}
function floatAt(text, x, y, z, cls) {
  const p = toScreen(x, y, z);
  if (!p.behind) hud.float(text, p.x, p.y, cls);
}

function handleEvent(ev) {
  tutorial?.onEvent(ev);
  if (ev.k === 'hit') {
    sfx.hit(ev.kind, spatial(ev.x, ev.y, ev.z));
    effects.burst(new THREE.Vector3(ev.x, ev.y, ev.z), ev.kind);
    state.lastHitKind = ev.kind;
    const p = state.players.get(ev.id);
    if (ev.kind === 'spike') {
      state.tsView = state.ts = 0.2; // start the slow-mo right away; snapshots keep it in sync
      director.spike(new THREE.Vector3(ev.x, ev.y, ev.z), p?.info.team ?? 0);
      sfx.slowmo();
      hud.pop(t('call.spike'));
      hud.cinema(true);
    }
    if (p && ev.id !== state.myId) {
      p.swingT = SWING_TIME;
      p.swingKind = ev.kind;
    }
    if (ev.kind === 'block') {
      hud.pop(t('call.block'));
      director.impact(0.3);
    }
    if (ev.kind === 'tip') floatAt(t('call.tip'), ev.x, ev.y + 0.6, ev.z, 'save');
    if (ev.kind === 'dig') {
      floatAt(t('call.save'), ev.x, ev.y + 0.8, ev.z, 'save');
      effects.dust(ev.x, ev.z);
    }
    if (ev.id === state.myId && ev.q) floatAt(t('call.perfect'), ev.x, ev.y + 0.5, ev.z, 'perfect');
    if (ev.kind === 'serve' && ev.zone) {
      floatAt(t(`serve.${ev.zone}`), ev.x, ev.y + 1, ev.z, SERVE_CALL_STYLE[ev.zone]);
      if (ev.id === state.myId) sfx.serveResult(ev.zone);
    }
  } else if (ev.k === 'whiff') {
    if (ev.id === state.myId) {
      floatAt(t(`call.${ev.why}`), me.x, me.y + 2.2, me.z, 'miss');
      sfx.whiff();
    }
  } else if (ev.k === 'bounce') {
    effects.puff(ev.x, ev.z);
  } else if (ev.k === 'start') {
    sfx.whistle();
    const r = ev.rules ?? state.room?.rules;
    hud.banner(t('ban.start'), r?.mode === 'points' ? t('ban.startPoints', { n: r.points }) : t('ban.startTime', { n: r?.minutes ?? 3 }), 2200);
  } else if (ev.k === 'timeup') {
    sfx.whistle();
    hud.banner(t('ban.timeup'), ev.lastRally ? t('ban.lastRally') : '', 2200);
  } else if (ev.k === 'sudden') {
    sfx.slowmo();
    hud.banner(t('ban.sudden'), t('ban.suddenSub'), 2600);
  } else if (ev.k === 'abort') {
    hud.banner(t('ban.stopped'), t('ban.stoppedSub'), 2500);
  } else if (ev.k === 'net') {
    sfx.net(ev.cord, spatial(0, ev.y, ev.z));
    world.net.impulse(ev.z, ev.y, Math.min(ev.v, 22) * (ev.cord ? 0.6 : 1.3), ev.dir || 1);
    if (ev.cord) floatAt(t('call.netCord'), 0, ev.y + 0.8, ev.z, '');
  } else if (ev.k === 'point') {
    sfx.whistle();
    const kill = ev.reason === 'in' && state.lastHitKind === 'spike';
    const sneaky = ev.reason === 'in' && state.lastHitKind === 'tip';
    const stuffed = ev.reason === 'in' && state.lastHitKind === 'block';
    if (ev.reason !== 'touches') effects.dust(ev.x, ev.z, kill);
    if (kill) {
      director.impact(0.45);
      sfx.hit('spike', spatial(ev.x, 0.3, ev.z));
    }
    const mine = ev.team === state.myTeam;
    sfx.crowd(mine);
    world.cheer?.(ev.team);
    const special = kill ? t('ban.smash') : sneaky ? t('ban.sneaky') : stuffed ? t('ban.stuffed') : null;
    const pointTeam = t('ban.pointTeam', { team: teamName(ev.team) });
    const title = special ?? (mine ? t('ban.pointMine') : pointTeam);
    hud.banner(title, special ? pointTeam : t(`reason.${ev.reason}`));
  } else if (ev.k === 'over') {
    sfx.fanfare();
    hud.banner(t('ban.wins', { team: teamName(ev.team) }), ev.team === state.myTeam ? t('ban.victory') : t('ban.rematch'), 5500);
  }
}

hud.on('team', (d) => net.send({ t: 'team', team: Number(d.team) }));
hud.on('cpu', () => net.send({ t: 'cpu', on: !state.room?.cpu }));
hud.on('start', () => net.send({ t: 'start' }));
hud.on('rules', (d) => {
  const n = Number(d.n);
  net.send({ t: 'rules', rules: d.mode === 'time' ? { mode: 'time', minutes: n } : { mode: 'points', points: n } });
});
hud.on('invite', () => hud.copyInvite());

// ---------- Lobby ----------
async function join(mode) {
  sfx.unlock();
  hud.lobbyError('');
  localStorage.setItem('volley:name', hud.name);
  if (mode === 'code' && hud.code.length !== 4) return hud.lobbyError(t('err.code'));
  // Prove we're human (Turnstile), get a room code + signed ticket, then connect to that room.
  for (let attempt = 0; attempt < 3; attempt++) {
    let code;
    try {
      let token;
      try {
        token = await humanToken();
      } catch {
        return hud.lobbyError(t('err.human'));
      }
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, code: hud.code, 'cf-turnstile-response': token }),
      });
      spendToken();
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        return hud.lobbyError(t(`err.${error === 'rateLimited' || error === 'human' || error === 'roomNotFound' ? error : 'server'}`));
      }
      const joinInfo = await res.json();
      code = joinInfo.code;
      await net.connect(`/ws/${encodeURIComponent(code)}?mode=${mode}&ticket=${encodeURIComponent(joinInfo.ticket)}`);
    } catch {
      return hud.lobbyError(t('err.server'));
    }
    const rejected = await new Promise((resolve) => {
      joinWait = resolve;
      net.send({ t: 'join', mode, code, name: hud.name, char: picked });
    });
    joinWait = null;
    if (rejected !== 'roomTaken') return; // brand-new codes can (very rarely) collide: just try another
  }
}
let joinWait = null; // resolves with an error code, or null once we're welcomed
document.getElementById('btn-quick').onclick = () => join('quick');
document.getElementById('btn-tutorial').onclick = () => join('tutorial');
document.getElementById('tut-play').onclick = () => (location.href = `${location.origin}/?play=quick`);
document.getElementById('tut-menu').onclick = () => (location.href = `${location.origin}/`);
if (!localStorage.getItem('volley:tutorialDone')) document.getElementById('btn-tutorial').classList.add('suggest');
// Coming from "Play a match!" at the end of the tutorial: jump straight into Quick Play.
if (new URLSearchParams(location.search).get('play') === 'quick') {
  history.replaceState(null, '', location.pathname);
  setTimeout(() => join('quick'), 300);
}
document.getElementById('btn-create').onclick = () => join('create');
document.getElementById('btn-join').onclick = () => join('code');
document.getElementById('code').addEventListener('keydown', (e) => e.key === 'Enter' && join('code'));

// ---------- Net contact ----------
// The visible cloth reacts to whatever touches it: the ball sinking in, bodies leaning on it,
// blockers' hands at the tape, and balls whooshing just over the top.
let skimCooldown = 0;
function pressNet(ballPos, dt) {
  const cloth = world.net;
  const r = BALL_RADIUS;
  if (Math.abs(ballPos.x) < r + 0.05 && ballPos.y > NET.bottom - r && ballPos.y < NET.height) {
    const side = ballPos.x < 0 ? -1 : 1;
    cloth.press(ballPos.z, ballPos.y, -side * (r + 0.05 - Math.abs(ballPos.x)) * 1.6, 0.75);
  }
  skimCooldown -= dt;
  if (skimCooldown <= 0 && Math.abs(ballPos.x) < 0.4 && ballPos.y > NET.height && ballPos.y < NET.height + 0.6) {
    const bs = state.ball.snap;
    cloth.impulse(ballPos.z, NET.height, 2.5, Math.sign(bs?.vx || 1)); // tape flutters in the ball's wake
    skimCooldown = 0.4;
  }
  for (const p of state.players.values()) {
    const reach = 0.85;
    if (Math.abs(p.x) > reach) continue;
    const side = p.x < 0 ? -1 : 1;
    const depth = -side * (reach - Math.abs(p.x)) * 0.8;
    cloth.press(p.z, Math.min(NET.height, p.y + 1.0), depth, 0.7); // body
    if (p.y > 0.3) cloth.press(p.z, NET.height, depth * 1.4, 0.9); // blocking hands over the tape
  }
}

// ---------- Frame loop ----------
const tmpV = new THREE.Vector3();
const SPIKE_Y = 3.1;

// Auto-dive: the spot to dive at when the ball is out of bump range, too far to run down
// in time, but close enough to save. Null when a dive isn't the answer.
function saveTarget(bs) {
  const live = state.phase === 'rally' || state.phase === 'lobby';
  if (!live || !bs || me.y > 0.01 || me.diveT >= 0 || bs.vy >= 0) return null;
  const s = sideSign(state.myTeam);
  if (Math.hypot(bs.x - me.x, bs.z - me.z) < PLAYER.reach && bs.y - me.y < PLAYER.reachHigh) return null; // just hit it
  const low = predictLanding(bs, 0.6);
  if (!low || low.x * s <= 0 || low.t > 0.55) return null;
  const d = Math.hypot(low.x - me.x, low.z - me.z);
  const onFoot = PLAYER.reach + PLAYER.speed * low.t * 0.8;
  if (d <= onFoot || d > DIVE.reach + DIVE.speed * DIVE.lunge * 0.7) return null; // can run there, or hopeless
  return low;
}

// What should you press right now? Shown as a floating button above your head.
// What a ground hit will do right now (mirrors the server): pass to your teammate on the first touch,
// set them up on the second, over the net on the third or when you push toward the net.
function touchKind(forward) {
  const used = state.lastTeam === state.myTeam ? state.touches : 0;
  if (used + 1 >= 3 || forward) return 'bump';
  return used === 0 ? 'pass' : 'set';
}

function contextPrompt(serving, bs, forward) {
  if (serving) return me.charge >= 0 ? { action: 'hit', label: t('prompt.stop'), urgent: true } : { action: 'hit', label: t('prompt.charge') };
  const live = state.phase === 'rally' || state.phase === 'lobby';
  if (!live || !bs || me.diveT >= 0) return null;
  const s = sideSign(state.myTeam);
  if (bs.x * s < -0.8) return null; // ball's on their side
  const horiz = Math.hypot(bs.x - me.x, bs.z - me.z);
  const rel = bs.y - me.y;
  if (horiz < PLAYER.reach && rel > 0.1 && rel < PLAYER.reachHigh) {
    if (me.y > 0.3 && bs.y > NET.height - 0.2) return { action: 'hit', label: t('prompt.spike'), urgent: true, alt: { action: 'tip', label: t('prompt.tip') } };
    return { action: 'hit', label: t({ pass: 'prompt.pass', set: 'prompt.set', bump: 'prompt.over' }[touchKind(forward)]) };
  }
  if (bs.vy < 0) {
    if (saveTarget(bs)) return { action: 'hit', label: t('prompt.dive'), urgent: true };
    const top = predictLanding(bs, SPIKE_Y);
    if (top && me.y === 0 && Math.abs(me.x) < 4.5 && top.t < 0.55 && Math.hypot(top.x - me.x, top.z - me.z) < 1.3) {
      return { action: 'jump', label: t('prompt.jump') };
    }
  }
  return null;
}

function updateGame(realDt, now) {
  state.tsView += (state.ts - state.tsView) * (1 - Math.exp(-realDt * 12));
  hud.cinema(state.tsView < 0.85);
  music.setMuffled(state.tsView < 0.85);
  music.setMode(state.phase === 'lobby' ? 'lobby' : 'match');
  const dt = realDt * state.tsView; // game time: everything slows together in slow-mo
  const s = sideSign(state.myTeam);
  const serving = state.phase === 'serve' && state.serverId === state.myId;

  const live = state.phase === 'rally' || state.phase === 'lobby';

  // Camera-relative controls: "forward" always points at the net.
  const mv = input.move();
  me.mx = -s * mv.y;
  me.mz = -s * mv.x;
  const forward = mv.y > 0.5; // pushing toward the net
  const jump = input.consume('jump');
  if (jump && me.y <= 0.001 && me.diveT < 0) sfx.jump();
  const self = state.players.get(state.myId);

  // Tip: in the air, a soft touch over the block instead of a spike.
  if (me.y > 0.3 && live && input.consume('tip')) {
    me.tip = true;
    me.hitCount++;
    if (self) {
      self.swingT = SWING_TIME;
      self.swingKind = 'tip';
    }
    sfx.swing();
    sendInput();
  }

  const prevX = me.x;
  const prevZ = me.z;
  const wasAir = me.y > 0.05 && me.diveT < 0;
  stepPlayer(me, me.mx, me.mz, jump, dt, state.myTeam, serving);
  if (wasAir && me.y <= 0.001) sfx.land();
  meVel.set((me.x - prevX) / Math.max(dt, 1e-3), 0, (me.z - prevZ) / Math.max(dt, 1e-3));

  // Serve mini-game: first press starts the power meter, second press locks it in and serves.
  if (!serving) me.charge = -1;
  else if (me.charge >= 0) me.charge += realDt;
  if (serving && input.consume('hit')) {
    if (me.charge < 0) {
      me.charge = 0;
      net.send({ t: 'charge' }); // the server times the meter too, so the power can't be faked
      sfx.charge();
    } else {
      me.servePower = meterValue(me.charge);
      me.charge = -1;
      me.hitCount++;
      if (self) {
        self.swingT = SWING_TIME;
        self.swingKind = 'serve';
      }
      sfx.swing();
      sendInput();
    }
  }
  hud.serveMeter(serving && me.charge >= 0 ? meterValue(me.charge) : null);

  // Auto-dive: pressing Hit when only a dive can reach the ball throws you at it.
  const save = !serving && input.enabled && input.pressed.hit > 0 ? saveTarget(state.ball.snap ? predictBall(now) : null) : null;
  if (save && startDive(me, save.x - me.x, save.z - me.z)) {
    input.consume('hit');
    me.tip = false;
    me.hitCount++;
    if (self) {
      self.swingT = SWING_TIME;
      self.swingKind = 'dig';
    }
    sfx.dive();
    sendInput();
  }

  if (input.consume('hit') && me.diveT < 0) {
    me.tip = false;
    me.hitCount++;
    if (self) {
      self.swingT = SWING_TIME;
      self.swingKind = serving ? 'serve' : me.y > 0.3 ? 'spike' : touchKind(forward);
    }
    sfx.swing();
    sendInput();
  }
  sendAcc += realDt;
  if (sendAcc >= 1 / SEND_HZ) {
    sendAcc = 0;
    sendInput();
  }
  pingAcc += realDt;
  if (pingAcc > 2 || !state.measured) {
    pingAcc = state.measured ? 0 : -0.5; // measure right away after joining
    net.send({ t: 'ping', c: performance.now(), rtt: state.measured ? Math.round(state.rtt) : undefined });
  }

  // Ball
  const bs = state.ball.snap ? predictBall(now) : null;
  if (bs) {
    state.ball.offset.multiplyScalar(Math.exp(-realDt * 10));
    state.ball.render.set(bs.x, bs.y, bs.z).add(state.ball.offset);
  }
  const ballPos = state.ball.render;
  const land = live && bs ? predictLanding(bs) : null;
  const landTeam = land ? (land.x < 0 ? 0 : 1) : null;
  ballView.update(dt, ballPos, bs, land, landTeam === state.myTeam);

  // Players
  const k = 1 - Math.exp(-realDt * 14);
  const winners = [];
  for (const [id, p] of state.players) {
    const px = p.x;
    const pz = p.z;
    if (id === state.myId) {
      Object.assign(p, { x: me.x, y: me.y, z: me.z });
      p.dive = { lunge: 1, down: 2 }[diveState(me)] ?? 0;
    } else {
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      p.z += (p.tz - p.z) * k;
    }
    const speed = Math.hypot(p.x - px, p.z - pz) / Math.max(dt, 1e-3);
    let ry = speed > 0.8 ? Math.atan2(p.x - px, p.z - pz) : Math.atan2(ballPos.x - p.x, ballPos.z - p.z);
    if (p.dive) ry = p.char.ry; // hold the dive direction while sprawled out
    p.swingT = Math.max(0, p.swingT - dt);
    p.char.root.position.set(p.x, p.y, p.z);
    p.char.showLabel(!director.cinematic && !(id === state.myId && serving)); // no giant own label in the serve cam
    if (p.info.team === state.lastPointTeam) winners.push(p.char.root.position);
    const wasEffort = p.char.effort;
    const prevDive = p.prevDive ?? 0;
    p.char.update(dt, {
      speed,
      ry,
      y: p.y,
      look: ballPos,
      airborne: p.y > 0.05,
      dive: p.dive,
      ready: live && landTeam === p.info.team && p.swingT <= 0,
      swing: p.swingT > 0 ? 1 - p.swingT / SWING_TIME : -1,
      swingKind: p.swingKind,
      cheer: (state.phase === 'point' || state.phase === 'over') && state.lastPointTeam === p.info.team,
      holding: state.phase === 'serve' && state.serverId === id,
      block: p.y > 0.3 && Math.abs(p.x) < 1.6 && p.swingT <= 0,
    });

    // Effort feedback: sweat on big efforts, sand kicked up by sprints and dives.
    if (p.char.effort && !wasEffort) effects.sweat(tmpV.set(p.x, p.y + p.char.sp.top, p.z));
    if (p.dive === 2 && prevDive === 1) effects.dust(p.x, p.z);
    p.prevDive = p.dive;
    if (p.y < 0.05 && !p.dive) {
      p.stride += speed * dt;
      if (speed > 4.5 && p.stride > 0.9) {
        p.stride = 0;
        effects.puff(p.x, p.z);
      }
    }
  }

  pressNet(ballPos, realDt);

  // HUD
  hud.touches(state.touches, state.phase === 'rally' && state.lastTeam === state.myTeam);
  hud.clock(state.clock, state.suddenDeath, state.room?.rules, state.phase !== 'lobby' && !tutorial);
  hud.prematch(state.phase === 'lobby' && !tutorial, state.room && { ...state.room, myId: state.myId, pings: currentPings() });
  tutorial?.update(realDt);
  hud.controls(input.device);
  const prompt = contextPrompt(serving, bs, forward);
  self?.char.setHighlight(!!prompt && prompt.action === 'hit');
  if (self && prompt && settings.prompts) {
    const sp = toScreen(me.x, me.y + self.char.sp.top + 0.75, me.z);
    hud.prompt(sp.behind ? null : prompt, sp.x, sp.y, input.device);
  } else hud.prompt(null);

  director.update(realDt, {
    myTeam: state.myTeam,
    me,
    meVel,
    ball: ballPos,
    phase: state.phase,
    phaseTime: (now - state.phaseAt) / 1000,
    servingMe: serving,
    winners,
    scoringTeam: state.lastPointTeam,
  });
  return dt;
}

const lobbyCam = new THREE.Vector3();
const lobbyLook = new THREE.Vector3();
const ballSpot = new THREE.Vector3();
function updateLobby(dt, t) {
  // Camera faces the lineup from the -x side; screen-right is +z, which keeps the cast clear of the menu.
  lobbyCam.set(SHOWCASE.x - 8.5 + Math.sin(t * 0.3) * 0.4, 2.3 + Math.sin(t * 0.4) * 0.15, -2.6);
  camera.position.lerp(lobbyCam, 1 - Math.exp(-dt * 3));
  lobbyLook.set(SHOWCASE.x, 1.0, -2.6);
  camera.lookAt(lobbyLook);

  const others = lineup.filter((_, i) => i !== picked);
  const k = 1 - Math.exp(-dt * 8);
  lineup.forEach((c, i) => {
    const front = i === picked;
    const slot = others.indexOf(c);
    const tx = front ? SHOWCASE.x - 1.7 : SHOWCASE.x + 0.6 + Math.abs(slot - 2.5) * 0.3;
    const tz = front ? 0 : (slot - 2) * 1.3 - 0.65; // back row staggered around your pick
    const p = c.root.position;
    const speed = Math.hypot(tx - p.x, tz - p.z) * 8;
    p.x += (tx - p.x) * k;
    p.z += (tz - p.z) * k;
    c.update(dt, { speed: Math.min(speed, 6), y: 0, ry: -Math.PI / 2, airborne: false, swing: -1, holding: front, look: camera.position });
  });

  // Your pick juggles the ball overhead.
  const sel = lineup[picked];
  ballSpot.set(sel.root.position.x, sel.sp.top + 0.35 + Math.abs(Math.sin(t * 3.2)) * 0.7, sel.root.position.z);
  ballView.update(dt, ballSpot, null, null);
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (window.volley?.paused) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  world.update(now / 1000);
  const gameDt = state.joined ? updateGame(dt, now) : (updateLobby(dt, now / 1000), dt);
  effects.update(gameDt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Language: re-fill static text and re-render everything that's built in code.
let lang = null;
onSettings((st) => {
  if (st.lang === lang) return;
  lang = st.lang;
  applyStatic();
  hud.invalidate();
  pick(picked);
  refreshRoster();
  tutorial?.render();
  for (const b of document.querySelectorAll('#lang-switch button')) b.classList.toggle('on', b.dataset.value === lang);
});
for (const b of document.querySelectorAll('#lang-switch button')) b.onclick = () => setSetting('lang', b.dataset.value);

// Handy for poking at the game from the browser console.
window.volley = { state, me, camera, renderer, scene, world, music, net, sfx };

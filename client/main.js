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
import { BALL_RADIUS, SWING_TIME, PLAYER, DIVE, NET, COURT } from '../shared/constants.js';
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

const soundBtn = document.getElementById('sound-btn');
const soundPanel = document.getElementById('sound-panel');
const musicToggle = document.getElementById('sound-music');
const sfxToggle = document.getElementById('sound-sfx');
const musicVol = document.getElementById('sound-music-vol');
const sfxVol = document.getElementById('sound-sfx-vol');
function syncSound() {
  musicToggle.checked = settings.musicOn;
  sfxToggle.checked = settings.sfxOn;
  for (const [el, v, on] of [
    [musicVol, settings.music, settings.musicOn],
    [sfxVol, settings.sfx, settings.sfxOn],
  ]) {
    el.value = v;
    el.style.setProperty('--fill', `${v * 100}%`);
    el.classList.toggle('off', !on);
  }
  const silent = !(settings.musicOn && settings.music > 0) && !(settings.sfxOn && settings.sfx > 0);
  soundBtn.querySelector('use').setAttribute('href', silent ? '#i-mute' : '#i-sound');
  soundBtn.classList.toggle('muted', silent);
}
function setSoundOpen(open) {
  soundPanel.classList.toggle('hidden', !open);
  soundBtn.setAttribute('aria-expanded', String(open));
}

onSettings((st) => {
  setVolumes({ master: st.master, music: st.music, sfx: st.sfx, musicOn: st.musicOn, sfxOn: st.sfxOn });
  applyQuality(st.quality);
  syncSound();
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
// iOS Safari only applies :active (the squish-down press) when a touch listener exists.
addEventListener('touchstart', () => {}, { passive: true });

// Music needs a user gesture to start (browser autoplay rules).
addEventListener('pointerdown', () => music.start(), { once: true });
addEventListener('keydown', () => music.start(), { once: true });
soundBtn.onclick = (e) => {
  e.stopPropagation();
  music.start();
  setSoundOpen(soundPanel.classList.contains('hidden'));
};
musicToggle.addEventListener('change', () => {
  music.start();
  setSetting('musicOn', musicToggle.checked);
});
sfxToggle.addEventListener('change', () => {
  music.start();
  setSetting('sfxOn', sfxToggle.checked);
});
// Dragging a volume slider also switches that channel back on.
for (const [el, key, onKey] of [
  [musicVol, 'music', 'musicOn'],
  [sfxVol, 'sfx', 'sfxOn'],
]) {
  el.addEventListener('input', () => {
    music.start();
    if (!settings[onKey]) setSetting(onKey, true);
    setSetting(key, Number(el.value));
  });
}
addEventListener('click', (e) => {
  if (!e.target.closest('#sound') || e.target.closest('[data-open]')) setSoundOpen(false);
});
// The game ignores keys aimed at inputs, so a slider or checkbox that keeps focus after a click
// would swallow the controls (arrows change the volume, Space flips the toggle). Let go of it once
// the pointer is released; keyboard users who tab into the panel keep normal focus.
addEventListener('pointerup', () =>
  requestAnimationFrame(() => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.closest('#sound-panel')) el.blur();
  }),
);
// Back to playing: any key pressed outside the panel closes it.
addEventListener('keydown', () => {
  if (!soundPanel.classList.contains('hidden') && !soundPanel.contains(document.activeElement)) setSoundOpen(false);
});
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) {
    music.start();
    setSetting('musicOn', !settings.musicOn);
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
const JOY_TIME = 1.3; // the "yay, me!" when a character is chosen
let joyT = JOY_TIME;
let juggleT = 0;
function pick(i, celebrate = false) {
  picked = (i + SPECIES.length) % SPECIES.length;
  localStorage.setItem('volley:char', picked);
  const sp = SPECIES[picked];
  document.getElementById('char-name').textContent = sp.name;
  document.getElementById('char-title').textContent = t(`species.${picked}.title`);
  document.getElementById('char-line').textContent = t(`species.${picked}.tagline`);
  lineup[picked].landT = 0; // little jelly bounce when chosen
  if (celebrate) {
    joyT = 0;
    sfx.jump();
    const info = document.querySelector('.char-info');
    info.classList.remove('char-swap');
    void info.offsetWidth; // restart the fade-in
    info.classList.add('char-swap');
  }
}
document.getElementById('char-prev').onclick = () => pick(picked - 1, true);
document.getElementById('char-next').onclick = () => pick(picked + 1, true);
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

// True while the ball is across the net from the camera and shows on screen over (or just around)
// the net, where it's hard to tell which side it's on. Casts the camera→ball ray onto the net plane.
function behindNet(b, cam) {
  if (b.x * cam.x >= 0 || Math.abs(b.x) < BALL_RADIUS) return false;
  const k = cam.x / (cam.x - b.x);
  const y = cam.y + (b.y - cam.y) * k;
  const z = cam.z + (b.z - cam.z) * k;
  const m = BALL_RADIUS * k + 0.5; // the ball's size at the net, plus a little "near the net" slack
  return y > NET.bottom - m && y < NET.height + m && Math.abs(z) < COURT.halfWidth + 0.7 + m;
}

// ---------- Network handlers ----------
net.on('welcome', (m) => {
  joinWait?.(null);
  link = { code: m.code, mode: link?.code === m.code ? link.mode : joinMode, key: m.key, ticket: link?.code === m.code ? link.ticket : null };
  state.myId = m.id;
  state.myTeam = m.team;
  if (state.joined) return; // a reconnect: we're already in the game
  world.sand.clear();
  world.resetCrowd();
  world.tournament.reset();
  state.joined = true;
  if (m.tutorial) {
    tutorial = new Tutorial({ scene, net, sfx, state, me, input });
    tutorial.start();
  }
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
    p.char.setLabel(info.off ? `${info.name} …` : info.name, info.id === state.myId); // … = reconnecting
    if (info.id === state.myId) state.myTeam = info.team;
  }
  for (const [id, p] of state.players) {
    if (!seen.has(id)) {
      p.char.dispose(scene);
      state.players.delete(id);
    }
  }
  state.room = { players: m.players, host: m.host, cpu: m.cpu, teamSize: m.teamSize, rules: m.rules, ball: m.ball, isPublic: m.isPublic, myId: state.myId };
  ballView.setSkin(m.ball ?? 'classic');
  refreshRoster();
});
net.on('notice', (m) => hud.toast(m.code ? t(`err.${m.code}`) : m.msg));

// Anti-AFK: the server warns 30s before sending an idle player back to the title.
let afkDeadline = 0;
net.on('afk', (m) => (afkDeadline = m.s > 0 ? performance.now() + m.s * 1000 : 0));
net.on('kicked', (m) => {
  leaving = true;
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
  world.tournament.sync(m.sc, m.ph, m.lp);

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
  joinWait?.('closed');
  if (state.joined && !leaving) reconnect();
});

// ---------- Reconnect ----------
// A dropped connection retries with exponential backoff (waiting for the network if we're offline),
// using the rejoin ticket the room gave us, so we land back in our own spot. The server holds that
// spot for 20s; after that (or if the room restarted) we come back as a new player in the same room.
const RECONNECT = { attempts: 6, baseMs: 500, maxMs: 8000, welcomeMs: 8000 };
let link = null; // { code, mode, key, ticket } for the room we're in
let leaving = false; // navigating away / kicked: never reconnect
let reconnecting = false;
net.on('ticket', (m) => link && (link.ticket = m.ticket));
addEventListener('pagehide', () => {
  leaving = true;
  net.send({ t: 'leave' }); // frees our spot right away instead of holding it
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const online = () => navigator.onLine || new Promise((r) => addEventListener('online', r, { once: true }));

async function reconnect() {
  if (reconnecting) return;
  reconnecting = true;
  for (let attempt = 1; attempt <= RECONNECT.attempts && !leaving; attempt++) {
    if (!link?.ticket) break;
    hud.banner(t('ban.reconnecting'), t('ban.reconnectTry', { n: attempt, max: RECONNECT.attempts }), 1e9);
    const delay = Math.min(RECONNECT.maxMs, RECONNECT.baseMs * 2 ** (attempt - 1));
    await sleep(delay * (0.8 + Math.random() * 0.4));
    await online();
    if (leaving) break;
    let result;
    try {
      await net.connect(`/ws/${encodeURIComponent(link.code)}?mode=rejoin-${link.mode}&ticket=${encodeURIComponent(link.ticket)}`);
      const timer = setTimeout(() => joinWait?.('timeout'), RECONNECT.welcomeMs);
      result = await new Promise((resolve) => {
        joinWait = resolve;
        net.send({ t: 'join', key: link.key, name: hud.name, char: picked });
      });
      clearTimeout(timer);
      joinWait = null;
    } catch {
      continue; // couldn't open the socket: try again
    }
    if (result === null) {
      reconnecting = false;
      hud.banner(t('ban.reconnected'), '', 1200);
      return;
    }
    net.close();
    if (result !== 'closed' && result !== 'timeout') break; // the room said no (e.g. full): stop
  }
  reconnecting = false;
  net.close();
  if (!leaving) hud.banner(t('ban.disconnected'), t('ban.refresh'), 1e9);
}

// Snapshots arrive 30 times a second; silence means the connection is dead even if it looks open.
setInterval(() => {
  if (state.joined && !reconnecting && net.connected && performance.now() - net.lastMessageAt > 6000) net.drop();
}, 1000);

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
    ballView.impact(ev.kind === 'spike' || ev.kind === 'block' ? 1 : .55);
    const prevKind = state.lastHitKind;
    state.lastHitKind = ev.kind;
    const p = state.players.get(ev.id);
    world.react(ev.kind, p?.info.team ?? -1);
    sfx.crowdReact(ev.kind, { prev: prevKind });
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
      sfx.crowdReact('whiff');
    }
  } else if (ev.k === 'bounce') {
    effects.sandImpact(ev.x, ev.z, .4);
    ballView.impact(.65);
  } else if (ev.k === 'start') {
    world.react('start');
    sfx.crowdReact('start');
    sfx.whistle();
    const r = ev.rules ?? state.room?.rules;
    hud.banner(t('ban.start'), r?.mode === 'points' ? t('ban.startPoints', { n: r.points }) : t('ban.startTime', { n: r?.minutes ?? 3 }), 2200);
  } else if (ev.k === 'timeup') {
    sfx.whistle();
    hud.banner(t('ban.timeup'), ev.lastRally ? t('ban.lastRally') : '', 2200);
  } else if (ev.k === 'sudden') {
    world.react('sudden');
    sfx.crowdReact('sudden');
    sfx.slowmo();
    hud.banner(t('ban.sudden'), t('ban.suddenSub'), 2600);
  } else if (ev.k === 'abort') {
    hud.banner(t('ban.stopped'), t('ban.stoppedSub'), 2500);
  } else if (ev.k === 'net') {
    ballView.impact(.7);
    sfx.net(ev.cord, spatial(0, ev.y, ev.z));
    sfx.crowdReact(ev.cord ? 'cord' : 'net');
    world.net.impulse(ev.z, ev.y, Math.min(ev.v, 22) * (ev.cord ? 0.9 : 1.65), ev.dir || 1);
    if (ev.cord) floatAt(t('call.netCord'), 0, ev.y + 0.8, ev.z, '');
  } else if (ev.k === 'point') {
    sfx.whistle();
    const kill = ev.reason === 'in' && state.lastHitKind === 'spike';
    const sneaky = ev.reason === 'in' && state.lastHitKind === 'tip';
    const stuffed = ev.reason === 'in' && state.lastHitKind === 'block';
    if (ev.reason === 'in' || ev.reason === 'out') { effects.sandImpact(ev.x, ev.z, kill ? 1 : .55);ballView.impact(kill ? 1 : .6); }
    if (ev.reason === 'in' || ev.reason === 'out') world.sand.impact(ev.x, ev.z, kill);
    if (kill) {
      director.impact(0.45);
      sfx.hit('spike', spatial(ev.x, 0.3, ev.z));
    }
    const mine = ev.team === state.myTeam;
    world.cheer?.(ev.team);
    const special = kill ? t('ban.smash') : sneaky ? t('ban.sneaky') : stuffed ? t('ban.stuffed') : null;
    sfx.crowdReact('point', { reason: ev.reason, special: !!special });
    const pointTeam = t('ban.pointTeam', { team: teamName(ev.team) });
    const title = special ?? (mine ? t('ban.pointMine') : pointTeam);
    hud.banner(title, special ? pointTeam : t(`reason.${ev.reason}`));
  } else if (ev.k === 'over') {
    world.react('over', ev.team);
    sfx.crowdReact('victory');
    sfx.fanfare();
    hud.banner(t('ban.wins', { team: teamName(ev.team) }), ev.team === state.myTeam ? t('ban.victory') : t('ban.rematch'), 5500);
  }
}

hud.on('team', (d) => net.send({ t: 'team', team: Number(d.team) }));
hud.on('format', (d) => net.send({ t: 'format', teamSize: Number(d.size) }));
hud.on('cpu', () => net.send({ t: 'cpu', on: !state.room?.cpu }));
hud.on('start', () => net.send({ t: 'start' }));
hud.on('rules', (d) => {
  const n = Number(d.n);
  net.send({ t: 'rules', rules: d.mode === 'time' ? { mode: 'time', minutes: n } : { mode: 'points', points: n } });
});
hud.on('invite', () => hud.copyInvite());
hud.on('ball', (d) => net.send({ t: 'ball', color: d.color }));

// ---------- Lobby ----------
// While a join is in flight: spinner on the button you pressed, the other ways in are locked, and a
// status line says what we're waiting on (Turnstile → room → socket → welcome).
const LOBBY_ACTIONS = ['btn-quick', 'btn-create', 'btn-join', 'btn-tutorial'];
const JOIN_BUTTON = { quick: 'btn-quick', create: 'btn-create', code: 'btn-join', tutorial: 'btn-tutorial' };
let joining = false;
function setJoining(mode, step) {
  joining = !!mode;
  for (const id of LOBBY_ACTIONS) {
    const b = document.getElementById(id);
    b.disabled = joining;
    b.classList.toggle('loading', joining && id === JOIN_BUTTON[mode]);
  }
  document.getElementById('code').disabled = joining;
  document.getElementById('lobby').classList.toggle('busy', joining);
  hud.lobbyStatus(joining ? t(`join.${step}`) : '');
}

async function join(mode) {
  if (joining) return;
  sfx.unlock();
  hud.lobbyError('');
  localStorage.setItem('volley:name', hud.name);
  if (mode === 'code' && hud.code.length !== 4) return hud.lobbyError(t('err.code'));
  try {
    await joinSteps(mode);
  } finally {
    setJoining(null);
  }
}

async function joinSteps(mode) {
  // Prove we're human (Turnstile), get a room code + signed ticket, then connect to that room.
  for (let attempt = 0; attempt < 3; attempt++) {
    let code;
    try {
      setJoining(mode, 'human');
      let token;
      try {
        token = await humanToken();
      } catch {
        return hud.lobbyError(t('err.human'));
      }
      setJoining(mode, 'room');
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
      joinMode = mode;
      setJoining(mode, 'connect');
      await net.connect(`/ws/${encodeURIComponent(code)}?mode=${mode}&ticket=${encodeURIComponent(joinInfo.ticket)}`);
    } catch {
      return hud.lobbyError(t('err.server'));
    }
    setJoining(mode, 'enter');
    // Settles on welcome / error, or gives up if the socket drops or the room never answers.
    const timer = setTimeout(() => joinWait?.('timeout'), 15000);
    const rejected = await new Promise((resolve) => {
      joinWait = resolve;
      net.send({ t: 'join', mode, code, name: hud.name, char: picked });
    });
    clearTimeout(timer);
    joinWait = null;
    if (rejected === 'closed' || rejected === 'timeout') {
      net.close();
      return hud.lobbyError(t('err.server'));
    }
    if (rejected !== 'roomTaken') return; // brand-new codes can (very rarely) collide: just try another
  }
}
let joinWait = null; // resolves with an error code, or null once we're welcomed
let joinMode = null; // how we got into the current room (reconnects reuse it)
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
const codeInput = document.getElementById('code');
codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && join('code'));
// Keep the code tidy as you type, and light up Join once it's complete.
function syncCode() {
  const clean = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
  if (clean !== codeInput.value) codeInput.value = clean;
  codeInput.parentElement.classList.toggle('ready', clean.length === 4);
}
codeInput.addEventListener('input', syncCode);
syncCode();

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
  world.watchBall(ballPos);
  sfx.crowdUpdate({ phase: state.phase, ballY: ballPos.y, ballVy: bs?.vy ?? 0, ts: state.tsView, dt: realDt });
  // Predict from the server snapshot, not the per-frame extrapolation, so the spot only moves
  // when new information arrives.
  const land = live && bs ? predictLanding(state.ball.snap) : null;
  const landTeam = land ? (land.x < 0 ? 0 : 1) : null;
  ballView.update(dt, ballPos, bs, land, landTeam === state.myTeam, behindNet(ballPos, camera.position));

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
    const wasGroundAir = p.sandAir ?? false;
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
    if (wasGroundAir && p.y < 0.05 && !p.dive) {
      world.sand.footprint(p.x, p.z, p.char.ry, -1);
      world.sand.footprint(p.x, p.z, p.char.ry, 1);
      effects.sandImpact(p.x, p.z, Math.min(.65, p.char.landStrength * 1.5));
    }
    p.sandAir = p.y >= 0.05;
    if (p.dive) {
      p.sandSlide = (p.sandSlide ?? 0) + speed * dt;
      if (!prevDive || p.sandSlide > 0.3) {
        world.sand.slide(p.x, p.z, p.char.ry);
        p.sandSlide = 0;
      }
    }
    if (p.y < 0.05 && !p.dive) {
      p.stride += speed * dt;
      if (speed > 0.8 && p.stride > 0.65) {
        p.stride = 0;
        p.sandFoot = -(p.sandFoot ?? 1);
        world.sand.footprint(p.x, p.z, p.char.ry, p.sandFoot);
        if (speed > 4.5) effects.puff(p.x, p.z);
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
const LOBBY_Z = -3.6; // lower = the whole scene sits further right on screen, clear of the wide menu card
function updateLobby(dt, t) {
  // Camera faces the lineup from the -x side; screen-right is +z, which keeps the cast clear of the menu.
  lobbyCam.set(SHOWCASE.x - 8.5 + Math.sin(t * 0.3) * 0.4, 2.3 + Math.sin(t * 0.4) * 0.15, LOBBY_Z);
  camera.position.lerp(lobbyCam, 1 - Math.exp(-dt * 3));
  lobbyLook.set(SHOWCASE.x, 1.0, LOBBY_Z);
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
    const joy = front && joyT < JOY_TIME;
    if (!joy) {
      c.update(dt, { speed: Math.min(speed, 6), y: 0, ry: -Math.PI / 2, airborne: false, swing: -1, holding: front, idle: true, look: camera.position });
      return;
    }
    // Chosen: two happy hops with arms up, a full spin on the first one.
    const hop = joyT < 1.1 ? Math.abs(Math.sin((joyT / 1.1) * Math.PI * 2)) * 0.45 : 0;
    const spin = Math.min(1, joyT / 0.55);
    p.y = hop;
    c.update(dt, {
      speed: 0,
      y: hop,
      ry: -Math.PI / 2,
      spin: (1 - Math.pow(1 - spin, 3)) * Math.PI * 2,
      airborne: hop > 0.02,
      swing: -1,
      cheer: true,
      look: camera.position,
    });
  });
  for (const c of lineup) if (c !== lineup[picked]) c.root.position.y = 0;

  // Your pick juggles the ball overhead; when chosen they toss it high and catch it again.
  const sel = lineup[picked];
  const base = sel.sp.top + 0.35;
  if (joyT < JOY_TIME) {
    if (joyT === 0) effects.particles(ballSpot.set(sel.root.position.x, base, sel.root.position.z), 20, [0xffd23f, 0xff6b6b, 0x2f9bff, 0x3ccf6a, 0xffffff], 4, 4, 9, 0.9);
    joyT += dt;
    juggleT = 0;
    ballSpot.set(sel.root.position.x, sel.root.position.y + base + Math.sin((Math.min(joyT, JOY_TIME) / JOY_TIME) * Math.PI) * 2.4, sel.root.position.z);
  } else {
    juggleT += dt;
    ballSpot.set(sel.root.position.x, base + Math.abs(Math.sin(juggleT * 3.2)) * 0.7, sel.root.position.z);
  }
  world.watchBall(ballSpot, false);
  ballView.update(dt, ballSpot, null, null);
}

// Warm-up on wide screens: the settings card sits on the left, so slide the picture right (view
// offset only, the camera itself doesn't move) to keep the court centred in the space that's left.
const wideScreen = matchMedia('(min-width: 900px)');
const prematchCard = document.getElementById('prematch');
let viewShift = 0;
function updateViewShift(dt) {
  const show = state.joined && wideScreen.matches && !prematchCard.classList.contains('hidden');
  const target = show ? (prematchCard.offsetLeft + prematchCard.offsetWidth) / 2 : 0;
  if (!target && !viewShift) return;
  viewShift += (target - viewShift) * (1 - Math.exp(-dt * 4));
  if (!target && viewShift < 0.5) {
    viewShift = 0;
    camera.clearViewOffset();
  } else camera.setViewOffset(innerWidth, innerHeight, -viewShift, 0, innerWidth, innerHeight);
  // Centred HUD bits (controls bar, hints, meter, banners, idle warning, toasts) follow the court, not the card.
  hudEl.style.setProperty('--view-shift', `${Math.round(viewShift)}px`);
}
const hudEl = document.getElementById('hud');

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (window.volley?.paused) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  world.update(now / 1000);
  if (!state.joined) sfx.crowdUpdate({ phase: 'menu', dt });
  const gameDt = state.joined ? updateGame(dt, now) : (updateLobby(dt, now / 1000), dt);
  effects.update(gameDt);
  updateViewShift(dt);
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

import { MAX_TOUCHES, BALL_COLORS } from '../shared/constants.js';
import { t, teamName } from './i18n.js';
import { TEAM_COLORS } from './teams.js';
import { BALL_SKINS } from './scene/ball.js';

const $ = (id) => document.getElementById(id);
const ico = (name) => `<svg class="ico"><use href="#i-${name}" /></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Button glyphs per input device: keycaps on keyboard, colored round buttons on pad/touch.
const GLYPHS = {
  keyboard: { hit: 'J', jump: 'Space', tip: 'K', move: 'WASD' },
  gamepad: { hit: 'X', jump: 'A', tip: 'B', move: 'L' },
  touch: { hit: 'X', jump: 'A', tip: 'B', move: '◉' },
};
export function glyph(device, action) {
  let label = GLYPHS[device]?.[action] ?? GLYPHS.keyboard[action];
  if (label === 'Space') label = t('key.space');
  return `<span class="glyph ${device} ${action}">${label}</span>`;
}

// Signal bars + milliseconds: green under 80ms, yellow under 150ms, red above. CPUs just say CPU.
function pingBadge(p, pings) {
  if (p.bot) return ` <small>${t('hud.cpu')}</small>`;
  const ms = pings?.get(p.id);
  if (ms == null) return ' <span class="ping">…</span>';
  const q = ms < 80 ? 'good' : ms < 150 ? 'ok' : 'bad';
  return ` <span class="ping ${q}" title="${t('hud.ping')}"><i></i><i></i><i></i>${ms}ms</span>`;
}

export class Hud {
  constructor() {
    this.cache = {};
    this.handlers = {};
    $('name').value = localStorage.getItem('volley:name') ?? '';
    const room = new URLSearchParams(location.search).get('room');
    if (room) {
      $('code').value = room.toUpperCase();
      $('btn-join').classList.add('primary');
    }
    $('prematch').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (btn && !btn.disabled) this.handlers[btn.dataset.cmd]?.(btn.dataset);
    });
  }

  on(cmd, fn) {
    this.handlers[cmd] = fn;
  }

  get name() {
    return $('name').value.trim();
  }

  get code() {
    return $('code').value.trim().toUpperCase();
  }

  // Forget cached HTML so everything re-renders (e.g. after a language change).
  invalidate() {
    this.cache = {};
  }

  // Avoids touching the DOM when nothing changed.
  set(id, html) {
    if (this.cache[id] === html) return;
    this.cache[id] = html;
    $(id).innerHTML = html;
  }

  lobbyError(msg) {
    $('lobby-error').textContent = msg;
  }

  lobbyStatus(msg) {
    $('lobby-status').textContent = msg;
  }

  enterGame(code) {
    $('lobby').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('room-code').textContent = code;
    this.roomCode = code;
    $('copy-link').onclick = () => this.copyInvite();
  }

  copyInvite() {
    navigator.clipboard?.writeText(`${location.origin}/?room=${this.roomCode}`);
    this.toast(t('hud.copied'));
  }

  score(sc) {
    this.set('score0', String(sc[0]));
    this.set('score1', String(sc[1]));
  }

  touches(count, show) {
    const dots = Array.from({ length: MAX_TOUCHES }, (_, i) => `<i class="${i < count ? 'on' : ''}"></i>`).join('');
    this.set('touches', show ? `${t('hud.touches')} ${dots}` : '');
  }

  controls(device) {
    const g = (a) => glyph(device, a);
    this.set(
      'controls',
      `<span>${g('move')} ${t('ctl.move')}</span><span>${g('jump')} ${t('ctl.jump')}</span><span>${g('hit')} ${t('ctl.hit')}</span><span>${g('tip')} ${t('ctl.tip')}</span>`,
    );
  }

  // pings: Map of player id → round-trip ms. Shown as signal bars + ms next to each name.
  roster(players, myId, pings = new Map()) {
    const pingTag = (p) => pingBadge(p, pings);
    const html = [0, 1]
      .map((team) => {
        const rows = players
          .filter((p) => p.team === team)
          .map((p) => `<div class="${p.id === myId ? 'me' : ''}"><span class="pname">${esc(p.name)}</span>${pingTag(p)}</div>`)
          .join('');
        return `<div class="side" style="--c:${TEAM_COLORS[team].css}"><b>${teamName(team)}</b>${rows}</div>`;
      })
      .join('');
    this.set('roster', html);
  }

  // Pre-match waiting room: team cards with join buttons, match settings, then the actions.
  prematch(show, r) {
    $('prematch').classList.toggle('hidden', !show);
    $('roster').classList.toggle('hidden', show);
    if (!show || !r) return;
    const me = r.players.find((p) => p.id === r.myId);
    const isHost = r.host === r.myId;
    for (const team of [0, 1]) {
      const members = r.players.filter((p) => p.team === team).sort((a, b) => a.slot - b.slot);
      const rows = [];
      for (let i = 0; i < r.teamSize; i++) {
        const p = members[i];
        if (!p) rows.push(`<div class="pm-slot empty">${ico('plus')}${t('pm.open')}</div>`);
        else {
          const crown = p.id === r.host ? `<span class="crown" title="${t('hud.host')}">${ico('crown')}</span>` : '';
          const you = p.id === r.myId ? `<span class="pm-tag">${t('pm.youTag')}</span>` : '';
          rows.push(
            `<div class="pm-slot ${you ? 'me' : ''}"><span class="pm-pname">${esc(p.name)}</span>${crown}${you}${pingBadge(p, r.pings)}</div>`,
          );
        }
      }
      const humansThere = members.filter((p) => !p.bot).length;
      const canJoin = me && me.team !== team && humansThere < r.teamSize;
      const mine = me?.team === team;
      const btn = mine
        ? `<div class="pm-you">${ico('check')}${t('pm.here')}</div>`
        : `<button class="pm-join with-ico" data-cmd="team" data-team="${team}" ${canJoin ? '' : 'disabled'}><span>${t('pm.join')}</span><svg class="ico"><use href="#i-arrow" /></svg></button>`;
      const card = $(`pm${team}`);
      card.classList.toggle('mine', mine);
      card.style.setProperty('--c', TEAM_COLORS[team].css);
      this.set(
        `pm${team}`,
        `<div class="pm-name"><span class="pm-tname"><small>${t('pm.team')}</small>${teamName(team)}</span><span class="pm-count">${ico('user')}${members.length}/${r.teamSize}</span></div>${rows.join('')}${btn}`,
      );
    }
    const ready = r.players.some((p) => p.team === 0) && r.players.some((p) => p.team === 1);
    // Match settings: the host of a private room picks them; everyone else sees what's been chosen.
    const rules = r.rules ?? { mode: 'time', minutes: 3 };
    const desc = rules.mode === 'time' ? t('rules.descTime', { n: rules.minutes }) : t('rules.descPoints', { n: rules.points });
    const modeIco = { time: ico('clock'), points: ico('ball') };
    const canPick = isHost && !r.isPublic;
    const opt = (mode, n) => {
      const on = rules.mode === mode && (mode === 'time' ? rules.minutes : rules.points) === n;
      return `<button data-cmd="rules" data-mode="${mode}" data-n="${n}" class="${on ? 'on' : ''}" aria-pressed="${on}">${modeIco[mode]}${t(`rules.${mode}`, { n })}</button>`;
    };
    const size = (n) =>
      `<button data-cmd="format" data-size="${n}" class="${r.teamSize === n ? 'on' : ''}" aria-pressed="${r.teamSize === n}">${n}v${n}</button>`;
    const row = (label, control) => `<span class="pm-label">${label}</span><div class="pm-ctrl">${control}</div>`;
    const cpuState = t(r.cpu ? 'pm.on' : 'pm.off');
    // Ball colour is room-wide: the host's swatches are buttons, everyone else sees the current one.
    const ball = BALL_COLORS.includes(r.ball) ? r.ball : BALL_COLORS[0];
    const swatch = (name, pick) => {
      const { a, b } = BALL_SKINS[name];
      const on = name === ball;
      return pick
        ? `<button data-cmd="ball" data-color="${name}" class="swatch ${on ? 'on' : ''}" style="--a:${a};--b:${b}" title="${t(`ball.${name}`)}" aria-label="${t(`ball.${name}`)}" aria-pressed="${on}"></button>`
        : `<span class="swatch" style="--a:${a};--b:${b}"></span>`;
    };
    this.set(
      'pmRules',
      row(t('rules.format'), canPick ? `<div class="seg">${[1, 2].map(size).join('')}</div>` : `<b class="pm-chip">${r.teamSize}v${r.teamSize}</b>`) +
        row(
          t('pm.length'),
          canPick
            ? `<div class="seg">${[2, 3, 5].map((n) => opt('time', n)).join('')}</div><span class="pm-or">${t('lobby.or')}</span><div class="seg">${[7, 11, 15].map((n) => opt('points', n)).join('')}</div>`
            : `<b class="pm-chip">${modeIco[rules.mode]}${desc}</b>`,
        ) +
        row(
          t('pm.cpu'),
          isHost
            ? `<button data-cmd="cpu" class="switch ${r.cpu ? 'on' : ''}" role="switch" aria-checked="${!!r.cpu}"><i></i><span>${cpuState}</span></button><small>${t('pm.cpuSub')}</small>`
            : `<b class="pm-chip">${cpuState}</b>`,
        ) +
        row(
          t('pm.ball'),
          isHost
            ? `<div class="swatches">${BALL_COLORS.map((name) => swatch(name, true)).join('')}</div><small>${t(`ball.${ball}`)}</small>`
            : `<b class="pm-chip">${swatch(ball, false)}${t(`ball.${ball}`)}</b>`,
        ),
    );
    const invite = `<button data-cmd="invite" class="with-ico"><svg class="ico"><use href="#i-link" /></svg><span>${t('pm.invite')}</span></button>`;
    this.set(
      'pmActions',
      isHost
        ? `${invite}<button data-cmd="start" class="primary pm-start with-ico" ${ready ? '' : 'disabled'}><svg class="ico"><use href="#i-play" /></svg><span>${t('pm.start')}</span></button>` +
            (ready ? '' : `<div class="pm-hint">${t('pm.need')}</div>`)
        : `${invite}<div class="pm-wait"><span class="pm-dot"></span>${t('pm.wait')}</div>`,
    );
  }

  // Match clock in the scoreboard: countdown in timed matches, the target in points matches.
  clock(clk, suddenDeath, rules, inMatch) {
    let text = '';
    let cls = '';
    if (inMatch && suddenDeath) {
      text = t('clock.sudden');
      cls = 'sudden';
    } else if (inMatch && clk != null) {
      text = `${Math.floor(clk / 60)}:${String(clk % 60).padStart(2, '0')}`;
      if (clk <= 10) cls = 'hurry';
    } else if (inMatch && rules?.mode === 'points') {
      text = t('clock.to', { n: rules.points });
    }
    this.set('clock', text);
    const el = $('clock');
    if (el.dataset.cls !== cls) {
      el.className = cls;
      el.dataset.cls = cls;
    }
  }

  // Serve power meter: zones from shared SERVE constants, needle at `v` (0..1), hidden when null.
  serveMeter(v) {
    const el = $('meter');
    el.classList.toggle('show', v !== null);
    if (v !== null) $('meter-needle').style.left = `${(v * 100).toFixed(1)}%`;
  }

  // Floating button prompt above your character.
  prompt(p, x, y, device) {
    const el = $('prompt');
    if (!p) {
      el.classList.remove('show');
      return;
    }
    const alt = p.alt ? `<i class="sep"></i>${glyph(device, p.alt.action)}<span class="alt">${p.alt.label}</span>` : '';
    this.set('prompt', `${glyph(device, p.action)}<span>${p.label}</span>${alt}`);
    el.className = `show ${p.urgent ? 'urgent' : ''}`;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  // Short text that pops and floats up from a screen position ("Perfect!", "Too early!").
  float(text, x, y, cls = '') {
    const el = document.createElement('div');
    el.className = `float ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    $('floats').appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  banner(title, sub = '', ms = 2000) {
    $('banner').innerHTML = `<div class="title">${esc(title)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}`;
    $('banner').classList.remove('show');
    void $('banner').offsetWidth; // restart animation
    $('banner').classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => $('banner').classList.remove('show'), ms);
  }

  // Letterbox bars + vignette during slow-mo.
  cinema(on) {
    if (this.cinemaOn === on) return;
    this.cinemaOn = on;
    $('cinema').classList.toggle('on', on);
  }

  pop(text) {
    const el = document.createElement('div');
    el.className = 'pop';
    el.textContent = text;
    $('hud').appendChild(el);
    setTimeout(() => el.remove(), 900);
  }
}

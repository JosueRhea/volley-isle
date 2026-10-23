import { MAX_TOUCHES } from '../shared/constants.js';
import { t, teamName } from './i18n.js';
import { TEAM_COLORS } from './teams.js';

const $ = (id) => document.getElementById(id);
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

  // Pre-match waiting room: team cards with join buttons, host controls.
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
        if (!p) rows.push(`<div class="pm-slot empty">${t('pm.open')}</div>`);
        else {
          const crown = p.id === r.host ? `<span class="crown" title="${t('hud.host')}">♛</span>` : '';
          rows.push(`<div class="pm-slot ${p.id === r.myId ? 'me' : ''}">${esc(p.name)} ${crown}${pingBadge(p, r.pings)}</div>`);
        }
      }
      const humansThere = members.filter((p) => !p.bot).length;
      const canJoin = me && me.team !== team && humansThere < r.teamSize;
      const btn = me?.team === team
        ? `<div class="pm-you">${t('pm.here')}</div>`
        : `<button data-cmd="team" data-team="${team}" ${canJoin ? '' : 'disabled'}>${t('pm.join', { team: teamName(team) })}</button>`;
      this.set(`pm${team}`, `<div class="pm-name" style="--c:${TEAM_COLORS[team].css}">${teamName(team)}</div>${rows.join('')}${btn}`);
    }
    const ready = r.players.some((p) => p.team === 0) && r.players.some((p) => p.team === 1);
    // Match format: the host of a private room picks it; everyone else sees what's been chosen.
    const rules = r.rules ?? { mode: 'time', minutes: 3 };
    const desc = rules.mode === 'time' ? t('rules.descTime', { n: rules.minutes }) : t('rules.descPoints', { n: rules.points });
    const canPick = isHost && !r.isPublic;
    const opt = (mode, n) => {
      const on = rules.mode === mode && (mode === 'time' ? rules.minutes : rules.points) === n;
      return `<button data-cmd="rules" data-mode="${mode}" data-n="${n}" class="${on ? 'on' : ''}">${t(`rules.${mode}`, { n })}</button>`;
    };
    this.set(
      'pmRules',
      canPick
        ? `<span>${t('rules.title')}</span><div class="seg">${[2, 3, 5].map((n) => opt('time', n)).join('')}</div><div class="seg">${[7, 11, 15].map((n) => opt('points', n)).join('')}</div>`
        : `<span>${t('rules.title')}:</span> <b>${desc}</b>`,
    );
    this.set(
      'pmActions',
      isHost
        ? `<button data-cmd="cpu" class="toggle ${r.cpu ? 'on' : ''}">${t('pm.cpu')} <b>${r.cpu ? t('pm.on') : t('pm.off')}</b></button>
           <button data-cmd="invite">${t('pm.invite')}</button>
           <button data-cmd="start" class="primary" ${ready ? '' : 'disabled'}>${t('pm.start')}</button>`
        : `<button data-cmd="invite">${t('pm.invite')}</button><div class="pm-wait">${t('pm.wait')}</div>`,
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

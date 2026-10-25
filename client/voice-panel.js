// The voice chat dock: the mic button, a status dot that opens the voice panel, and an alert chip that
// pops up when something needs fixing (mic blocked or missing, a player we can't reach, audio held back
// by the browser). The panel shows everything about voice in one place, with a fix for each problem.
import { settings, setSetting, onSettings } from './settings.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const PEER_LEVEL = { ok: 'ok', connecting: 'wait', unstable: 'wait', failed: 'bad', off: 'off' };
const MIC_FIX = { denied: 1, notfound: 1, busy: 1, lost: 1, other: 1 }; // errors "Try again" can fix

export function setupVoicePanel(voice) {
  const dock = $('voice');
  const panel = $('voice-panel');
  const btn = $('voice-btn');
  const more = $('voice-more');
  const alert = $('voice-alert');
  const meter = $('vp-meter-fill');
  const cache = {};
  let open = false;

  // Only touch the DOM when what it shows actually changed.
  const set = (key, el, html) => {
    if (cache[key] === html) return false;
    cache[key] = html;
    el.innerHTML = html;
    return true;
  };

  function setOpen(v) {
    open = v;
    panel.classList.toggle('hidden', !v);
    more.setAttribute('aria-expanded', String(v));
    if (v) voice.refreshDevices();
  }
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!open);
  });
  addEventListener('click', (e) => open && !e.target.closest('#voice') && setOpen(false));
  // Back to playing: a game key pressed outside the panel closes it (push-to-talk doesn't, so you can test).
  addEventListener('keydown', (e) => {
    if (open && e.code !== 'KeyV' && !panel.contains(document.activeElement)) setOpen(false);
  });
  // Let go of a slider/select after using it, so arrows and Space go back to the game.
  addEventListener('pointerup', () =>
    requestAnimationFrame(() => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.closest('#voice-panel')) el.blur();
    }),
  );

  // The alert chip: one tap fixes what it can, otherwise opens the panel with the details.
  alert.addEventListener('click', (e) => {
    e.stopPropagation();
    const h = voice.health();
    if (h.code === 'blocked') voice.unlockAudio();
    else setOpen(true);
  });

  // Mic button: tap to turn the mic on/off (or retry after a problem); in push-to-talk, hold it to talk.
  let held = false;
  btn.addEventListener('pointerdown', (e) => {
    if (settings.micMode !== 'ptt' || !voice.mic) return;
    btn.setPointerCapture(e.pointerId);
    held = true;
    voice.hold(+1);
  });
  const release = () => held && ((held = false), voice.hold(-1));
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('click', () => {
    btn.blur(); // keep Space/Enter for the game
    if (voice.micError && !MIC_FIX[voice.micError]) return setOpen(true); // nothing to retry: explain
    voice.toggleMic();
  });

  // ----- Panel controls -----
  $('vp-on').addEventListener('change', (e) => setSetting('voiceOn', e.target.checked));
  const vol = $('vp-vol');
  vol.addEventListener('input', () => setSetting('voiceVol', Number(vol.value)));
  $('vp-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setSetting('micMode', b.dataset.value);
  });
  $('vp-mic-device').addEventListener('change', (e) => voice.setMicDevice(e.target.value));
  $('vp-out').addEventListener('change', (e) => voice.setOutput(e.target.value));
  $('vp-mic-toggle').addEventListener('click', () => (voice.mic ? voice.disableMic() : voice.enableMic()));
  $('vp-reconnect').addEventListener('click', () => voice.reconnectAll());
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = Number(b.dataset.id);
    if (b.dataset.act === 'mute') voice.toggleMute(id);
    if (b.dataset.act === 'reconnect') voice.reconnect(id);
    if (b.dataset.act === 'retry-mic') voice.enableMic();
    if (b.dataset.act === 'voice-on') setSetting('voiceOn', true);
    if (b.dataset.act === 'unlock') voice.unlockAudio();
    if (b.dataset.act === 'reconnect-all') voice.reconnectAll();
  });
  panel.addEventListener('input', (e) => {
    const el = e.target.closest('[data-gain]');
    if (!el) return;
    voice.setGain(Number(el.dataset.gain), Number(el.value));
    el.style.setProperty('--fill', `${el.value * 100}%`);
  });

  onSettings((st) => {
    $('vp-on').checked = st.voiceOn;
    vol.value = st.voiceVol;
    vol.style.setProperty('--fill', `${st.voiceVol * 100}%`);
    for (const b of $('vp-mode').querySelectorAll('button')) b.classList.toggle('on', b.dataset.value === st.micMode);
    for (const k of Object.keys(cache)) delete cache[k]; // language may have changed: re-render text
  });

  // ----- Rendering -----

  // What's wrong (or right), in a sentence, plus the button that fixes it.
  function statusHtml(h) {
    const btnHtml = (act, label) => `<button class="vp-small" data-act="${act}">${label}</button>`;
    const names = (h.players ?? []).map((p) => esc(p.name)).join(', ');
    const msg = {
      disabled: [t('vp.h.disabled'), btnHtml('voice-on', t('vp.turnOn'))],
      blocked: [t('vp.h.blocked'), btnHtml('unlock', t('vp.unlock'))],
      failed: [t('vp.h.failed', { names }), btnHtml('reconnect-all', t('vp.reconnect'))],
      alone: [t('vp.h.alone')],
      nobody: [t('vp.h.nobody')],
      connecting: [t('vp.h.connecting', { n: h.n })],
      connected: [t('vp.h.connected', { n: h.n })],
    }[h.code];
    if (msg) return `<div class="vp-msg"><i class="vp-dot ${h.level}"></i><span>${msg[0]}</span></div>${msg[1] ?? ''}`;
    const err = h.code.slice(4); // mic.<error>
    return `<div class="vp-msg"><i class="vp-dot bad"></i><span><b>${t(`vp.h.mic.${err}`)}</b> ${t(`vp.fix.${err}`)}</span></div>${
      MIC_FIX[err] ? btnHtml('retry-mic', t('vp.tryAgain')) : ''
    }`;
  }

  function options(list, current, fallback) {
    const def = `<option value="">${t('vp.default')}</option>`;
    const opts = list
      .filter((d) => d.id !== 'default')
      .map((d, i) => `<option value="${esc(d.id)}" ${d.id === current ? 'selected' : ''}>${esc(d.label || t(fallback, { n: i + 1 }))}</option>`);
    return def + opts.join('');
  }

  function peopleHtml() {
    const others = voice.players.filter((p) => !p.bot && p.id !== voice.myId);
    if (!others.length) return '';
    const rows = others.map((p) => {
      const st = voice.peerState(p);
      const label = st === 'ok' && !p.mc ? t('vp.st.listen') : t(`vp.st.${st}`);
      const muted = voice.muted.has(p.id);
      const gain = voice.gains.get(p.id) ?? 1;
      const live = st !== 'off';
      return `<div class="vp-person" data-id="${p.id}">
        <div class="vp-person-head">
          <i class="vp-dot ${PEER_LEVEL[st]}"></i><b>${esc(p.name)}</b><small>${label}</small>
          ${st === 'failed' ? `<button class="vp-small" data-act="reconnect" data-id="${p.id}">${t('vp.reconnect')}</button>` : ''}
          ${live ? `<button class="vp-small ${muted ? 'on' : ''}" data-act="mute" data-id="${p.id}" aria-pressed="${muted}">${t(muted ? 'vp.unmute' : 'vp.mute')}</button>` : ''}
        </div>
        ${live ? `<input type="range" min="0" max="1" step="0.05" value="${gain}" data-gain="${p.id}" style="--fill:${gain * 100}%" aria-label="${esc(t('vp.playerVol', { name: p.name }))}" />` : ''}
      </div>`;
    });
    return `<div class="snd-head"><span>${t('vp.players')}</span></div>${rows.join('')}`;
  }

  // Every frame: the dock is cheap to keep current; the panel only while it's open.
  function update() {
    const show = voice.available;
    dock.classList.toggle('hidden', !show);
    if (!show) {
      if (open) setOpen(false);
      return;
    }
    const h = voice.health();
    const state = voice.micState;
    const talking = voice.speaking.has(voice.myId);
    if (cache.btn !== `${state}|${talking}`) {
      cache.btn = `${state}|${talking}`;
      btn.dataset.state = state;
      btn.classList.toggle('talking', talking);
      const on = state === 'open' || state === 'ptt' || state === 'talking';
      btn.querySelector('use').setAttribute('href', on ? '#i-mic' : '#i-mic-off');
      btn.title = t(`voice.btn.${state}`);
      btn.setAttribute('aria-label', btn.title);
    }
    more.dataset.level = h.level;

    // The alert chip: only for problems, short enough to read mid-rally.
    let chip = '';
    if (h.level === 'bad') {
      const first = h.players?.[0];
      const text =
        h.code === 'failed'
          ? t('vp.a.failed', { name: first.name, more: h.players.length > 1 ? ` +${h.players.length - 1}` : '' })
          : t(`vp.a.${h.code.replace('mic.', '')}`);
      chip = `<svg class="ico"><use href="#i-warn" /></svg><span>${esc(text)}</span>`;
    }
    alert.classList.toggle('hidden', !chip || open);
    set('chip', alert, chip);

    if (!open) return;
    set('status', $('vp-status'), statusHtml(h));
    $('vp-body').classList.toggle('hidden', !settings.voiceOn);
    const micTag = voice.asking ? t('vp.asking') : voice.mic ? t(settings.micMode === 'ptt' ? 'vp.micPtt' : 'vp.micOn') : t('vp.micOff');
    set('micTag', $('vp-mic-state'), esc(micTag));
    $('vp-mic-state').classList.toggle('off', !voice.mic);
    set('micBtn', $('vp-mic-toggle'), voice.mic ? t('vp.turnOff') : t('vp.turnOn'));
    set('inputs', $('vp-mic-device'), options(voice.inputs, settings.micDevice, 'vp.micN'));
    $('vp-out').classList.toggle('hidden', !voice.canPickOutput || !voice.outputs.length);
    if (voice.canPickOutput) set('outputs', $('vp-out'), options(voice.outputs, settings.voiceOut, 'vp.spkN'));
    // Don't rebuild the list while a volume slider in it is being dragged.
    if (!panel.querySelector('[data-gain]:active')) set('people', $('vp-people'), peopleHtml());
    $('vp-people').classList.toggle('hidden', !cache.people);
    $('vp-reconnect').classList.toggle('hidden', !voice.wanted().length);
    for (const row of $('vp-people').querySelectorAll('.vp-person')) row.classList.toggle('talk', voice.speaking.has(Number(row.dataset.id)));
    // Input meter: shows your mic level even with push-to-talk released, so you can test it.
    meter.style.width = `${Math.round(voice.micLevel() * 100)}%`;
    meter.parentElement.classList.toggle('sending', voice.transmitting);
  }

  return { update, open: () => setOpen(true) };
}

import { settings, setSetting, resetSettings } from './settings.js';
import { glyph } from './hud.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);

// Overlay menus: in-game menu (Esc / ☰), settings, how-to-play. Opening one pauses *your* input;
// the online match itself keeps running.
export function setupMenus({ input, inGame, onLeave, onInvite }) {
  const stack = [];

  function open(id) {
    if (stack.includes(id)) return;
    $(id).classList.remove('hidden');
    stack.push(id);
    input.enabled = false;
    input.clear();
    if (id === 'settings') syncSettings();
    if (id === 'help') renderHelp();
  }

  function close() {
    const id = stack.pop();
    if (id) $(id).classList.add('hidden');
    if (!stack.length) input.enabled = true;
    disarmLeave();
  }

  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open]');
    if (opener) return open(opener.dataset.open);
    if (e.target.closest('[data-close]') || e.target.classList.contains('overlay')) close();
  });
  $('menu-btn').onclick = () => open('pause');
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (stack.length) close();
    else if (inGame()) open('pause');
  });

  // Leaving takes two taps so you don't quit mid-rally by accident.
  const leaveBtn = $('leave');
  let armed = false;
  let armTimer = null;
  function disarmLeave() {
    armed = false;
    leaveBtn.textContent = t('menu.leave');
    clearTimeout(armTimer);
  }
  leaveBtn.onclick = () => {
    if (armed) return onLeave();
    armed = true;
    leaveBtn.textContent = t('menu.leaveConfirm');
    armTimer = setTimeout(disarmLeave, 3000);
  };
  $('pause-invite').onclick = () => onInvite();

  // Settings widgets ↔ saved settings
  const paint = (el) => el.style.setProperty('--fill', `${el.value * 100}%`);
  for (const el of document.querySelectorAll('#settings [data-setting]')) {
    const key = el.dataset.setting;
    if (el.type === 'range') {
      el.addEventListener('input', () => {
        setSetting(key, Number(el.value));
        paint(el);
      });
    } else if (el.type === 'checkbox') {
      el.addEventListener('change', () => setSetting(key, el.checked));
    } else {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        setSetting(key, b.dataset.value);
        syncSettings();
      });
    }
  }
  $('settings-reset').onclick = () => {
    resetSettings();
    syncSettings();
  };

  function syncSettings() {
    for (const el of document.querySelectorAll('#settings [data-setting]')) {
      const v = settings[el.dataset.setting];
      if (el.type === 'range') {
        el.value = v;
        paint(el);
      } else if (el.type === 'checkbox') el.checked = v;
      else for (const b of el.querySelectorAll('button')) b.classList.toggle('on', b.dataset.value === v);
    }
  }

  function renderHelp() {
    const d = input.device;
    const rows = [
      [glyph(d, 'move'), t('help.move')],
      [glyph(d, 'jump'), t('help.jump')],
      [glyph(d, 'hit'), t('help.hit')],
      [glyph(d, 'tip'), t('help.tip')],
      ['<span class="glyph keyboard">Esc</span>', t('help.menu')],
      ['<span class="glyph keyboard">M</span>', t('help.music')],
      ['<span class="glyph keyboard">V</span>', t('help.ptt')],
    ];
    $('help-controls').innerHTML = rows.map(([g, label]) => `<div>${g}</div><div>${label}</div>`).join('');
  }

  return { isOpen: () => stack.length > 0 };
}

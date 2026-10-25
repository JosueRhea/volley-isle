// Player preferences, saved in localStorage. Call onSettings(fn) to react to changes.
const KEY = 'volley:settings';

export const DEFAULTS = {
  master: 0.8, // 0..1
  music: 0.6,
  sfx: 0.9,
  musicOn: true,
  sfxOn: true,
  voiceOn: true, // voice chat: hear (and, with the mic on, talk to) the other players in the room
  voiceVol: 1,
  micMode: 'open', // 'open' | 'ptt' (push-to-talk: hold V)
  micOn: false, // turned the mic on last time: ask for it again on the next join
  micDevice: '', // chosen microphone ('' = the system default)
  voiceOut: '', // chosen speaker for voices ('' = the system default; only where the browser allows it)
  prompts: true, // floating button prompts
  simpleHud: false, // in a match, show only the scoreboard, event feed/callouts and the menu button
  quality: 'high', // 'high' | 'medium' | 'low'
  lang: navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en', // 'en' | 'es'
};

let stored = {};
try {
  stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
} catch {
  stored = {};
}
export const settings = { ...DEFAULTS, ...stored };
// Older builds stored music mute on its own. Keep that choice the first time these toggles appear.
if (!Object.hasOwn(stored, 'musicOn') && localStorage.getItem('volley:muted') === '1') settings.musicOn = false;

const listeners = new Set();
export function onSettings(fn) {
  listeners.add(fn);
  fn(settings);
}

export function setSetting(key, value) {
  settings[key] = value;
  localStorage.setItem(KEY, JSON.stringify(settings));
  for (const fn of listeners) fn(settings);
}

export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  localStorage.setItem(KEY, JSON.stringify(settings));
  for (const fn of listeners) fn(settings);
}

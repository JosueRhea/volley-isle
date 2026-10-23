// Player preferences, saved in localStorage. Call onSettings(fn) to react to changes.
const KEY = 'volley:settings';

export const DEFAULTS = {
  master: 0.8, // 0..1
  music: 0.6,
  sfx: 0.9,
  prompts: true, // floating button prompts
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

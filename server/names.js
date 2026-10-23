// Player name cleanup: strips invisible/trick characters and replaces names containing common
// English or Spanish profanity/slurs. Deliberately simple; a determined troll can still get creative.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁯﻿]/g;
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
const BLOCKED = [
  // English
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'slut', 'whore',
  'fag', 'nigg', 'retard', 'rape', 'nazi', 'hitler', 'porn',
  // Spanish
  'puta', 'puto', 'mierda', 'verga', 'pendej', 'cabron', 'chinga', 'culero', 'maricon', 'joto',
  'zorra', 'polla', 'gilipollas', 'hijueputa', 'malparid', 'mamaguevo',
];

const normalize = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // á → a, ñ → n
    .replace(/[0-9@$!]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, '');

export function cleanName(raw) {
  const name = String(raw ?? '')
    .replace(INVISIBLE, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  if (!name) return 'Hero';
  const flat = normalize(name);
  return BLOCKED.some((w) => flat.includes(w)) ? 'Player' : name;
}

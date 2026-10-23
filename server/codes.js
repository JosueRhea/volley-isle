// 4-letter room codes (no I or O, so they can't be confused with 1 and 0).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_RE = /^[A-HJ-NP-Z]{4}$/;

export function newCode(taken = () => false) {
  let c;
  do c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  while (taken(c));
  return c;
}

// The join gate, shared by the Node and Cloudflare hosts:
//   1. Origin check: room connections must come from the game's own pages.
//   2. Turnstile: the browser proves it's a person before it gets a room.
//   3. Join tickets: rooms only accept connections carrying a short-lived HMAC-signed ticket,
//      which is only handed out after (1) and (2) pass. Uses WebCrypto, so it runs in both hosts.
const TICKET_TTL_MS = 60_000;
// Rejoin tickets let a dropped player get back into their room without a new Turnstile check.
// The room hands one out on join and refreshes it while the player is connected.
export const REJOIN_TTL_MS = 15 * 60_000;
const enc = new TextEncoder();

export function originAllowed(origin, allowed) {
  return !!origin && allowed.includes(origin);
}

export const TURNSTILE_ACTION = 'join';
// Cloudflare's published dummy secrets (local testing only) don't return a real action/hostname.
const isTestSecret = (secret) => /^[123]x0+AA$/.test(secret);

// Ask Cloudflare whether a Turnstile token is real, single-use, for our action and one of our hostnames.
// No secret configured → Turnstile is off (plain local dev). Network errors count as failures.
export async function verifyTurnstile(secret, token, ip, { action = TURNSTILE_ACTION, hostnames = [] } = {}) {
  if (!secret) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    });
    const out = await res.json();
    if (out.success !== true) return false;
    if (isTestSecret(secret)) return true;
    return out.action === action && hostnames.length > 0 && hostnames.includes(out.hostname);
  } catch {
    return false;
  }
}

export const listFrom = (value) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const keys = new Map();
function hmacKey(secret) {
  if (!keys.has(secret)) {
    keys.set(secret, crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
  }
  return keys.get(secret);
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// Ticket = "<expiry>.<signature over code|mode|expiry>"
export async function signTicket(secret, code, mode, ttl = TICKET_TTL_MS) {
  const exp = Date.now() + ttl;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${code}|${mode}|${exp}`));
  return `${exp}.${b64url(sig)}`;
}

export async function verifyTicket(secret, ticket, code, mode) {
  if (typeof ticket !== 'string') return false;
  const [expStr, sig] = ticket.split('.');
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(`${code}|${mode}|${exp}`));
  } catch {
    return false;
  }
}

export const JOIN_MODES = ['quick', 'create', 'tutorial', 'code'];
// Reconnects use "rejoin-<original mode>", so a room that restarted (e.g. after a deploy) comes back
// with the same settings.
export const rejoinMode = (mode) => `rejoin-${mode}`;
export const baseMode = (mode) => (typeof mode === 'string' && mode.startsWith('rejoin-') ? mode.slice(7) : mode);

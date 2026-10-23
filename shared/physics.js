import { GRAVITY, BALL_RADIUS, NET, COURT, PLAYER, BOUNDS, DIVE, SERVE } from './constants.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sideSign = (team) => (team === 0 ? -1 : 1);

// Advances the ball in place. Returns 'ground' | 'net' | null.
export function stepBall(b, dt) {
  const r = BALL_RADIUS;
  const px = b.x;
  b.vy -= GRAVITY * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;

  let ev = null;
  const side = px < 0 ? -1 : 1; // the ball's centre never passes through the mesh, so this is its side
  const alongNet = Math.abs(b.z) < COURT.halfWidth + 0.7;
  const touching = Math.abs(b.x) < r || (b.x < 0 ? -1 : 1) !== side;
  if (alongNet && touching && !b.inNet && b.vx * side < 0 && b.y > NET.height - r * 0.25 && b.y < NET.height + r * 0.6) {
    // Clipped the tape: the ball pops up and dribbles over, much slower ("net cord").
    b.vx *= 0.35;
    b.vz *= 0.6;
    b.vy = Math.abs(b.vy) * 0.3 + 1.6;
    b.y = NET.height + r * 0.65;
    ev = 'cord';
  } else if (alongNet && touching && b.y <= NET.height - r * 0.25 && b.y > NET.bottom - r * 0.5) {
    // Into the mesh: it stretches like a trampoline and springs the ball back out.
    if ((b.x < 0 ? -1 : 1) !== side || Math.abs(b.x) < 0.02) b.x = side * 0.02;
    const sink = r - Math.abs(b.x);
    b.vx += (side * NET.spring * sink - b.vx * NET.damping) * dt;
    b.vy *= 1 - 3 * dt;
    b.vz *= 1 - 4 * dt;
    if (!b.inNet) ev = 'net';
    b.inNet = true;
  } else {
    b.inNet = false;
  }

  if (b.y < r) {
    b.y = r;
    if (b.vy < 0) {
      ev = 'ground';
      b.vy = -b.vy * 0.55;
      if (b.vy < 0.8) b.vy = 0;
      b.vx *= 0.75;
      b.vz *= 0.75;
    }
  }
  return ev;
}

// Simulates forward until the ball falls to yLevel (or hits the ground).
export function predictLanding(b0, yLevel = BALL_RADIUS, maxT = 4) {
  const b = { ...b0 };
  const crossed = (ev) => (b.vy < 0 && b.y <= yLevel) || ev === 'ground';
  const dt = 1 / 60;
  for (let t = 0; t < maxT; t += dt) {
    const prev = { ...b };
    if (!crossed(stepBall(b, dt))) continue;
    // Redo the last step finely so the spot doesn't snap to the 1/60 s grid (that made the
    // marker shiver as the starting point moved from frame to frame).
    Object.assign(b, prev);
    const fine = dt / 16;
    for (let i = 1; i <= 16; i++) {
      if (crossed(stepBall(b, fine))) return { x: b.x, y: b.y, z: b.z, t: t + i * fine };
    }
    return { x: b.x, y: b.y, z: b.z, t: t + dt };
  }
  return null;
}

// Velocity for a lob that peaks at `apex` and lands on `target`.
export function arcVelocity(from, target, apex) {
  const g = GRAVITY;
  const h = Math.max(apex, from.y + 0.3, target.y + 0.3);
  const vy = Math.sqrt(2 * g * (h - from.y));
  const T = vy / g + Math.sqrt((2 * (h - target.y)) / g);
  return { vx: (target.x - from.x) / T, vy, vz: (target.z - from.z) / T };
}

// Velocity that reaches `target` in exactly T seconds (used for spikes).
export function directVelocity(from, target, T) {
  return {
    vx: (target.x - from.x) / T,
    vy: (target.y - from.y + 0.5 * GRAVITY * T * T) / T,
    vz: (target.z - from.z) / T,
  };
}

// Height of a launched ball when it passes plane x, or null if it never does.
export function yAtX(from, v, x) {
  if (Math.abs(v.vx) < 1e-4) return null;
  const t = (x - from.x) / v.vx;
  if (t <= 0) return null;
  return from.y + v.vy * t - 0.5 * GRAVITY * t * t;
}

export function clampPlayer(p, team, serving) {
  const s = sideSign(team);
  const inner = PLAYER.radius + 0.1;
  const serveLine = COURT.halfLength + 0.4;
  if (s < 0) p.x = clamp(p.x, -BOUNDS.x, serving ? -serveLine : -inner);
  else p.x = clamp(p.x, serving ? serveLine : inner, BOUNDS.x);
  const zLim = serving ? COURT.halfWidth : BOUNDS.z;
  p.z = clamp(p.z, -zLim, zLim);
}

export function serveZone(power) {
  if (power < SERVE.short) return 'short';
  if (power > SERVE.long) return 'long';
  if (power >= SERVE.perfectLo && power <= SERVE.perfectHi) return 'perfect';
  return 'good';
}

// Needle position for a meter that's been running for t seconds (ping-pongs 0 → 1 → 0).
export function meterValue(t) {
  const x = (t / SERVE.sweep) % 2;
  return x < 1 ? x : 2 - x;
}

export function startDive(p, dx, dz) {
  const len = Math.hypot(dx, dz);
  if (len < 0.01 || p.y > 0.01 || (p.diveT ?? -1) >= 0) return false;
  p.diveT = 0;
  p.diveX = dx / len;
  p.diveZ = dz / len;
  p.ry = Math.atan2(p.diveX, p.diveZ);
  return true;
}

// 'lunge' while flying forward, 'down' while recovering on the sand, or null.
export function diveState(p) {
  const t = p.diveT ?? -1;
  if (t < 0) return null;
  return t < DIVE.lunge ? 'lunge' : 'down';
}

// Moves a player in place. mx/mz is a world-space direction (length <= 1).
export function stepPlayer(p, mx, mz, jump, dt, team, serving) {
  if ((p.diveT ?? -1) >= 0) {
    p.diveT += dt;
    if (p.diveT < DIVE.lunge) {
      const v = DIVE.speed * (1 - (p.diveT / DIVE.lunge) * 0.6);
      p.x += p.diveX * v * dt;
      p.z += p.diveZ * v * dt;
      p.y = Math.sin((p.diveT / DIVE.lunge) * Math.PI) * 0.25;
    } else {
      p.y = 0;
      if (p.diveT >= DIVE.total) p.diveT = -1;
    }
    p.vy = 0;
    clampPlayer(p, team, serving);
    return;
  }
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const speed = PLAYER.speed * (p.y > 0.01 ? PLAYER.airSpeedMul : 1);
  p.x += mx * speed * dt;
  p.z += mz * speed * dt;
  if (jump && p.y <= 0.001) p.vy = PLAYER.jumpVel;
  p.vy -= PLAYER.gravity * dt;
  p.y += p.vy * dt;
  if (p.y <= 0) {
    p.y = 0;
    p.vy = 0;
  }
  clampPlayer(p, team, serving);
  if (len > 0.1) p.ry = Math.atan2(mx, mz);
}

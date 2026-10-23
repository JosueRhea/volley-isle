// Gameplay tuning shared by server (authoritative) and client (prediction).
// Units are meters / seconds. Team 0 plays on x < 0, team 1 on x > 0; the net is the plane x = 0.

export const COURT = { halfLength: 9, halfWidth: 4.5 };
// The mesh is a damped spring: a ball sinks in up to its radius, then gets pushed back out
// at roughly a third of its speed (spring ω ≈ 50/s, damping ratio ≈ 0.3).
export const NET = { height: 2.3, bottom: 1.1, spring: 2500, damping: 32 };
export const BOUNDS = { x: 15, z: 9 }; // where players may roam (the island)

export const BALL_RADIUS = 0.3;
export const GRAVITY = 11; // a bit floaty, cartoon-style

export const PLAYER = {
  speed: 6.8,
  airSpeedMul: 0.85,
  jumpVel: 7.4,
  gravity: 20,
  radius: 0.4,
  reach: 1.4, // horizontal hit reach
  reachHigh: 2.8, // max ball height above feet that can be hit
};

// Dive: a lunge along the ground that reaches far for low balls, then a short recovery on the sand.
export const DIVE = { lunge: 0.32, total: 0.85, speed: 10, reach: 2.1, reachHigh: 1.5 };

// Serve power meter (0..1): below `short` dies on your own side, above `long` sails out,
// and the narrow perfect band gives a deep, flat serve that's hard to return.
export const SERVE = { short: 0.3, perfectLo: 0.7, perfectHi: 0.82, long: 0.85, sweep: 0.8 };

export const SWING_TIME = 0.3; // hit window after pressing the hit button
export const HIT_COOLDOWN = 0.4;
export const MAX_TOUCHES = 3;
export const TEAM_SIZE = 2;
export const WIN_SCORE = 11;

// Slow-motion: everyone in the room slows down together for a beat after a spike,
// and again when a spike lands for the point. Durations are in real seconds.
export const SLOWMO = { scale: 0.2, spike: 1.0, kill: 0.8, rampOut: 0.35 };

export const TICK_HZ = 60;
export const SNAPSHOT_HZ = 30;

export const TEAM_NAMES = ['Lagoon', 'Sunset'];

// Playable cast, by index. Visuals live in client/scene/species.js (same order).
export const CHARACTERS = ['Bongo', 'Pinchy', 'Pip', 'Tiki', 'Mochi', 'Rocco'];

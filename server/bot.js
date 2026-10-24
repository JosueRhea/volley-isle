import { PLAYER, SWING_TIME, DIVE, MAX_TOUCHES, COURT } from '../shared/constants.js';
import { sideSign, stepPlayer, predictLanding, startDive, clamp } from '../shared/physics.js';

const rand = (a, b) => a + Math.random() * (b - a);
const CONTACT_Y = 1.2; // comfortable height for passes and sets
const SPIKE_Y = 3.1; // contact height near the top of a jump
const JUMP_LEAD = PLAYER.jumpVel / PLAYER.gravity; // seconds from takeoff to jump apex

export function homePos(team, slot, teamSize = 2) {
  const s = sideSign(team);
  if (teamSize === 1) return { x: s * 5.2, z: 0 };
  return slot === 0 ? { x: s * 6.2, z: -1.8 } : { x: s * 2.6, z: 1.8 };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Point on the opponents' court that's farthest from any of them (with a little randomness).
function openSpot(room, team) {
  const s = sideSign(team);
  const opp = room.players.filter((p) => p.team !== team);
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < 16; i++) {
    const spot = { x: -s * rand(2, 8.2), z: rand(-4, 4) };
    const gap = opp.length ? Math.min(...opp.map((o) => dist(o, spot))) : 5;
    const score = gap + rand(0, 0.8);
    if (score > bestScore) {
      bestScore = score;
      best = spot;
    }
  }
  return best;
}

// Server-side aim formulas, inverted so bots can aim at a point.
function aimSpikeAt(bot, ball, spot) {
  bot.aimF = clamp((Math.abs(spot.x) - 4) / 3, -1, 1);
  bot.aimZ = clamp((spot.z - ball.z) / 3.2, -1, 1);
}
function aimBumpAt(bot, ball, spot) {
  bot.aimF = clamp((Math.abs(spot.x) - 4.5) / 3, -1, 1);
  bot.aimZ = clamp((spot.z - ball.z * 0.4) / 3.5, -1, 1);
  bot.wantOver = true;
}
function aimServeAt(bot, spot) {
  bot.aimF = clamp((Math.abs(spot.x) - 5.5) / 2.5, -1, 1);
  bot.aimZ = clamp(spot.z / 3.5, -1, 1);
}

function swing(bot) {
  if (bot.cooldown <= 0 && bot.swingT <= 0) bot.swingT = SWING_TIME;
}

export function updateBot(bot, room, dt) {
  const ai = bot.ai;
  const s = sideSign(bot.team);
  const ball = room.ball;
  const serving = room.phase === 'serve' && room.server === bot;
  let target = homePos(bot.team, bot.slot, room.teamSize);
  let jump = false;

  if (ai.lastSeq !== room.hitSeq) {
    ai.lastSeq = room.hitSeq;
    // Bots aren't perfect: they occasionally misjudge, and spikes are much harder to dig.
    // Misses mostly happen on the opponent's hard stuff; balls from your own teammate are easy.
    const fromMate = room.lastTeam === bot.team;
    const tough = fromMate ? 0.02 : { spike: 0.35, tip: 0.35, block: 0.3 }[room.lastKind] ?? (room.lastKind === 'serve' && room.lastPerfect ? 0.3 : 0.06);
    ai.willPlay = Math.random() > tough;
    ai.err = rand(-0.3, 0.3);
    ai.judge = Math.random() < 0.85;
    ai.willBlock = Math.random() < 0.55;
  }

  const live = (room.phase === 'rally' || room.phase === 'lobby') && !room.tutorial;
  if (room.tutorial) {
    // Practice partner: waits at the net as a target for your passes and cheers you on.
    target = { x: s * 1.8, z: 1.6 };
  } else if (serving) {
    target = { x: bot.x, z: bot.z };
    if (room.phaseT > 1.2) {
      aimServeAt(bot, openSpot(room, bot.team));
      // Bots use the meter too: mostly solid, sometimes perfect, occasionally botched.
      const r = Math.random();
      bot.servePower = r < 0.05 ? rand(0.1, 0.28) : r < 0.1 ? rand(0.87, 1) : r < 0.3 ? rand(0.71, 0.81) : rand(0.4, 0.68);
      swing(bot);
    }
  } else if (live) {
    const mates = room.members(bot.team);
    const used = room.lastTeam === bot.team ? room.touches : 0;
    const next = used + 1;
    const pass = predictLanding(ball, CONTACT_Y);
    // Good judgment: let an opponent's ball go if it's sailing out (most of the time).
    const ground = room.lastTeam !== bot.team ? predictLanding(ball) : null;
    const goingOut = ground && (Math.abs(ground.x) > COURT.halfLength + 0.4 || Math.abs(ground.z) > COURT.halfWidth + 0.4);
    const ours = pass && pass.x * s > -0.2 && next <= MAX_TOUCHES && !(goingOut && ai.judge);

    if (ours) {
      // Who takes this touch: nearest teammate to where the ball comes down (not whoever just touched it).
      let pool = mates;
      if (mates.length > 1 && room.lastTeam === bot.team) pool = mates.filter((p) => p.id !== room.lastHitter);
      const taker = pool.reduce((a, b) => (dist(b, pass) < dist(a, pass) ? b : a), pool[0]);
      const attack = next === MAX_TOUCHES || (next === 2 && mates.length === 1);
      const spikePt = attack ? predictLanding(ball, SPIKE_Y) : null;
      const canSpike = spikePt && Math.abs(spikePt.x) < 4.5;

      if (taker === bot) {
        if (canSpike) {
          // Approach: get under the spike point, take off so the jump peaks as the ball arrives.
          target = { x: spikePt.x + s * 0.3, z: spikePt.z + ai.err * 0.5 };
          if (ai.willPlay && bot.y === 0 && spikePt.t <= JUMP_LEAD + 0.03 && dist(bot, spikePt) < 1.1) jump = true;
        } else {
          target = { x: pass.x + s * 0.3, z: pass.z + ai.err };
          // Can't make it on foot? Dive.
          const low = predictLanding(ball, 0.6);
          if (ai.willPlay && low && low.t < DIVE.lunge + 0.12) {
            const d = dist(bot, low);
            if (d > PLAYER.reach * 0.9 && d < DIVE.reach + DIVE.speed * DIVE.lunge * 0.6 && startDive(bot, low.x - bot.x, low.z - bot.z)) {
              swing(bot);
            }
          }
        }

        const horiz = Math.hypot(ball.x - bot.x, ball.z - bot.z);
        const rel = ball.y - bot.y;
        if (ai.willPlay && horiz < PLAYER.reach * 0.85 && rel > 0.25 && rel < 2.5 && ball.vy < 1.5) {
          bot.tipNext = false;
          if (bot.y > 0.3 || attack) {
            const spot = openSpot(room, bot.team);
            // Read the block: if someone's up at the net, tip it over them instead of hammering into their hands.
            const blockerUp = room.players.some((o) => o.team !== bot.team && o.y > 0.3 && Math.abs(o.x) < 1.6);
            if (bot.y > 0.3 && Math.random() < (blockerUp ? 0.45 : 0.08)) {
              bot.tipNext = true;
              bot.aimF = rand(-0.6, 0.3);
              bot.aimZ = clamp((spot.z - ball.z) / 2.5, -1, 1);
            } else if (bot.y > 0.3) aimSpikeAt(bot, ball, spot);
            else aimBumpAt(bot, ball, spot);
          } else {
            bot.aimF = 0; // pass / set to the teammate
            bot.aimZ = 0;
            bot.wantOver = false;
          }
          swing(bot);
        }
      } else if (mates.length > 1) {
        // Off the ball: be the setter at the net on first touch, the hitter waiting to approach on second.
        target = next === 1 ? { x: s * 1.8, z: clamp(pass.z * 0.5, -3, 3) } : { x: s * 4.2, z: clamp(pass.z * 0.8, -3.5, 3.5) };
      }
    } else if (ball.x * s < 0 || room.lastTeam === bot.team) {
      // Defense while the other side has it: split the court, shade toward the ball.
      const shade = clamp(ball.z * 0.35, -1.5, 1.5);
      target = mates.length > 1
        ? { x: s * 5.6, z: (bot.slot === 0 ? -2.1 : 2.1) + shade }
        : { x: s * 5.2, z: shade };

      // Block: when they're building an attack near the net, whoever's closer to the net goes up with the hitter.
      const theirs = room.lastTeam !== null && room.lastTeam !== bot.team && room.touches >= 1;
      const attackPt = theirs ? predictLanding(ball, SPIKE_Y) : null;
      if (attackPt && attackPt.x * s < 0 && Math.abs(attackPt.x) < 4 && mates.length > 1 && ai.willBlock) {
        const blocker = mates.reduce((a, b) => (Math.abs(b.x) < Math.abs(a.x) ? b : a), mates[0]);
        if (blocker === bot) {
          target = { x: s * 0.75, z: clamp(attackPt.z, -4, 4) };
          if (bot.y === 0 && attackPt.t <= JUMP_LEAD * 0.8 && Math.abs(bot.x) < 1.6) jump = true;
        }
      }
    }
  }

  let mx = target.x - bot.x;
  let mz = target.z - bot.z;
  const d = Math.hypot(mx, mz);
  if (d < 0.12) {
    mx = 0;
    mz = 0;
  } else {
    const k = Math.min(1, d / 0.5);
    mx = (mx / d) * k;
    mz = (mz / d) * k;
  }
  stepPlayer(bot, mx, mz, jump, dt, bot.team, serving);
  bot.mx = mx;
  bot.mz = mz;
}

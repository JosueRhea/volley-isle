import * as THREE from 'three';
import { part } from './toon.js';
import { buildSpecies, blobGeo } from './species.js';
import { TEAM_COLORS } from '../teams.js';
import { attachCharacterRig, animateCharacterRig } from './character-rig.js';

const INK_MAT = new THREE.MeshBasicMaterial({ color: 0x1b1b2f });
const WHITE_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff });
const tmp = new THREE.Vector3();
const dir = new THREE.Vector3();
const dirV = new THREE.Vector3();
const hL = new THREE.Vector3();
const hR = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

const damp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function angleLerp(a, b, k) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function makeLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 36px Fredoka, Nunito, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 9;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1b1b2f';
  ctx.strokeText(text, 128, 34);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}

export class Character {
  constructor({ team = 0, species = 0 } = {}) {
    const tc = TEAM_COLORS[team];
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.rotation.order = 'YXZ'; // yaw, then lean forward in local space
    this.root.add(this.body);
    this.t = Math.random() * 10;
    this.phase = 0;
    this.ry = 0;
    this.prevY = 0;
    this.wasAir = false;
    this.landT = 9;
    this.fallSpeed = 0;
    this.landStrength = 0.24;
    this.cheerT = 0;
    this.blinkIn = 1 + Math.random() * 3;
    this.blinkT = 0;
    this.swingActive = false;
    this.recoverT = 0;
    this.disposed = false;

    const { sp, update } = buildSpecies(species, this.body);
    this.sp = sp;
    this.extra = update;
    const limb = sp.limb ?? sp.color;

    // Rubber-hose arms: each shoulder aims at a hand target and the arm stretches to reach it,
    // so poses read clearly (forearm platform, hands over the forehead, big spike swing).
    const ARM_REST = 0.34;
    const arm = (sx) => {
      const sh = new THREE.Group();
      sh.position.set(sx * sp.shoulder[0], sp.shoulder[1], 0.02);
      const upper = new THREE.Group();
      sh.add(upper);
      const hand = new THREE.Group();
      sh.add(hand);
      if (sp.hand === 'wing') {
        upper.add(part(blobGeo(0.07, 0.2, 0.13).translate(0, -0.18, 0), limb, { outline: 0.025 }));
        hand.add(part(blobGeo(0.06, 0.08, 0.11), limb, { outline: 0.02 }));
      } else {
        upper.add(part(new THREE.CapsuleGeometry(0.058, 0.2, 4, 8).translate(0, -0.14, 0), limb, { outline: 0.022 }));
        const band = part(new THREE.TorusGeometry(0.064, 0.03, 6, 14), tc.main, { outline: 0.012 });
        band.rotation.x = Math.PI / 2;
        band.position.y = 0.09;
        hand.add(band);
        if (sp.hand === 'claw') {
          hand.add(part(blobGeo(0.1, 0.09, 0.09), limb, { outline: 0.022 }));
          for (const s2 of [-1, 1]) {
            const pincer = part(blobGeo(0.045, 0.12, 0.06).translate(0, -0.1, 0), limb, { outline: 0.02 });
            pincer.position.x = s2 * 0.04;
            pincer.rotation.z = s2 * 0.35;
            hand.add(pincer);
          }
        } else {
          // Flat little palm + thumb, so hands read as hands, not baseball mitts.
          hand.add(part(blobGeo(0.075, 0.09, 0.05), limb, { outline: 0.02 }));
          const thumb = part(blobGeo(0.028, 0.05, 0.028), limb, { outline: 0.012 });
          thumb.position.set(-sx * 0.06, 0.02, 0.03);
          thumb.rotation.z = -sx * 0.6;
          hand.add(thumb);
        }
      }
      hand.position.y = -ARM_REST;
      this.body.add(sh);
      return { sh, upper, hand, side: sx, target: new THREE.Vector3(sx * (sp.shoulder[0] + 0.06), sp.shoulder[1] - ARM_REST, 0.02) };
    };
    this.armRest = ARM_REST;
    this.armL = arm(-1);
    this.armR = arm(1);

    // Legs ending in chunky team-colored sneakers
    const [hipX, hipY] = sp.hip;
    const L = Math.max(0.02, hipY - 0.22);
    const leg = (sx) => {
      const hip = new THREE.Group();
      hip.position.set(sx * hipX, hipY, 0);
      hip.add(part(new THREE.CapsuleGeometry(0.07, L, 4, 8).translate(0, -(L / 2 + 0.04), 0), limb, { outline: 0.022 }));
      hip.add(part(blobGeo(0.115, 0.08, 0.17).translate(0, -hipY + 0.08, 0.05), tc.main, { outline: 0.022 }));
      hip.add(part(blobGeo(0.12, 0.035, 0.175).translate(0, -hipY + 0.035, 0.05), 0xffffff, { outline: 0.015 }));
      this.body.add(hip);
      return hip;
    };
    this.legL = leg(-1);
    this.legR = leg(1);

    // Eyes: googly (tracking pupils) or beady dots. Both blink.
    this.eyes = [];
    const E = sp.eyes;
    for (const [x, y, z] of E.pos) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      this.body.add(g);
      let pupil = null;
      if (E.style === 'dot') {
        g.add(new THREE.Mesh(new THREE.SphereGeometry(E.r, 12, 10), INK_MAT));
        const shine = new THREE.Mesh(new THREE.SphereGeometry(E.r * 0.3, 8, 6), WHITE_MAT);
        shine.position.set(E.r * 0.35, E.r * 0.4, E.r * 0.75);
        g.add(shine);
      } else {
        g.add(part(new THREE.SphereGeometry(E.r, 18, 14), 0, { material: WHITE_MAT, outline: 0.018, shadow: false }));
        pupil = new THREE.Mesh(new THREE.SphereGeometry(E.r * 0.55, 14, 10), INK_MAT);
        const shine = new THREE.Mesh(new THREE.SphereGeometry(E.r * 0.16, 8, 6), WHITE_MAT);
        shine.position.set(E.r * 0.18, E.r * 0.2, E.r * 0.42);
        pupil.add(shine);
        pupil.position.z = E.r * 0.6;
        g.add(pupil);
      }
      this.eyes.push({ g, pupil, r: E.r });
    }

    // Team ring on the ground so you can always tell who's who.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.64, 36),
      new THREE.MeshBasicMaterial({ color: tc.main, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.teamColor = tc.main;
    this.ring.position.y = 0.02;
    this.root.add(this.ring);
    this.modelReady = attachCharacterRig(this, species, tc.main).catch((error) => {
      console.warn(`Using fallback ${this.sp.name}:`, error);
      return false;
    });
  }

  setLabel(text, isMe) {
    if (this.label) {
      this.root.remove(this.label);
      this.label.material.map.dispose();
      this.label.material.dispose();
    }
    this.label = makeLabel(text, isMe ? '#ffe066' : '#ffffff');
    this.label.position.y = this.sp.top + 0.35;
    this.root.add(this.label);
  }

  // Your ground ring glows when the ball is in hitting range.
  setHighlight(on) {
    if (this.highlight === on) return;
    this.highlight = on;
    this.ring.material.color.set(on ? 0xffe066 : this.teamColor);
    this.ring.scale.setScalar(on ? 1.25 : 1);
  }

  showLabel(on) {
    if (this.label) this.label.visible = on;
  }

  // Points an arm at a body-space hand target, stretching it to fit.
  reach(arm, target, k) {
    arm.target.lerp(target, k);
    dirV.copy(arm.target).sub(arm.sh.position);
    const len = clamp(dirV.length(), this.armRest * 0.6, this.armRest * 2.4);
    arm.sh.quaternion.setFromUnitVectors(DOWN, dirV.normalize());
    arm.upper.scale.y = len / this.armRest;
    arm.hand.position.y = -len;
  }

  // st: { speed, y, vy, airborne, swing (0..1 or -1), swingKind, dive (0|1|2), ready, ry, cheer, holding, look,
  //       idle (menu fidget), spin (extra yaw, radians) }
  update(dt, st) {
    if (this.disposed) return;
    this.t += dt;
    const swinging = st.swing >= 0;
    if (this.swingActive && !swinging) this.recoverT = 0.18;
    this.swingActive = swinging;
    this.recoverT = Math.max(0, this.recoverT - dt);
    const sp = this.sp;
    const y = st.y ?? 0;
    const vy = (y - this.prevY) / Math.max(dt, 1e-3);
    this.prevY = y;
    const air = st.airborne && !st.dive;
    if (this.wasAir && !air) {
      this.landT = 0;
      const softness = this.sp.name === 'Mochi' ? .38 : this.sp.name === 'Rocco' ? .20 : .29;
      this.landStrength = softness * clamp(this.fallSpeed / 7, .55, 1.2);
    }
    this.fallSpeed = air ? Math.max(0, -vy) : 0;
    this.cheerT = st.cheer ? this.cheerT + dt : 0;
    this.wasAir = air;
    this.landT += dt;

    const run = air || st.dive ? 0 : Math.min(1, st.speed / 5.5);
    if (run > 0.05) this.phase += dt * (6 + st.speed * 1.8);
    const sw = Math.sin(this.phase);

    // Pose description: legs/lean/drop as angles, hands as body-space targets.
    const [sx, sy] = sp.shoulder;
    const front = sp.front ?? 0.38;
    const top = sp.top;
    const R = this.armRest;
    let legL = sw * 1.0 * run;
    let legR = -sw * 1.0 * run;
    let lean = 0.2 * run;
    let drop = 0;
    let lift = 0;
    let effort = false;
    let poseK = 14;
    let twist = 0;
    if (this.recoverT > 0) poseK = 8; // ease from the follow-through back into locomotion
    hL.set(-(sx + 0.05), sy - R * 0.92 + Math.max(0, -sw) * 0.08 * run, 0.02 - sw * 0.28 * run);
    hR.set(sx + 0.05, sy - R * 0.92 + Math.max(0, sw) * 0.08 * run, 0.02 + sw * 0.28 * run);

    const idle = st.idle && run < 0.05 && !air;
    const breath = Math.sin(this.t * 2.1);
    if (idle) {
      // Menu idle: slow breathing, lazy arm sway and a little weight shift side to side.
      drop = -breath * 0.015;
      lean = Math.sin(this.t * 0.8) * 0.05;
      hL.y += Math.sin(this.t * 1.6) * 0.04;
      hR.y += Math.sin(this.t * 1.6 + 1.3) * 0.04;
      hL.z += Math.sin(this.t * 1.1) * 0.05;
      hR.z += Math.sin(this.t * 1.1 + 2) * 0.05;
    }
    if (st.ready && run < 0.5 && !air) {
      // Ready stance: knees bent, platform low and out front.
      drop = 0.07;
      lean = 0.25;
      legL = legR = -0.25;
      hL.set(-0.09, sy - 0.32, front + 0.14);
      hR.set(0.09, sy - 0.32, front + 0.14);
    }
    if (air) {
      legL = -0.7;
      legR = 0.35;
      lean = 0;
      if (vy > 0) {
        // Approach arm swing: both arms thrown up on takeoff.
        hL.set(-(sx + 0.12), top + 0.3, 0.05);
        hR.set(sx + 0.12, top + 0.3, 0.05);
        effort = true;
      } else {
        hL.set(-(sx + 0.15), sy + 0.15, 0.1);
        hR.set(sx + 0.15, sy + 0.15, 0.1);
      }
    }
    if (air && st.block) {
      // Block at the net: both hands high and wide, pressed over the tape.
      hL.set(-(sx * 0.6), top + 0.45, front + 0.2);
      hR.set(sx * 0.6, top + 0.45, front + 0.2);
      effort = true;
    }
    if (st.holding) {
      hL.set(-0.13, top + 0.12, front * 0.7);
      hR.set(0.13, top + 0.12, front * 0.7);
    }
    let celebrationRoll = 0;
    if (st.cheer) {
      const t = this.cheerT;
      const wave = Math.sin(t * 9);
      hL.set(-(sx + .18), top + .35, 0);
      hR.set(sx + .18, top + .35, 0);
      switch (sp.name) {
        case 'Bongo': // Alternate chest drums, then a proud raised fist.
          hL.set(-.16, sy + .05 + wave * .13, front + .12);
          hR.set(.20, sy + .05 - wave * .13, front + .12);
          if (t % 2.4 > 1.6) hR.set(sx+.15,top+.55,0);
          lean = -.08;drop = -Math.abs(wave) * .07;
          break;
        case 'Pinchy': // Side-to-side claw dance.
          hL.y += wave * .22;hR.y -= wave * .22;
          twist = Math.sin(t * 5) * .24;celebrationRoll = wave * .10;
          break;
        case 'Pip': // Fast little wing flaps.
          hL.set(-sx-.25,sy+.18+wave*.30,0);
          hR.set(sx+.25,sy+.18+wave*.30,0);
          drop = -Math.abs(Math.sin(t*6))*.19;lean = -.10;
          break;
        case 'Tiki': // A relaxed hula with hands moving together.
          hL.set(-sx+wave*.20,sy+.12,front);
          hR.set(sx+wave*.20,sy+.12,front);
          twist = Math.sin(t*4)*.25;celebrationRoll = Math.sin(t*4)*.14;
          break;
        case 'Mochi': // Soft bounces and a two-handed wave.
          hL.y += wave*.18;hR.y += wave*.18;
          drop = -Math.abs(Math.sin(t*5))*.24;celebrationRoll = Math.sin(t*2.5)*.08;
          break;
        case 'Rocco': // Slow, weighty double fist pumps; smoke joins the party.
          hL.y = hR.y = sy+.32+Math.max(0,Math.sin(t*5))*.42;
          lean = -.14;drop = -Math.abs(Math.sin(t*2.5))*.08;
          break;
      }
    }
    if (st.swing >= 0) {
      const p = st.swing;
      const bell = Math.sin(p * Math.PI);
      poseK = 26;
      switch (st.swingKind) {
        case 'set':
          // Hands up at the forehead, push up through the ball.
          hL.set(-0.11, top + 0.05 + bell * 0.2, front * 0.6);
          hR.set(0.11, top + 0.05 + bell * 0.2, front * 0.6);
          lean = -0.12;
          drop = 0.06 * (1 - p) - 0.05 * bell;
          legL = legR = -0.15;
          break;
        case 'spike':
        case 'serve': {
          // Cock the hitting arm back behind the head, then whip it through.
          const e = THREE.MathUtils.smoothstep(p, 0.18, 0.78);
          hR.set(sx * (1 - e * 0.5), top + 0.35 - e * (top + 0.25 - sy), -0.3 + e * (front + 0.7));
          hL.set(-sx * 0.6 - e * 0.3, top + 0.3 - e * 0.6, front * 0.5 - e * 0.3);
          lean = -0.35 + e * 0.8;
          twist = -0.22 + e * 0.42;
          effort = true;
          break;
        }
        case 'tip':
          // Soft touch: one hand floats up and pushes the ball over with the fingertips.
          hR.set(sx * 0.35, top + 0.3 + bell * 0.15, front + 0.25 + bell * 0.25);
          hL.set(-(sx + 0.1), sy, 0.1);
          lean = 0.1;
          break;
        case 'dig':
          break; // handled by the dive pose below
        default:
          // Bump: forearms locked together in a platform, legs drive up.
          hL.set(-0.07, sy - 0.36 + bell * 0.18, front + 0.2);
          hR.set(0.07, sy - 0.36 + bell * 0.18, front + 0.2);
          lean = 0.35 - bell * 0.15;
          drop = 0.12 * (1 - p);
          legL = legR = -0.35 * (1 - p);
          effort = true;
      }
    }
    if (st.dive) {
      // Full-stretch dive: body flat out, arms reaching past the head.
      lean = 1.35;
      lift = 0.3;
      legL = 0.35;
      legR = 0.6;
      hL.set(-0.13, top + 0.35, front * 0.3);
      hR.set(0.13, top + 0.35, front * 0.3);
      effort = st.dive === 1;
      poseK = 22;
    }

    const k = 1 - Math.exp(-dt * 18);
    const kPose = 1 - Math.exp(-dt * poseK);
    this.reach(this.armL, hL, kPose);
    this.reach(this.armR, hR, kPose);
    this.legL.rotation.x = damp(this.legL.rotation.x, legL, k);
    this.legR.rotation.x = damp(this.legR.rotation.x, legR, k);
    const bob = Math.abs(sw) * 0.06 * run + Math.sin(this.t * 2.5) * 0.008 * (1 - run);
    this.body.position.y = damp(this.body.position.y, bob - drop + lift, k);
    // Getting up from a dive is a beat slower than going down.
    this.body.rotation.x = damp(this.body.rotation.x, lean, st.dive ? kPose : 1 - Math.exp(-dt * 9));
    this.ry = angleLerp(this.ry, st.ry, 1 - Math.exp(-dt * 12));
    this.body.rotation.y = this.ry + (st.spin ?? 0) + twist;
    this.body.rotation.z = damp(this.body.rotation.z, st.cheer ? celebrationRoll : idle ? Math.sin(this.t * 0.8 + 0.6) * 0.05 : -sw * 0.045 * run, k);

    // Squash & stretch: stretch while rising, jelly-wobble on landing, bounce while running.
    let sq = air ? 1 + clamp(vy * 0.025, -0.08, 0.18) : 1;
    sq -= Math.exp(-this.landT * 8) * Math.cos(this.landT * 23) * this.landStrength;
    sq += (Math.abs(sw) - 0.5) * 0.08 * run;
    if (st.cheer) sq += Math.sin(this.cheerT * 10) * (sp.name === 'Mochi' ? .14 : .06);
    if (idle) sq += breath * 0.02;
    const sxz = 1 / Math.sqrt(sq);
    this.body.scale.set(sxz, sq, sxz);
    this.effort = effort;
    if (this.rig) {
      this.root.updateMatrixWorld(true);
      animateCharacterRig(this, dt, st, run, drop);
    }

    // Blink, squint with effort, pupils that follow the ball.
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkT = 0.13;
      this.blinkIn = 1.5 + Math.random() * 3.5;
    }
    this.blinkT -= dt;
    const eyeOpen = this.blinkT > 0 ? 0.1 : effort ? 0.5 : 1;
    let local = null;
    if (st.look) {
      this.root.updateMatrixWorld(true);
      local = this.body.worldToLocal(tmp.copy(st.look));
    }
    for (const e of this.eyes) {
      e.g.scale.y = damp(e.g.scale.y, eyeOpen, 1 - Math.exp(-dt * 42));
      if (!e.pupil) continue;
      if (local) {
        dir.copy(local).sub(e.g.position).normalize();
        dir.z += 1.2;
        dir.normalize();
      } else dir.set(0, 0, 1);
      e.pupil.position.lerp(dir.multiplyScalar(e.r * 0.6), 1 - Math.exp(-dt * 20));
    }

    this.effort = effort;
    this.ring.position.y = -y + 0.02;
    this.extra?.(dt, this.t, st, run);
  }

  dispose(scene) {
    this.disposed = true;
    scene.remove(this.root);
    this.rig?.dispose();
    if (this.label) this.label.material.map.dispose();
  }
}

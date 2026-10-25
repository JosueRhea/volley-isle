import * as THREE from 'three';
import { sideSign, clamp } from '../shared/physics.js';

const SPIKE_CAM_TIME = 0.9; // real seconds the spike cam holds before handing back

// Picks a shot every frame and eases the real camera toward it.
//   play      – behind your baseline, framing you + the ball, pushing out as the ball climbs
//   serve     – low over-the-shoulder when you're serving
//   spike     – hard cut to a slow-mo shot of the spiker, always from your half so left/right never flips:
//               over the spiker's shoulder when your team attacks, a defender's view across the net when they do
//   celebrate – slow orbit around the team that just scored
export class CameraDirector {
  constructor(camera) {
    this.cam = camera;
    this.pos = camera.position.clone();
    this.look = new THREE.Vector3(0, 1, 0);
    this.fov = camera.fov;
    this.roll = 0;
    this.shake = 0;
    this.mode = 'play';
    this.t = 0;
    this.anchor = new THREE.Vector3();
    this.spikeTeam = 0;
    this.spikeSide = 1;
    this.spikeMine = true;
    this.orbit = null;
    this.P = new THREE.Vector3();
    this.L = new THREE.Vector3();
    this.C = new THREE.Vector3();
  }

  // Take over from wherever the camera currently is (e.g. the lobby).
  sync(look) {
    this.pos.copy(this.cam.position);
    this.look.copy(look);
    this.fov = this.cam.fov;
  }

  spike(pos, team, myTeam) {
    this.mode = 'spike';
    this.t = 0;
    this.anchor.copy(pos);
    this.spikeTeam = team;
    this.spikeMine = team === myTeam;
    this.spikeSide = pos.z >= 0 ? 1 : -1;
    this.spikeShot(0);
    this.pos.copy(this.P); // hard cut
    this.look.copy(pos);
    this.fov = 38;
    this.shake = Math.max(this.shake, 0.12);
  }

  impact(power) {
    this.shake = Math.max(this.shake, power);
  }

  spikeShot(t) {
    const sT = sideSign(this.spikeTeam);
    const a = this.anchor;
    if (this.spikeMine) {
      // Low, behind and beside the spiker; dollies toward the net as the ball flies away from you.
      this.P.set(a.x + sT * (4.2 - t * 2.2), Math.max(0.9, a.y - 0.6 + t * 0.6), a.z + this.spikeSide * (2.6 + t * 0.8));
    } else {
      // From your half, looking back across the net at the spiker; backs off as the ball comes at you.
      // High enough to see over the net tape, and off to one side so the ball doesn't fly through the lens.
      this.P.set(-sT * (5.5 + t * 3), 2.7 + t * 0.4, a.z * 0.5 + this.spikeSide * (2.2 + t * 1.2));
    }
  }

  // ctx: { myTeam, me, meVel, ball, phase, phaseTime, servingMe, winners: Vector3[], scoringTeam }
  update(dt, ctx) {
    this.t += dt;
    const { P, L } = this;
    const s = sideSign(ctx.myTeam);
    let fov;
    let posK;
    let lookK;
    let roll = 0;

    if (this.mode === 'spike' && this.t > SPIKE_CAM_TIME) this.mode = 'play';
    const celebrating = (ctx.phase === 'point' || ctx.phase === 'over') && ctx.winners.length && ctx.phaseTime > 0.6;

    if (this.mode === 'spike') {
      const k = this.t / SPIKE_CAM_TIME;
      this.spikeShot(k);
      L.lerpVectors(this.anchor, ctx.ball, Math.min(1, k * 2.5));
      fov = 38 + k * (this.spikeMine ? 14 : 20);
      posK = 10;
      lookK = 12;
    } else if (celebrating) {
      const C = this.C.set(0, 0, 0);
      for (const w of ctx.winners) C.add(w);
      C.divideScalar(ctx.winners.length);
      const sW = sideSign(ctx.scoringTeam);
      if (this.orbit === null) this.orbit = sW < 0 ? 0 : Math.PI; // start on the net side, facing them
      this.orbit += dt * 0.4;
      const r = ctx.phase === 'over' ? 7.5 : 5.5;
      P.set(C.x + Math.cos(this.orbit) * r, 2.1, C.z + Math.sin(this.orbit) * r);
      L.set(C.x, 1.0, C.z);
      fov = 40;
      posK = 2.5;
      lookK = 4;
    } else if (ctx.servingMe) {
      const me = ctx.me;
      P.set(me.x + s * 3.4, 2.1, me.z + 1.6);
      L.set(-s * 4, 1.5, me.z * 0.3);
      fov = 52;
      posK = 3;
      lookK = 4;
    } else {
      const { me, ball } = ctx;
      const high = clamp(ball.y - 1.5, 0, 6);
      const fx = me.x * 0.6 + ball.x * 0.4;
      const fz = me.z * 0.6 + ball.z * 0.4;
      // Stay at least 9m behind you so you never drop out of the bottom of the frame.
      const back = Math.max(15 + fx * 0.3 * s, me.x * s + 9);
      P.set(s * back, 6.3 + high * 0.45, fz * 0.5);
      L.set(fx * 0.45 - s * 1, 1.0 + high * 0.3, fz * 0.55);
      fov = 46 + high * 1.2 + clamp(Math.abs(ball.x - me.x) - 4, 0, 10) * 0.4;
      // Lean into sideways runs a touch.
      roll = clamp(ctx.meVel.z * s * 0.006, -0.05, 0.05);
      posK = 3.5;
      lookK = 5;
    }
    if (!celebrating) this.orbit = null;
    this.cinematic = this.mode === 'spike' || celebrating;

    this.pos.lerp(P, 1 - Math.exp(-dt * posK));
    this.look.lerp(L, 1 - Math.exp(-dt * lookK));
    this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 5));
    this.roll += (roll - this.roll) * (1 - Math.exp(-dt * 4));

    const cam = this.cam;
    cam.position.copy(this.pos);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      cam.position.z += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.2);
    }
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    cam.lookAt(this.look);
    cam.rotateZ(this.roll);
  }
}

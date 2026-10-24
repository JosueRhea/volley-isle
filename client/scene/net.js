import * as THREE from 'three';
import { part } from './toon.js';
import { COURT, NET } from '../../shared/constants.js';

const COLS = 48;
const ROWS = 10;
const WAVE = 650; // spring coupling between neighbours (higher = stiffer, faster ripples)
const PULL = 18; // pull back to rest
const PULL_TOP = 260; // the top tape is under much more tension
const DAMP = 2.8;
const STEP = 1 / 120;
const PRESS = 900; // how hard a body pressing into the net drags the cloth along with it

function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#2a2420';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The net as a springy cloth: each vertex can bulge along x (toward either team) and ripples spread
// to its neighbours. Ball hits push it; the posts hold the side edges still.
export class NetCloth {
  constructor(scene) {
    this.postZ = COURT.halfWidth + 0.7;
    const W = this.postZ * 2;
    const H = NET.height - NET.bottom;

    const tex = netTexture();
    tex.repeat.set(W / 0.15, H / 0.15);
    this.geo = new THREE.PlaneGeometry(W, H, COLS, ROWS).rotateY(Math.PI / 2).translate(0, NET.bottom + H / 2, 0);
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }),
    );
    scene.add(this.mesh);

    const n = (COLS + 1) * (ROWS + 1);
    this.disp = new Float32Array(n);
    this.vel = new Float32Array(n);
    // Vertex z for each column (PlaneGeometry rows run top → bottom, columns along the width).
    const pos = this.geo.attributes.position;
    this.colZ = Array.from({ length: COLS + 1 }, (_, ix) => pos.getZ(ix));
    this.rowY = Array.from({ length: ROWS + 1 }, (_, iy) => pos.getY(iy * (COLS + 1)));

    // Top tape follows the top row of the cloth.
    this.bandGeo = new THREE.BoxGeometry(0.06, 0.12, W, 1, 1, COLS);
    this.bandBase = this.bandGeo.attributes.position.array.slice();
    const band = part(this.bandGeo, 0xffffff, { outline: 0.015 });
    band.position.y = NET.height - 0.06;
    scene.add(band);

    this.acc = 0;
    this.energy = 1;
    this.presses = [];
  }

  // Something is pushing into the cloth this frame (the ball, a player's body or hands).
  // depth is signed along x: the cloth near (z, y) gets dragged out to at least that displacement.
  press(z, y, depth, radius) {
    if (Math.abs(z) < this.postZ) this.presses.push({ z, y, depth, radius });
  }

  // Push the cloth at (z, y): `strength` in m/s, `dir` = which way the ball was travelling along x.
  impulse(z, y, strength, dir) {
    const R = 1.05;
    strength = Math.min(24, Math.max(0, strength));
    for (let iy = 0; iy <= ROWS; iy++) {
      for (let ix = 1; ix < COLS; ix++) {
        const d = Math.hypot(this.colZ[ix] - z, this.rowY[iy] - y);
        if (d < R) {
          const f = (1 - d / R) ** 2;
          this.vel[iy * (COLS + 1) + ix] += dir * strength * f * (iy === 0 ? 0.50 : 1);
        }
      }
    }
    this.energy = 1;
  }

  update(dt, t) {
    this.acc = Math.min(this.acc + dt, 0.1);
    const { disp, vel } = this;
    const w = COLS + 1;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      let energy = 0;
      for (let iy = 0; iy <= ROWS; iy++) {
        // A soft breeze keeps the net gently alive even when nobody touches it.
        const breeze = Math.sin(t * 1.3 + iy * 0.3) * 0.012 * (iy / ROWS);
        for (let ix = 1; ix < COLS; ix++) {
          const i = iy * w + ix;
          const up = iy > 0 ? disp[i - w] : disp[i];
          const down = iy < ROWS ? disp[i + w] : disp[i];
          const lap = disp[i - 1] + disp[i + 1] + up + down - 4 * disp[i];
          const pull = iy === 0 ? PULL_TOP : PULL;
          let push = 0;
          for (const p of this.presses) {
            const d = Math.hypot(this.colZ[ix] - p.z, this.rowY[iy] - p.y);
            if (d >= p.radius) continue;
            const target = p.depth * (1 - (d / p.radius) ** 2);
            // One-way: only drag the cloth when it hasn't been pushed that far yet.
            if ((target > 0 && disp[i] < target) || (target < 0 && disp[i] > target)) push += (target - disp[i]) * PRESS;
          }
          vel[i] += (WAVE * lap - pull * (disp[i] - breeze) - DAMP * vel[i] + push) * STEP;
          energy += Math.abs(vel[i]);
        }
      }
      for (let i = 0; i < disp.length; i++) disp[i] += vel[i] * STEP;
      this.energy = energy;
    }

    this.presses.length = 0;
    const pos = this.geo.attributes.position;
    for (let i = 0; i < disp.length; i++) pos.setX(i, disp[i]);
    pos.needsUpdate = true;

    // Bend the tape with the top row.
    const band = this.bandGeo.attributes.position;
    const half = this.postZ;
    for (let i = 0; i < band.count; i++) {
      const z = this.bandBase[i * 3 + 2];
      const ix = Math.round(((half - z) / (2 * half)) * COLS);
      band.setX(i, this.bandBase[i * 3] + disp[Math.max(0, Math.min(COLS, ix))]);
    }
    band.needsUpdate = true;
  }
}

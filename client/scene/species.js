import * as THREE from 'three';
import { part, toon, withOutline } from './toon.js';

// The Volley Isle cast. Order must match CHARACTERS in shared/constants.js.
// Each species builds its unique body; Character adds the shared limbs, eyes and sneakers.
//   shoulder/hip: [x offset, height] of limb pivots
//   eyes: googly 'big' eyes (white + tracking pupil) or beady 'dot' eyes
//   top: height of the head, for the name label

export const blobGeo = (rx, ry, rz, w = 28, h = 20) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);

const MOUTH = new THREE.MeshBasicMaterial({ color: 0x5a1630 });
const TONGUE = new THREE.MeshBasicMaterial({ color: 0xff6f8e });
const INK_BASIC = new THREE.MeshBasicMaterial({ color: 0x1b1b2f });
const CHEEK = new THREE.MeshBasicMaterial({ color: 0xff7b9c, transparent: true, opacity: 0.55, depthWrite: false });

function kit(body) {
  const at = (mesh, x, y, z, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    body.add(mesh);
    return mesh;
  };
  return {
    at,
    blob: (rx, ry, rz, color, opts = {}) => part(blobGeo(rx, ry, rz), color, { outline: 0.03, ...opts }),
    // Open "D" mouth with a tongue; tilt follows the curve of the face.
    mouth(x, y, z, r, tilt = -0.3) {
      const shape = new THREE.Shape();
      shape.moveTo(-r, 0);
      shape.lineTo(r, 0);
      shape.absarc(0, 0, r, 0, Math.PI, true);
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 14,
      });
      const m = withOutline(new THREE.Mesh(geo, MOUTH), 0.012);
      const tongue = new THREE.Mesh(blobGeo(r * 0.55, r * 0.3, 0.02), TONGUE);
      tongue.position.set(0, -r * 0.6, 0.035);
      m.add(tongue);
      return at(m, x, y, z, tilt);
    },
    // Thin smile line.
    grin(x, y, z, r, tilt = -0.3) {
      return at(new THREE.Mesh(new THREE.TorusGeometry(r, 0.016, 6, 18, Math.PI), INK_BASIC), x, y, z, tilt, 0, Math.PI);
    },
    cheeks(x, y, z) {
      for (const sx of [-1, 1]) at(new THREE.Mesh(new THREE.CircleGeometry(0.06, 14), CHEEK), sx * x, y, z, 0, sx * 0.6, 0);
    },
  };
}

export const SPECIES = [
  {
    name: 'Bongo',
    title: 'the Frog',
    tagline: 'Huge hops. Bigger grin.',
    color: 0x6fd14b,
    shoulder: [0.41, 0.8],
    hip: [0.17, 0.3],
    hand: 'mitt',
    top: 1.45,
    eyes: { style: 'big', r: 0.13, pos: [[-0.18, 1.3, 0.19], [0.18, 1.3, 0.19]] },
    build(c) {
      c.at(c.blob(0.42, 0.5, 0.38, this.color), 0, 0.78, 0);
      c.at(c.blob(0.3, 0.32, 0.12, 0xf4f1b5, { outline: 0.015 }), 0, 0.66, 0.28);
      for (const sx of [-1, 1]) c.at(c.blob(0.17, 0.15, 0.16, this.color), sx * 0.18, 1.2, 0.1);
      c.mouth(0, 1.03, 0.33, 0.13);
      c.cheeks(0.29, 1.0, 0.27);
    },
  },
  {
    name: 'Pinchy',
    title: 'the Crab',
    tagline: 'Sideways? Never. Spikes? Always.',
    color: 0xf2553b,
    shoulder: [0.52, 0.75],
    hip: [0.2, 0.38],
    hand: 'claw',
    front: 0.42,
    top: 1.5,
    eyes: { style: 'big', r: 0.11, pos: [[-0.15, 1.4, 0.13], [0.15, 1.4, 0.13]] },
    build(c) {
      c.at(c.blob(0.55, 0.36, 0.42, this.color), 0, 0.72, 0);
      for (const [x, y, z] of [[-0.22, 1.04, -0.02], [0.17, 1.05, -0.12], [0.05, 1.02, 0.17]]) {
        c.at(c.blob(0.08, 0.03, 0.08, 0xff9474, { outline: 0.01 }), x, y, z);
      }
      for (const sx of [-1, 1]) {
        c.at(part(new THREE.CylinderGeometry(0.035, 0.045, 0.34, 8), this.color, { outline: 0.02 }), sx * 0.15, 1.2, 0.12);
        for (let i = 0; i < 2; i++) {
          const leg = part(new THREE.CapsuleGeometry(0.035, 0.22, 4, 8).translate(0, -0.13, 0), this.color, { outline: 0.02 });
          c.at(leg, sx * 0.42, 0.55, -0.12 + i * 0.2, 0, 0, sx * 0.9);
        }
      }
      c.mouth(0, 0.78, 0.4, 0.1, -0.15);
      c.cheeks(0.3, 0.74, 0.37);
    },
  },
  {
    name: 'Pip',
    title: 'the Puffin',
    tagline: 'Tiny wings, perfect sets.',
    color: 0x2b2f45,
    shoulder: [0.38, 0.95],
    hip: [0.15, 0.3],
    hand: 'wing',
    top: 1.5,
    eyes: { style: 'big', r: 0.1, pos: [[-0.14, 1.13, 0.37], [0.14, 1.13, 0.37]] },
    build(c) {
      c.at(c.blob(0.4, 0.52, 0.38, this.color), 0, 0.8, 0);
      c.at(c.blob(0.3, 0.22, 0.16, 0xffffff, { outline: 0.015 }), 0, 1.05, 0.24);
      c.at(c.blob(0.29, 0.3, 0.14, 0xffffff, { outline: 0.015 }), 0, 0.62, 0.26);
      const beak = part(new THREE.ConeGeometry(0.12, 0.28, 4), 0xff8a1e, { outline: 0.02 });
      beak.scale.set(1, 1, 0.7);
      c.at(beak, 0, 0.98, 0.45, Math.PI / 2, 0, Math.PI / 4);
      for (const [x, rz] of [[-0.07, 0.4], [0, 0], [0.07, -0.4]]) {
        c.at(part(new THREE.ConeGeometry(0.05, 0.2, 6), this.color, { outline: 0.015 }), x, 1.36, 0, -0.3, 0, rz);
      }
      c.cheeks(0.24, 1.0, 0.36);
    },
  },
  {
    name: 'Tiki',
    title: 'the Coconut',
    tagline: 'Hard head. Soft touch.',
    color: 0x7a4a26,
    limb: 0xc98a55,
    front: 0.3,
    shoulder: [0.22, 0.7],
    hip: [0.11, 0.34],
    hand: 'mitt',
    top: 1.55,
    eyes: { style: 'big', r: 0.1, pos: [[-0.11, 1.08, 0.36], [0.11, 1.08, 0.36]] },
    build(c) {
      c.at(c.blob(0.36, 0.34, 0.34, this.color), 0, 1.05, 0);
      c.at(c.blob(0.26, 0.22, 0.12, 0xf6ecd0, { outline: 0.015 }), 0, 1.0, 0.25);
      for (const [x, z] of [[-0.08, -0.08], [0.08, -0.08], [0, 0.06]]) c.at(c.blob(0.04, 0.02, 0.04, 0x4a2a14, { outline: 0 }), x, 1.385, z - 0.1);
      const leafGeo = new THREE.ConeGeometry(0.1, 0.5, 4).translate(0, 0.25, 0);
      this.leaves = [];
      for (let i = 0; i < 4; i++) {
        const leaf = part(leafGeo, i % 2 ? 0x46b04f : 0x5fd05c, { outline: 0.02 });
        leaf.scale.set(1, 1, 0.3);
        leaf.rotation.order = 'YXZ';
        c.at(leaf, 0, 1.36, 0, 0.75, (i / 4) * Math.PI * 2 + 0.4, 0);
        leaf.rotation.order = 'YXZ';
        this.leaves.push(leaf);
      }
      c.at(c.blob(0.22, 0.22, 0.2, this.limb), 0, 0.62, 0);
      c.at(part(new THREE.CylinderGeometry(0.21, 0.33, 0.24, 14), 0xe0b84f, { outline: 0.025 }), 0, 0.46, 0);
      c.mouth(0, 0.93, 0.36, 0.08, -0.2);
      return (dt, t) => this.leaves.forEach((l, i) => (l.rotation.x = 0.75 + Math.sin(t * 3 + i) * 0.08));
    },
  },
  {
    name: 'Mochi',
    title: 'the Axolotl',
    tagline: 'Always smiling, always diving.',
    color: 0xffa6c9,
    shoulder: [0.38, 0.75],
    hip: [0.16, 0.3],
    hand: 'mitt',
    top: 1.35,
    eyes: { style: 'dot', r: 0.065, pos: [[-0.17, 1.02, 0.33], [0.17, 1.02, 0.33]] },
    build(c) {
      c.at(c.blob(0.4, 0.48, 0.38, this.color), 0, 0.76, 0);
      c.at(c.blob(0.27, 0.28, 0.12, 0xffdce9, { outline: 0.015 }), 0, 0.62, 0.28);
      const gillGeo = new THREE.CapsuleGeometry(0.045, 0.2, 4, 8).translate(0, 0.14, 0);
      this.gills = [];
      for (const sx of [-1, 1]) {
        for (const i of [-1, 0, 1]) {
          const g = part(gillGeo, 0xff5f9e, { outline: 0.018 });
          c.at(g, sx * 0.33, 1.02 + i * 0.1, -0.04, 0, 0, -sx * (Math.PI / 2 - i * 0.5));
          this.gills.push({ g, base: g.rotation.z, sx, i });
        }
      }
      c.at(c.blob(0.12, 0.1, 0.32, this.color), 0, 0.42, -0.4, -0.4, 0, 0);
      c.grin(0, 0.93, 0.355, 0.12, -0.35);
      c.cheeks(0.27, 0.92, 0.3);
      return (dt, t, st, run) => {
        for (const { g, base, sx, i } of this.gills) g.rotation.z = base + Math.sin(t * (4 + run * 8) + i) * 0.12 * sx;
      };
    },
  },
  {
    name: 'Rocco',
    title: 'the Volcano',
    tagline: 'Hot-headed. Rock-solid defense.',
    color: 0x726d7e,
    shoulder: [0.38, 0.72],
    hip: [0.17, 0.3],
    hand: 'mitt',
    top: 1.35,
    eyes: { style: 'big', r: 0.11, pos: [[-0.12, 0.9, 0.29], [0.12, 0.9, 0.29]] },
    build(c) {
      c.at(part(new THREE.CylinderGeometry(0.22, 0.42, 0.85, 18), this.color, { outline: 0.03 }), 0, 0.72, 0);
      for (const [x, y, z, s] of [[-0.3, 0.5, 0.2, 0.07], [0.28, 0.75, -0.1, 0.06], [0.1, 0.4, -0.35, 0.08]]) {
        c.at(part(new THREE.DodecahedronGeometry(s, 0), 0x57536a, { outline: 0.015 }), x, y, z);
      }
      const lava = toon(0xff7a1a, { emissive: 0xff4a00, emissiveIntensity: 0.6 });
      c.at(c.blob(0.23, 0.07, 0.23, 0, { material: lava }), 0, 1.15, 0);
      for (const a of [-0.6, 0.35, 2.4]) {
        const drip = part(new THREE.CapsuleGeometry(0.04, 0.14, 4, 8), 0, { outline: 0.012, material: lava });
        c.at(drip, Math.sin(a) * 0.25, 1.06, Math.cos(a) * 0.25, Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25);
      }
      this.smoke = [0, 1, 2].map((i) => {
        const puff = new THREE.Mesh(blobGeo(0.1, 0.1, 0.1, 12, 8), toon(0xe9e6f0));
        withOutline(puff, 0.015);
        return c.at(puff, 0, 1.2, 0);
      });
      c.mouth(0, 0.72, 0.33, 0.09, -0.2);
      c.cheeks(0.22, 0.75, 0.3);
      return (dt, t) => {
        this.smoke.forEach((p, i) => {
          const k = (t * 0.6 + i / 3) % 1;
          p.position.set(Math.sin(t + i * 2) * 0.08, 1.25 + k * 0.7, 0);
          p.scale.setScalar(0.5 + k * 1.1);
          p.visible = k < 0.92;
        });
      };
    },
  },
];

export function buildSpecies(index, body) {
  const sp = SPECIES[((index % SPECIES.length) + SPECIES.length) % SPECIES.length];
  // Builders stash per-instance parts on `self`, so give each character its own copy.
  const self = Object.create(sp);
  return { sp, update: sp.build.call(self, kit(body)) ?? null };
}

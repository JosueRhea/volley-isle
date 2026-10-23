import * as THREE from 'three';
import { part, toon, gradientMap } from '../toon.js';
import { rand, pickOne, shoreRadius, wobblyShape, instancedOutlineMaterial, stripeTexture } from './util.js';

const SAND = 0xf7dd9a;
const WET_SAND = 0xe6bd78;
const CLIFF = 0xe0b06a;
const GRASS = 0x7bd855;
const GRASS_DARK = 0x56b844;
const WOOD = 0xa8713d;
const SEG = 160;

// Island top and sloped sides follow shoreRadius(), so the ocean foam hugs it exactly.
function landmass(scene) {
  const shape = new THREE.Shape();
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const r = shoreRadius(a);
    // Shape is in XY and gets rotated onto XZ; -sin keeps a = atan2(z, x).
    if (i === 0) shape.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
  }
  const top = new THREE.Mesh(new THREE.ShapeGeometry(shape), toon(SAND));
  top.rotation.x = -Math.PI / 2;
  top.receiveShadow = true;
  scene.add(top);

  // Wet-sand band just inside the shoreline, with a wobbly inner edge.
  const pos = [];
  const idx = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const r = shoreRadius(a);
    const inner = r - 1.3 - 0.35 * Math.sin(a * 11) - 0.25 * Math.sin(a * 23 + 1);
    pos.push(Math.cos(a) * inner, 0.012, Math.sin(a) * inner, Math.cos(a) * r, 0.012, Math.sin(a) * r);
    if (i < SEG) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const bandGeo = new THREE.BufferGeometry();
  bandGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bandGeo.setIndex(idx);
  bandGeo.computeVertexNormals();
  const band = new THREE.Mesh(bandGeo, toon(WET_SAND, { side: THREE.DoubleSide }));
  band.receiveShadow = true;
  scene.add(band);

  // Sloped sides down into the sea.
  const sp = [];
  const si = [];
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const r = shoreRadius(a);
    sp.push(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(a) * (r + 3), -1.4, Math.sin(a) * (r + 3));
    if (i < SEG) {
      const T0 = i * 2;
      const B0 = T0 + 1;
      const T1 = T0 + 2;
      const B1 = T0 + 3;
      si.push(T0, T1, B1, T0, B1, B0);
    }
  }
  const sideGeo = new THREE.BufferGeometry();
  sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sideGeo.setIndex(si);
  sideGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(sideGeo, toon(CLIFF, { side: THREE.DoubleSide })));
}

function grassPatch(scene, x, z, r) {
  const geo = new THREE.ExtrudeGeometry(wobblyShape(r), {
    depth: 0.06, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.12, bevelSegments: 2, curveSegments: 8,
  });
  const g = part(geo, GRASS, { outline: 0.05, shadow: false });
  g.rotation.x = -Math.PI / 2;
  g.rotation.z = rand(0, Math.PI * 2);
  g.position.set(x, 0.0, z);
  scene.add(g);
}

// Grass tufts and flowers are instanced: hundreds of bits, a handful of draw calls.
function tuftsAndFlowers(scene, spots) {
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const bladeGeo = new THREE.ConeGeometry(0.08, 0.38, 5).translate(0, 0.19, 0);
  const tufts = spots.length * 3;
  const blades = new THREE.InstancedMesh(bladeGeo, toon(0xffffff), tufts);
  const bladeLines = new THREE.InstancedMesh(bladeGeo, instancedOutlineMaterial(0.025), tufts);
  let n = 0;
  for (const [x, z] of spots) {
    for (let k = 0; k < 3; k++) {
      dummy.position.set(x + rand(-0.12, 0.12), 0.05, z + rand(-0.12, 0.12));
      dummy.rotation.set(rand(-0.35, 0.35), rand(0, 6), (k - 1) * 0.45);
      dummy.scale.setScalar(rand(0.8, 1.3));
      dummy.updateMatrix();
      blades.setMatrixAt(n, dummy.matrix);
      bladeLines.setMatrixAt(n, dummy.matrix);
      blades.setColorAt(n, color.set(pickOne([GRASS, GRASS_DARK, 0x8fe35f])));
      n++;
    }
  }
  scene.add(blades, bladeLines);

  const flowerSpots = spots.filter((_, i) => i % 2 === 0);
  const petalGeo = new THREE.SphereGeometry(0.075, 8, 6);
  const petals = new THREE.InstancedMesh(petalGeo, toon(0xffffff), flowerSpots.length * 5);
  const centers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), toon(0xffd23f), flowerSpots.length);
  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.018, 0.28, 5), toon(GRASS_DARK), flowerSpots.length);
  const petalColors = [0xff6fa8, 0xff5a5a, 0xffffff, 0xb07bff, 0xff9f1c, 0x6ad1ff];
  flowerSpots.forEach(([x0, z0], i) => {
    const x = x0 + rand(0.25, 0.5);
    const z = z0 + rand(-0.3, 0.3);
    const y = 0.32;
    const c = pickOne(petalColors);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.position.set(x, 0.16, z);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    centers.setMatrixAt(i, dummy.matrix);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      dummy.position.set(x + Math.cos(a) * 0.1, y, z + Math.sin(a) * 0.1);
      dummy.scale.set(1, 0.55, 1);
      dummy.updateMatrix();
      petals.setMatrixAt(i * 5 + k, dummy.matrix);
      petals.setColorAt(i * 5 + k, color.set(c));
    }
  });
  scene.add(petals, centers, stems);
}

// Palms sway gently and their fronds bounce.
function palm(scene, x, z, h = 7) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const lean = rand(0.1, 0.25);
  const segs = 7;
  const segH = h / segs;
  let top = new THREE.Vector3();
  for (let i = 0; i < segs; i++) {
    const seg = part(new THREE.CylinderGeometry(0.22 - i * 0.013, 0.3 - i * 0.013, segH * 1.08, 9), i % 2 ? WOOD : 0x8b5a2f, {
      outline: 0.03,
    });
    const y = segH / 2 + i * segH;
    const off = Math.pow(i / segs, 2) * lean * 7;
    seg.position.set(off, y, 0);
    seg.rotation.z = -lean * (i / segs) * 1.6;
    g.add(seg);
    top.set(off, y + segH * 0.55, 0);
  }
  const crown = new THREE.Group();
  crown.position.copy(top);
  g.add(crown);
  const leafGeo = new THREE.ConeGeometry(0.6, 3.2, 4).translate(0, 1.6, 0);
  const leaves = [];
  for (let i = 0; i < 8; i++) {
    const leaf = part(leafGeo, i % 2 ? 0x4cc157 : 0x3aa84a, { outline: 0.04 });
    leaf.scale.set(1, 1, 0.22);
    leaf.rotation.order = 'YXZ';
    leaf.rotation.y = (i / 8) * Math.PI * 2;
    const base = 1.15 + rand(-0.1, 0.2);
    leaf.rotation.x = base;
    crown.add(leaf);
    leaves.push({ leaf, base, ph: rand(0, 6) });
  }
  for (let i = 0; i < 3; i++) {
    const nut = part(new THREE.SphereGeometry(0.2, 10, 8), 0x7a4a26, { outline: 0.025 });
    const a = (i / 3) * Math.PI * 2;
    nut.position.set(Math.cos(a) * 0.25, -0.3, Math.sin(a) * 0.25);
    crown.add(nut);
  }
  g.rotation.y = Math.atan2(-z, x) + rand(-0.4, 0.4); // lean out, away from the court
  scene.add(g);
  const ph = rand(0, 6);
  return (t) => {
    g.rotation.z = Math.sin(t * 0.7 + ph) * 0.025;
    crown.rotation.y = Math.sin(t * 0.5 + ph) * 0.15;
    for (const l of leaves) l.leaf.rotation.x = l.base + Math.sin(t * 1.8 + l.ph) * 0.07;
  };
}

function umbrella(scene, x, z, colors) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const pole = part(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 8), 0xffffff, { outline: 0.02 });
  pole.position.y = 1.25;
  g.add(pole);
  const tex = stripeTexture(colors, 12);
  const canopy = part(new THREE.ConeGeometry(1.5, 0.7, 12), 0, {
    outline: 0.04,
    material: new THREE.MeshToonMaterial({ map: tex, gradientMap: gradientMap() }),
  });
  canopy.position.y = 2.5;
  g.add(canopy);
  const knob = part(new THREE.SphereGeometry(0.09, 8, 6), 0xffd23f, { outline: 0.015 });
  knob.position.y = 2.88;
  g.add(knob);
  g.rotation.z = rand(-0.15, 0.15);
  g.rotation.x = rand(-0.15, 0.15);
  scene.add(g);

  const towel = part(new THREE.BoxGeometry(0.95, 0.04, 1.8), 0, {
    outline: 0.015,
    material: new THREE.MeshToonMaterial({ map: stripeTexture([colors[0], '#ffffff'], 6), gradientMap: gradientMap() }),
  });
  towel.position.set(x + rand(0.9, 1.3), 0.03, z + rand(-0.3, 0.3));
  towel.rotation.y = rand(-0.4, 0.4);
  scene.add(towel);
}

function snackHut(scene, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.lookAt(0, 0, 0);
  for (const [px, pz] of [[-1.3, -1.1], [1.3, -1.1], [-1.3, 1.1], [1.3, 1.1]]) {
    const post = part(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 8), WOOD, { outline: 0.025 });
    post.position.set(px, 1.3, pz);
    g.add(post);
  }
  const roof = part(new THREE.ConeGeometry(2.5, 1.6, 10), 0xe9bb57, { outline: 0.05 });
  roof.position.y = 3.3;
  g.add(roof);
  const fringe = part(new THREE.CylinderGeometry(2.45, 2.6, 0.35, 10, 1, true), 0xd9a744, { outline: 0 });
  fringe.position.y = 2.55;
  g.add(fringe);
  const counter = part(new THREE.BoxGeometry(2.6, 1.0, 0.6), 0xc4844a, { outline: 0.03 });
  counter.position.set(0, 0.5, 1.1);
  g.add(counter);
  for (let i = 0; i < 3; i++) {
    const drink = part(new THREE.SphereGeometry(0.17, 10, 8), 0x7a4a26, { outline: 0.02 });
    drink.position.set(-0.7 + i * 0.7, 1.15, 1.1);
    g.add(drink);
    const straw = part(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 5), pickOne([0xff6fa8, 0x6ad1ff, 0xffd23f]), { outline: 0 });
    straw.position.set(-0.7 + i * 0.7 + 0.05, 1.35, 1.1);
    straw.rotation.z = -0.3;
    g.add(straw);
  }
  const sign = part(new THREE.BoxGeometry(1.6, 0.45, 0.08), 0xff6b6b, { outline: 0.02 });
  sign.position.set(0, 2.35, 1.3);
  g.add(sign);
  scene.add(g);
}

function rock(scene, a, s) {
  const r = shoreRadius(a) - rand(0.2, 1.0);
  const m = part(new THREE.DodecahedronGeometry(s, 0), pickOne([0xa7b0bb, 0x96a0ad, 0xb7bfc8]), { outline: 0.05 });
  m.position.set(Math.cos(a) * r, s * 0.3, Math.sin(a) * r);
  m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
  m.scale.y = 0.7;
  scene.add(m);
}

// Scenery layout keeps the play area (|x| < 15, |z| < 9) and the camera lines (around the x axis) clear.
export function buildIsland(scene) {
  landmass(scene);
  const updaters = [];

  const patches = [
    [-11, 15.5, 4], [-2, 17.5, 4.2], [9, 16, 4.5], [16.5, 11, 3.6],
    [-14, -15, 4.2], [-3, -18, 3.8], [8, -16.5, 4.2], [17, -10.5, 3.2],
    [-19.5, 7, 2.8], [-19, -7.5, 2.8], [20, 2.5, 2.4],
  ];
  const tuftSpots = [];
  for (const [x, z, r] of patches) {
    grassPatch(scene, x, z, r);
    for (let i = 0; i < 7; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(0.3, r * 0.85);
      tuftSpots.push([x + Math.cos(a) * d, z + Math.sin(a) * d]);
    }
  }
  // A few stray tufts in the sand around the court.
  for (let i = 0; i < 30; i++) {
    const a = rand(0, Math.PI * 2);
    const d = rand(13, 21);
    tuftSpots.push([Math.cos(a) * d, Math.sin(a) * d]);
  }
  tuftsAndFlowers(scene, tuftSpots);

  for (const [x, z, h] of [
    [-13, 14, 7.5], [-5, 17.5, 8], [6, 18, 7], [14, 14, 8],
    [-12, -16, 8], [-1, -19.5, 7], [10, -17, 8.5], [20.5, -6, 7], [-20.5, -9, 7.5], [-21, 9, 6.5],
  ]) {
    updaters.push(palm(scene, x, z, h));
  }

  umbrella(scene, -9, 14.5, ['#ff6b6b', '#ffffff']);
  umbrella(scene, 3, 15.5, ['#2f9bff', '#ffffff']);
  umbrella(scene, -6, -15, ['#ffd23f', '#ff9f1c']);
  umbrella(scene, 11, -14, ['#b07bff', '#ffffff']);
  snackHut(scene, 5, -19.5);

  for (let i = 0; i < 18; i++) rock(scene, (i / 18) * Math.PI * 2 + rand(-0.12, 0.12), rand(0.5, 1.4));

  return (t) => updaters.forEach((u) => u(t));
}

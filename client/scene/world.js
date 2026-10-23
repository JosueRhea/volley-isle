import * as THREE from 'three';
import { part, toon } from './toon.js';
import { COURT, NET } from '../../shared/constants.js';
import { TEAM_COLORS } from '../teams.js';
import { buildOcean } from './env/water.js';
import { buildSky } from './env/sky.js';
import { buildIsland } from './env/island.js';
import { buildLife } from './env/life.js';
import { rand } from './env/util.js';
import { NetCloth } from './net.js';
import { upgradeGameProp } from './game-assets.js';
import { sandMesh, SandTracks } from './env/sand.js';

const COURT_SAND = 0xfbe7b5;
const WOOD = 0xa8713d;
const HORIZON = 0xd4f1ff;

function flag(scene, x, z, color) {
  const pole = part(new THREE.CylinderGeometry(0.06, 0.07, 4, 8), WOOD, { outline: 0.02 });
  pole.position.set(x, 2, z);
  scene.add(pole);
  const knob = part(new THREE.SphereGeometry(0.12, 10, 8), 0xf2c641, { outline: 0.02 });
  knob.position.set(x, 4.05, z);
  scene.add(knob);
  const geo = new THREE.PlaneGeometry(1.4, 0.8, 10, 4).translate(0.7, 0, 0);
  const base = geo.attributes.position.array.slice();
  const mesh = new THREE.Mesh(geo, toon(color, { side: THREE.DoubleSide }));
  mesh.position.set(x, 3.5, z);
  mesh.castShadow = true;
  scene.add(mesh);
  const phase = rand(0, 6);
  return (t) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3];
      pos.setZ(i, Math.sin(bx * 4 - t * 6 + phase) * 0.12 * bx);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  };
}

function court(scene) {
  const W = COURT.halfLength * 2;
  const D = COURT.halfWidth * 2;
  const floor = sandMesh(new THREE.PlaneGeometry(W + 3, D + 3), COURT_SAND);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.005;
  floor.receiveShadow = true;
  scene.add(floor);

  const lineMat = toon(0xffffff);
  const line = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  const lw = 0.1;
  for (const sx of [-1, 1]) {
    line(lw, D + lw, sx * COURT.halfLength, 0); // baselines
    line(W, lw, 0, sx * COURT.halfWidth); // sidelines
    line(lw, D, sx * 3, 0); // attack lines
  }
  line(lw, D, 0, 0);

  // Net, posts, top band
  const postZ = COURT.halfWidth + 0.7;
  for (const sz of [-1, 1]) {
    const standard = new THREE.Group();
    standard.position.z = sz * postZ;
    scene.add(standard);
    const post = part(new THREE.CylinderGeometry(0.09, 0.11, NET.height + 0.3, 10), WOOD, { outline: 0.025 });
    post.position.set(0, (NET.height + 0.3) / 2, 0);
    standard.add(post);
    const cap = part(new THREE.SphereGeometry(0.14, 10, 8), 0xf2c641, { outline: 0.02 });
    cap.position.set(0, NET.height + 0.32, 0);
    standard.add(cap);
    upgradeGameProp(standard, 'post', { teamColor: TEAM_COLORS[sz < 0 ? 0 : 1].main });
  }
  return new NetCloth(scene);
}

// Cartoon island world. update(t, dt?) animates it (t in seconds); cheer(team) makes that team's fans go wild.
export function buildWorld(scene) {
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 150, 430);

  const sunDir = new THREE.Vector3(0.45, 0.7, 0.35).normalize();
  scene.add(new THREE.HemisphereLight(0xdaf3ff, 0xf0cf94, 1.35));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.0);
  sun.position.copy(sunDir).multiplyScalar(40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 100 });
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  const skyUpdate = buildSky(scene, { sunDir, horizon: HORIZON });
  const ocean = buildOcean(scene, HORIZON);
  const islandUpdate = buildIsland(scene);
  const net = court(scene);
  const sand = new SandTracks(scene);
  const life = buildLife(scene);

  const flags = [
    flag(scene, -11.5, -6.5, TEAM_COLORS[0].main),
    flag(scene, -11.5, 6.5, TEAM_COLORS[0].main),
    flag(scene, 11.5, -6.5, TEAM_COLORS[1].main),
    flag(scene, 11.5, 6.5, TEAM_COLORS[1].main),
  ];

  let lastT = null;
  return {
    update(t, dt) {
      if (dt === undefined) dt = lastT === null ? 0 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      ocean.update(t);
      skyUpdate(t);
      islandUpdate(t);
      life.update(t, dt);
      net.update(dt, t);
      sand.update(dt);
      for (const f of flags) f(t);
    },
    net,
    sand,
    react: life.react,
    watchBall: life.watchBall,
    resetCrowd: life.resetCrowd,
    cheer(team) {
      if (team === 0 || team === 1) life.cheer(team);
    },
  };
}

import * as THREE from 'three';
import { part, toon } from '../toon.js';
import { buildCrowd } from './crowd.js';
import { rand, shoreRadius } from './util.js';
import { WATER_Y } from './water.js';

function gull(scene) {
  const g = new THREE.Group();
  const bodyMesh = part(new THREE.SphereGeometry(1, 12, 10).scale(0.22, 0.18, 0.5), 0xffffff, { outline: 0.03 });
  g.add(bodyMesh);
  const head = part(new THREE.SphereGeometry(0.15, 10, 8), 0xffffff, { outline: 0.025 });
  head.position.set(0, 0.12, 0.45);
  g.add(head);
  const beak = part(new THREE.ConeGeometry(0.05, 0.18, 6), 0xffb02e, { outline: 0.015 });
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.1, 0.65);
  g.add(beak);
  const wingGeo = new THREE.BoxGeometry(0.9, 0.04, 0.32).translate(0.45, 0, 0);
  const wings = [-1, 1].map((s) => {
    const w = part(wingGeo, 0xe8eef5, { outline: 0.02 });
    w.scale.x = s;
    w.position.set(s * 0.15, 0.05, 0);
    g.add(w);
    return w;
  });
  scene.add(g);
  const r = rand(26, 36);
  const h = rand(11, 17);
  const speed = rand(0.12, 0.2) * (Math.random() < 0.5 ? -1 : 1);
  const ph = rand(0, 6);
  return (t) => {
    const a = t * speed + ph;
    g.position.set(Math.cos(a) * r, h + Math.sin(t * 0.7 + ph) * 1.2, Math.sin(a) * r);
    // Face along the circle's tangent.
    g.rotation.set(0, -a + (speed > 0 ? Math.PI : 0), speed > 0 ? 0.25 : -0.25);
    const flap = Math.sin(t * 7 + ph) * 0.6 * (Math.sin(t * 0.5 + ph) > -0.3 ? 1 : 0.1);
    wings[0].rotation.z = -flap;
    wings[1].rotation.z = flap;
  };
}

// A dolphin that pops out of the water every few seconds, with splash rings.
function dolphin(scene) {
  const g = new THREE.Group();
  const blue = 0x5a8fe0;
  g.add(part(new THREE.SphereGeometry(1, 16, 12).scale(0.42, 0.4, 1.2), blue, { outline: 0.04 }));
  const belly = part(new THREE.SphereGeometry(1, 14, 10).scale(0.3, 0.26, 0.95), 0xdce9ff, { outline: 0 });
  belly.position.set(0, -0.15, 0.1);
  g.add(belly);
  const snout = part(new THREE.CapsuleGeometry(0.12, 0.25, 4, 8), blue, { outline: 0.03 });
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.05, 1.25);
  g.add(snout);
  const fin = part(new THREE.ConeGeometry(0.18, 0.5, 6), blue, { outline: 0.03 });
  fin.position.set(0, 0.5, -0.1);
  fin.rotation.x = -0.4;
  g.add(fin);
  const tail = part(new THREE.BoxGeometry(0.9, 0.06, 0.35), blue, { outline: 0.03 });
  tail.position.set(0, 0, -1.3);
  g.add(tail);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1b1b2f }));
    eye.position.set(sx * 0.3, 0.12, 0.85);
    g.add(eye);
  }
  g.visible = false;
  scene.add(g);

  const ringGeo = new THREE.RingGeometry(0.6, 0.9, 32);
  const splashes = [];
  const splash = (x, z) => {
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, WATER_Y + 0.25, z);
      scene.add(m);
      splashes.push({ m, life: 1.1 + i * 0.4, max: 1.1 + i * 0.4, delay: i * 0.15 });
    }
  };

  let next = rand(2, 5);
  let jump = null;
  return (t, dt) => {
    next -= dt;
    if (!jump && next <= 0) {
      const a = rand(0, Math.PI * 2);
      const d = shoreRadius(a) + rand(9, 28);
      const dir = rand(0, Math.PI * 2);
      const start = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
      const end = start.clone().add(new THREE.Vector3(Math.cos(dir) * 7, 0, Math.sin(dir) * 7));
      jump = { start, end, u: 0 };
      g.visible = true;
      g.rotation.set(0, Math.atan2(end.x - start.x, end.z - start.z), 0);
      splash(start.x, start.z);
    }
    if (jump) {
      jump.u += dt / 1.5;
      const u = Math.min(1, jump.u);
      g.position.lerpVectors(jump.start, jump.end, u);
      g.position.y = WATER_Y - 0.8 + Math.sin(u * Math.PI) * 3.4;
      g.rotation.x = -Math.cos(u * Math.PI) * 0.9;
      if (u >= 1) {
        splash(jump.end.x, jump.end.z);
        g.visible = false;
        jump = null;
        next = rand(5, 11);
      }
    }
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i];
      if (s.delay > 0) {
        s.delay -= dt;
        s.m.visible = false;
        continue;
      }
      s.m.visible = true;
      s.life -= dt;
      const k = 1 - s.life / s.max;
      s.m.scale.setScalar(1 + k * 4);
      s.m.material.opacity = Math.max(0, s.life / s.max);
      if (s.life <= 0) {
        scene.remove(s.m);
        s.m.material.dispose();
        splashes.splice(i, 1);
      }
    }
  };
}

export function buildLife(scene) {
  const fans = buildCrowd(scene);
  const gulls = [0, 1, 2, 3].map(() => gull(scene));
  const dolphinUpdate = dolphin(scene);
  return {
    cheer: fans.cheer,
    react: fans.react,
    watchBall: fans.watchBall,
    resetCrowd: fans.reset,
    crowd: fans,
    update(t, dt) {
      fans.update(t, dt);
      for (const g of gulls) g(t);
      dolphinUpdate(t, dt);
    },
  };
}

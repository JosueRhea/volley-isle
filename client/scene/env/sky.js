import * as THREE from 'three';
import { toon, outlineMaterial } from '../toon.js';
import { rand } from './util.js';

function dome(scene, horizon) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x3b8ff0) },
      mid: { value: new THREE.Color(0x7cc4ff) },
      horizon: { value: new THREE.Color(horizon) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    // Banded gradient keeps the sky cartoony instead of photographic.
    fragmentShader: /* glsl */ `
      uniform vec3 top, mid, horizon;
      varying vec3 vDir;
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 col = mix(horizon, mid, smoothstep(0.02, 0.16, h));
        col = mix(col, top, smoothstep(0.3, 0.75, h));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), mat));
}

function sun(scene, dir) {
  const g = new THREE.Group();
  g.position.copy(dir).multiplyScalar(520);
  g.lookAt(0, 0, 0);
  const basic = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, fog: false, ...opts });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(24, 40), basic(0xfff3a6));
  disc.position.z = 0.3;
  g.add(disc);
  const rim = new THREE.Mesh(new THREE.RingGeometry(24, 27, 40), basic(0xffb547));
  rim.position.z = 0.25;
  g.add(rim);
  const rays = new THREE.Group();
  const tri = new THREE.Shape();
  tri.moveTo(-5, 0);
  tri.lineTo(5, 0);
  tri.lineTo(0, 17);
  const rayGeo = new THREE.ShapeGeometry(tri);
  const rayMat = basic(0xffd75e, { transparent: true, opacity: 0.85 });
  for (let i = 0; i < 12; i++) {
    const ray = new THREE.Mesh(rayGeo, rayMat);
    const a = (i / 12) * Math.PI * 2;
    ray.position.set(Math.cos(a) * 29, Math.sin(a) * 29, 0);
    ray.rotation.z = a - Math.PI / 2;
    ray.scale.y = i % 2 ? 0.7 : 1;
    rays.add(ray);
  }
  g.add(rays);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(60, 40), basic(0xfff6c8, { transparent: true, opacity: 0.25 }));
  glow.position.z = -0.2;
  g.add(glow);
  scene.add(g);
  return (t) => {
    rays.rotation.z = t * 0.08;
    const s = 1 + Math.sin(t * 1.5) * 0.04;
    rays.scale.set(s, s, 1);
  };
}

function cloud(group, x, y, z, s) {
  const c = new THREE.Group();
  c.position.set(x, y, z);
  const mat = toon(0xffffff, { emissive: 0x9fb4cc });
  const outline = outlineMaterial(0.3, 0x6f93d0);
  const geo = new THREE.SphereGeometry(1, 16, 12);
  const n = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const r = rand(3, 5.5) * s;
    const puff = new THREE.Mesh(geo, mat);
    const off = (i / (n - 1) - 0.5) * 14 * s;
    puff.position.set(off, (1 - Math.abs(off) / (8 * s)) * rand(0.8, 2.4) * s, rand(-2, 2) * s);
    puff.scale.set(r, r * 0.8, r);
    const o = new THREE.Mesh(geo, outline);
    o.scale.setScalar(1 + 0.3 / r);
    puff.add(o);
    c.add(puff);
  }
  c.lookAt(0, y, 0);
  c.userData = { bob: rand(0, 6), baseY: y };
  group.add(c);
}

function distantIsland(scene, angle, dist) {
  const g = new THREE.Group();
  g.position.set(Math.cos(angle) * dist, -0.6, Math.sin(angle) * dist);
  const size = rand(14, 30);
  const outline = (th, color) => outlineMaterial(th, color);
  const sand = new THREE.Mesh(new THREE.CylinderGeometry(size * 1.15, size * 1.3, 1.6, 28), toon(0xf7dd9a));
  g.add(sand);
  const hills = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < hills; i++) {
    const r = size * rand(0.5, 0.85) * (i === 0 ? 1 : 0.7);
    const hill = new THREE.Mesh(
      new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      toon(i === 0 ? 0x5fc95a : 0x4cb456),
    );
    hill.scale.y = rand(0.7, 1.2);
    hill.position.set((i - (hills - 1) / 2) * size * 0.6, 0.6, rand(-0.2, 0.2) * size);
    const o = new THREE.Mesh(hill.geometry, outline(0.9, 0x2f7a3a));
    hill.add(o);
    g.add(hill);
  }
  scene.add(g);
}

export function buildSky(scene, { sunDir, horizon }) {
  dome(scene, horizon);
  const sunUpdate = sun(scene, sunDir);

  const clouds = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand(-0.15, 0.15);
    const d = rand(85, 170);
    cloud(clouds, Math.cos(a) * d, rand(28, 55), Math.sin(a) * d, rand(1.1, 1.9));
  }
  scene.add(clouds);

  for (let i = 0; i < 7; i++) distantIsland(scene, (i / 7) * Math.PI * 2 + rand(-0.25, 0.25), rand(190, 290));

  return (t) => {
    sunUpdate(t);
    clouds.rotation.y = t * 0.006;
    for (const c of clouds.children) c.position.y = c.userData.baseY + Math.sin(t * 0.3 + c.userData.bob) * 1.2;
  };
}

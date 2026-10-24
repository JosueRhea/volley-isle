import * as THREE from 'three';
import { gradientMap, withOutline } from './toon.js';
import { BALL_RADIUS } from '../../shared/constants.js';
import { upgradeGameProp } from './game-assets.js';

// Ball colour options: the two coloured panel sets change; white panels and ink seams stay.
// `original` keeps the model's own colours instead of a and b.
export const BALL_SKINS = {
  classic: { a: '#ffd23f', b: '#2f7fd6', original: true },
  red: { a: '#ff5a4e', b: '#b3202d' },
  green: { a: '#5fd66b', b: '#1f8a4c' },
  black: { a: '#3a3a4c', b: '#14141d' },
  purple: { a: '#b07cff', b: '#5b2bb5' },
};

function ballTexture(skin) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  const colors = [skin.a, '#ffffff', skin.b, skin.a, '#ffffff', skin.b];
  colors.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect((i * 256) / colors.length, 0, 256 / colors.length + 1, 128);
  });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 10);
  ctx.fillRect(0, 118, 256, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createBall(scene) {
  const fallback = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 24, 16),
    new THREE.MeshToonMaterial({ map: ballTexture(BALL_SKINS.classic), gradientMap: gradientMap() }),
  );
  withOutline(fallback, 0.025);
  const mesh = new THREE.Group();
  const visual = new THREE.Group();
  visual.add(fallback);
  mesh.add(visual);
  scene.add(mesh);
  // The model's coloured panels: Gold.* (yellow) and Team.* (blue), with their original colours.
  const panels = [];
  let skinName = 'classic';
  function applySkin() {
    const skin = BALL_SKINS[skinName] ?? BALL_SKINS.classic;
    fallback.material.map.dispose();
    fallback.material.map = ballTexture(skin);
    for (const { material, role, original } of panels) {
      if (skin.original) material.color.copy(original);
      else material.color.set(role === 'gold' ? skin.a : skin.b);
    }
  }
  upgradeGameProp(visual, 'ball').then((root) => {
    root?.traverse((o) => {
      if (!o.isMesh) return;
      for (const material of [o.material].flat()) {
        const role = /^Gold(?:\.|$)/.test(material.name) ? 'gold' : /^Team(?:\.|$)/.test(material.name) ? 'team' : null;
        if (role && !panels.some((p) => p.material === material)) panels.push({ material, role, original: material.color.clone() });
      }
    });
    applySkin();
  });

  // White rim around the ink outline, shown while the ball is on the far side of the net
  // from the camera, so "over there" reads at a glance.
  const rim = new THREE.Mesh(
    fallback.geometry,
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: { opacity: { value: 0 } },
      vertexShader: /* glsl */ `
        void main() {
          vec3 p = position + normalize(normal) * 0.085;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float opacity;
        void main() {
          gl_FragColor = vec4(1.0, 1.0, 1.0, opacity);
        }`,
    }),
  );
  rim.raycast = () => {};
  rim.visible = false;
  mesh.add(rim);
  let rimK = 0;

  // Blob shadow straight below the ball: the key depth cue for timing hits.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(BALL_RADIUS * 1.15, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  scene.add(shadow);

  // Landing spot. A dark disc and ink ring keep the yellow readable on the sand.
  const marker = new THREE.Group();
  const shade = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 32),
    new THREE.MeshBasicMaterial({ color: 0x1b1b2f, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  shade.rotation.x = -Math.PI / 2;
  shade.position.y = 0.02;
  const ink = new THREE.Mesh(
    new THREE.RingGeometry(0.44, 0.72, 32),
    new THREE.MeshBasicMaterial({ color: 0x1b1b2f, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  ink.rotation.x = -Math.PI / 2;
  ink.position.y = 0.028;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.48, 0.68, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.034;
  marker.add(shade, ink, ring);
  marker.visible = false;
  scene.add(marker);

  const axis = new THREE.Vector3();
  let t = 0;
  let impactAge = 1, impactStrength = 0;

  return {
    mesh,
    setSkin(name) {
      if (name === skinName) return;
      skinName = name;
      applySkin();
    },
    impact(strength = 1) { impactAge = 0;impactStrength = THREE.MathUtils.clamp(strength, 0, 1); },
    update(dt, pos, vel, land, landIsMine, farSide = false) {
      t += dt;
      mesh.position.copy(pos);
      impactAge += dt;
      const squash = impactAge < .28 ? impactStrength * .32 * Math.exp(-impactAge*14) * Math.cos(impactAge*24) : 0;
      const vertical = 1-squash;
      mesh.scale.set(1/Math.sqrt(vertical),vertical,1/Math.sqrt(vertical));
      rimK += ((farSide ? 1 : 0) - rimK) * (1 - Math.exp(-dt * 12));
      rim.material.uniforms.opacity.value = rimK * 0.95;
      rim.visible = rimK > 0.02;
      if (vel) {
        const speed = Math.hypot(vel.vx, vel.vz);
        if (speed > 0.1) {
          axis.set(vel.vz, 0, -vel.vx).normalize();
          visual.rotateOnWorldAxis(axis, (speed / BALL_RADIUS) * dt * 0.5);
          rim.rotateOnWorldAxis(axis, (speed / BALL_RADIUS) * dt * 0.5);
        }
      }
      const h = Math.max(0, pos.y - BALL_RADIUS);
      shadow.position.x = pos.x;
      shadow.position.z = pos.z;
      shadow.scale.setScalar(1 + h * 0.12);
      shadow.material.opacity = 0.45 / (1 + h * 0.25);

      if (land) {
        // Glide over small corrections; jump straight to a new target after a hit.
        const far = Math.hypot(land.x - marker.position.x, land.z - marker.position.z) > 1.5;
        const k = !marker.visible || far ? 1 : 1 - Math.exp(-dt * 18);
        marker.position.x += (land.x - marker.position.x) * k;
        marker.position.z += (land.z - marker.position.z) * k;
        ring.material.color.set(landIsMine ? 0xffc400 : 0xffffff);
        marker.scale.setScalar(1 + Math.sin(t * 5) * 0.05);
      }
      marker.visible = !!land;
    },
  };
}

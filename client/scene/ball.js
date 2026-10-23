import * as THREE from 'three';
import { gradientMap, withOutline } from './toon.js';
import { BALL_RADIUS } from '../../shared/constants.js';

function ballTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  const colors = ['#ffd23f', '#ffffff', '#2f7fd6', '#ffd23f', '#ffffff', '#2f7fd6'];
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
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 24, 16),
    new THREE.MeshToonMaterial({ map: ballTexture(), gradientMap: gradientMap() }),
  );
  withOutline(mesh, 0.025);
  scene.add(mesh);

  // Blob shadow straight below the ball: the key depth cue for timing hits.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(BALL_RADIUS * 1.15, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  scene.add(shadow);

  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.62, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.03;
  marker.visible = false;
  scene.add(marker);

  const axis = new THREE.Vector3();
  let t = 0;

  return {
    mesh,
    update(dt, pos, vel, land, landIsMine) {
      t += dt;
      mesh.position.copy(pos);
      if (vel) {
        const speed = Math.hypot(vel.vx, vel.vz);
        if (speed > 0.1) {
          axis.set(vel.vz, 0, -vel.vx).normalize();
          mesh.rotateOnWorldAxis(axis, (speed / BALL_RADIUS) * dt * 0.5);
        }
      }
      const h = Math.max(0, pos.y - BALL_RADIUS);
      shadow.position.x = pos.x;
      shadow.position.z = pos.z;
      shadow.scale.setScalar(1 + h * 0.12);
      shadow.material.opacity = 0.45 / (1 + h * 0.25);

      marker.visible = !!land;
      if (land) {
        marker.position.x = land.x;
        marker.position.z = land.z;
        marker.material.color.set(landIsMine ? 0xffe36b : 0xffffff);
        marker.scale.setScalar(1 + Math.sin(t * 10) * 0.08);
      }
    },
  };
}

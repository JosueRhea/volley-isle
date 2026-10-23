import * as THREE from 'three';

export const rand = (a, b) => a + Math.random() * (b - a);
export const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Island shoreline radius at angle a = atan2(z, x). The ocean shader mirrors this exact formula.
export function shoreRadius(a) {
  return 23.2 + 1.1 * Math.sin(3 * a + 0.5) + 0.6 * Math.sin(7 * a + 1.3) + 0.35 * Math.sin(13 * a + 2.0);
}

// Blobby closed outline in the XY plane, for organic patches.
export function wobblyShape(r, bumps = 9, amt = 0.22) {
  const shape = new THREE.Shape();
  const ph = Math.random() * 6;
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = r * (1 + amt * Math.sin(a * 3 + ph) * 0.6 + amt * Math.sin(a * bumps + ph * 2) * 0.4);
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

// Inverted-hull outline that also works for InstancedMesh.
const instOutlineCache = new Map();
export function instancedOutlineMaterial(thickness, color = 0x1b1b2f) {
  const key = `${thickness}|${color}`;
  if (!instOutlineCache.has(key)) {
    instOutlineCache.set(key, new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color(color) } },
      vertexShader: /* glsl */ `
        uniform float thickness;
        void main() {
          vec4 p = vec4(position + normalize(normal) * thickness, 1.0);
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        void main() {
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }`,
    }));
  }
  return instOutlineCache.get(key);
}

export function stripeTexture(colors, stripes = 12, vertical = true) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = colors[i % colors.length];
    if (vertical) ctx.fillRect((i * 256) / stripes, 0, 256 / stripes + 1, 64);
    else ctx.fillRect(0, (i * 64) / stripes, 256, 64 / stripes + 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

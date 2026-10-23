import * as THREE from 'three';

// Two hard light bands: flat, punchy cartoon shading.
let gradient;
export function gradientMap() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([140, 255]), 2, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const toonCache = new Map();
export function toon(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!toonCache.has(key)) toonCache.set(key, new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts }));
  return toonCache.get(key);
}

// Inverted-hull outline: render back faces pushed out along normals in a flat ink color.
const outlineCache = new Map();
export const INK = 0x1b1b2f;
export function outlineMaterial(thickness = 0.02, color = INK) {
  const key = `${thickness}|${color}`;
  if (!outlineCache.has(key)) {
    outlineCache.set(key, new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color(color) } },
      vertexShader: /* glsl */ `
        uniform float thickness;
        void main() {
          vec3 p = position + normalize(normal) * thickness;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        void main() {
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }`,
    }));
  }
  return outlineCache.get(key);
}

export function withOutline(mesh, thickness = 0.02) {
  const outline = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness));
  outline.raycast = () => {};
  mesh.add(outline);
  return mesh;
}

export function part(geometry, color, { outline = 0.02, shadow = true, material } = {}) {
  const mesh = new THREE.Mesh(geometry, material ?? toon(color));
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  if (outline) withOutline(mesh, outline);
  return mesh;
}

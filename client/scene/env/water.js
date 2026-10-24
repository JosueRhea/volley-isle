import * as THREE from 'three';

export const WATER_Y = -0.45;

// Single-draw-call toon ocean:
//  - vertex swells that grow with distance from the island (flat at the shore, so no clipping)
//  - posterized color bands: turquoise shallows -> mid -> deep -> abyss, with organic noisy edges
//  - white crest caps on swell peaks, squiggly foam contour lines
//  - ripple rings that travel out from the island, a lapping foam rim against the sand
//  - twinkling star-shaped sparkles, horizon fade to the sky
export function buildOcean(scene, horizon) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x6ff3e1) },
      uMid: { value: new THREE.Color(0x2fcbe6) },
      uDeep: { value: new THREE.Color(0x1f95ea) },
      uAbyss: { value: new THREE.Color(0x1769d1) },
      uCrest: { value: new THREE.Color(0xc9f6ff) },
      uFoam: { value: new THREE.Color(0xffffff) },
      uHorizon: { value: new THREE.Color(horizon) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vW;
      varying float vH;
      varying float vAmp;
      float shoreR(float a) {
        return 23.2 + 1.1 * sin(3.0 * a + 0.5) + 0.6 * sin(7.0 * a + 1.3) + 0.35 * sin(13.0 * a + 2.0) + 0.96;
      }
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        float dd = length(w.xz) - shoreR(atan(w.z, w.x));
        float h = sin(w.x * 0.08 + uTime * 0.9) * 0.5
                + sin(w.z * 0.11 - uTime * 1.1 + w.x * 0.03) * 0.35
                + sin((w.x + w.z) * 0.21 + uTime * 1.7) * 0.15;
        float amp = smoothstep(3.0, 35.0, dd);
        w.y += h * amp * 0.55;
        vW = w.xz;
        vH = h;
        vAmp = amp;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uShallow, uMid, uDeep, uAbyss, uCrest, uFoam, uHorizon;
      varying vec2 vW;
      varying float vH;
      varying float vAmp;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float shoreR(float a) {
        return 23.2 + 1.1 * sin(3.0 * a + 0.5) + 0.6 * sin(7.0 * a + 1.3) + 0.35 * sin(13.0 * a + 2.0) + 0.96;
      }

      void main() {
        float d = length(vW);
        float a = atan(vW.y, vW.x);
        float dd = d - shoreR(a);
        float n = noise(vW * 0.15 + uTime * 0.05);

        // Posterized depth bands with wobbly edges.
        float e = dd + (n - 0.5) * 3.5;
        vec3 col = uAbyss;
        col = mix(col, uDeep, step(e, 75.0));
        col = mix(col, uMid, step(e, 24.0));
        col = mix(col, uShallow, step(e, 7.5));

        // Crest caps on swell peaks.
        col = mix(col, uCrest, step(0.78, vH + (n - 0.5) * 0.25) * step(0.35, vAmp) * 0.55);

        // Squiggly foam contour lines out in open water.
        float sq = noise(vW * 0.07 + vec2(uTime * 0.03, uTime * 0.02)) * 0.7
                 + noise(vW * 0.19 - vec2(uTime * 0.04, 0.0)) * 0.3;
        float line = 1.0 - smoothstep(0.012, 0.03, abs(sq - 0.5));
        col = mix(col, uFoam, line * 0.75 * step(6.0, dd) * (1.0 - smoothstep(160.0, 380.0, d)));

        // Ripple rings drifting outward from the island.
        float ph = fract(dd * 0.11 - uTime * 0.22 + n * 0.15);
        float ripple = step(0.93, ph) * (1.0 - smoothstep(3.0, 22.0, dd)) * step(2.2, dd);
        col = mix(col, uFoam, ripple * 0.9);

        // Foam rim lapping against the sand, plus a thin trailing line.
        float lap = 0.9 + 0.55 * sin(uTime * 1.4 + a * 2.0) + (n - 0.5) * 0.9;
        col = mix(col, uFoam, step(dd, lap));
        float lap2 = lap + 1.0 + 0.45 * sin(uTime * 1.4 + 1.5);
        col = mix(col, uFoam, step(abs(dd - lap2), 0.17) * 0.95);

        // Twinkling four-point sparkles.
        vec2 cell = floor(vW / 4.0);
        vec2 f = fract(vW / 4.0) - 0.5;
        float hs = hash(cell);
        if (hs > 0.92) {
          vec2 o = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
          vec2 p = (f - o * 0.6) * 6.0;
          float tw = max(0.0, sin(uTime * 2.6 + hs * 40.0));
          float star = max(0.0, 1.0 - abs(p.x * p.y) * 22.0 - length(p) * 1.15);
          col = mix(col, vec3(1.0), clamp(star * tw * 3.0, 0.0, 1.0) * step(4.0, dd) * (1.0 - smoothstep(90.0, 220.0, d)));
        }

        // A broad, quiet warm glint breaks up the blue between foam lines.
        float glint = pow(max(0.0, sin(vW.x*.19 + vW.y*.13 + uTime*.7)), 18.0);
        col += vec3(.045,.031,.012) * glint * smoothstep(2.0,15.0,dd);
        col = mix(col, uHorizon, smoothstep(170.0, 480.0, d));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(1000, 1000, 220, 220);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_Y;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    update(t) {
      mat.uniforms.uTime.value = t;
    },
  };
}

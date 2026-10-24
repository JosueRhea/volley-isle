import * as THREE from 'three';

const EXTENT = 52;
let textures;

// One world-aligned texture pair, shared by the beach and court. No external images.
function sandTextures() {
  if (textures) return textures;
  const size = 1024;
  const color = document.createElement('canvas'), height = document.createElement('canvas');
  color.width = color.height = height.width = height.height = size;
  const cc = color.getContext('2d'), hc = height.getContext('2d');
  const albedo = cc.createImageData(size, size), relief = hc.createImageData(size, size);
  let seed = 417;
  for (let j = 0; j < size; j++) {
    const z = j / size * EXTENT - EXTENT / 2;
    for (let i = 0; i < size; i++) {
      const x = i / size * EXTENT - EXTENT / 2;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = seed / 4294967296;
      const wave = Math.sin(z * 9 + Math.sin(x * 1.1) * 1.8 + Math.sin(z * 1.4 + x * .6));
      const dune = Math.sin(x * .45 + z * .25) * Math.cos(z * .6);
      // The central court is lightly groomed; stronger ridges live around its edges.
      const edge = THREE.MathUtils.smoothstep(Math.max(Math.abs(x) / 11, Math.abs(z) / 6), .65, 1.3);
      const value = 244 + wave * (2 + edge * 5) + dune * 3 + (grain - .5) * 9;
      const bump = 128 + wave * (12 + edge * 25) + (grain - .5) * 24;
      const k = (j * size + i) * 4;
      albedo.data[k] = value;albedo.data[k + 1] = value;albedo.data[k + 2] = value - 3;albedo.data[k + 3] = 255;
      relief.data[k] = relief.data[k + 1] = relief.data[k + 2] = bump;relief.data[k + 3] = 255;
    }
  }
  cc.putImageData(albedo, 0, 0);hc.putImageData(relief, 0, 0);
  const map = new THREE.CanvasTexture(color), bumpMap = new THREE.CanvasTexture(height);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = bumpMap.anisotropy = 4;
  textures = { map, bumpMap };
  return textures;
}

// Both inputs start in XY, then rotate onto the ground; UVs remain in world metres.
export function sandMesh(geometry, color) {
  const pos = geometry.attributes.position, uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / EXTENT + .5;
    uv[i * 2 + 1] = pos.getY(i) / EXTENT + .5;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const material = new THREE.MeshStandardMaterial({ color, ...sandTextures(), bumpScale: .055, roughness: .94, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

const WIDTH = 32, DEPTH = 20, PIXELS = 40;

// Fixed-size canvas stores the court's history: one draw call, no per-print meshes.
export class SandTracks {
  constructor(scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH * PIXELS;this.canvas.height = DEPTH * PIXELS;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, DEPTH), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthWrite: false, opacity: .72,
    }));
    this.mesh.name = 'Sand footprints and scuffs';
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = .009; // above sand, below court lines and gameplay markers
    this.mesh.renderOrder = 0;
    scene.add(this.mesh);
    this.dirty = false;this.uploadT = 0;this.fadeT = 0;this.activeFor = 0;
    this.stamps = 0;
  }

  stamp(x, z, angle, draw) {
    if (![x, z, angle].every(Number.isFinite) || Math.abs(x) > 15.5 || Math.abs(z) > 9.5) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate((x + WIDTH / 2) * PIXELS, (z + DEPTH / 2) * PIXELS);
    ctx.rotate(-angle);
    ctx.scale(PIXELS, PIXELS);
    draw(ctx);
    ctx.restore();
    this.dirty = true;this.activeFor = 90;this.stamps++;
  }

  footprint(x, z, angle, side = 1) {
    // Local +canvas-y is forward (+world-z), matching the character heading.
    this.stamp(x, z, angle, ctx => {
      ctx.translate(side * .16, 0);
      ctx.fillStyle = 'rgba(255,245,206,.65)';
      ctx.beginPath();ctx.ellipse(-.018, .014, .105, .19, 0, 0, Math.PI * 2);ctx.fill();
      ctx.fillStyle = 'rgba(137,99,51,.42)';
      ctx.beginPath();ctx.ellipse(.005, .025, .086, .153, 0, 0, Math.PI * 2);ctx.fill();
      ctx.fillStyle = 'rgba(108,78,39,.22)';
      ctx.beginPath();ctx.ellipse(0, -.095, .068, .055, 0, 0, Math.PI * 2);ctx.fill();
      ctx.strokeStyle = 'rgba(255,238,184,.6)';ctx.lineWidth = .014;
      for (let i = 0; i < 3; i++) {ctx.beginPath();ctx.moveTo(-.05,.005+i*.04);ctx.lineTo(.05,.005+i*.04);ctx.stroke();}
    });
  }

  slide(x, z, angle) {
    this.stamp(x, z, angle, ctx => {
      const g = ctx.createRadialGradient(0,0,.04,0,0,.5);
      g.addColorStop(0,'rgba(137,99,51,.20)');g.addColorStop(.75,'rgba(164,119,63,.13)');g.addColorStop(1,'rgba(164,119,63,0)');
      ctx.save();ctx.scale(.85,1.3);ctx.fillStyle=g;ctx.fillRect(-.5,-.5,1,1);ctx.restore();
      ctx.lineCap='round';
      for (let i=-2;i<=2;i++) {
        ctx.strokeStyle='rgba(139,99,47,.16)';ctx.lineWidth=.018;
        ctx.beginPath();ctx.moveTo(i*.12,-.31);ctx.quadraticCurveTo(i*.13,0,i*.12,.31);ctx.stroke();
      }
      ctx.strokeStyle='rgba(255,244,200,.38)';ctx.lineWidth=.035;
      ctx.beginPath();ctx.ellipse(0,.18,.36,.28,0,0,Math.PI);ctx.stroke();
    });
  }

  impact(x, z, big = false) {
    this.stamp(x, z, 0, ctx => {
      const r = big ? .54 : .31;
      const g=ctx.createRadialGradient(-r*.12,-r*.12,0,0,0,r);
      g.addColorStop(0,'rgba(139,99,50,.3)');g.addColorStop(.65,'rgba(165,122,65,.24)');g.addColorStop(1,'rgba(165,122,65,0)');
      ctx.fillStyle=g;ctx.fillRect(-r,-r,r*2,r*2);
      ctx.strokeStyle='rgba(255,246,210,.6)';ctx.lineWidth=.035;
      ctx.beginPath();ctx.ellipse(0,0,r*.84,r*.80,0,.12,Math.PI*1.05);ctx.stroke();
    });
  }

  update(dt) {
    if (this.activeFor <= 0) return;
    this.activeFor -= dt;this.uploadT += dt;this.fadeT += dt;
    if (this.fadeT >= .25) {
      this.ctx.save();this.ctx.globalCompositeOperation='destination-out';
      this.ctx.fillStyle=`rgba(0,0,0,${1-Math.exp(-this.fadeT/18)})`;
      this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);this.ctx.restore();
      this.fadeT=0;this.dirty=true;
    }
    if (this.activeFor <= 0) this.clear();
    else if (this.dirty && this.uploadT >= .1) {
      this.texture.needsUpdate=true;this.dirty=false;this.uploadT=0;
    }
  }

  clear() {
    this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    this.texture.needsUpdate=true;this.activeFor=0;this.dirty=false;this.stamps=0;
  }
}

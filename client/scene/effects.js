import * as THREE from 'three';

// Short-lived sparkles, shockwave rings and sand puffs.
export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.items = [];
    this.geo = new THREE.OctahedronGeometry(0.09, 0);
    this.ringGeo = new THREE.TorusGeometry(0.3, 0.04, 6, 28);
  }

  spawn(mesh, item) {
    this.scene.add(mesh);
    this.items.push({ mesh, max: item.life, ...item });
  }

  particles(pos, n, colors, speed, up, gravity, life) {
    for (let i = 0; i < n; i++) {
      const color = colors[i % colors.length];
      const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true }));
      mesh.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random() * 0.5));
      v.y += up;
      this.spawn(mesh, { v, gravity, life: life * (0.7 + Math.random() * 0.3) });
    }
  }

  burst(pos, kind) {
    const spike = kind === 'spike';
    this.particles(pos, spike ? 22 : 10, spike ? [0xffe066, 0xff7b39, 0xffffff] : [0xffffff, 0xfff1a8], spike ? 7 : 4, 1, 9, 0.5);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: spike ? 0xffe066 : 0xffffff, transparent: true }));
    ring.position.copy(pos);
    ring.quaternion.copy(this.camera.quaternion);
    this.spawn(ring, { ring: true, grow: spike ? 6 : 3.5, life: 0.35 });
  }

  dust(x, z, big = false) {
    const pos = new THREE.Vector3(x, 0.15, z);
    this.particles(pos, big ? 40 : 14, [0xf6e2ae, 0xe2c385, 0xffffff], big ? 6 : 3, big ? 4 : 2.5, 12, big ? 0.9 : 0.6);
    if (big) {
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      ring.position.copy(pos);
      ring.rotation.x = Math.PI / 2;
      this.spawn(ring, { ring: true, grow: 9, life: 0.5 });
    }
  }

  // A low, radial fan of sand: hard impacts kick grains outward, not confetti upward.
  sandImpact(x, z, strength = 1) {
    const k = THREE.MathUtils.clamp(strength, .2, 1);
    const count = Math.round(16 + 28*k);
    for(let i=0;i<count;i++) {
      const a = Math.PI*2*(i/count) + Math.random()*.2;
      const speed = (2 + Math.random()*3)*k;
      const mesh = new THREE.Mesh(this.geo,new THREE.MeshBasicMaterial({color:i%3 ? 0xe8c78d : 0xffe7b3,transparent:true}));
      mesh.position.set(x,.07,z);mesh.scale.set(.5+Math.random()*.7,.35,.5);
      this.spawn(mesh,{v:new THREE.Vector3(Math.cos(a)*speed,.9+Math.random()*1.6*k,Math.sin(a)*speed),gravity:9,life:.45+Math.random()*.25});
    }
    const ring = new THREE.Mesh(this.ringGeo,new THREE.MeshBasicMaterial({color:0xeed5a5,transparent:true}));
    ring.position.set(x,.035,z);ring.rotation.x=Math.PI/2;
    this.spawn(ring,{ring:true,grow:3+4*k,life:.32});
  }

  // Effort sweat drops flicking off the head.
  sweat(pos) {
    this.particles(pos, 4, [0x9fe6ff, 0xd9f6ff], 2.2, 2.5, 10, 0.45);
  }

  // Small kick-up of sand from running feet.
  puff(x, z) {
    this.particles(new THREE.Vector3(x, 0.08, z), 3, [0xf6e2ae, 0xe2c385], 1.2, 1.2, 6, 0.35);
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) {
        this.scene.remove(it.mesh);
        it.mesh.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      if (it.ring) {
        it.mesh.scale.setScalar(1 + (1 - it.life / it.max) * it.grow);
      } else {
        it.v.y -= it.gravity * dt;
        it.mesh.position.addScaledVector(it.v, dt);
        it.mesh.position.y = Math.max(.025,it.mesh.position.y);
        it.mesh.rotation.x += dt * 8;
        it.mesh.rotation.y += dt * 6;
      }
      it.mesh.material.opacity = it.life / it.max;
    }
  }
}

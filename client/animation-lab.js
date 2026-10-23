import * as THREE from 'three';
import { Character } from './scene/character.js';
const canvas = document.querySelector('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeaf7f3);
scene.add(new THREE.HemisphereLight(0xffffff, 0x9cad83, 2));
const sun = new THREE.DirectionalLight(0xffedd2, 2.4);
sun.position.set(-3, 7, 5);sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = .025;
sun.shadow.bias = -.0002;
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({color:0xeaf7f3,roughness:1}));
ground.rotation.x = -Math.PI / 2;ground.receiveShadow = true;scene.add(ground);
const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
camera.position.set(0, 5.5, 10);camera.lookAt(0, .6, 0);
const chars = Array.from({ length: 6 }, (_, species) => {
  const c = new Character({ species, team: species % 2 });
  c.root.position.set((species % 3 - 1) * 2.25, 0, species < 3 ? -1.25 : 1.25);
  c.setLabel(c.sp.name, false);scene.add(c.root);return c;
});
const descriptions = {
  Idle: 'Idle breathing, eye tracking, and secondary motion.',
  Run: 'Alternating strides, knee flex, foot lift, and counter-swing.',
  Ready: 'Bent knees, elbows out, and a low passing platform.',
  Jump: 'Takeoff stretch, tucked legs, and a soft landing.',
  Bump: 'Joined hands with a low-to-high passing platform.',
  Set: 'Bent elbows and an upward push above the forehead.',
  Spike: 'Wind-up, torso rotation, wrist snap, and follow-through.',
  Serve: 'Overhand wind-up and a full reaching swing.',
  Tip: 'One hand reaches high for a soft touch.',
  Block: 'Both hands pressed high, with knees tucked in the air.',
  Dive: 'Full-body reach, a sliding hold, and eased recovery.',
  Cheer: 'Bongo drums, Pinchy dances, Pip flaps, Tiki sways, Mochi bounces, and Rocco pumps his fists.',
};
let action = 'Idle', time = 0, paused = false, speed = 1;
const duration = 1.6;
function stateFor(name, phase) {
  const st = { speed: 0, y: 0, airborne: false, swing: -1, ry: 0, look: new THREE.Vector3(0, 2, 7) };
  if (name === 'Run') st.speed = 5.5;
  if (name === 'Ready') st.ready = true;
  if (name === 'Cheer') st.cheer = true;
  if (['Jump', 'Block', 'Spike', 'Tip'].includes(name)) {
    const flight = THREE.MathUtils.clamp((phase - .12) / .62, 0, 1);
    st.y = Math.sin(flight * Math.PI) * .6;
    st.airborne = st.y > .01;
  }
  if (name === 'Block') st.block = true;
  if (['Bump', 'Set', 'Spike', 'Serve', 'Tip'].includes(name)) {
    st.swingKind = name.toLowerCase();
    st.swing = phase > .22 && phase < .62 ? (phase - .22) / .4 : -1;
    if (name === 'Serve') st.holding = phase < .22;
  }
  if (name === 'Dive') st.dive = phase < .18 ? 0 : phase < .4 ? 1 : phase < .72 ? 2 : 0;
  return st;
}
function draw(dt, phase = (time % duration) / duration) {
  for (const c of chars) {
    const st = stateFor(action, phase);
    c.root.position.y = st.y;
    c.update(dt, st);
  }
  renderer.render(scene, camera);
}
for (const name of Object.keys(descriptions)) {
  const b = document.createElement('button');b.textContent = name;b.dataset.action = name;
  b.classList.toggle('active', name === action);
  b.onclick = () => {
    action = name;time = 0;
    document.querySelectorAll('[data-action]').forEach(o => o.classList.toggle('active', o.dataset.action === name));
    document.querySelector('#hint').textContent = descriptions[name];
    draw(1 / 60, 0);
  };
  document.querySelector('#actions').append(b);
}
document.querySelector('#speed').onchange = e => speed = Number(e.target.value);
document.querySelector('#pause').onclick = e => { paused = !paused;e.target.textContent = paused ? 'Play' : 'Pause'; };
document.querySelector('#scrub').oninput = e => {
  paused = true;document.querySelector('#pause').textContent = 'Play';
  time = Number(e.target.value) * duration;
  for (let i = 0; i < 20; i++) draw(1 / 60, Number(e.target.value));
};
function resize() {
  const stage = document.querySelector('#stage');
  renderer.setSize(stage.clientWidth, stage.clientHeight, false);
  camera.aspect = stage.clientWidth / stage.clientHeight;
  const distance = Math.max(10, 7.8 / (2 * Math.tan(THREE.MathUtils.degToRad(19)) * camera.aspect));
  camera.position.set(0, distance * .55, distance);
  camera.lookAt(0, .6, 0);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(document.querySelector('#stage'));resize();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), .05) * speed;
  if (!paused) { time += dt;draw(dt);document.querySelector('#scrub').value = (time % duration) / duration; }
});
Promise.all(chars.map(c => c.modelReady)).then(results => {
  document.querySelector('#status').textContent = `${results.filter(Boolean).length}/6 Blender characters loaded · ${Object.keys(descriptions).length} motion previews`;
});
// Deterministic access for the visual/pose regression checks.
window.animationLab = { chars, scene, renderer, camera, stateFor, draw,
  setAction(name) { action = name; },
  setPaused(value) { paused = value; },
};

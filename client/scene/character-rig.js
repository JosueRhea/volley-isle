import * as THREE from 'three';
import { characterModels, loadGameModel } from './game-assets.js';
import { solveTwoBone } from './two-bone.js';
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const start = new THREE.Vector3();
const end = new THREE.Vector3();
const elbow = new THREE.Vector3();
const pole = new THREE.Vector3();
const delta = new THREE.Vector3();
const inverse = new THREE.Quaternion();
const facing = new THREE.Quaternion();

function segment(node, from, to, restLength) {
  node.position.copy(from);
  delta.subVectors(to, from);
  const length = delta.length();
  node.quaternion.setFromUnitVectors(DOWN, delta.normalize());
  node.scale.set(1, length / restLength, 1);
}

export async function attachCharacterRig(character, species, teamColor) {
  const index = ((species % characterModels.length) + characterModels.length) % characterModels.length;
  const model = await loadGameModel(characterModels[index], { teamColor, outline: true });
  if (character.disposed) { model.dispose(); return false; }
  const { roles } = model;
  const required = ['Torso', ...['L', 'R'].flatMap(s => ['UpperArm', 'Forearm', 'Hand', 'Thigh', 'Shin', 'Shoe', 'Eye'].map(p => `${p}_${s}`))];
  if (required.some(role => !roles.has(role))) { model.dispose(); throw new Error('Incomplete character rig'); }
  for (const child of character.body.children) child.visible = false;
  character.body.add(model.root);
  character.eyes = ['L', 'R'].map(side => ({ g: roles.get(`Eye_${side}`), pupil: roles.get(`Pupil_${side}`), r: character.sp.eyes.r }));
  const secondary = [...roles].filter(([role]) => role.startsWith('Secondary_')).map(([role, node]) => ({ role, node, rest: node.position.clone() }));
  character.rig = { ...model, secondary };
  character.extra = null;
  character.root.userData.assetLoaded = character.sp.name;
  return true;
}

export function animateCharacterRig(c, dt, st, run, drop) {
  const { roles, secondary } = c.rig;
  const k = 1 - Math.exp(-dt * 14);
  for (const [side, sign, arm] of [['L', -1, c.armL], ['R', 1, c.armR]]) {
    start.copy(arm.sh.position);
    end.copy(arm.target);
    pole.set(sign * 0.8, -0.3, -0.7);
    if (st.holding || st.block || st.swingKind === 'set' && st.swing >= 0) pole.z = 0.15;
    solveTwoBone(start, end, 0.24, pole, elbow);
    const upper = roles.get(`UpperArm_${side}`), fore = roles.get(`Forearm_${side}`), hand = roles.get(`Hand_${side}`);
    segment(upper, start, elbow, 0.24);
    segment(fore, elbow, end, 0.24);
    hand.position.copy(end);
    hand.quaternion.copy(fore.quaternion);
    // Wrists soften the contact instead of making the whole arm one straight hose.
    hand.rotateX(st.block ? -0.35 : st.swing >= 0 ? 0.28 * Math.sin(st.swing * Math.PI) : -0.12);

    const [hx, hy] = c.sp.hip;
    const legLength = (hy - 0.10) / 2;
    start.set(sign * hx, hy, 0);
    const phase = c.phase + (sign === 1 ? Math.PI : 0);
    if (!st.airborne && !st.dive) {
      const stride = Math.sin(phase) * 0.19 * run;
      const lift = Math.max(0, Math.cos(phase)) * 0.13 * run;
      end.set(sign * hx, 0.105 + lift, stride);
      end.applyAxisAngle(UP, c.ry + (st.spin ?? 0));
      c.body.worldToLocal(c.root.localToWorld(end));
    } else {
      const angle = side === 'L' ? c.legL.rotation.x : c.legR.rotation.x;
      end.set(0, -(hy - .10), 0).applyAxisAngle(RIGHT, angle).add(start);
      end.y += st.dive ? 0.015 : 0.06;
    }
    pole.set(0, 0, 1);
    solveTwoBone(start, end, legLength, pole, elbow);
    segment(roles.get(`Thigh_${side}`), start, elbow, legLength);
    segment(roles.get(`Shin_${side}`), elbow, end, legLength);
    const shoe = roles.get(`Shoe_${side}`);
    shoe.position.copy(end);
    if (!st.airborne && !st.dive) {
      inverse.copy(c.body.quaternion).invert();
      facing.setFromAxisAngle(UP, c.ry + (st.spin ?? 0));
      shoe.quaternion.copy(inverse.multiply(facing));
    } else shoe.quaternion.copy(roles.get(`Shin_${side}`).quaternion);
    const brow = roles.get(`Brow_${side}`);
    if (brow) brow.rotation.z = THREE.MathUtils.lerp(brow.rotation.z, (c.effort ? sign * .22 : -sign * .08), k);
  }
  const mouth = roles.get('Mouth');
  if (mouth) mouth.scale.y = THREE.MathUtils.lerp(mouth.scale.y, st.cheer ? 1.35 : c.effort ? .5 : 1, k);
  const impact = Math.exp(-c.landT * 10) * Math.sin(c.landT * 24);
  secondary.forEach(({ role, node, rest }, i) => {
    if (role.includes('Smoke')) {
      const phase = (c.t * (st.cheer ? 1.3 : .65) + i / 3) % 1;
      node.position.set(rest.x + Math.sin(c.t * 2 + i) * .06, 1.25 + phase * .55, rest.z);
      node.scale.setScalar(.55 + phase * .8);
      node.visible = phase < .91;
    } else {
      const frequency = role.includes('Tail') ? 5 : 3.2;
      const wave = Math.sin(c.t * frequency + i * .7 + c.phase * run * .2);
      node.rotation.z = THREE.MathUtils.lerp(node.rotation.z, wave * (.035 + run * .10) + impact * .12, k);
      node.rotation.x = THREE.MathUtils.lerp(node.rotation.x, -drop * .5 + wave * .055 + impact * .15, k);
      if (role.includes('Tail')) node.rotation.y = wave * (.15 + run * .3);
    }
  });
}

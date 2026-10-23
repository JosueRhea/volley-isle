import * as THREE from 'three';
const direction = new THREE.Vector3();
const bend = new THREE.Vector3();

// Equal-length two-segment IK. A projected pole keeps elbows/knees facing consistently.
// A small amount of stylized stretch preserves the gameplay hand target at full reach.
export function solveTwoBone(start, target, length, pole, elbow) {
  direction.subVectors(target, start);
  const distance = direction.length();
  if (distance < 1e-6) direction.set(0, -1, 0);
  else direction.divideScalar(distance);
  const segment = Math.max(length, distance * 0.56);
  bend.copy(pole).addScaledVector(direction, -pole.dot(direction));
  if (bend.lengthSq() < 1e-8) {
    bend.set(Math.abs(direction.x) < 0.8 ? 1 : 0, Math.abs(direction.x) < 0.8 ? 0 : 1, 0);
    bend.addScaledVector(direction, -bend.dot(direction));
  }
  bend.normalize();
  const height = Math.sqrt(Math.max(0, segment * segment - distance * distance * 0.25));
  elbow.copy(start).addScaledVector(direction, distance * 0.5).addScaledVector(bend, height);
  return elbow;
}

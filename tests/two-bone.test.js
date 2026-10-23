import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { solveTwoBone } from '../client/scene/two-bone.js';

for (const [name, target, pole] of [
  ['bent contact', [0, -.3, .1], [1, 0, -1]],
  ['full reach', [0, .8, .3], [1, 0, -1]],
  ['coincident wrist', [0, 0, 0], [0, -1, 0]],
  ['pole parallel to limb', [0, -.3, 0], [0, -1, 0]],
]) {
  test(`two-bone IK preserves equal limb lengths: ${name}`, () => {
    const start = new Vector3(), end = new Vector3(...target), joint = new Vector3();
    solveTwoBone(start, end, .24, new Vector3(...pole), joint);
    assert(joint.toArray().every(Number.isFinite));
    const expected = Math.max(.24, start.distanceTo(end) * .56);
    assert(Math.abs(start.distanceTo(joint) - expected) < 1e-8);
    assert(Math.abs(end.distanceTo(joint) - expected) < 1e-8);
  });
}
test('elbow bends toward the requested pole', () => {
  const joint = solveTwoBone(new Vector3(), new Vector3(0, -.3, 0), .24, new Vector3(1, 0, 0), new Vector3());
  assert(joint.x > 0);
  assert(Math.abs(joint.y + .15) < 1e-8);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const names = ['bongo', 'pinchy', 'pip', 'tiki', 'mochi', 'rocco'];
for (const [species, name] of names.entries()) {
  test(`${name} export has a usable game rig and stays within the mesh budget`, () => {
    const bytes = readFileSync(new URL(`../client/assets/models/characters/${name}.glb`, import.meta.url));
    assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
    assert.equal(bytes.readUInt32LE(4), 2);
    const data = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    const roles = data.nodes.filter(n => n.extras?.role).map(n => n.extras.role);
    assert.equal(new Set(roles).size, roles.length, 'pivot roles must be unique per asset');
    for (const side of ['L', 'R']) {
      for (const part of ['UpperArm', 'Forearm', 'Hand', 'Thigh', 'Shin', 'Shoe', 'Eye']) assert(roles.includes(`${part}_${side}`));
    }
    assert(roles.includes(species === 2 ? 'LowerBeak' : 'Mouth'), 'every character needs an articulated expression');
    const root = data.nodes.find(n => n.extras?.species === species);
    assert(root);
    assert.deepEqual(root.translation ?? [0, 0, 0], [0, 0, 0], 'studio placement must not leak into export');
    assert(data.materials.some(m => /^Team(?:\.|$)/.test(m.name)), 'team-color material must survive export');
    const triangles = data.meshes.flatMap(m => m.primitives).reduce((n, p) => n + data.accessors[p.indices].count / 3, 0);
    assert(triangles < 12000, `${triangles} triangles exceeds per-character budget`);
    assert(bytes.length < 250000, 'asset exceeds per-character download budget');
  });
}

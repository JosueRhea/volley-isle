import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const name of ['referee-stand','beach-scoreboard','golden-coconut','beach-cooler','towel-sandals','surfboard','beach-bag']) {
  test(`${name} keeps its game-ready export contract`, () => {
    const bytes=readFileSync(new URL(`../client/assets/models/${name}.glb`,import.meta.url));
    assert.equal(bytes.toString('utf8',0,4),'glTF');
    const data=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
    const triangles=data.meshes.flatMap(m=>m.primitives).reduce((sum,p)=>sum+data.accessors[p.indices].count/3,0);
    assert(triangles<11000,'prop triangle budget');
    assert(bytes.length<550000,'prop download budget');
    assert(data.meshes.length <= (name==='referee-stand'?3:1),'static pieces must be merged');
    if(name==='referee-stand') {
      const roles=data.nodes.map(n=>n.extras?.role).filter(Boolean);
      assert(roles.includes('RefArm_L') && roles.includes('RefArm_R'),'both point-signal pivots must survive export');
    }
    if(name==='golden-coconut') assert(data.materials.some(m=>m.pbrMetallicRoughness?.metallicFactor>.5),'trophy must retain metallic gold');
  });
}

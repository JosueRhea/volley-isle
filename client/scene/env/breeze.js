import * as THREE from 'three';

// Shared clock, used by color and shadow passes. Geometry is cloned only for animated props.
export const breezeTime = { value: 0 };
const deformation = `
  vec3 windWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float wave = sin(breezeTime * 1.7 + windWorld.x * .7 + windWorld.z * .45);
  float flutter = sin(breezeTime * 4.4 + windWorld.x * 3.0 + windWorld.z * 2.0);
  transformed.x += breezeWeight * wave * .065;
  transformed.y += breezeWeight * (wave * .025 + flutter * .018);
  transformed.z += breezeWeight * flutter * .025;
`;
function shader(material) {
  material.onBeforeCompile = s => {
    s.uniforms.breezeTime = breezeTime;
    s.vertexShader = 'uniform float breezeTime;\nattribute float breezeWeight;\n' + s.vertexShader;
    s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + deformation);
  };
  material.customProgramCacheKey = () => 'island-breeze-v1';
  material.needsUpdate = true;
}
export function animateBreeze(root, kind) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const v = new THREE.Vector3(), relative = new THREE.Matrix4();
  root.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const eligible = mats.some(m => kind === 'palm' ? /Frond|midribs/.test(m.name) : kind === 'umbrella' ? /Canvas/.test(m.name) : true);
    if (!eligible) return;
    const geometry = o.geometry.clone(), position = geometry.attributes.position;
    const weights = new Float32Array(position.count);
    relative.multiplyMatrices(inverse, o.matrixWorld);
    let active = false;
    for(let i=0;i<position.count;i++) {
      v.fromBufferAttribute(position,i).applyMatrix4(relative);
      let w=0;
      if(kind==='palm') w=THREE.MathUtils.smoothstep(Math.hypot(v.x-1.1,v.z),.35,2.8)*1.5;
      if(kind==='umbrella') w=THREE.MathUtils.smoothstep(Math.hypot(v.x,v.z),.2,1.4);
      if(kind==='canopy') w=v.y>3 ? THREE.MathUtils.smoothstep(Math.abs(v.z),.3,.95) : 0;
      if(kind==='towel') w=v.y<.055 ? THREE.MathUtils.smoothstep(Math.abs(v.x),.3,.55)*THREE.MathUtils.smoothstep(Math.abs(v.z),.5,1.05) : 0;
      weights[i]=w;active ||= w>0;
    }
    if(!active){geometry.dispose();return;}
    geometry.setAttribute('breezeWeight',new THREE.BufferAttribute(weights,1));o.geometry=geometry;
    mats.forEach(shader);
    o.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});shader(o.customDepthMaterial);
    geometry.computeBoundingSphere();geometry.boundingSphere.radius+=.18;
    o.userData.breeze=kind;
  });
}

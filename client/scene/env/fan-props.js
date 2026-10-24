import * as THREE from 'three';
import { toon } from '../toon.js';
import { TEAM_COLORS } from '../../teams.js';

export function fanProp(scene, kind, team) {
  const root = new THREE.Group();root.name = `Fan ${kind}`;scene.add(root);
  const color = TEAM_COLORS[team >= 0 ? team : 0].main;
  const add = (geometry,material,x,y,z) => {
    const m = new THREE.Mesh(geometry,material);m.position.set(x,y,z);root.add(m);return m;
  };
  const paint=toon(color), ivory=toon(0xfff1c9), wood=toon(0x9b643c);
  let cloth;
  if(kind==='flag') {
    add(new THREE.CylinderGeometry(.018,.018,.85,6),wood,0,.32,0);
    cloth=add(new THREE.PlaneGeometry(.48,.30,8,3),new THREE.MeshToonMaterial({color,side:THREE.DoubleSide}),.24,.58,0);
  } else if(kind==='finger') {
    add(new THREE.BoxGeometry(.24,.30,.10),paint,0,.15,0);
    add(new THREE.CapsuleGeometry(.055,.29,3,8),paint,-.06,.43,0);
    add(new THREE.BoxGeometry(.12,.13,.10),paint,.15,.19,0);
    add(new THREE.BoxGeometry(.025,.22,.012),ivory,-.06,.43,.058);
  } else if(kind==='drum') {
    add(new THREE.CylinderGeometry(.24,.24,.28,16),paint,0,-.10,.12);
    add(new THREE.CylinderGeometry(.25,.25,.025,16),ivory,0,.055,.12);
    for(const s of [-1,1]) {
      const stick=add(new THREE.CylinderGeometry(.014,.014,.34,6),wood,s*.16,.18,.10);stick.rotation.z=s*.4;
    }
  } else {
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;
    const c=canvas.getContext('2d');c.fillStyle='#fff0cd';c.fillRect(0,0,256,128);c.strokeStyle=TEAM_COLORS[team>=0?team:0].css;c.lineWidth=12;c.strokeRect(7,7,242,114);
    c.fillStyle='#30283a';c.font='900 65px sans-serif';c.textAlign='center';c.fillText('GO!',128,88);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    add(new THREE.BoxGeometry(.04,.45,.035),wood,0,.15,0);
    add(new THREE.BoxGeometry(.69,.38,.045),wood,0,.49,0);
    add(new THREE.PlaneGeometry(.66,.35),new THREE.MeshBasicMaterial({map:texture}),0,.49,.025);
  }
  const rest=cloth?.geometry.attributes.position.array.slice();
  return {root,kind,update(t,energy){
    root.rotation.z += Math.sin(t*(2+energy*5))*(.025+energy*.12);
    if(cloth){const p=cloth.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setZ(i,Math.sin(t*5+rest[i*3]*10)*(rest[i*3]+.24)*.16);p.needsUpdate=true;}
    if(kind==='drum') for(const [i,o] of root.children.entries())if(i>1)o.rotation.x=Math.sin(t*(4+energy*12)+i*2)*(.15+energy*.5);
  }};
}

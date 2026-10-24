import * as THREE from 'three';
import { animateBreeze } from './breeze.js';
import { loadGameModel } from '../game-assets.js';
import { TEAM_COLORS } from '../../teams.js';
import refereeUrl from '../../assets/models/referee-stand.glb?url';
import scoreboardUrl from '../../assets/models/beach-scoreboard.glb?url';
import trophyUrl from '../../assets/models/golden-coconut.glb?url';
import coolerUrl from '../../assets/models/beach-cooler.glb?url';
import towelUrl from '../../assets/models/towel-sandals.glb?url';
import boardUrl from '../../assets/models/surfboard.glb?url';
import bagUrl from '../../assets/models/beach-bag.glb?url';

function label(width, height, text, background, color = '#fff4d4') {
  const canvas = document.createElement('canvas');canvas.width = 512;canvas.height = 256;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture }));
  const draw = (value) => {
    context.fillStyle = background;context.fillRect(0, 0, 512, 256);
    context.fillStyle = color;context.font = `900 ${String(value).length > 3 ? 72 : 170}px sans-serif`;
    context.textAlign = 'center';context.textBaseline = 'middle';context.fillText(String(value),256,137,470);
    texture.needsUpdate = true;
  };
  draw(text);return { mesh, draw };
}

export function buildTournament(scene) {
  const root = new THREE.Group();root.name = 'Beach tournament';scene.add(root);
  const pending = [];
  function prop(url, name, x, z, yaw = 0, scale = 1, color) {
    const group = new THREE.Group();group.name = name;group.position.set(x,0,z);group.rotation.y = yaw;group.scale.setScalar(scale);root.add(group);
    const ready = loadGameModel(url, { teamColor: color }).then(model => {
      if (url===refereeUrl) animateBreeze(model.root,'canopy');
      if (url===towelUrl) animateBreeze(model.root,'towel');
      group.add(model.root);group.userData.assetLoaded = true;return model;
    }).catch(error => { console.warn(`Could not load ${name}`, error);return null; });
    pending.push(ready);return { group, ready };
  }
  const referee = prop(refereeUrl,'Referee stand',0,-8.7);
  let arms = [];
  referee.ready.then(model => { if (model) arms = ['L','R'].map(s => model.roles.get(`RefArm_${s}`)); });
  const board = prop(scoreboardUrl,'Beach scoreboard',13.8,-3.8,-Math.PI/2);
  const title = label(2.8,.31,'VOLLEY ISLE','#f5dfb0','#49301d');title.mesh.position.set(0,3.37,.091);board.group.add(title.mesh);
  const panels = [0,1].map(team => {
    const tile = label(1.43,.98,'0','#252b36');
    const pivot = new THREE.Group();pivot.position.set(team ? .96 : -.96,2.68,.23);tile.mesh.position.y=-.49;pivot.add(tile.mesh);board.group.add(pivot);
    const heading = label(1.43,.27,team ? 'SUNSET' : 'LAGOON',TEAM_COLORS[team].css);
    heading.mesh.position.set(team ? .96 : -.96,2.84,.20);board.group.add(heading.mesh);
    // A thin divider makes the rotating cards read as a mechanical scoreboard.
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(1.43,.015),new THREE.MeshBasicMaterial({color:0x10131c}));
    seam.position.set(0,-.49,.002);pivot.add(seam);
    return { pivot, draw:tile.draw, value:0, target:0, elapsed:1, swapped:true };
  });
  const trophy = prop(trophyUrl,'Golden coconut trophy',-4,0,0,2.0);trophy.group.visible = false;
  const ring = new THREE.Mesh(new THREE.RingGeometry(.65,1.0,48),new THREE.MeshBasicMaterial({color:0xffdb70,transparent:true,opacity:.6,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.02;trophy.group.add(ring);
  // Small clusters outside the play area and clear of the bleacher stairways.
  for (const [x,z,team] of [[-10.7,-13.4,0],[10.6,13.9,1],[-10.8,13.7,0]]) {
    prop(coolerUrl,'Beach cooler',x,z,.3,1,TEAM_COLORS[team].main);
    prop(towelUrl,'Towel and sandals',x+1.1,z+1.2,.3,1);
    prop(bagUrl,'Beach bag',x-.6,z+.9,-.4,1);
  }
  for (const [x,z,yaw] of [[-11.4,-12.6,.35],[10.9,12.8,-.4]]) {
    const surf = prop(boardUrl,'Surfboard',x,z,yaw);surf.group.rotation.z=.15;
  }
  let phase = 'lobby', pointTeam = -1, signal = 0, reveal = 0;
  return {
    root, panels, referee:referee.group, trophy:trophy.group,
    ready:Promise.all(pending),
    reset() {
      phase='lobby';signal=0;pointTeam=-1;reveal=0;trophy.group.visible=false;
      for (const p of panels) { p.value=p.target=0;p.elapsed=1;p.swapped=true;p.pivot.rotation.x=0;p.draw(0); }
    },
    sync(score, nextPhase, winner) {
      score.forEach((value,i) => {
        const p=panels[i];if (!p || !Number.isFinite(value) || value===p.target) return;
        p.target=value;p.elapsed=0;p.swapped=false;
      });
      if (nextPhase==='over' && phase!=='over' && (winner===0 || winner===1)) {
        reveal=0;trophy.group.position.x=winner===0?-4:4;trophy.group.visible=true;
      }
      if (nextPhase!=='over') trophy.group.visible=false;
      phase=nextPhase;
    },
    point(team) { if(team===0 || team===1){pointTeam=team;signal=3;} },
    update(t,dt) {
      signal=Math.max(0,signal-dt);
      for(let i=0;i<arms.length;i++) if(arms[i]) {
        const angle=signal>0 && pointTeam===i ? (i===0?-1:1)*1.35 : 0;
        arms[i].rotation.z=THREE.MathUtils.lerp(arms[i].rotation.z,angle,1-Math.exp(-dt*10));
      }
      for(const p of panels) if(p.elapsed<1) {
        p.elapsed=Math.min(1,p.elapsed+dt/.6);
        if(p.elapsed>=.5 && !p.swapped){p.draw(p.target);p.value=p.target;p.swapped=true;}
        p.pivot.rotation.x=-Math.sin(Math.PI*p.elapsed)*Math.PI/2;
      }
      if(trophy.group.visible){
        reveal=Math.min(1,reveal+dt/1.2);
        const pop=1-Math.pow(1-reveal,3);trophy.group.scale.setScalar(2*pop);
        trophy.group.position.y=.25+.12*Math.sin(t*2.2)*pop;
        trophy.group.rotation.y=t*.5;ring.material.opacity=.45+.15*Math.sin(t*4);
      }
    },
  };
}

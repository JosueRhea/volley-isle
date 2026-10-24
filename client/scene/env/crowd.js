import * as THREE from 'three';
import { fanProp } from './fan-props.js';
import { part, toon } from '../toon.js';
import { TEAM_COLORS } from '../../teams.js';
import { upgradeGameProp } from '../game-assets.js';
import { rand, pickOne, instancedOutlineMaterial } from './util.js';

const NEUTRAL = [0xff7eb6, 0x9b7bff, 0x7be0ad, 0xffd84d, 0xff8a65, 0x6ad1ff];
const UP = new THREE.Vector3(0, 1, 0);

export function buildCrowd(scene) {
  const fans = [];
  const stands = [];
  for (const side of [-1, 1]) {
    for (const [section, x] of [-6.8, 0, 6.8].entries()) {
      const stand = new THREE.Group();
      stand.name = 'Wooden sideline bleachers';
      stand.position.set(x, 0, side * 11.8);
      stand.rotation.y = side > 0 ? Math.PI : 0;
      // Lightweight loading fallback; it also documents the exact seat heights.
      for (let row = 0; row < 3; row++) {
        const seat = part(new THREE.BoxGeometry(6, .13, .45), 0xb47b43, { outline: .025 });
        seat.position.set(0, .435 + row * .45, .95 - row * .95);
        stand.add(seat);
      }
      scene.add(stand);stands.push(stand);
      upgradeGameProp(stand, 'bleachers', { teamColor: TEAM_COLORS[section === 2 ? 1 : 0].main });
      for (let row = 0; row < 3; row++) {
        for (let seat = 0; seat < 4; seat++) {
          const team = section === 1 ? (seat % 3 === 0 ? -1 : seat % 2) : section === 0 ? 0 : 1;
          fans.push({
            x: x + (seat - 1.5) * 1.4,
            z: side * (11.8 - .95 + row * .95),
            seatY: .5 + row * .45,
            r: rand(.32, .39), team, side, row, section,
            color: team >= 0 ? TEAM_COLORS[team].main : pickOne(NEUTRAL),
            yaw: side > 0 ? Math.PI : 0,
            ph: rand(0, 10), speed: rand(1.6, 2.6), variant: (seat + row + section) % 3,
          });
        }
      }
    }
  }
  for (let i=0;i<fans.length;i+=6) fans[i].prop=fanProp(scene,['flag','finger','drum','sign'][(i/6)%4],fans[i].team);
  const N = fans.length;
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const ink = new THREE.MeshBasicMaterial({ color: 0x24263d });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const make = (name, material, count = N) => {
    const m = new THREE.InstancedMesh(sphere, material, count);
    m.name = `Crowd ${name}`;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;scene.add(m);return m;
  };
  const body = make('bodies', toon(0xffffff));body.castShadow = true;
  const outline = make('outlines', instancedOutlineMaterial(.065));
  const hands = make('hands', toon(0xffffff), N * 2);
  const whites = make('eyes', white, N * 2);
  const pupils = make('pupils', ink, N * 2);
  const mouths = make('expressions', ink);
  const bellies = make('belly patches', toon(0xfff0c5));
  const ears = make('ears', toon(0xffffff), N * 2);
  const shoes = make('feet', toon(0xffebc5), N * 2);
  const hats = make('sun visors', toon(0xffe28a));
  const meshes = [body, outline, hands, whites, pupils, mouths, bellies, ears, shoes, hats];
  const color = new THREE.Color();
  fans.forEach((f, i) => {
    body.setColorAt(i, color.set(f.color));
    for (const m of [hands, ears]) for (let j = 0; j < 2; j++) m.setColorAt(i * 2 + j, color);
  });
  const M = new THREE.Matrix4(), S = new THREE.Matrix4();
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), v = new THREE.Vector3();
  const target = new THREE.Vector3();
  let watching = false, clock = 0, rally = 0, burst = 0, burstKind = '', burstTeam = -1;
  let winner = -1, scoreAt = -100, victory = false;
  const place = (mesh, i, x, y, z, sx, sy = sx, sz = sx) => {
    v.set(x,y,z).applyMatrix4(M);S.compose(v,q,sc.set(sx,sy,sz));mesh.setMatrixAt(i,S);
  };
  return {
    stands, fanCount: N,
    watchBall(pos, active = true) { target.copy(pos);watching = active; },
    reset() { winner = -1;scoreAt = -100;burst = 0;rally = 0;watching = false; },
    react(kind, team = -1) {
      if (!['spike', 'block', 'dig', 'set', 'pass', 'bump', 'serve', 'tip', 'start', 'sudden', 'over'].includes(kind)) return;
      burstKind = kind;burstTeam = team;burst = 1;
      rally = Math.min(1, rally + .12);
      if (kind === 'over') { winner = team;scoreAt = clock;victory = true; }
      if (kind === 'start') { winner = -1;rally = 0; }
    },
    cheer(team) {
      if (team !== 0 && team !== 1) return;
      winner = team;scoreAt = clock;victory = false;rally = 0;
    },
    update(t, dt) {
      clock += dt;
      burst = Math.max(0, burst - dt / 1.1);
      rally = Math.max(0, rally - dt / 12);
      fans.forEach((f, i) => {
        // Wave moves across sections rather than making everyone jump on one frame.
        const elapsed = clock - scoreAt - (f.x + 10) * .045 - f.row * .10;
        const envelope = elapsed < 0 ? 0 : Math.max(0, 1 - elapsed / (victory ? 7 : 3.8));
        const hype = winner < 0 ? 0 : f.team === winner ? envelope : f.team < 0 ? envelope * .65 : 0;
        const sulk = winner >= 0 && f.team >= 0 && f.team !== winner ? envelope : 0;
        const support = f.team === burstTeam || f.team < 0;
        const clap = ['dig', 'block'].includes(burstKind) && support ? burst : 0;
        const gasp = ['spike', 'sudden'].includes(burstKind) ? burst : 0;
        const idle = Math.sin(t * f.speed + f.ph);
        const jump = Math.max(0, Math.sin(elapsed * 10 + f.ph));
        const hop = hype * jump * .34 + clap * Math.abs(Math.sin(t * 10 + f.ph)) * .07;
        const sy = 1 + idle * .025 + hype * Math.sin(t * 16 + f.ph) * .09 - sulk * .12;
        const sxz = 1 / Math.sqrt(sy);
        let look = 0;
        if (watching) {
          look = Math.atan2(target.x - f.x, target.z - f.z) - (f.side > 0 ? Math.PI : 0);
          look = Math.atan2(Math.sin(look), Math.cos(look));
          look = THREE.MathUtils.clamp(look, -.55, .55);
        }
        const desiredYaw = (f.side > 0 ? Math.PI : 0) + look;
        f.yaw += (desiredYaw - f.yaw) * (1 - Math.exp(-dt * 6));
        q.setFromAxisAngle(UP, f.yaw);
        p.set(f.x, f.seatY + f.r * sy + hop, f.z);
        M.compose(p, q, sc.set(f.r * sxz, f.r * sy, f.r * sxz));
        body.setMatrixAt(i, M);outline.setMatrixAt(i, M);
        place(bellies, i, 0,-.20,.88,f.r*.61,f.r*.52,f.r*.12);
        const mouthHeight = .045 + gasp * .095 + hype * .06;
        place(mouths,i,0,-.10-sulk*.10,1.005,f.r*(sulk>.2?.18:.21),mouthHeight,f.r*.045);
        for (const s of [-1, 1]) {
          const j = i * 2 + (s > 0 ? 1 : 0);
          const up = hype * 1.55 + gasp * .55 + rally * .15 + (burstKind === 'start' ? burst * .8 : 0);
          const clapX = .24 + Math.abs(Math.sin(t * 15 + f.ph)) * .34;
          const hx = s * THREE.MathUtils.lerp(1.03 - up * .13, clapX, clap);
          const hy = -.10 + up + Math.sin(t * 13 + f.ph) * hype * .20 - sulk * .2;
          place(hands,j,hx,hy+clap*.35,.23+clap*.75,f.r*.24);
          if (f.prop && s===1) {
            const drum=f.prop.kind==='drum';
            v.set(drum?0:hx,drum?-.2:hy+clap*.35,drum?1.2:.23+clap*.75).applyMatrix4(M);
            f.prop.root.position.copy(v);f.prop.root.quaternion.copy(q);
            f.prop.update(t+f.ph,Math.max(hype,clap));
          }
          const blink = (Math.sin(f.ph * 13.7 + Math.floor(t * 3) * 1.3) > .97 ? .12 : 1) * (1 - sulk * .4);
          place(whites,j,s*.32,.28,.85,f.r*.29,f.r*.29*blink,f.r*.29);
          const gazeY = watching ? THREE.MathUtils.clamp((target.y - p.y) * .035, -.08,.10) : 0;
          place(pupils,j,s*.32+look*.12,.28+gazeY,1.09,f.r*.16,f.r*.16*blink,f.r*.10);
          const earSize = f.variant === 1 ? 0 : f.r;
          place(ears,j,s*.63,.86,-.03,earSize*.22,earSize*(f.variant===0?.38:.23),earSize*.20);
          place(shoes,j,s*.48,-1.12,.51,f.r*.27,f.r*.20,f.r*.38);
        }
        const hat = f.variant === 1 ? f.r : 0;
        place(hats,i,0,.91,.22,hat*.92,hat*.14,hat*.8);
      });
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    },
  };
}

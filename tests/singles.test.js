import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { attach } from '../server/session.js';

function socket() { return {readyState:1,sent:[],send(s){this.sent.push(JSON.parse(s));},close(){this.readyState=3;}}; }
function join(room) { const ws=socket(), session=attach(ws,room);session.onMessage(JSON.stringify({t:'join',name:'Player',char:0}));return {ws,session,p:room.players.find(p=>p.ws===ws)}; }
function format(who,size){who.session.onMessage(JSON.stringify({t:'format',teamSize:size}));}

test('private host can play singles against one CPU, start and rematch',()=>{
 const room=new Room('SOLO',false),host=join(room);format(host,1);
 assert.equal(room.teamSize,1);assert.equal(room.players.length,2);
 assert.equal(room.players.filter(p=>p.bot).length,1);
 assert(room.players.every(p=>p.slot===0&&p.z===0));
 room.flush();assert.equal(host.ws.sent.findLast(m=>m.t==='roster').teamSize,1);
 room.startMatch(host.p);assert.equal(room.phase,'serve');assert(room.server);
 format(host,2);assert.equal(room.teamSize,1,'cannot change an active match');
 room.enterLobby();room.startMatch(host.p);assert.equal(room.players.length,2);
 room.enterLobby();format(host,2);assert.equal(room.players.length,4);
});

test('a friend replaces the only CPU, a third player is rejected, and reconnect works at capacity',()=>{
 const room=new Room('SOLO',false),host=join(room);format(host,1);
 const guest=join(room);assert(guest.p);assert.equal(room.players.filter(p=>p.bot).length,0);
 const third=join(room);assert.equal(third.ws.sent.find(m=>m.t==='error')?.code,'roomFull');
 guest.session.onClose();const ws=socket(),session=attach(ws,room);
 session.onMessage(JSON.stringify({t:'join',key:guest.p.key,name:'Again'}));
 assert.equal(ws.sent.find(m=>m.t==='welcome').id,guest.p.id);assert.equal(room.players.length,2);
});

test('singles balances two teammates without changing identities or reconnect keys',()=>{
 const room=new Room('SOLO',false),host=join(room),guest=join(room);
 room.pickTeam(guest.p,host.p.team);assert.equal(guest.p.team,host.p.team);
 const key=guest.p.key;format(host,1);
 assert.notEqual(guest.p.team,host.p.team);assert.equal(guest.p.key,key);
 assert.equal(room.members(0).length,1);assert.equal(room.members(1).length,1);
});

test('format cannot eject humans, be changed by guests, or alter Quick Play/tutorial',()=>{
 const room=new Room('SOLO',false),host=join(room),guest=join(room);
 format(guest,1);assert.equal(room.teamSize,2);
 join(room);format(host,1);assert.equal(room.teamSize,2);assert.equal(room.humanCount,3);
 assert.equal(host.ws.sent.findLast(m=>m.t==='notice').code,'singlesFull');
 for(const value of [0,3,'1',null])format(host,value);
 assert.equal(room.teamSize,2);
 for(const r of [new Room('PUBB',true),new Room('TUTO',false,{tutorial:true})]){const h=join(r);format(h,1);assert.equal(r.teamSize,2);}
});

test('CPU toggle and departures respect the singles capacity',()=>{
 const room=new Room('SOLO',false),host=join(room);format(host,1);
 room.setCpu(host.p,false);assert.equal(room.players.length,1);
 room.startMatch(host.p);assert.equal(room.phase,'lobby');
 const guest=join(room);room.startMatch(host.p);assert.equal(room.phase,'serve');
 room.removeHuman(guest.p);assert.equal(room.phase,'lobby');
 room.setCpu(host.p,true);assert.equal(room.players.length,2);
});

test('singles self-sets remain legal and the fourth team touch still loses the point',()=>{
 const room=new Room('SOLO',false),host=join(room);format(host,1);room.startMatch(host.p);room.phase='rally';
 const p=host.p;room.lastTeam=p.team;room.lastHitter=p.id;room.touches=1;
 Object.assign(room.ball,{x:p.x,y:1.2,z:p.z,vx:0,vy:-1,vz:0});p.cooldown=0;
 room.tryHit(p);assert.equal(room.touches,2);assert.equal(room.lastKind,'set');
 room.touches=3;p.cooldown=0;Object.assign(room.ball,{x:p.x,y:1.2,z:p.z});
 room.tryHit(p);assert.equal(room.score[1-p.team],1);
});

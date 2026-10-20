import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';

test('combat journal records only applied damage and is outside save/RNG/IDs',()=>{
  const world=new World(), control=World.fromSave(world.serialize());
  control._combatEvent=()=>{};
  const source=world.state.units.find(u=>u.team===1&&u.kind==='infantry');
  const target=world.state.units.find(u=>u.team===2&&u.kind==='infantry');
  world._damage(target,19,source);
  control._damage(control.getEntity(target.id),19,control.getEntity(source.id));
  assert.deepEqual(world.serialize(),control.serialize());
  const hit=world.combatEvents[0];
  assert.equal(hit.kind,'hit');
  assert.equal(hit.amount,control.getEntity(target.id).maxHp-control.getEntity(target.id).hp);
  assert.equal(hit.target.hp,target.hp);
  assert.equal(hit.source.id,source.id);
  world._damage(target,10000,source);
  assert.equal(world.combatEvents[2].kind,'death');
  const seq=world.combatSequence;
  world._damage(target,10000,source);
  assert.equal(world.combatSequence,seq,'dead targets do not generate duplicate gore');
  assert.equal(World.fromSave(control.serialize()).combatEvents,undefined);
});

test('combat journal ring retains exactly the last 512 detached snapshots',()=>{
  const world=new World(),source=world.state.units[0],target=world.state.units[12];
  for(let i=0;i<1500;i++)world._combatEvent('attack',source,target);
  assert.equal(world.combatEvents.length,512);
  assert.equal(world.combatSequence,1500);
  assert.deepEqual(world.combatEvents.map(e=>e.seq).sort((a,b)=>a-b),Array.from({length:512},(_,i)=>989+i));
  const event=world.combatEvents[1499%512],x=event.source.x;
  source.x+=2;
  assert.equal(event.source.x,x);
});

test('real melee attack produces strike then damage without changing simulation',()=>{
  const world=new World();
  const source=world.state.units.find(u=>u.team===1&&u.kind==='infantry');
  const target=world.state.units.find(u=>u.team===2&&u.kind==='infantry');
  target.x=source.x+.5;target.y=source.y;source.order={type:'attack',targetId:target.id};
  const control=World.fromSave(world.serialize());control._combatEvent=()=>{};
  world._combat(source,.05);control._combat(control.getEntity(source.id),.05);
  assert.deepEqual(world.serialize(),control.serialize());
  assert.equal(world.combatEvents[0].kind,'attack');assert.equal(world.combatEvents[1].kind,'hit');
  const seq=world.combatSequence;world._combat(source,.05);
  assert.equal(world.combatSequence,seq,'cooldown creates no invented impact');
});

// Exercise presentation pool consumption independently of Canvas/browser timing.
import { GameRenderer } from '../src/game/renderer.js';
test('renderer consumes each journal event once, caps pools and expires visuals',()=>{
  const world=new World();
  const renderer=Object.assign(Object.create(GameRenderer.prototype),{world,combatSequence:0,combatPoses:new Map(),combatBursts:[],bloodDecals:[],bodies:[],stats:{}});
  const source=world.state.units[0],target=world.state.units[12];
  for(let i=0;i<900;i++){
    world._combatEvent('hit',source,{...target,id:'visual-'+i},5);
    world._combatEvent('death',source,target,5);
    if(i%32===0)renderer.updateCombat();
  }
  renderer.updateCombat();
  assert.equal(renderer.combatBursts.length,128);assert.equal(renderer.bloodDecals.length,192);assert.equal(renderer.bodies.length,96);
  assert.ok(renderer.combatPoses.size<=2048);
  const counts=JSON.stringify(renderer.stats.combat);renderer.updateCombat();assert.equal(JSON.stringify(renderer.stats.combat),counts);
  world.state.time=46;renderer.updateCombat();
  assert.equal(renderer.combatBursts.length+renderer.bloodDecals.length+renderer.bodies.length+renderer.combatPoses.size,0);
});

test('support presentation requires real healing and preserves deterministic save',()=>{
  const world=new World(),source=world.state.units.find(u=>u.kind==='healer'),target=world.state.units.find(u=>u.kind==='infantry');
  world._heal(target,18,source);assert.equal(world.combatSequence,undefined,'full health is not a cast');
  target.hp-=30;
  const control=World.fromSave(world.serialize());control._combatEvent=()=>{};
  world._heal(target,18,source);control._heal(control.getEntity(target.id),18,control.getEntity(source.id));
  assert.deepEqual(world.serialize(),control.serialize());
  assert.equal(world.combatEvents[0].kind,'support');assert.equal(world.combatEvents[0].amount,18);
});

test('conversion support event appears only after actual allegiance changes',()=>{
  const world=new World(),source=world._spawn('wizard',1,35,20),target=world._spawn('infantry',2,36,20);
  assert.equal(world.command('convert',{unitIds:[source.id],targetId:target.id}).ok,true);
  const control=World.fromSave(world.serialize());control._combatEvent=()=>{};
  for(let i=0;i<4;i++){world._combat(source,1);control._combat(control.getEntity(source.id),1);}
  assert.equal(world.combatSequence,undefined);assert.equal(target.team,2);
  world._combat(source,1);control._combat(control.getEntity(source.id),1);
  assert.equal(target.team,1);assert.equal(world.combatEvents[0].kind,'support');
  assert.deepEqual(world.serialize(),control.serialize());
});

test('projectiles meet live moving targets and keep flight/style after source dies',()=>{
  const world=new World(),wizard=world._spawn('wizard',1,35,20),target=world._spawn('infantry',2,39,20),tower=world.state.buildings.find(b=>b.kind==='guildhall');
  const renderer=Object.assign(Object.create(GameRenderer.prototype),{world,projectileVisuals:new Map(),combatPoses:new Map(),stats:{frames:0}});
  const bolt={id:'flight-wizard',kind:'arrow',sourceId:wizard.id,targetId:target.id,x:wizard.x,y:wizard.y,targetX:target.x,targetY:target.y,ttl:.15};
  const arrow={...bolt,id:'flight-tower',sourceId:tower.id};
  const magic=renderer.projectilePose(bolt),before=renderer.projectilePose(arrow);
  world.entities.delete(wizard.id);world.entities.delete(tower.id);
  assert.deepEqual(renderer.projectilePose(bolt),magic,'wizard death cannot turn magic into an arrow');
  assert.deepEqual(renderer.projectilePose(arrow),before,'tower death cannot reset flight progress');
  target.x+=1;target.y+=.5;bolt.ttl=0;
  const arrival=renderer.projectilePose(bolt),point=renderer.project(target.x,target.y);
  assert.equal(arrival.x,point.x);assert.ok(Math.abs(arrival.y-(point.y-24))<1e-9);
});

test('source lost before first paint retains magic through actual attack snapshot',()=>{
  const world=new World(),wizard=world._spawn('wizard',1,35,20),target=world._spawn('infantry',2,39,20);
  const renderer=Object.assign(Object.create(GameRenderer.prototype),{world,projectileVisuals:new Map(),combatPoses:new Map([[wizard.id,{attack:{source:{...wizard}}}]]),stats:{frames:0}});
  world.entities.delete(wizard.id);
  const flight=renderer.projectilePose({id:'late',kind:'arrow',sourceId:wizard.id,targetId:target.id,x:35,y:20,targetX:39,targetY:20,ttl:.1});
  assert.equal(flight.magic,true);assert.equal(flight.color,'#b891ff');
});

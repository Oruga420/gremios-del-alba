import test from 'node:test';
import assert from 'node:assert/strict';
import { World, NAVIGATION_HISTORY_LIMIT } from '../src/game/world.js';
import { createBenchmarkWorld, benchmarkEvidence } from '../scripts/benchmark.mjs';

test('80 accepted thousand-unit orders keep bounded, resumable saves and every active reference',()=>{
  const {world,metadata}=createBenchmarkWorld();
  const ids=world.state.units.filter(unit=>unit.team===1).map(unit=>unit.id);
  const enemyActive=new Map(world.state.units.filter(unit=>unit.team===2).map(unit=>[unit.id,world.state.navigation[unit.navigationIndex]]));
  for(let i=0;i<80;i++){
    assert.equal(world.command('move',{unitIds:ids,x:35+(i%2),y:35}).ok,true);
    assert.ok(world.state.navigation.length<=NAVIGATION_HISTORY_LIMIT);
  }
  for(const unit of world.state.units){
    const record=world.state.navigation[unit.navigationIndex];
    assert.ok(record,`Missing active navigation for ${unit.id}`);
    assert.equal(record.unitId,unit.id);
    assert.equal(record.status,'pending');
    if(unit.team===2)assert.equal(record,enemyActive.get(unit.id),'Compaction must retain every unresolved request');
  }
  const saved=world.serialize(),json=JSON.stringify(saved);
  assert.ok(Buffer.byteLength(json)<5_000_000,'Save must fit comfortably beneath existing limits');
  assert.ok(json.length*2<5_000_000,'UTF16 localStorage payload must remain bounded');
  assert.equal(Object.hasOwn(saved,'initialNavigationRecords'),false);
  const restored=World.fromSave(saved);
  assert.deepEqual(restored.serialize(),saved);
  for(let i=0;i<20;i++){world.tick(.05);restored.tick(.05);}
  assert.deepEqual(restored.serialize(),world.serialize(),'Remapped active references must resume deterministically');
  const evidence=benchmarkEvidence(world,metadata,[1],1,0);
  assert.equal(evidence.unitPaths.length,2000,'Initial benchmark cohort must survive outside production history');
  assert.equal(new Set(evidence.unitPaths.map(record=>record.unitId)).size,2000);
  assert.ok(evidence.unitPaths.filter(record=>record.team===1).every(record=>record.status==='cancelled'),'Superseded cohort must remain explicit, never silently disappear');
});

test('paused fireball finalizes deaths, reservations, refunds and effects before a save',()=>{
  const world=new World(),mage=world._spawn('mage',1,25,25),victim=world._spawn('villager',2,25,26);
  const producer=world._building('barracks',2,26,24,1);world.navigation.rebuild();
  const resourcesBefore={...world.state.teams[2].resources};
  assert.equal(world._command('train',{buildingId:producer.id,kind:'infantry'},2).ok,true);
  assert.equal(world.summary(2).reservedPopulation,1);
  victim.hp=1;producer.hp=1;
  assert.equal(world.command('pause',{paused:true}).ok,true);
  assert.equal(world.command('cast',{unitIds:[mage.id],x:victim.x,y:victim.y,spell:'fireball'}).ok,true);
  assert.equal(world.state.paused,true);
  assert.equal(world.state.time,0);
  assert.equal(world.getEntity(victim.id),undefined);
  assert.equal(world.getEntity(producer.id),undefined);
  assert.equal(world.summary(2).reservedPopulation,0);
  assert.equal(world.summary(2).population,18);
  assert.deepEqual(world.state.teams[2].resources,resourcesBefore);
  assert.equal(world.state.effects.filter(effect=>effect.kind==='death').length,1);
  assert.equal(world.state.effects.filter(effect=>effect.kind==='rubble').length,1);
  const saved=world.serialize(),restored=World.fromSave(saved);
  assert.deepEqual(restored.serialize(),saved);
  const invalid=structuredClone(saved);invalid.units[0].hp=-1;
  assert.throws(()=>World.fromSave(invalid),'Malformed negative HP saves must still reject');
  for(const match of [world,restored]){match.command('pause',{paused:false});match.tick(.05);}
  assert.deepEqual(restored.serialize(),world.serialize());
  assert.equal(world.state.effects.filter(effect=>effect.kind==='death').length,1);
  assert.equal(world.state.effects.filter(effect=>effect.kind==='rubble').length,1);
  assert.deepEqual(world.state.teams[2].resources,resourcesBefore,'No second refund after unpause');
});

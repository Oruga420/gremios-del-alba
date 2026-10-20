import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { TERRAIN } from '../src/game/data.js';

function emptyWorld(terrain=TERRAIN.GRASS){
  const world=new World({mode:'peaceful'});
  world.state.units=[];world.state.buildings=[];world.state.nodes=[];
  world.state.map.terrain.fill(terrain);world._indexes();world.navigation.rebuild();
  return world;
}

test('builders use the reachable west side even when the closest center ring is disconnected',()=>{
  const world=emptyWorld(TERRAIN.CLIFF);
  for(const [x,y] of [[29,30],[30,30],[30,31],[31,30],[31,31],[32,31]])world.state.map.terrain[y*80+x]=TERRAIN.GRASS;
  world.navigation.rebuild();const worker=world._spawn('villager',1,29,30);
  const result=world.command('build',{unitIds:[worker.id],kind:'house',x:30,y:30});
  assert.equal(result.ok,true);
  world.tick(.1);const building=world.getEntity(result.buildingIds[0]);
  assert.ok(building.progress>0,'An adjacent west-side worker must start construction');
  const restored=World.fromSave(world.serialize());
  for(let i=0;i<8;i++){world.tick(2);restored.tick(2);}
  assert.equal(building.progress,1);
  assert.deepEqual(restored.serialize(),world.serialize());
});

test('workers cannot repair a building through a surrounding wall',()=>{
  const world=emptyWorld(),house=world._building('house',1,30,30,1);
  house.hp=100;
  for(let y=29;y<=32;y++)for(let x=29;x<=32;x++)if(x===29||x===32||y===29||y===32)world._building('palisade',1,x,y,1);
  world.navigation.rebuild();const worker=world._spawn('villager',1,28,30);
  assert.equal(world.command('repair',{unitIds:[worker.id],targetId:house.id}).ok,true);
  for(let i=0;i<5;i++)world.tick(1);
  assert.equal(house.hp,100,'A distant ring beyond the wall is not a valid work position');
});

test('gatherers deliver to a reachable depot when the geometrically closest one is disconnected',()=>{
  const world=emptyWorld();
  for(let y=0;y<80;y++)world.state.map.terrain[y*80+20]=TERRAIN.CLIFF;
  world._building('lumber_camp',1,18,10,1);
  const reachable=world._building('lumber_camp',1,34,10,1);
  world.navigation.rebuild();const worker=world._spawn('villager',1,22,10),node=world._node('wood',22.5,11.5,100);
  worker.carry={kind:'wood',amount:20};const before=world.summary().resources.wood;
  assert.equal(world.command('gather',{unitIds:[worker.id],targetId:node.id}).ok,true);
  assert.equal(world._dropoff(worker,'wood')?.id,reachable.id);
  for(let i=0;i<6;i++)world.tick(1);
  assert.ok(world.summary().resources.wood>=before+20);
  assert.equal(worker.order.type,'gather');
});

test('save validation rejects orders the unit role cannot execute',()=>{
  const world=new World(),soldier=world.state.units.find(u=>u.kind==='infantry');
  const node=world.state.nodes.find(n=>n.kind==='wood'),house=world.state.buildings.find(b=>b.team===1&&b.kind==='house');
  for(const order of [
    {type:'gather',targetId:node.id,phase:'gather'},
    {type:'build',targetId:house.id},
    {type:'repair',targetId:house.id},
    {type:'convert',targetId:world.state.units.find(u=>u.team===2).id,conversion:0},
  ]){
    const save=world.serialize(),unit=save.units.find(u=>u.id===soldier.id);
    unit.x=node.x;unit.y=node.y;unit.order=order;
    assert.throws(()=>World.fromSave(save),/Partida guardada inválida/,order.type);
  }
});

test('save validation rejects incompatible gathering targets while ordinary active saves resume',()=>{
  const world=new World({mode:'peaceful'}),worker=world.state.units.find(u=>u.team===1&&u.kind==='villager');
  const wood=world.state.nodes.find(n=>n.kind==='wood'),fish=world.state.nodes.find(n=>n.kind==='fish');
  assert.equal(world.command('gather',{unitIds:[worker.id],targetId:wood.id}).ok,true);
  world.tick(.2);const restored=World.fromSave(world.serialize());
  for(let i=0;i<10;i++){world.tick(.1);restored.tick(.1);}
  assert.deepEqual(restored.serialize(),world.serialize());
  const invalid=world.serialize();invalid.units.find(u=>u.id===worker.id).order={type:'gather',targetId:fish.id,phase:'gather'};
  assert.throws(()=>World.fromSave(invalid),/Partida guardada inválida/);
});

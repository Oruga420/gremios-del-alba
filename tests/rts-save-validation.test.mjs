import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { TERRAIN } from '../src/game/data.js';

function openWorld() {
  const w=new World({mode:'peaceful',seed:20261021});w.state.units=[];w.state.buildings=[];w.state.nodes=[];
  w.state.map.terrain.fill(TERRAIN.GRASS);w._indexes();w.navigation.rebuild();w._ai=()=>{};return w;
}

test('formation, rally and navigation hints reject malformed saves without altering the original',()=>{
  const w=openWorld(),u=w._spawn('villager',1,15,15),hall=w._building('guildhall',1,8,8,1),n=w._node('wood',20.5,15.5,100);
  w.navigation.rebuild();w.command('move',{unitIds:[u.id],x:35,y:35,formation:'line'});w.command('rally',{buildingId:hall.id,targetId:n.id});w.tick(.05);
  const raw=w.serialize();
  for(const mutate of [
    s=>s.units[0].formation='constructor',s=>s.units[0].order.marchSpeed=999,s=>s.units[0].order.anchorX=80,
    s=>s.units[0].order.route=[6400],s=>s.units[0].order.routeCursor=513,s=>s.units[0].order.routeVersion=s.navigationVersion+1,
    s=>s.buildings[0].rally.targetId='b1',s=>s.buildings[0].rally.resource='bitcoin',
    s=>s.navigationFields=[{x:1,y:1,movement:'fly',footprint:null}],s=>s.navigationQueue=Array(2049).fill({x:1,y:1,movement:'land',footprint:null}),
    s=>s.navigationFields=[{x:1,y:1,movement:'land',footprint:{kind:'__proto__',x:1,y:1}}],
    s=>s.navigationFields=[{x:5.2,y:6.3,movement:'land',footprint:null}],
    s=>{s.navigationFields=[{x:5.5,y:6.5,movement:'land',footprint:null}];s.navigationQueue=structuredClone(s.navigationFields);},
    s=>{s.units[0].order.route=[1,640];s.units[0].order.routeVersion=s.navigationVersion;},
  ]){const bad=structuredClone(raw);mutate(bad);assert.throws(()=>World.fromSave(bad));assert.deepEqual(w.serialize(),raw);}
});

test('a save with genuinely deferred routes resumes the same simulation',()=>{
  const w=openWorld();for(let y=0;y<80;y++)if(y!==40)w._building('wall',1,30,y,1);w.navigation.rebuild();
  for(let i=0;i<40;i++){const u=w._spawn('infantry',1,20+i%4,20+Math.floor(i/4));w.command('move',{unitIds:[u.id],x:40+i%8,y:20+Math.floor(i/8)});}
  w.tick(.05);assert.ok(w.state.navigationQueue.length>0,'Fixture must exercise the actual deferred planner');
  const raw=w.serialize(),loaded=World.fromSave(raw);loaded._ai=()=>{};assert.deepEqual(loaded.serialize(),raw);
  for(let i=0;i<300;i++){w.tick(.05);loaded.tick(.05);}assert.deepEqual(loaded.serialize(),w.serialize());
});

test('AI reassignment delivers partial gold rather than converting it to another resource',()=>{
  const w=new World({mode:'peaceful',seed:3}),hall=w.state.buildings.find(b=>b.team===2&&b.kind==='guildhall');
  for(const n of w.state.nodes)if(n.kind!=='wood')n.amount=0;
  const enemy=w.state.units.filter(u=>u.team===2&&u.kind==='villager');
  for(const u of enemy){u.carry={kind:'gold',amount:7};u.order={type:'idle'};u.x=hall.x-.5;u.y=hall.y+.5;}
  w._ai(3.1);const assigned=enemy.find(u=>u.order.type==='gather');assert.ok(assigned);
  const before=w.state.teams[2].resources.gold;w._gather(assigned,.05);
  assert.equal(w.state.teams[2].resources.gold,before+7);assert.deepEqual(assigned.carry,{kind:null,amount:0});
});

test('insufficient formation space reports unreachable members rather than duplicate arrivals',()=>{
  const w=openWorld();for(let i=0;i<8;i++)w._spawn('infantry',1,30,40);
  w.state.map.terrain.fill(TERRAIN.CLIFF);w.state.map.terrain[40*80+30]=TERRAIN.GRASS;w.navigation.rebuild();
  const start=new Map(w.state.units.map(u=>[u.id,{x:u.x,y:u.y}]));
  const result=w.command('move',{unitIds:w.state.units.map(u=>u.id),x:30.5,y:40.5,formation:'box'});
  assert.ok(result.ok);assert.ok(result.unreachableUnitIds.length>0);
  for(let i=0;i<40;i++)w.tick(.05);
  const arrived=w.state.navigation.filter(r=>r.status==='arrived'),unreachable=w.state.navigation.filter(r=>r.status==='unreachable');
  assert.equal(arrived.length+unreachable.length,8);assert.equal(unreachable.length,result.unreachableUnitIds.length);
  for(const id of result.unreachableUnitIds){const u=w.getEntity(id);assert.deepEqual({x:u.x,y:u.y},start.get(id));}
  assert.equal(new Set(arrived.map(r=>`${r.x}:${r.y}`)).size,arrived.length);
});

test('AI cannot create an enemy-farm order that makes its own save invalid',()=>{
  const w=openWorld();for(let i=0;i<4;i++)w._spawn('villager',2,30+i,30);
  w._building('farm',1,36,30,1);w.navigation.rebuild();
  for(const team of Object.values(w.state.teams))for(const key of Object.keys(team.resources))team.resources[key]=0;
  World.prototype._ai.call(w,3.1);
  assert.ok(w.state.units.every(u=>u.order.type!=='gather'));assert.doesNotThrow(()=>World.fromSave(w.serialize()));
});

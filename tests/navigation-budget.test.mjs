import test from 'node:test';
import assert from 'node:assert/strict';
import { Navigation } from '../src/game/navigation.js';
import { TERRAIN } from '../src/game/data.js';

function world(width=40,height=40) {
  return {state:{map:{width,height,terrain:Array(width*height).fill(TERRAIN.GRASS)},buildings:[]}};
}
function cliff(w,x,y) { w.state.map.terrain[y*w.state.map.width+x]=TERRAIN.CLIFF; }
function point(index,width) { return {x:index%width+.5,y:Math.floor(index/width)+.5}; }
function checkRoute(nav,start,destination,result) {
  assert.equal(result.status,'ok');
  assert.equal(result.truncated,false);
  const width=nav.world.state.map.width;
  let previous=Math.floor(start.y)*width+Math.floor(start.x);
  for (const cell of result.cells) {
    const next=point(cell,width),prior=point(previous,width);
    assert.equal(Math.abs(next.x-prior.x)+Math.abs(next.y-prior.y),1);
    assert.equal(nav.walkable(Math.floor(next.x),Math.floor(next.y)),true);
    previous=cell;
  }
  assert.equal(previous,Math.floor(destination.y)*width+Math.floor(destination.x));
}

test('segment traversal rejects blocked endpoints, intervening obstacles and map escape',()=>{
  const w=world(12,12),nav=new Navigation(w);
  assert.equal(nav.segmentClear(.5,.5,11.5,11.5),true);
  cliff(w,4,4);
  assert.equal(nav.segmentClear(4.5,4.5,5.5,5.5),false);
  assert.equal(nav.segmentClear(.5,.5,4.5,4.5),false);
  assert.equal(nav.segmentClear(.5,.5,11.5,11.5),false);
  assert.equal(nav.segmentClear(.5,.5,-.1,.5),false);
  assert.equal(nav.segmentClear(.5,.5,12,.5),false);
  assert.equal(nav.segmentClear(.5,.5,NaN,.5),false);
  assert.equal(nav.segmentClear(.5,.5,.5,.5),true);
  for (const ends of [[2,1,1,2],[1,2,2,1],[2,2,1,1],[1,1,2,2],[2,1,1,1]]) assert.equal(nav.segmentClear(...ends),true,`grid-boundary endpoint ${ends}`);
});

test('segment traversal prevents diagonal corner cutting in both directions',()=>{
  for (const blocked of [[1,0],[0,1],[4,1]]) {
    const w=world(12,12),nav=new Navigation(w);
    cliff(w,...blocked);
    const from=[.5,.5],to=blocked[0]===4?[9.5,3.5]:[1.5,1.5];
    assert.equal(nav.segmentClear(...from,...to),false,`forward corner ${blocked}`);
    assert.equal(nav.segmentClear(...to,...from),false,`reverse corner ${blocked}`);
  }
});

test('shared parent tree routes around a wall between arbitrary walkable points',()=>{
  const w=world(12,10);
  for (let y=0;y<9;y++) cliff(w,5,y);
  const nav=new Navigation(w),anchor={x:10.5,y:1.5},field=nav.field(anchor.x,anchor.y);
  assert.ok(field.parent instanceof Int32Array);
  const start={x:1.5,y:1.5},destination={x:8.5,y:3.5};
  const before=nav.stats.builtTotal;
  checkRoute(nav,start,destination,nav.route(start,destination,field));
  checkRoute(nav,destination,start,nav.route(destination,start,field));
  assert.equal(nav.stats.builtTotal,before);
  const short=nav.route(start,destination,field,3);
  assert.equal(short.status,'ok');assert.equal(short.cells.length,3);assert.equal(short.truncated,true);
  assert.deepEqual(nav.route(start,start,field),{status:'ok',cells:[],truncated:false});
  assert.equal(nav.route(start,{x:5.5,y:2.5},field).status,'unreachable');
  nav.rebuild();
  assert.equal(nav.route(start,destination,field).status,'unreachable');
});

test('one thousand distinct goals build at most eight fields per tick and retain FIFO fairness',()=>{
  const w=world(32,32),nav=new Navigation(w);
  nav.beginStep();
  for (let index=0;index<1000;index++) {
    const target=point(index,32),field=nav.field(target.x,target.y);
    assert.equal(field===undefined,index>=8);
  }
  assert.equal(nav.stats.builtThisStep,8);
  assert.equal(nav.stats.builtTotal,8);
  assert.equal(w.state.navigationQueue.length,992);
  const oldest=w.state.navigationQueue.slice(0,4);
  for (let index=0;index<8;index++) { const target=point(index,32);assert.ok(nav.field(target.x,target.y)); }
  assert.equal(nav.stats.builtThisStep,8,'cached hits must be free');
  nav.endStep();
  nav.beginStep();
  for (const target of oldest) assert.ok(nav.field(target.x,target.y));
  assert.equal(nav.stats.builtThisStep,4);
  assert.deepEqual(w.state.navigationQueue[0],{...point(12,32),movement:'land',footprint:null});
  assert.equal(nav.stats.maxBuiltPerStep,8);
  assert.ok(nav.stats.deferredTotal>=992);
  nav.endStep();
});

test('queued descriptors and insertion-ordered cache survive deterministic save restoration',()=>{
  const original=world(32,32),nav=new Navigation(original);
  nav.beginStep();
  for (let index=0;index<24;index++) { const target=point(index,32);nav.field(target.x,target.y); }
  nav.endStep();
  const saved=JSON.parse(JSON.stringify(original.state)),restored={state:saved},other=new Navigation(restored);
  assert.deepEqual(restored.state,original.state);
  assert.deepEqual([...other.fields.keys()],[...nav.fields.keys()]);
  for (const [key,value] of nav.fields) {
    assert.deepEqual(other.fields.get(key).parent,value.parent);
    assert.deepEqual(other.fields.get(key).distance,value.distance);
  }
  for (let tick=0;tick<8;tick++) {
    nav.beginStep();other.beginStep();
    for (let index=0;index<40;index++) {
      const target=point(index,32),a=nav.field(target.x,target.y),b=other.field(target.x,target.y);
      assert.equal(a?.key,b?.key);
      assert.equal(a===undefined,b===undefined);
      assert.equal(a===null,b===null);
    }
    nav.endStep();other.endStep();
    assert.deepEqual(restored.state,original.state);
    assert.ok(nav.stats.builtThisStep<=8);assert.ok(other.stats.builtThisStep<=8);
  }
});

test('legacy empty construction does not add descriptors; geometry invalidates all derived work',()=>{
  const w=world(10,10),nav=new Navigation(w);
  assert.equal(Object.hasOwn(w.state,'navigationFields'),false);
  assert.equal(Object.hasOwn(w.state,'navigationQueue'),false);
  nav.beginStep(0);assert.equal(nav.field(3.2,4.8),undefined);nav.endStep();
  assert.deepEqual(w.state.navigationQueue,[{x:3.5,y:4.5,movement:'land',footprint:null}]);
  nav.rebuild();
  assert.deepEqual(w.state.navigationFields,[]);assert.deepEqual(w.state.navigationQueue,[]);
  assert.equal(nav.pending.size,0);assert.equal(nav.fields.size,0);
  w.state.map.terrain.fill(TERRAIN.WATER);
  nav.beginStep(0);assert.equal(nav.field(5,5),null);nav.endStep();
  assert.equal(nav.pending.size,0,'truly unreachable targets do not wait for budget');
});

test('legacy off-map field searches still find every nearest edge goal without saving invalid descriptors',()=>{
  const w=world(10,10),nav=new Navigation(w),field=nav.field(-1,2);
  assert.ok(field);
  for (const row of [1,2,3]) assert.equal(field.distance[row*10],0);
  assert.equal(nav.field(-20,2),null);
  assert.equal(Object.hasOwn(w.state,'navigationFields'),false);
});

test('restoration rejects saved fields and queued requests whose goals disappeared',()=>{
  const descriptor={x:4.5,y:4.5,movement:'land',footprint:null};
  for (const slot of ['navigationFields','navigationQueue']) {
    const w=world(8,8);
    w.state.map.terrain.fill(TERRAIN.WATER);
    w.state[slot]=[{...descriptor}];
    assert.throws(()=>new Navigation(w),/has no reachable goals/,slot);
  }
  const duplicate=world(8,8);
  duplicate.state.navigationFields=[{...descriptor}];
  duplicate.state.navigationQueue=[{...descriptor}];
  assert.throws(()=>new Navigation(duplicate),/Invalid saved navigation queue descriptor/);
  const outside=world(8,8);
  outside.state.navigationFields=[{...descriptor,x:8.5}];
  assert.throws(()=>new Navigation(outside),/Invalid saved navigation field descriptor/);
});

test('cache and pending queue retain hard bounds under dispersed targets',()=>{
  const w=world(48,48),nav=new Navigation(w);
  for (let index=0;index<140;index++) { const target=point(index,48);nav.field(target.x,target.y); }
  assert.equal(nav.queryCache.size,128);assert.equal(nav.fields.size,0);
  assert.equal(Object.hasOwn(w.state,'navigationFields'),false);
  for (let start=0;start<140;start+=8) {
    nav.beginStep();
    for (let index=start;index<Math.min(start+8,140);index++) { const target=point(index,48);assert.ok(nav.field(target.x,target.y)); }
    nav.endStep();
  }
  assert.equal(nav.fields.size,128);assert.equal(w.state.navigationFields.length,128);
  assert.equal(w.state.navigationFields[0].x,point(12,48).x);
  nav.beginStep(0);
  for (let index=140;index<2304;index++) { const target=point(index,48);assert.equal(nav.field(target.x,target.y),undefined); }
  nav.endStep();
  assert.equal(nav.pending.size,2048);assert.equal(w.state.navigationQueue.length,2048);
});

test('off-step probes leave serialized gameplay state and persistent cache unchanged',()=>{
  const w=world(32,32),nav=new Navigation(w),before=JSON.stringify(w.state);
  nav.field(3.2,4.8);nav.field(7.5,8.5);
  assert.equal(JSON.stringify(w.state),before);
  assert.equal(nav.fields.size,0);assert.equal(nav.queryCache.size,2);
  nav.beginStep();nav.field(3.5,4.5);nav.endStep();
  const warmed=JSON.stringify(w.state),keys=[...nav.fields.keys()];
  for (let index=0;index<200;index++) { const target=point(index,32);nav.field(target.x,target.y); }
  assert.equal(JSON.stringify(w.state),warmed);
  assert.deepEqual([...nav.fields.keys()],keys,'queries must never evict persistent fields');
});

test('warm probe promotion consumes admission budget and matches a cold save restore',()=>{
  const warmWorld=world(32,32),warm=new Navigation(warmWorld);
  const coldWorld={state:JSON.parse(JSON.stringify(warmWorld.state))},cold=new Navigation(coldWorld);
  for (let index=0;index<40;index++) { const target=point(index,32);warm.field(target.x,target.y); }
  assert.deepEqual(warmWorld.state,coldWorld.state);
  for (let tick=0;tick<5;tick++) {
    warm.beginStep();cold.beginStep();
    for (let index=0;index<40;index++) {
      const target=point(index,32),a=warm.field(target.x,target.y),b=cold.field(target.x,target.y);
      assert.equal(a===undefined,b===undefined);
      assert.equal(a?.key,b?.key);
    }
    warm.endStep();cold.endStep();
    assert.deepEqual(warmWorld.state,coldWorld.state);
    assert.ok(warm.stepUsed<=8);assert.ok(cold.stepUsed<=8);
    if (tick===0) {
      assert.equal(warm.stats.builtThisStep,0,'promotions reuse already computed arrays');
      assert.equal(cold.stats.builtThisStep,8,'cold admission builds the same eight goals');
    }
  }
  assert.equal(warm.stats.builtTotal,40,'promotion avoids duplicate physical builds');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { TERRAIN } from '../src/game/data.js';
import { scenarios } from './world-scenarios.mjs';
test('allten maps have actual worker/dropoff/conquest and boat connectivity',scenarios.GAME12);
test('A* terminates within bounded expansions and never cuts obstacle corners',()=>{const w=new World({mapId:'llanuras-de-otono',mode:'peaceful'});for(let y=0;y<80;y++)w.state.map.terrain[y*80+40]=TERRAIN.CLIFF;w.navigation.rebuild();const result=w.navigation.path({x:35,y:35},{x:45,y:35});assert.equal(result.status,'unreachable');assert.ok(result.expanded<=6400);assert.equal(w.navigation.path({x:35,y:35},{x:39,y:65},'land',2).status,'budget_exceeded');const u=w.state.units.find(e=>e.team===1);u.x=35.5;u.y=35.5;assert.ok(w.command('move',{unitIds:[u.id],x:45,y:35}).ok);w.tick(.05);assert.equal(w.state.navigation.at(-1).status,'unreachable');assert.equal(u.x,35.5);assert.equal(u.y,35.5);});

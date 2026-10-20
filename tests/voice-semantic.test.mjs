import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World } from '../src/game/world.js';
import { BUILDINGS, MAPS, UNITS } from '../src/game/data.js';
import { createVoiceRegistry, exportRegistry } from '../src/voice/registry.js';
import { parseSpanishCommand } from '../src/voice/spanish.js';
import { completeBuilding, prepared, plot, step } from './world-scenarios.mjs';

function harness(world = prepared({ mode: 'conquest' })) {
  const calls = [];
  const game = { world, selectedIds: [], worldGeneration: 1,
    execute(type, args) { calls.push({ type, args }); return world.command(type, args); },
    select(ids) { this.selectedIds = ids; } };
  const registry = createVoiceRegistry(game);
  const text = value => { const parsed = parseSpanishCommand(value, { game }); return parsed.error || registry.runTool(parsed.name, parsed.input); };
  return { game, registry, text, calls, world };
}

test('SEM01 house with no coordinates or selected builder is paid once and actually completes on all ten maps', () => {
  for (const map of MAPS) {
    const h = harness(new World({ mapId: map.id, mode: 'peaceful' }));
    const before = h.world.summary().resources.wood;
    assert.equal(h.text('Construye una casa').code, 'EXECUTED', map.id);
    const building = h.world.state.buildings.at(-1);
    assert.equal(building.kind, 'house');
    assert.equal(h.world.summary().resources.wood, before - BUILDINGS.house.cost.wood);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].args.unitIds.length, 1);
    assert.equal(h.registry.confirm.pending, false);
    assert.equal(h.world.state.paused, false);
    step(h.world, 50);
    assert.equal(building.progress, 1, map.id);
  }
});

test('SEM02 selected compatible builder wins, otherwise an idle builder is chosen without stealing military selection', () => {
  const h = harness(), workers = h.world.state.units.filter(u => u.team === 1 && u.kind === 'villager');
  workers[0].order = { type: 'move', x: 30, y: 30 };
  h.game.select([h.world.state.units.find(u => u.team === 1 && u.kind === 'infantry').id]);
  assert.equal(h.text('Construye casa').ok, true);
  assert.notEqual(h.calls.at(-1).args.unitIds[0], workers[0].id);
  h.game.select([workers[0].id]);
  assert.equal(h.text('Construye casa').ok, true);
  assert.deepEqual(h.calls.at(-1).args.unitIds, [workers[0].id]);
});

test('SEM03 relative placement uses the real barracks and behind points away from the enemy base', () => {
  const h = harness(), barracks = h.world.state.buildings.find(b => b.team === 1 && b.kind === 'barracks');
  assert.equal(h.text('Construye una casa detrás del cuartel').code, 'EXECUTED');
  const house = h.world.state.buildings.at(-1);
  assert.ok(house.x + 1 < barracks.x + 1.5 || house.y + 1 < barracks.y + 1.5);
  assert.ok(Math.hypot(house.x - barracks.x, house.y - barracks.y) < 14);
  assert.equal(h.text('Construye casa al lado del cuartel').code, 'EXECUTED');
  assert.ok(Math.hypot(h.world.state.buildings.at(-1).x - barracks.x, h.world.state.buildings.at(-1).y - barracks.y) < 8);
  for(const phrase of ['junto al cuartel','frente al cuartel','junto al centro urbano']) {
    const fresh=harness();assert.equal(fresh.text(`Construye casa ${phrase}`).code,'EXECUTED',phrase);
  }
});

test('SEM04 natural walls find seven legal segments toward each requested direction and default toward enemy', () => {
  for (const direction of ['norte', 'sur', 'este', 'oeste', '']) {
    const h = harness(), count = h.world.state.buildings.length, before = h.world.summary().resources.wood;
    assert.equal(h.text(`Construye empalizada${direction ? ` al ${direction}` : ''}`).code, 'EXECUTED', direction);
    const built = h.world.state.buildings.slice(count), x = built.reduce((sum,b)=>sum+b.x,0)/7, y=built.reduce((sum,b)=>sum+b.y,0)/7;
    assert.equal(built.length, 7);
    assert.equal(h.world.summary().resources.wood, before - 7 * BUILDINGS.palisade.cost.wood);
    if(direction==='norte')assert.ok(y<10); if(direction==='sur')assert.ok(y>10);
    if(direction==='este')assert.ok(x>10); if(direction==='oeste')assert.ok(x<10);
  }
});

test('SEM05 impossible local plots and missing builders produce no command or spending', () => {
  const h = harness(), before = h.world.serialize();
  h.world.canPlace = () => false;
  assert.equal(h.text('Construye casa').code, 'NO_LEGAL_PLACEMENT');
  assert.deepEqual(h.world.serialize(), before); assert.equal(h.calls.length, 0);
  const none = harness(); for(const u of none.world.state.units)if(u.team===1&&u.kind==='villager')u.hp=0;
  assert.equal(none.text('Construye casa').code, 'NO_UNITS'); assert.equal(none.calls.length,0);
});

test('SEM06 partial coordinates cannot silently become auto placements and explicit coordinates still work', () => {
  const h = harness(), before = h.world.serialize();
  for(const [name,input] of [['propose_build',{kind:'house',x:20}],['propose_move',{x:20}],['propose_cast',{spell:'heal',y:20}],['propose_wall',{kind:'wall',x:20,y:20}],['propose_wall',{kind:'wall',endX:20}]]) {
    assert.equal(h.registry.runTool(name,input).code,'POSITION_REQUIRED',name);
  }
  assert.deepEqual(h.world.serialize(),before);
  const point=plot(h.world,'house');
  assert.equal(h.registry.runTool('propose_build',{kind:'house',target:'Luna',...point}).code,'EXECUTED');
  assert.deepEqual({x:h.world.state.buildings.at(-1).x,y:h.world.state.buildings.at(-1).y},point);
});

test('SEM07 move resolves enemy base, home, selected villagers and the nearest reachable real forest', () => {
  const h=harness(),luna=h.world.state.units.find(u=>u.name==='Luna'),enemy=h.world.state.buildings.find(b=>b.team===2&&b.kind==='guildhall');
  assert.equal(h.text('Mueve los soldados a la base enemiga').ok,true);
  assert.equal(h.calls.at(-1).args.x,enemy.x+2);
  h.game.select([luna.id]);assert.equal(h.text('Regresa a casa').ok,true);
  assert.deepEqual(h.calls.at(-1).args.unitIds,[luna.id]);assert.equal(luna.order.x,10);
  assert.equal(h.text('Luna ve al bosque más cercano').ok,true);
  const nodes=h.world.state.nodes.filter(n=>n.kind==='wood'&&n.amount>0).sort((a,b)=>Math.hypot(a.x-luna.x,a.y-luna.y)-Math.hypot(b.x-luna.x,b.y-luna.y));
  assert.equal(luna.order.x,nodes[0].x);assert.equal(luna.order.y,nodes[0].y);
});

test('SEM08 semantic attack chooses own military and enemy hall without ambiguous type or ID prompts', () => {
  const h=harness(),enemy=h.world.state.buildings.find(b=>b.team===2&&b.kind==='guildhall');
  assert.equal(h.text('Ataca la base enemiga').ok,true);
  assert.equal(h.calls.at(-1).args.targetId,enemy.id);
  for(const id of h.calls.at(-1).args.unitIds){const u=h.world.getEntity(id);assert.equal(u.team,1);assert.notEqual(UNITS[u.kind].role,'worker');assert.notEqual(u.kind,'healer');}
  const knight=h.world.state.units.find(u=>u.team===1&&u.kind==='heavy_knight'),near=h.world._spawn('infantry',2,knight.x+2,knight.y);
  assert.equal(h.registry.runTool('propose_attack',{target:'caballero pesado',enemy:'enemigo más cercano'}).ok,true);
  assert.equal(knight.order.targetId,near.id);
  assert.equal(h.registry.runTool('propose_attack',{target:'Luna',enemy:'mi base'}).ok,false);
});

test('SEM09 gather forest without worker selection and heal wounded use real units and engine validation', () => {
  const h=harness();assert.equal(h.text('Recoge madera del bosque más cercano').ok,true);
  const healer=h.world.state.units.find(u=>u.team===1&&u.kind==='healer'),ally=h.world._spawn('infantry',1,healer.x+1,healer.y);ally.hp-=30;
  const hp=ally.hp,mana=healer.mana;
  assert.equal(h.text('Cura a los heridos').code,'EXECUTED');assert.ok(ally.hp>hp);assert.equal(healer.mana,mana-35);
  const after=healer.mana;assert.equal(h.text('Cura a los heridos').ok,false);assert.equal(healer.mana,after);
});

test('SEM10 least-busy completed producer chosen by default or generic type; explicit selected producer honored', () => {
  const h=harness(),first=h.world.state.buildings.find(b=>b.team===1&&b.kind==='archery'),second=completeBuilding(h.world,'archery');
  assert.equal(h.registry.runTool('propose_train',{kind:'archer',quantity:1,building:first.id}).ok,true);
  assert.equal(h.text('Entrena un arquero').ok,true);assert.equal(h.calls.at(-1).args.buildingId,second.id);
  assert.equal(h.registry.runTool('propose_train',{kind:'archer',quantity:1,building:first.id}).ok,true);
  assert.equal(h.registry.runTool('propose_train',{kind:'archer',quantity:1,building:'arquería'}).ok,true);assert.equal(h.calls.at(-1).args.buildingId,second.id);
  h.game.select([first.id]);assert.equal(h.text('Entrena un arquero').ok,true);assert.equal(h.calls.at(-1).args.buildingId,first.id);
});

test('SEM11 affordability, cap, ownership and unknown landmarks cannot bypass the authoritative command', () => {
  const h=harness();h.world.state.teams[1].resources.wood=0;const before=h.world.serialize();
  assert.equal(h.text('Construye casa').code,'ENGINE_REJECTED');assert.deepEqual(h.world.serialize(),before);
  assert.equal(h.text('Construye casa detrás del castillo imaginario').ok,false);
  assert.equal(h.registry.runTool('propose_build',{kind:'house',target:h.world.state.units.find(u=>u.team===2).id}).ok,false);
  const hall=h.world.state.buildings.find(b=>b.team===1&&b.kind==='guildhall');
  while(h.world.summary().population<h.world.summary().capacity)h.world._spawn('villager',1,12,14);
  assert.equal(h.registry.runTool('propose_train',{kind:'villager',quantity:1}).code,'ENGINE_REJECTED');assert.equal(hall.queue.length,0);
});

test('SEM12 exact 36 tool inventory parity and semantic keys remain available to cloud and native adapters', () => {
  const tools=exportRegistry();assert.equal(tools.length,36);assert.deepEqual(JSON.parse(fs.readFileSync(new URL('../docs/voice/clickables.json',import.meta.url),'utf8')).tools,tools);
  for(const name of ['propose_build','propose_wall','propose_move','propose_cast']){const schema=tools.find(t=>t.name===name).inputSchema;assert.equal(schema.required.includes('x'),false);assert.equal(schema.required.includes('y'),false);}
});

test('SEM13 distant wounded trigger truthful approach with no mana charge, followed by actual passive healing', () => {
  const h=harness(),healer=h.world.state.units.find(u=>u.team===1&&u.kind==='healer');
  const ally=h.world._spawn('infantry',1,30,20);ally.hp-=40;
  const mana=healer.mana,hp=ally.hp;
  const response=h.text('Cura a los heridos');
  assert.equal(response.code,'EXECUTED');assert.equal(response.speak,'Sanadores en camino.');
  assert.equal(h.calls.at(-1).type,'move');assert.equal(healer.mana,mana);assert.equal(ally.hp,hp);
  step(h.world,20);assert.ok(ally.hp>hp);
});

test('SEM14 semantic destinations skip unreachable resources and reject unreachable bases without inventing coordinates', () => {
  const h=harness(),luna=h.world.state.units.find(u=>u.name==='Luna');
  for(let y=0;y<80;y++)h.world._building('wall',1,22,y,1);
  h.world.navigation.rebuild();
  const unreachable=h.world._node('wood',23,luna.y,1000);
  for(const n of h.world.state.nodes)if(n.kind==='wood'&&n.id!==unreachable.id)n.amount=0;
  const resource=h.world._node('wood',4,30,1000);
  assert.equal(h.text('Luna recoge madera').ok,true);assert.equal(luna.order.targetId,resource.id);
  const before=h.world.serialize();assert.equal(h.text('Luna ve a la base enemiga').code,'UNREACHABLE_TARGET');assert.deepEqual(h.world.serialize(),before);
  for(const b of h.world.state.buildings)if(b.team===1&&b.kind==='guildhall')b.hp=0;
  assert.equal(h.text('Construye casa').code,'TARGET_NOT_FOUND');
});

test('SEM15 named directional landmarks use that real landmark and fireball destinations retain range validation', () => {
  const h=harness(),barracks=h.world.state.buildings.find(b=>b.team===1&&b.kind==='barracks');
  assert.equal(h.text('Construye empalizada al sur del cuartel').code,'EXECUTED');
  const args=h.calls.at(-1).args;assert.ok((args.x+args.endX)/2>=barracks.x-2);
  assert.ok((args.y+args.endY)/2>barracks.y+6);
  const parsed=parseSpanishCommand('Magos lancen bola de fuego a la base enemiga',{game:h.game});
  assert.deepEqual(parsed,{name:'propose_cast',input:{spell:'fireball',destination:'la base enemiga',target:'Magos'}});
  const mana=h.world.state.units.find(u=>u.team===1&&u.kind==='mage').mana;
  assert.equal(h.registry.runTool(parsed.name,parsed.input).code,'ENGINE_REJECTED');
  assert.equal(h.world.state.units.find(u=>u.team===1&&u.kind==='mage').mana,mana);
  const mage=h.world.state.units.find(u=>u.team===1&&u.kind==='mage'),enemy=h.world._spawn('infantry',2,mage.x+1,mage.y),hp=enemy.hp;
  assert.equal(h.text('Magos lancen bola de fuego al enemigo más cercano').code,'EXECUTED');assert.ok(enemy.hp<hp);
});

test('SEM16 manual wall endpoints and unknown relational landmarks fail without automatic substitution', () => {
  const h=harness(),before=h.world.serialize();
  assert.equal(h.text('Construye una muralla desde 20, 20').ok,false);
  assert.equal(h.text('Construye casa junto al edificio inexistente').code,'TARGET_NOT_FOUND');
  assert.equal(h.text('Construye empalizada al norte del edificio inexistente').code,'TARGET_NOT_FOUND');
  assert.deepEqual(h.world.serialize(),before);
});

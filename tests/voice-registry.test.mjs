import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { World } from '../src/game/world.js';
import { BUILDINGS, UNITS } from '../src/game/data.js';
import { createVoiceRegistry, exportRegistry } from '../src/voice/registry.js';
import { parseSpanishCommand } from '../src/voice/spanish.js';
import { schemaDescriptions, vendorSchema } from '../src/voice/schema.js';
import { exportPersonalDefinition } from '../scripts/personal-voice.mjs';
import { prepared, completeBuilding, plot, step } from './world-scenarios.mjs';

function harness(options = {}) {
  let now = 1000, saved;
  const groups = new Map(); const cameraCalls = [];
  const game = { world: options.prepared ? prepared({ mode:options.mode||'peaceful' }) : new World({ mode:options.mode||'peaceful' }), worldGeneration:1, selectedIds:[], renderer:{ centerOn(...args) {cameraCalls.push(['center',...args]);},pan(...args){cameraCalls.push(['pan',...args]);},zoomAt(...args){cameraCalls.push(['zoom',...args]);}},
    execute(type,args){return this.world.command(type,args);},select(ids){this.selectedIds=[...new Set(ids)];},newMatch(args){this.world=new World(args);this.worldGeneration++;return {ok:true};},load(raw){this.world=World.fromSave(raw);this.worldGeneration++;return {ok:true};},save(){saved=this.world.serialize();return {ok:true};},view(action,args={}){if(action==='assign-group')groups.set(args.group,[...this.selectedIds]);if(action==='recall-group')this.select(groups.get(args.group)||[]);return {ok:true};},openPanel(){},announce(){} };
  const registry = createVoiceRegistry(game,{confirmationMode:'confirmed',confirmOptions:{now:()=>now}});
  function confirm(value) { assert.equal(value.code,'PROPOSED',value.speak); assert.equal(registry.runTool('confirm_action',{proposalId:value.data.proposalId,confirmationText:'confirma'}).code,'ARMED'); registry.confirm.speechEnded(value.data); now+=4000;registry.confirm.tick(); assert.equal(registry.confirm.state,'done',registry.confirm.getState()?.result?.speak); return registry.confirm.getState(); }
  function text(command) { const parsed=parseSpanishCommand(command,{game,confirm:registry.confirm,mode:registry.mode});return parsed.error||registry.runTool(parsed.name,parsed.input); }
  return {game,registry,confirm,text,cameraCalls,get saved(){return saved;},advance(ms){now+=ms;return registry.confirm.tick();}};
}
test('VOICE01 exact inventory names, schemas, descriptions, commander gate and vendor schemas match', async()=>{
  const inventory=JSON.parse(await readFile(new URL('../docs/voice/clickables.json',import.meta.url),'utf8')),tools=exportRegistry();assert.equal(tools.length,36);assert.deepEqual(tools,inventory.tools);assert.deepEqual([...new Set(inventory.rows.map(row=>row.voiceTool).filter(Boolean))].sort(),tools.map(tool=>tool.name).sort());
  for(const tool of tools){assert.deepEqual(schemaDescriptions(tool.inputSchema),[]);assert.deepEqual(tool.allowedRoles,['commander']);assert.equal(tool.annotations.consequentialHint,tool.kind==='consequential');}
  const vendor=(await exportPersonalDefinition()).conversation_config.agent.prompt.tools;assert.deepEqual(vendor.map(tool=>tool.name),tools.map(tool=>tool.name));for(let i=0;i<tools.length;i++)assert.deepEqual(vendor[i].parameters,vendorSchema(tools[i].inputSchema));
  const h=harness();assert.equal(h.registry.runTool('read_city',{}, {role:'spectator'}).code,'ROLE_REJECTED');assert.equal(h.registry.runTool('propose_train',{kind:'archer',quantity:1,team:2}).code,'INVALID_INPUT');assert.equal(h.registry.runTool('eval',{code:'x'}).code,'UNKNOWN_TOOL');
});
test('VOICE02 named/role selections, English aliases, bounded roles/read and immediate camera/groups work',()=>{
  const h=harness();assert.equal(h.text('Selecciona a Luna').code,'SELECTED');assert.equal(h.game.world.getEntity(h.game.selectedIds[0]).name,'Luna');
  for(const alias of ['heavy knight','archer','mage','healer']){assert.equal(h.registry.runTool('select_units',{target:alias}).ok,true);assert.equal(h.game.selectedIds.length,1);}
  assert.equal(h.registry.runTool('read_roles').data.find(role=>role.kind==='heavy_knight').count,1);assert.ok(h.registry.runTool('read_residents',{limit:20}).data.length<=20);
  h.registry.runTool('control_group',{action:'assign',group:2});h.game.select([]);h.registry.runTool('control_group',{action:'recall',group:2});assert.equal(h.game.selectedIds.length,1);
  assert.equal(h.registry.runTool('camera_view',{action:'center',target:'Luna'}).ok,true);assert.equal(h.cameraCalls[0][0],'center');assert.equal(h.game.world.state.paused,false);
});
test('VOICE03 rename freezes exact identity, rejects duplicate/ambiguous names and waits for confirmation',()=>{
  const h=harness();const luna=h.game.world.state.units.find(unit=>unit.name==='Luna');const proposed=h.text('Cambia el nombre de Luna a Aurora');assert.equal(luna.name,'Luna');assert.equal(h.game.world.state.paused,true);h.confirm(proposed);assert.equal(luna.name,'Aurora');assert.equal(h.game.world.state.paused,false);
  assert.equal(h.text('Cambia el nombre de Bruno a Teo').code,'ENGINE_REJECTED');
  const another=h.game.world.state.units.find(unit=>unit.team===1&&unit.id!==luna.id);another.name='Aurora';assert.equal(h.registry.runTool('select_units',{target:'Aurora'}).code,'AMBIGUOUS_NAME');
  another.name='La Luna';assert.equal(h.registry.runTool('select_units',{target:'La Luna'}).data.ids[0],another.id);
});
test('VOICE04 Spanish gather does not mutate until confirm; real gather/carry/deposit follows',()=>{
  const h=harness();const luna=h.game.world.state.units.find(unit=>unit.name==='Luna'),wood=h.game.world.summary().resources.wood;
  const proposal=h.text('Luna recoge madera');assert.equal(luna.order.type,'idle');assert.equal(h.game.world.summary().resources.wood,wood);h.confirm(proposal);assert.equal(luna.order.type,'gather');step(h.game.world,50);assert.ok(h.game.world.summary().resources.wood>wood);assert.ok(h.game.world.state.metrics.gatherCycles>0);
});
test('VOICE05 training reserves/spends exactly once, stop prevents charge, unaffordable execution revalidates',()=>{
  const h=harness();const before={...h.game.world.summary().resources};const proposal=h.text('Entrena cinco arqueros');assert.equal(h.game.world.summary().reservedPopulation,0);h.registry.runTool('stop_action');assert.deepEqual(h.game.world.summary().resources,before);
  h.confirm(h.text('Entrena cinco arqueros'));assert.equal(h.game.world.summary().reservedPopulation,5);assert.equal(h.game.world.summary().resources.gold,before.gold-200);h.advance(10_000);assert.equal(h.game.world.summary().reservedPopulation,5);
  const second=h.registry.runTool('propose_train',{kind:'villager',quantity:1});assert.equal(second.code,'PROPOSED');h.game.world.state.teams[1].resources.food=0;h.registry.runTool('confirm_action',{proposalId:second.data.proposalId,confirmationText:'sí'});h.registry.confirm.speechEnded(second.data);h.advance(4000);assert.equal(h.registry.confirm.state,'failed');assert.equal(h.game.world.summary().reservedPopulation,5);assert.equal(h.game.world.state.paused,false);
});
test('VOICE06 building and wall proposals have exact coordinates/cost and produce real geometry',()=>{
  const h=harness({prepared:true}),p=plot(h.game.world,'house'),count=h.game.world.state.buildings.length,wood=h.game.world.summary().resources.wood;
  h.confirm(h.registry.runTool('propose_build',{target:'Luna',kind:'house',...p}));assert.equal(h.game.world.state.buildings.length,count+1);assert.equal(h.game.world.summary().resources.wood,wood-BUILDINGS.house.cost.wood);
  const wall=h.registry.runTool('propose_wall',{target:'constructores',kind:'wall',x:30,y:22,endX:33,endY:22});assert.match(wall.speak,/4 segmentos/u);const stone=h.game.world.summary().resources.stone;h.confirm(wall);assert.equal(h.game.world.summary().resources.stone,stone-80);assert.equal(h.game.world.state.buildings.filter(building=>building.kind==='wall'&&building.y===22).length,4);
});
test('VOICE07 attack/defend/heal/fireball/convert tools reach actual engine state',()=>{
  const h=harness({prepared:true,mode:'conquest'});const own=h.game.world.state.units.filter(unit=>unit.team===1),knight=own.find(unit=>unit.kind==='heavy_knight'),mage=own.find(unit=>unit.kind==='mage'),healer=own.find(unit=>unit.kind==='healer'),ally=own.find(unit=>unit.kind==='villager'),enemy=h.game.world.state.units.find(unit=>unit.team===2);
  h.confirm(h.registry.runTool('propose_attack',{target:'heavy knight',enemy:enemy.id}));assert.equal(knight.order.targetId,enemy.id);
  const gate=completeBuilding(h.game.world,'gate');h.confirm(h.registry.runTool('propose_defend',{target:'caballeros pesados',anchor:gate.id}));assert.equal(knight.order.type,'defend');assert.equal(knight.order.x,gate.x);
  ally.x=healer.x+.3;ally.y=healer.y;ally.hp=10;h.confirm(h.text('Curanderos, sanen a los heridos'));assert.ok(ally.hp>10);assert.equal(healer.mana,65);
  enemy.x=mage.x+1;enemy.y=mage.y;const hp=enemy.hp;h.confirm(h.registry.runTool('propose_cast',{target:'mage',spell:'fireball',x:enemy.x,y:enemy.y}));assert.ok(enemy.hp<hp);assert.equal(mage.mana,65);
  const wizard=h.game.world._spawn('wizard',1,enemy.x-1,enemy.y);h.confirm(h.registry.runTool('propose_convert',{target:wizard.id,enemy:enemy.id}));assert.equal(wizard.order.type,'convert');
});
test('VOICE08 age/upgrades/trade/queue/gate/rally/repair mutations use confirmed commands',()=>{
  const h=harness({prepared:true}),world=h.game.world,forge=completeBuilding(world,'forge'),market=completeBuilding(world,'market'),gate=completeBuilding(world,'gate'),hall=world.state.buildings.find(building=>building.team===1&&building.kind==='guildhall');
  h.confirm(h.registry.runTool('propose_research',{technologyId:'forging',building:forge.id}));assert.ok(forge.queue.some(entry=>entry.kind==='forging'));step(world,13);assert.equal(world.state.teams[1].upgrades.forging,true);
  const gold=world.summary().resources.gold,wood=world.summary().resources.wood;h.confirm(h.text('Compra diez madera'));assert.equal(world.summary().resources.gold,gold-15);assert.equal(world.summary().resources.wood,wood+10);
  h.confirm(h.registry.runTool('propose_gate',{building:gate.id,open:true}));assert.equal(gate.open,true);
  h.confirm(h.registry.runTool('propose_rally',{building:hall.id,x:20,y:20}));assert.deepEqual(hall.rally,{x:20,y:20});
  h.confirm(h.registry.runTool('propose_train',{kind:'villager',quantity:1,building:hall.id}));h.confirm(h.registry.runTool('propose_cancel_train',{building:hall.id,queueIndex:0}));assert.equal(world.summary().reservedPopulation,0);
  gate.hp-=50;h.confirm(h.registry.runTool('propose_repair',{target:'Luna',building:gate.id}));assert.equal(world.state.units.find(unit=>unit.name==='Luna').order.type,'repair');
  const age=harness();const food=age.game.world.summary().resources.food;age.confirm(age.text('Avanza de era'));assert.equal(age.game.world.summary().resources.food,food-300);step(age.game.world,21);assert.equal(age.game.world.summary().age,2);
});
test('VOICE09 save preserves original pause and new/load invalidates old identities',()=>{
  const h=harness();h.confirm(h.registry.runTool('propose_save'));assert.equal(h.saved.paused,false);
  const old=h.registry.runTool('propose_rename',{target:'Luna',name:'Nunca ejecutar'});h.registry.runTool('confirm_action',{proposalId:old.data.proposalId,confirmationText:'sí'});h.registry.confirm.speechEnded(old.data);h.game.newMatch({mapId:'islas-del-viento'});h.advance(4000);assert.equal(h.registry.confirm.state,'invalidated');assert.equal(h.game.world.state.units.find(unit=>unit.name==='Luna').name,'Luna');
  const next=h.registry.runTool('propose_new_match',{mapId:'paso-nevado',guildId:'eclipse',difficulty:'easy',mode:'peaceful'});h.confirm(next);assert.equal(h.game.world.state.mapId,'paso-nevado');assert.equal(h.game.worldGeneration,3);
  globalThis.localStorage={getItem:()=>JSON.stringify(h.saved)};try{h.confirm(h.registry.runTool('propose_load'));assert.equal(h.game.world.state.mapId,'valle-del-alba');assert.equal(h.game.world.state.paused,false);}finally{delete globalThis.localStorage;}
});
test('VOICE10 Spanish required sentences and English role commands resolve exact tool shapes',()=>{
  const h=harness({prepared:true,mode:'conquest'});const expected=[['Selecciona a Luna','select_units'],['Luna recoge madera','propose_gather'],['Cambia el nombre de Bruno a Teo','propose_rename'],['Constructores, levanten una muralla al norte','propose_wall'],['Entrena cinco arqueros','propose_train'],['Caballeros pesados, defiendan la puerta','propose_defend'],['Magos, ataquen la torre roja','propose_attack'],['heavy knights, attack Casa del Gremio','propose_attack'],['Confirma',null],['Alto','stop_action']];
  for(const [phrase,name] of expected){const parsed=parseSpanishCommand(phrase,{game:h.game,confirm:h.registry.confirm,mode:h.registry.mode});if(name)assert.equal(parsed.name,name,phrase);else assert.equal(parsed.error.code,'COMMAND_NOT_UNDERSTOOD');}
  for(const alias of ['heavy knight','archer','assassin','mage','healer'])assert.ok(UNITS[parseSpanishCommand(`Entrena dos ${alias}`,{game:h.game}).input.kind]);
});
test('VOICE11 a human queue cancellation cannot retarget an already proposed cancellation',()=>{
  const h=harness({prepared:true}),hall=h.game.world.state.buildings.find(building=>building.team===1&&building.kind==='guildhall');
  assert.equal(h.game.execute('train',{buildingId:hall.id,kind:'villager',quantity:2}).ok,true);
  const proposal=h.registry.runTool('propose_cancel_train',{building:hall.id,queueIndex:0});assert.equal(proposal.code,'PROPOSED');
  assert.equal(h.game.execute('cancel_train',{buildingId:hall.id,queueIndex:0}).ok,true);const resources={...h.game.world.summary().resources};
  h.registry.runTool('confirm_action',{proposalId:proposal.data.proposalId,confirmationText:'sí'});h.registry.confirm.speechEnded(proposal.data);h.advance(4000);
  assert.equal(h.registry.confirm.state,'failed');assert.equal(h.registry.confirm.getState().result.code,'QUEUE_CHANGED');assert.equal(hall.queue.length,1);assert.deepEqual(h.game.world.summary().resources,resources);assert.equal(h.game.world.state.paused,false);
});

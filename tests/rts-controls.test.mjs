import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BUILDINGS, UNITS } from '../src/game/data.js';
import { createVoiceRegistry, exportRegistry } from '../src/voice/registry.js';
import { parseSpanishCommand } from '../src/voice/spanish.js';
import { registerNativeTools } from '../src/voice/webmcp.js';
import { completeBuilding, prepared, step } from './world-scenarios.mjs';

function harness() {
  const world = prepared(), calls = [];
  const game = { world, selectedIds: [], worldGeneration: 1,
    execute(type, args) { calls.push({ type, args }); return world.command(type, args); },
    select(ids) { this.selectedIds = ids; } };
  const registry = createVoiceRegistry(game);
  const text = value => { const parsed = parseSpanishCommand(value, { game }); return parsed.error || registry.runTool(parsed.name, parsed.input); };
  return { world, game, registry, calls, text };
}

test('RTS controls parse formations and resource rally without a coordinate or confirmation prompt', () => {
  for (const [phrase, expected] of [
    ['Forma en línea', { name: 'propose_formation', input: { kind: 'line' } }],
    ['Formación escalonada', { name: 'propose_formation', input: { kind: 'staggered' } }],
    ['Forma los arqueros en caja', { name: 'propose_formation', input: { kind: 'box', target: 'arqueros' } }],
    ['Mueve los arqueros en caja a mi base', { name: 'propose_move', input: { destination: 'mi base', formation: 'box', target: 'arqueros' } }],
    ['Arqueros, vayan a mi base en línea', { name: 'propose_move', input: { destination: 'mi base', formation: 'line', target: 'Arqueros' } }],
    ['Caja ve a mi base', { name: 'propose_move', input: { destination: 'mi base', target: 'Caja' } }],
    ['Punto de reunión del centro urbano al bosque', { name: 'propose_rally', input: { building: 'centro urbano', destination: 'bosque' } }],
    ['Pon el punto de reunión al oro', { name: 'propose_rally', input: { destination: 'oro' } }],
  ]) assert.deepEqual(parseSpanishCommand(phrase), expected, phrase);
});

test('voice formation commands immediately change only the requested own units and persist through movement', () => {
  const h = harness(), archers = h.world.state.units.filter(unit => unit.team === 1 && unit.kind === 'archer');
  for (let i = 0; i < 5; i++) archers.push(h.world._spawn('archer', 1, 14 + i % 3, 18 + Math.floor(i / 3)));
  h.game.select(archers.map(unit => unit.id));
  const others = h.world.state.units.filter(unit => !h.game.selectedIds.includes(unit.id)).map(unit => ({ id: unit.id, order: structuredClone(unit.order) }));
  assert.equal(h.text('Forma en línea').code, 'EXECUTED');
  assert.equal(h.calls.at(-1).type, 'formation');
  assert.deepEqual(h.calls.at(-1).args, { unitIds: archers.map(unit => unit.id), kind: 'line' });
  assert.ok(archers.every(unit => unit.formation === 'line' && unit.order.type === 'move'));
  assert.equal(new Set(archers.map(unit => `${unit.order.x},${unit.order.y}`)).size, archers.length);
  assert.equal(h.world.state.paused, false);
  assert.equal(h.registry.confirm.pending, false);
  for (const other of others) assert.deepEqual(h.world.getEntity(other.id).order, other.order);
  assert.equal(h.text('Mueve los arqueros a mi base').code, 'EXECUTED');
  assert.equal(h.calls.at(-1).args.formation, 'line');
  for (const other of others) assert.deepEqual(h.world.getEntity(other.id).order, other.order);
  step(h.world, 20);
  assert.ok(archers.every(unit => unit.order.type === 'idle'), 'Archers must physically finish their formation move.');
  assert.equal(new Set(archers.map(unit => `${unit.x.toFixed(2)},${unit.y.toFixed(2)}`)).size, archers.length);
});

test('voice moves default to box and explicit staggered overrides stored choices', () => {
  const h = harness(), units = h.world.state.units.filter(unit => unit.team === 1 && unit.kind === 'archer');
  assert.equal(h.text('Mueve los arqueros a mi base').code, 'EXECUTED');
  assert.equal(h.calls.at(-1).args.formation, 'box');
  assert.equal(h.text('Mueve los arqueros en formación escalonada a mi base').code, 'EXECUTED');
  assert.equal(h.calls.at(-1).args.formation, 'staggered');
  assert.ok(units.every(unit => unit.formation === 'staggered'));
});

test('invalid formation arguments, foreign targets and partial anchors cannot mutate the world', () => {
  const h = harness(), enemy = h.world.state.units.find(unit => unit.team === 2), before = h.world.serialize();
  for (const input of [{ kind: 'wedge' }, { kind: 'box', team: 2 }, { kind: 'line', x: 10 }]) {
    assert.equal(h.registry.runTool('propose_formation', input).ok, false);
    assert.deepEqual(h.world.serialize(), before);
  }
  assert.equal(h.registry.runTool('propose_formation', { kind: 'line', target: enemy.id }).ok, false);
  assert.deepEqual(h.world.serialize(), before);
});

test('resource rally resolves a live resource and new workers actually gather and deposit it', () => {
  const h = harness(), hall = h.world.state.buildings.find(building => building.team === 1 && building.kind === 'guildhall');
  h.game.select([hall.id]);
  assert.equal(h.text('Punto de reunión al bosque').code, 'EXECUTED');
  const args = h.calls.at(-1).args, resource = h.world.getEntity(args.targetId);
  assert.equal(args.buildingId, hall.id);
  assert.equal(resource.kind, 'wood');
  assert.ok(resource.amount > 0);
  const beforeIds = new Set(h.world.state.units.map(unit => unit.id)), wood = h.world.summary().resources.wood;
  assert.equal(h.text('Entrena un aldeano').code, 'EXECUTED');
  step(h.world, UNITS.villager.trainTime + .2);
  const recruit = h.world.state.units.find(unit => !beforeIds.has(unit.id));
  assert.equal(recruit.kind, 'villager');
  assert.equal(recruit.order.type, 'gather');
  assert.equal(recruit.order.targetId, resource.id);
  step(h.world, 60);
  assert.ok(h.world.summary().resources.wood > wood, 'Rally workers must deposit resources, not only receive an order.');
  assert.equal(h.registry.confirm.pending, false);
});

test('a farm rally retains exact target identity and foreign or depleted resources fail without replacing it', () => {
  const h = harness(), hall = h.world.state.buildings.find(building => building.team === 1 && building.kind === 'guildhall'), farm = completeBuilding(h.world, 'farm');
  assert.equal(h.registry.runTool('propose_rally', { building: hall.id, targetId: farm.id }).code, 'EXECUTED');
  assert.equal(h.calls.at(-1).args.targetId, farm.id);
  assert.equal(h.registry.runTool('propose_rally', { building: hall.id, destination: 'mi huerto' }).code, 'EXECUTED');
  assert.equal(h.calls.at(-1).args.targetId, farm.id);
  const saved = structuredClone(hall.rally), enemyFarm = completeBuilding(h.world, 'farm', 2), empty = h.world.state.nodes.find(node => node.kind === 'wood');
  assert.equal(h.registry.runTool('propose_rally', { building: hall.id, targetId: enemyFarm.id }).ok, false);
  assert.deepEqual(hall.rally, saved);
  empty.amount = 0;
  assert.equal(h.registry.runTool('propose_rally', { building: hall.id, targetId: empty.id }).ok, false);
  assert.deepEqual(hall.rally, saved);
  assert.equal(h.registry.runTool('propose_rally', { building: hall.id, x: 10 }).code, 'POSITION_REQUIRED');
  assert.deepEqual(hall.rally, saved);
});

test('resource rally skips closer unreachable nodes using the actual producer exit', () => {
  const h = harness(), hall = h.world.state.buildings.find(building => building.team === 1 && building.kind === 'guildhall');
  for (const node of h.world.state.nodes) if (node.kind === 'wood') node.amount = 0;
  for (let y = 0; y < 80; y++) h.world._building('wall', 1, 22, y, 1);
  h.world.navigation.rebuild();
  const blocked = h.world._node('wood', 23, 13, 1000), accessible = h.world._node('wood', 4, 30, 1000);
  assert.equal(h.registry.runTool('propose_rally', { building: hall.id, destination: 'bosque más cercano' }).code, 'EXECUTED');
  assert.notEqual(h.calls.at(-1).args.targetId, blocked.id);
  assert.equal(h.calls.at(-1).args.targetId, accessible.id);
});

test('native tool registration includes exact formation/rally schemas and real commands; aborted calls have no effect', async () => {
  const h = harness(), tools = exportRegistry(), registered = new Map();
  const inventory = JSON.parse(fs.readFileSync(new URL('../docs/voice/clickables.json', import.meta.url), 'utf8'));
  assert.deepEqual(inventory.tools, tools);
  assert.ok(inventory.actualDomActions.some(action => action.action === 'formation' && action.voiceTool === 'propose_formation'));
  const adapter = await registerNativeTools({ document: { modelContext: { async registerTool(tool) { registered.set(tool.name, tool); } } }, navigator: {}, tools, runTool: h.registry.runTool });
  assert.deepEqual([...registered.keys()], tools.map(tool => tool.name));
  const formation = registered.get('propose_formation');
  assert.deepEqual(formation.inputSchema.properties.kind.enum, ['line', 'box', 'staggered']);
  assert.equal((await formation.execute({ kind: 'box', target: 'arqueros' })).code, 'EXECUTED');
  const before = h.world.serialize();
  assert.equal((await formation.execute({ kind: 'line', target: 'arqueros' }, { signal: AbortSignal.abort() })).code, 'ABORTED');
  assert.deepEqual(h.world.serialize(), before);
  assert.equal(registered.get('propose_move').inputSchema.properties.formation.type, 'string');
  assert.equal(registered.get('propose_rally').inputSchema.properties.targetId.type, 'string');
  adapter.destroy();
  assert.equal((await formation.execute({ kind: 'line', target: 'arqueros' })).code, 'ABORTED');
});

test('read_entity returns the live cargo, waiting phase, formation and producer rally for voice decisions', () => {
  const h = harness(), worker = h.world.state.units.find(unit => unit.team === 1 && unit.kind === 'villager'), hall = h.world.state.buildings.find(building => building.team === 1 && BUILDINGS[building.kind].trains?.includes('villager'));
  worker.carry = { kind: 'wood', amount: 12 };
  worker.order = { type: 'gather', phase: 'deliver', targetId: h.world.state.nodes.find(node => node.kind === 'wood').id, waiting: 'dropoff' };
  worker.formation = 'line';
  const read = h.registry.runTool('read_entity', { target: worker.id }).data;
  assert.deepEqual(read.carry, worker.carry);
  assert.equal(read.order.waiting, 'dropoff');
  assert.equal(read.order.phase, 'deliver');
  assert.equal(read.formation, 'line');
  assert.deepEqual(h.registry.runTool('read_entity', { target: hall.id }).data.rally, hall.rally);
});

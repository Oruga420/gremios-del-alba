/** Browser test saves made from actual World entities, commands and ticks.
 * No application cheat command or production source is added by this helper.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { World } from '../src/game/world.js';
import { TERRAIN, BUILDINGS } from '../src/game/data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.local', 'browser-fixtures');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fixtures = {};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function base(mode = 'peaceful') {
  const world = new World({ mode, seed: 20261013, difficulty: 'normal' });
  world.state.units = [];
  world.state.buildings = [];
  world.state.nodes = [];
  world.state.events = [];
  world._indexes();
  world._building('guildhall', 1, 8, 8, 1);
  for (const y of [5, 8, 11]) world._building('house', 1, 3, y, 1);
  world._building('guildhall', 2, 65, 65, 1);
  world.state.teams[1].resources = { wood: 10000, food: 10000, gold: 10000, stone: 10000 };
  world.state.teams[2].resources = { wood: 0, food: 0, gold: 0, stone: 0 };
  world.navigation.rebuild();
  world._indexes();
  return world;
}

function ready(world) {
  world.navigation.rebuild();
  world._indexes();
  return world;
}

function spawn(world, kind, team, x, y) {
  const unit = world._spawn(kind, team, x, y);
  assert(unit, `No legal ${kind} spawn at ${x},${y}`);
  return unit;
}

function command(world, type, args, team = 1) {
  const result = team === 1 ? world.command(type, args) : world._command(type, args, team);
  assert(result.ok, `Fixture real command ${type} rejected: ${result.message}`);
  return result;
}

function save(name, world, metadata) {
  ready(world);
  const serialized = world.serialize();
  const validated = World.fromSave(serialized);
  assert(JSON.stringify(validated.serialize()) === JSON.stringify(serialized), `${name}: validated roundtrip differs`);
  const file = `${name}.json`;
  const bytes = Buffer.from(JSON.stringify(serialized));
  fs.writeFileSync(path.join(output, file), bytes);
  fixtures[name] = { file, sha256: hash(bytes), validatedByWorldFromSave: true,
    actualLiving: [1, 2].map(team => world.summary(team).population), metadata };
}

function economy() {
  const world = base();
  world._building('lumber_camp', 1, 12, 9, 1);
  world._building('mining_camp', 1, 12, 13, 1);
  world._building('mill', 1, 8, 14, 1);
  const farm = world._building('farm', 1, 5, 18, 1);
  for (let y = 9; y <= 20; y++) for (let x = 23; x <= 31; x++) world.state.map.terrain[y * 80 + x] = TERRAIN.WATER;
  world._building('dock', 1, 21, 11, 1);
  ready(world);
  const cycles = [];
  for (const [kind, x, y] of [['wood',16.5,9.5], ['food',8.5,18.5], ['gold',16.5,14.5], ['stone',17.5,16.5]]) {
    const node = world._node(kind, x, y, 6000);
    const unit = spawn(world, 'villager', 1, x - 1, y);
    cycles.push({ kind, unitId: unit.id, targetId: node.id, depositedResource: kind });
  }
  const farmer = spawn(world, 'villager', 1, 4.5, 19.5);
  const fish = world._node('fish', 26.5, 15.5, 6000);
  const boat = spawn(world, 'fishing_boat', 1, 25.5, 15.5);
  cycles.push({ kind: 'farm', unitId: farmer.id, targetId: farm.id, depositedResource: 'food' },
    { kind: 'fish', unitId: boat.id, targetId: fish.id, depositedResource: 'food' });
  save('economy', world, { cycles });
}

function construction() {
  const world = base();
  const damaged = world._building('house', 1, 11, 25, 1); damaged.hp = 200;
  ready(world);
  const builders = Array.from({ length: 5 }, (_, i) => spawn(world, 'villager', 1, 15.5 + i % 3, 24.5 + Math.floor(i / 3)));
  assert(world.canPlace('house', 16, 27), 'Construction fixture plot is illegal');
  save('construction', world, { builderIds: builders.map(unit => unit.id), housePlot: { x: 16, y: 27 }, damagedBuildingId: damaged.id });
}

function walls() {
  const world = base('conquest');
  world.state.map.terrain.fill(TERRAIN.CLIFF);
  for (let y = 30; y <= 35; y++) for (let x = 8; x <= 25; x++) world.state.map.terrain[y * 80 + x] = TERRAIN.GRASS;
  for (let y = 30; y <= 35; y++) if (y !== 32) world._building('palisade', 1, 17, y, 1);
  const gate = world._building('gate', 1, 17, 32, 1); gate.hp = 30;
  world.state.teams[1].age = 2;
  ready(world);
  const builders = Array.from({ length: 4 }, (_, i) => spawn(world, 'villager', 1, 10.5 + (i % 2), 33.5 + Math.floor(i / 2)));
  const traveler = spawn(world, 'villager', 1, 14.5, 32.5);
  const siege = spawn(world, 'siege_engine', 2, 23.5, 32.5); siege.cooldown = 20;
  command(world, 'attack', { unitIds: [siege.id], targetId: gate.id }, 2);
  save('walls', world, { builderIds: builders.map(unit => unit.id), wallKind: 'palisade',
    wallStart: { x: 9, y: 30 }, wallEnd: { x: 9, y: 33 }, gateId: gate.id,
    gateDestroyerId: siege.id,
    gateRoute: { unitId: traveler.id, origin: { x: 14.5, y: 32.5 }, destination: { x: 20.5, y: 32.5 } } });
}

function queues() {
  const world = base();
  spawn(world, 'villager', 1, 13.5, 13.5);
  const producer = world.state.buildings.find(building => building.team === 1 && building.kind === 'guildhall');
  save('queues', world, { producerId: producer.id });
}

function technologies() {
  const world = base(); world.state.teams[1].age = 2;
  const granary = world._building('granary', 1, 14, 6, 1);
  const market = world._building('market', 1, 20, 6, 1);
  ready(world);
  const hall = world.state.buildings.find(building => building.team === 1 && building.kind === 'guildhall');
  save('technologies', world, { guildhallId: hall.id, technologyBuildingId: granary.id,
    technologyId: 'wheelbarrow', marketId: market.id, rally: { x: 14.5, y: 15.5 } });
}

function combat() {
  const world = base('conquest'); world.state.teams[1].age = 3;
  for (let y = 30; y <= 51; y++) for (let x = 30; x <= 39; x++) world.state.map.terrain[y * 80 + x] = TERRAIN.GRASS;
  ready(world);
  const attacker = spawn(world, 'archer', 1, 32.5, 32.5);
  const target = spawn(world, 'infantry', 2, 36.5, 32.5); target.cooldown = 20;
  const mage = spawn(world, 'mage', 1, 32.5, 40.5);
  mage.cooldown = 20;
  const fireTarget = spawn(world, 'heavy_knight', 2, 36.5, 40.5); fireTarget.cooldown = 20;
  const injured = spawn(world, 'heavy_knight', 1, 32.5, 48.5); injured.hp = 100;
  const healer = spawn(world, 'healer', 1, 34.5, 48.5); healer.cooldown = 20;
  save('combat', world, { attackerId: attacker.id, targetId: target.id, mageId: mage.id,
    fireTargetId: fireTarget.id, healerId: healer.id, injuredId: injured.id,
    attackMoveDestination: { x: 39.5, y: 32.5 } });
}

function ai() {
  const world = base('conquest'); world.state.difficulty = 'hard'; world.state.time = 26;
  world.state.teams[2].resources = { wood: 650, food: 600, gold: 350, stone: 400 };
  const wood = world._node('wood', 61.5, 60.5, 6000);
  const food = world._node('food', 61.5, 63.5, 6000);
  spawn(world, 'villager', 2, wood.x - 1, wood.y);
  const gatherer = spawn(world, 'villager', 2, food.x - 1, food.y);
  spawn(world, 'archer', 2, 14.5, 11.5);
  const hall = world.state.buildings.find(building => building.team === 1 && building.kind === 'guildhall');
  save('ai', world, { enemyGathererId: gatherer.id, playerTargetId: hall.id });
}

function victory() {
  const world = base('conquest');
  const hall = world.state.buildings.find(building => building.team === 2 && building.kind === 'guildhall'); hall.hp = 1;
  const attacker = spawn(world, 'infantry', 1, 63.5, 65.5); attacker.cooldown = 10;
  save('victory', world, { attackerId: attacker.id, enemyHallId: hall.id });
}

function defeat() {
  const world = base('conquest');
  const hall = world.state.buildings.find(building => building.team === 1 && building.kind === 'guildhall'); hall.hp = 1;
  const attacker = spawn(world, 'infantry', 2, 13.5, 10.5); attacker.cooldown = 3;
  command(world, 'attack', { unitIds: [attacker.id], targetId: hall.id }, 2);
  save('defeat', world, { enemyAttackerId: attacker.id, playerHallId: hall.id });
}

function saves() {
  const world = base();
  const node = world._node('wood', 14.5, 16.5, 6000);
  const carrier = spawn(world, 'villager', 1, 13.5, 16.5);
  const builders = Array.from({ length: 4 }, () => spawn(world, 'villager', 1, 15.5, 23.5));
  const hall = world.state.buildings.find(building => building.team === 1 && building.kind === 'guildhall');
  command(world, 'gather', { unitIds: [carrier.id], targetId: node.id });
  command(world, 'build', { unitIds: builders.map(unit => unit.id), kind: 'house', x: 16, y: 24 });
  command(world, 'train', { buildingId: hall.id, kind: 'villager' });
  for (let i = 0; i < 50; i++) world.tick(.05);
  command(world, 'pause', { paused: true });
  assert(carrier.carry.amount > 0, 'Save fixture carrier did not actually gather');
  assert(world.state.buildings.some(building => building.progress > 0 && building.progress < 1), 'Save fixture has no actual ongoing construction');
  assert(world.summary(1).reservedPopulation > 0, 'Save fixture has no real queue reservation');
  save('saves', world, { carryingUnitId: carrier.id, producerId: hall.id });
}

fs.mkdirSync(output, { recursive: true });
for (const create of [economy, construction, walls, queues, technologies, combat, ai, victory, defeat, saves]) create();
const benchmarkPath = path.join(root, 'scripts', 'benchmark.mjs');
if (fs.existsSync(benchmarkPath)) {
  const { createBenchmarkWorld, updateBenchmarkPhase } = await import('./benchmark.mjs');
  const { world, metadata } = createBenchmarkWorld();
  const benchmarkSource = fs.readFileSync(benchmarkPath, 'utf8');
  const recordPhase = benchmarkSource.match(/function recordPhase\([\s\S]*?\n\}\n/u)?.[0];
  assert(recordPhase, 'Cannot adapt the real measured phase recorder');
  save('benchmark', world, { ...metadata,
    metricContract: { paths: { ...metadata.paths, tickSamples: ['tickSamples'], tickDt: ['tickDt'],
      phases: ['phases'], unitPaths: ['unitPaths'] },
      participantPaths: { economy: ['metrics', 'participants', 'economy'],
        construction: ['metrics', 'participants', 'builders'], combat: ['metrics', 'participants', 'military'] } },
    phaseAdapter: { sourcePath: 'scripts/benchmark.mjs', sourceSha256: hash(Buffer.from(benchmarkSource)),
      updateSource: updateBenchmarkPhase.toString(), recordSource: recordPhase },
  });
}
const engineSha256 = hash(fs.readFileSync(path.join(root, 'src', 'game', 'world.js')));
fs.writeFileSync(path.join(output, 'index.json'), JSON.stringify({ version: 1, generatedAt: new Date().toISOString(),
  seed: 20261013, engineSha256, provenance: 'Actual World factories, commands and fixed .05-second ticks; every save validated through World.fromSave', fixtures }, null, 2) + '\n');
console.log(`BROWSER_FIXTURES_READY count=${Object.keys(fixtures).length} index=${path.join(output, 'index.json')}`);

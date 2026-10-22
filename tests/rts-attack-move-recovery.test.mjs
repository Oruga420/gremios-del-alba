import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { TERRAIN } from '../src/game/data.js';

function battleWorld() {
  const world = new World({ mode: 'conquest', seed: 20261022 });
  world.state.units = []; world.state.buildings = []; world.state.nodes = [];
  world.state.map.terrain.fill(TERRAIN.GRASS);
  world._indexes(); world.navigation.rebuild();
  world._ai = () => {};
  return world;
}

function enclosedEnemy(world) {
  for (let y = 8; y <= 12; y++) for (let x = 14; x <= 18; x++) {
    if ((x === 14 || x === 18 || y === 8 || y === 12) && !(x === 14 && y === 10)) {
      world._building('wall', 1, x, y, 1);
    }
  }
  const gate = world._building('gate', 1, 14, 10, 1);
  world.navigation.rebuild();
  const enemy = world._spawn('healer', 2, 16.5, 10.5);
  return { gate, enemy };
}

function march(world, units, x = 8.5, y = 22.5) {
  assert.equal(world.command('move', {
    unitIds: units.map(unit => unit.id), x, y, formation: 'box', attackMove: true,
  }).ok, true);
  return units.map(unit => world.state.navigation[unit.navigationIndex]);
}

function advance(world, seconds) {
  for (let step = 0; step < Math.round(seconds / .05); step++) world.tick(.05);
}

function queuedPursuit() {
  const world = battleWorld();
  for (let y = 0; y < 16; y++) world._building('wall', 1, 14, y, 1);
  world.navigation.rebuild();
  const unit = world._spawn('heavy_knight', 1, 11.5, 10.5);
  const enemy = world._spawn('healer', 2, 16.5, 10.5);
  const [record] = march(world, [unit]);
  world.navigation.beginStep(0);
  for (let y = 40.5; y < 44.5; y++) assert.equal(world.navigation.field(50.5, y), undefined);
  assert.equal(world.navigation.field(enemy.x, enemy.y), undefined);
  world.navigation.endStep();
  return { world, unit, enemy, record };
}

test('attack-move resumes its formation destination after an enclosed automatic enemy is unreachable', () => {
  const world = battleWorld(), { enemy } = enclosedEnemy(world);
  const units = [9.5, 10.5, 11.5].map(y => world._spawn('heavy_knight', 1, 11.5, y));
  const records = march(world, units);
  const goals = units.map(unit => ({ x: unit.order.x, y: unit.order.y }));
  advance(world, 12);
  assert.equal(enemy.hp, enemy.maxHp, 'An enclosed enemy must not take melee damage through walls');
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    assert.equal(unit.order.type, 'idle', 'A failed automatic chase must not hold the march forever');
    assert.equal(records[index].status, 'arrived');
    assert.equal(unit.x, goals[index].x); assert.equal(unit.y, goals[index].y);
  }
  assert.equal(world.state.metrics.movementArrivals, units.length);
  assert.ok(world.navigation.stats.maxBuiltPerStep <= 8);
});

test('failed automatic pursuit resumes movement without falsely completing its navigation record', () => {
  const world = battleWorld(); enclosedEnemy(world);
  const unit = world._spawn('heavy_knight', 1, 11.5, 10.5), [record] = march(world, [unit]);
  world.tick(.05);
  assert.equal(unit.autoTarget, null);
  assert.ok(unit.scanCooldown > .05, 'Retry uses a bounded existing scan delay');
  assert.ok(unit.y > 10.5, 'The original march resumes in the same step');
  assert.equal(unit.order.type, 'move');
  assert.equal(record.status, 'moving'); assert.equal(record.resolvedAt, null);
  assert.equal(world.state.metrics.movementArrivals, 0);
});

test('a deferred pursuit waits for the real navigation queue instead of abandoning a reachable enemy', () => {
  const { world, unit, enemy, record } = queuedPursuit();
  const before = { x: unit.x, y: unit.y };
  world.tick(.05);
  assert.equal(unit.autoTarget, enemy.id);
  assert.equal(unit.x, before.x); assert.equal(unit.y, before.y);
  assert.equal(record.status, 'pending'); assert.equal(record.resolvedAt, null);
  assert.equal(world.state.metrics.movementArrivals, 0);
  assert.ok(world.state.navigationQueue.some(goal => goal.x === enemy.x && goal.y === enemy.y));
  world.tick(.05);
  assert.ok(unit.x > before.x, 'Pursuit starts once the shared field is admitted');
  assert.equal(unit.autoTarget, enemy.id);
  assert.notEqual(record.status, 'arrived');
  assert.ok(world.navigation.stats.maxBuiltPerStep <= 8);
});

test('opening a gate makes an automatic enemy eligible again after its bounded retry delay', () => {
  const world = battleWorld(), { gate, enemy } = enclosedEnemy(world);
  const unit = world._spawn('heavy_knight', 1, 11.5, 10.5);
  march(world, [unit], 12.5, 12.5);
  world.tick(.05);
  assert.equal(unit.autoTarget, null);
  assert.equal(world.command('gate', { buildingId: gate.id, open: true }).ok, true);
  advance(world, 8);
  assert.ok(world.state.metrics.damagingHits > 0, 'Pursuit can reach combat after the gate opens');
  assert.ok(!world.getEntity(enemy.id) || enemy.hp < enemy.maxHp);
});

test('a reachable enemy encountered after a failed chase still receives battle damage', () => {
  const world = battleWorld(), { enemy: enclosed } = enclosedEnemy(world);
  const unit = world._spawn('heavy_knight', 1, 11.5, 10.5);
  const reachable = world._spawn('villager', 2, 10.5, 16.5);
  march(world, [unit]); advance(world, 15);
  assert.equal(enclosed.hp, enclosed.maxHp);
  assert.ok(!world.getEntity(reachable.id) || reachable.hp < reachable.maxHp);
  assert.ok(world.state.metrics.damagingHits > 0);
  assert.ok(world.navigation.stats.maxBuiltPerStep <= 8);
});

test('explicit attack keeps its chosen target while unreachable and proceeds when its gate opens', () => {
  const world = battleWorld(), { gate, enemy } = enclosedEnemy(world);
  const unit = world._spawn('heavy_knight', 1, 11.5, 10.5);
  assert.equal(world.command('attack', { unitIds: [unit.id], targetId: enemy.id }).ok, true);
  advance(world, 2);
  assert.equal(unit.order.type, 'attack'); assert.equal(unit.order.targetId, enemy.id);
  assert.equal(unit.x, 11.5); assert.equal(unit.y, 10.5);
  assert.equal(enemy.hp, enemy.maxHp);
  world.command('gate', { buildingId: gate.id, open: true }); advance(world, 8);
  assert.ok(world.state.metrics.damagingHits > 0);
});

test('pending and failed automatic pursuits replay identically from existing save fields', () => {
  const blocked = battleWorld(); enclosedEnemy(blocked);
  const unit = blocked._spawn('heavy_knight', 1, 11.5, 10.5);
  march(blocked, [unit]); blocked.tick(.05);
  const pending = queuedPursuit().world; pending.tick(.05);
  for (const world of [blocked, pending]) {
    const saved = world.serialize(), clone = World.fromSave(saved); clone._ai = () => {};
    assert.deepEqual(clone.serialize(), saved);
    for (let step = 0; step < 80; step++) {
      world.tick(.05); clone.tick(.05);
      assert.deepEqual(clone.serialize(), world.serialize());
    }
  }
});

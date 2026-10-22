import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { TERRAIN, UNITS } from '../src/game/data.js';

function emptyWorld() {
  const w = new World({ mode: 'peaceful', seed: 20261022 });
  w.state.units = []; w.state.buildings = []; w.state.nodes = [];
  w.state.map.terrain.fill(TERRAIN.GRASS); w._indexes(); w.navigation.rebuild();
  w._ai = () => {};
  return w;
}
const advance = (w, seconds) => { for (let i = 0; i < Math.round(seconds / .05); i++) w.tick(.05); };
const gather = (w, u, target) => w.command('gather', { unitIds: [u.id], targetId: target.id });

test('reissuing the same gathering target preserves an active route and order', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 12.5, 10.5);
  for (let y = 0; y < 80; y++) if (y !== 15) w._building('wall', 1, 20, y, 1);
  const n = w._node('wood', 25.5, 10.5, 1000); w.navigation.rebuild();
  assert.ok(gather(w, u, n).ok); w.tick(.05);
  assert.ok(u.waypoint, 'The fixture must be following a real route');
  const order = u.order, waypoint = u.waypoint, before = w.serialize();
  assert.ok(gather(w, u, n).ok);
  assert.equal(u.order, order); assert.equal(u.waypoint, waypoint);
  assert.deepEqual(w.serialize(), before);
});

test('repeating a partially loaded gathering order continues harvesting without an early deposit', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 14.5, 12.5);
  w._building('guildhall', 1, 8, 8, 1); w.navigation.rebuild();
  const n = w._node('gold', u.x, u.y, 1000);
  assert.ok(gather(w, u, n).ok); advance(w, .1);
  assert.ok(u.carry.amount > 0 && u.carry.amount < UNITS.villager.carryCapacity);
  const before = w.serialize(), amount = u.carry.amount, credited = w.state.teams[1].resources.gold;
  assert.ok(gather(w, u, n).ok); assert.deepEqual(w.serialize(), before);
  advance(w, .1);
  assert.equal(u.order.phase, 'gather'); assert.ok(u.carry.amount > amount);
  assert.equal(w.state.teams[1].resources.gold, credited);
});

test('farm building and resource convenience reissues preserve the normalized active task', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 14.5, 12.5);
  const farm = w._building('farm', 1, 18, 14, 1); w.navigation.rebuild();
  assert.ok(gather(w, u, farm).ok); w.tick(.05);
  const order = u.order, before = w.serialize();
  assert.ok(gather(w, u, farm).ok); assert.equal(u.order, order); assert.deepEqual(w.serialize(), before);
  assert.ok(w.command('gather', { unitIds: [u.id], resource: 'food' }).ok);
  assert.equal(u.order, order); assert.deepEqual(w.serialize(), before);
});

test('reissuing during delivery or a missing-depot wait preserves its phase, cargo and retry', () => {
  for (const withDepot of [true, false]) {
    const w = emptyWorld(), u = w._spawn('villager', 1, 20.5, 12.5);
    if (withDepot) w._building('guildhall', 1, 8, 8, 1);
    w.navigation.rebuild(); const n = w._node('wood', 35.5, 12.5, 1000);
    u.carry = { kind: 'wood', amount: 7 };
    assert.ok(gather(w, u, n).ok); w.tick(.05);
    assert.equal(u.order.phase, 'deliver');
    if (withDepot) assert.ok(u.waypoint); else assert.equal(u.order.waiting, 'dropoff');
    const order = u.order, before = w.serialize();
    assert.ok(gather(w, u, n).ok); assert.equal(u.order, order); assert.deepEqual(w.serialize(), before);
    assert.doesNotThrow(() => World.fromSave(w.serialize()));
  }
});

test('a partially loaded worker can retarget the same resource and resume deterministically', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 14.5, 12.5);
  const first = w._node('gold', u.x, u.y, 1000), next = w._node('gold', u.x + 1, u.y, 1000);
  assert.ok(gather(w, u, first).ok); advance(w, .1);
  const cargo = { ...u.carry }, firstAmount = first.amount;
  assert.ok(gather(w, u, next).ok);
  assert.equal(u.order.phase, 'gather'); assert.equal(u.order.targetId, next.id); assert.deepEqual(u.carry, cargo);
  const saved = w.serialize(), loaded = World.fromSave(saved); loaded._ai = () => {};
  advance(w, .6); advance(loaded, .6);
  assert.ok(next.amount < next.maxAmount); assert.equal(first.amount, firstAmount);
  assert.ok(u.carry.amount > cargo.amount); assert.deepEqual(loaded.serialize(), w.serialize());
});

test('retargeting an active delivery preserves its leg and deposits the original cargo kind first', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 20.5, 12.5);
  w._building('guildhall', 1, 8, 8, 1); w.navigation.rebuild();
  const first = w._node('gold', 30.5, 12.5, 1000), next = w._node('gold', 24.5, 12.5, 1000);
  const wood = w._node('wood', 16.5, 12.5, 1000), resources = { ...w.state.teams[1].resources };
  u.carry = { kind: 'gold', amount: 7 };
  assert.ok(gather(w, u, first).ok); w.tick(.05);
  assert.ok(gather(w, u, next).ok); assert.equal(u.order.phase, 'deliver');
  assert.ok(gather(w, u, wood).ok); assert.equal(u.order.phase, 'deliver'); assert.equal(u.carry.kind, 'gold');
  advance(w, 30);
  assert.equal(w.state.teams[1].resources.gold - resources.gold, 7);
  assert.ok(w.state.teams[1].resources.wood > resources.wood);
  assert.ok(u.carry.amount === 0 || u.carry.kind === 'wood');
});

test('full cargo still enters delivery through the existing gather loop after a same-kind retarget', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 20.5, 12.5);
  w._building('guildhall', 1, 8, 8, 1); w.navigation.rebuild();
  const first = w._node('gold', 30.5, 12.5, 1000), next = w._node('gold', 24.5, 12.5, 1000);
  assert.ok(gather(w, u, first).ok);
  u.carry = { kind: 'gold', amount: UNITS.villager.carryCapacity };
  assert.ok(gather(w, u, next).ok); w.tick(.05);
  assert.equal(u.order.phase, 'deliver'); assert.equal(u.carry.amount, UNITS.villager.carryCapacity);
  assert.equal(next.amount, next.maxAmount);
});

test('gather reissues retain atomic ownership, worker-role, farm and movement restrictions', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 14.5, 12.5);
  const other = w._spawn('villager', 2, 15.5, 12.5), soldier = w._spawn('infantry', 1, 14.5, 13.5);
  for (let y = 60; y < 65; y++) for (let x = 60; x < 65; x++) w.state.map.terrain[y * 80 + x] = TERRAIN.WATER;
  w.navigation.rebuild(); const boat = w._spawn('fishing_boat', 1, 61.5, 61.5);
  const wood = w._node('wood', 20.5, 12.5, 1000), fish = w._node('fish', 63.5, 62.5, 1000);
  const farm = w._building('farm', 2, 24, 14, 1), unfinished = w._building('farm', 1, 28, 14);
  w.navigation.rebuild(); assert.ok(gather(w, u, wood).ok); w.tick(.05);
  for (const args of [
    { unitIds: [u.id, other.id], targetId: wood.id }, { unitIds: [u.id, soldier.id], targetId: wood.id },
    { unitIds: [u.id], targetId: farm.id }, { unitIds: [u.id], targetId: unfinished.id },
    { unitIds: [u.id], targetId: fish.id }, { unitIds: [boat.id], targetId: wood.id },
    { unitIds: [u.id], targetId: wood.id, team: 2 },
  ]) {
    const before = w.serialize(); assert.equal(w.command('gather', args).ok, false); assert.deepEqual(w.serialize(), before);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { TERRAIN } from '../src/game/data.js';

function emptyWorld() {
  const w = new World({ mode: 'peaceful', seed: 20261021 });
  w.state.units = []; w.state.buildings = []; w.state.nodes = [];
  w.state.map.terrain.fill(TERRAIN.GRASS); w._indexes(); w.navigation.rebuild();
  w._ai = () => {};
  return w;
}
const advance = (w, seconds) => { for (let i = 0; i < Math.round(seconds / .05); i++) w.tick(.05); };
const workers = w => w.state.units.filter(u => u.kind === 'villager');

test('formation orders arrive at distinct legal positions through a wall opening', () => {
  const w = emptyWorld();
  for (let y = 0; y < 80; y++) if (y !== 39 && y !== 40) w._building('wall', 1, 30, y, 1);
  w.navigation.rebuild();
  for (let i = 0; i < 24; i++) w._spawn('infantry', 1, 22 + i % 4, 37 + Math.floor(i / 4));
  const ids = w.state.units.map(u => u.id);
  assert.equal(w.command('move', { unitIds: ids, x: 40, y: 40, formation: 'box' }).ok, true);
  const goals = new Set(w.state.units.map(u => `${u.order.x}:${u.order.y}`));
  assert.equal(goals.size, ids.length);
  for (let i = 0; i < 800; i++) {
    w.tick(.05);
    assert.ok(w.state.units.every(u => w.navigation.walkable(Math.floor(u.x), Math.floor(u.y))), 'No unit enters a wall');
  }
  assert.ok(w.state.units.every(u => u.order.type === 'idle'));
  assert.equal(new Set(w.state.units.map(u => `${u.x.toFixed(3)}:${u.y.toFixed(3)}`)).size, ids.length);
  assert.ok(w.state.navigation.every(r => r.status === 'arrived'));
});

test('formation choice persists, rejects invalid ownership atomically, and resumes deterministically', () => {
  const w = emptyWorld();
  for (let i = 0; i < 18; i++) w._spawn(i % 3 ? 'infantry' : 'heavy_knight', 1, 15 + i % 3, 15 + Math.floor(i / 3));
  const ids = w.state.units.map(u => u.id);
  for (const args of [{ unitIds: ids, kind: 'constructor' }, { unitIds: ids, kind: 'line', x: 20 }]) {
    const before = w.serialize(); assert.equal(w.command('formation', args).ok, false); assert.deepEqual(w.serialize(), before);
  }
  assert.equal(w.command('formation', { unitIds: ids, kind: 'line' }).ok, true);
  assert.ok(w.state.units.every(u => u.formation === 'line'));
  assert.equal(w.command('move', { unitIds: ids, x: 40, y: 30 }).ok, true);
  advance(w, 1.5);
  const saved = w.serialize(), loaded = World.fromSave(saved); loaded._ai = () => {};
  assert.deepEqual(loaded.serialize(), saved);
  advance(w, 25); advance(loaded, 25);
  assert.deepEqual(loaded.serialize(), w.serialize());
  assert.ok(w.state.units.every(u => u.order.type === 'idle'));
});

test('partial cargo is deposited before harvesting a different resource', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 12, 10);
  w._building('guildhall', 1, 8, 8, 1); w.navigation.rebuild();
  const n = w._node('wood', 15.5, 10.5, 1000), initial = { ...w.state.teams[1].resources };
  u.carry = { kind: 'gold', amount: 7 };
  assert.equal(w.command('gather', { unitIds: [u.id], targetId: n.id }).ok, true);
  advance(w, 30);
  assert.equal(w.state.teams[1].resources.gold - initial.gold, 7);
  assert.ok(w.state.teams[1].resources.wood > initial.wood);
  assert.ok(u.carry.amount === 0 || u.carry.kind === 'wood');
});

test('missing resource with partial cargo delivers and preserves the intended resource', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 12, 10);
  w._building('guildhall', 1, 8, 8, 1); w.navigation.rebuild();
  const gone = w._node('gold', 14.5, 10.5, 10), alternate = w._node('gold', 16.5, 10.5, 1000);
  w.command('gather', { unitIds: [u.id], targetId: gone.id }); u.carry = { kind: 'gold', amount: 5 };
  w.state.nodes = w.state.nodes.filter(n => n.id !== gone.id); w._indexes();
  const before = w.state.teams[1].resources.gold; advance(w, 30);
  assert.ok(w.state.teams[1].resources.gold > before + 5);
  assert.equal(u.order.targetId, alternate.id); assert.equal(u.order.resource, 'gold');
});

test('worker waits without losing cargo and automatically resumes when a depot is built', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 12, 10), n = w._node('wood', 14.5, 10.5, 1000);
  u.carry = { kind: 'wood', amount: 10 }; w.command('gather', { unitIds: [u.id], targetId: n.id });
  advance(w, 2); assert.equal(u.order.type, 'gather'); assert.equal(u.order.waiting, 'dropoff'); assert.equal(u.carry.amount, 10);
  w._building('lumber_camp', 1, 8, 10, 1); w.navigation.rebuild();
  const before = w.state.teams[1].resources.wood; advance(w, 25);
  assert.ok(w.state.teams[1].resources.wood > before + 10); assert.notEqual(u.order.waiting, 'dropoff');
});

test('a newly blocked source deposits partial cargo before waiting and resumes when reopened', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 12.5, 10.5);
  w._building('guildhall', 1, 8, 8, 1);
  for (let y = 0; y < 80; y++) if (y !== 10) w._building('wall', 1, 20, y, 1);
  const gate = w._building('gate', 1, 20, 10, 1), n = w._node('gold', 23.5, 10.5, 1000);
  w.command('gate', { buildingId: gate.id, open: true });
  assert.equal(w.command('gather', { unitIds: [u.id], targetId: n.id }).ok, true);
  u.carry = { kind: 'gold', amount: 7 };
  const before = w.state.teams[1].resources.gold;
  w.command('gate', { buildingId: gate.id, open: false });
  advance(w, 8);
  assert.equal(w.state.teams[1].resources.gold - before, 7);
  assert.equal(u.carry.amount, 0); assert.equal(u.order.waiting, 'resource');
  assert.equal(u.order.resource, 'gold'); assert.doesNotThrow(() => World.fromSave(w.serialize()));
  w.command('gate', { buildingId: gate.id, open: true }); advance(w, 30);
  assert.ok(n.amount < 1000); assert.ok(w.state.teams[1].resources.gold > before + 7);
});

test('depleted nodes retarget a reachable source, ignoring a nearer enclosed source', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 12, 10);
  w._building('guildhall', 1, 8, 8, 1);
  const depleted = w._node('stone', 13.5, 10.5, 0), blocked = w._node('stone', 17.5, 10.5, 1000), reachable = w._node('stone', 12.5, 18.5, 1000);
  for (const [x,y] of [[16,9],[17,9],[18,9],[16,10],[18,10],[16,11],[17,11],[18,11]]) w._building('wall', 1, x, y, 1);
  w.navigation.rebuild();
  u.order = { type: 'gather', targetId: depleted.id, resource: 'stone', phase: 'gather' };
  advance(w, 35);
  assert.equal(blocked.amount, 1000); assert.ok(reachable.amount < 1000); assert.equal(u.order.targetId, reachable.id);
});

test('enemy farms cannot be harvested and resource rally recruits gather and deposit', () => {
  const w = emptyWorld(), u = w._spawn('villager', 1, 13, 13), enemyFarm = w._building('farm', 2, 16, 16, 1);
  w.navigation.rebuild(); assert.equal(w.command('gather', { unitIds: [u.id], targetId: enemyFarm.id }).ok, false);
  const hall = w._building('guildhall', 1, 8, 8, 1), n = w._node('wood', 15.5, 10.5, 1000); w.navigation.rebuild();
  assert.equal(w.command('rally', { buildingId: hall.id, targetId: n.id }).ok, true);
  assert.equal(w.command('train', { buildingId: hall.id, kind: 'villager' }).ok, true);
  const before = w.state.teams[1].resources.wood; advance(w, 50);
  const recruit = workers(w).find(e => e.id !== u.id);
  assert.ok(recruit); assert.equal(recruit.order.type, 'gather'); assert.equal(recruit.order.resource, 'wood');
  assert.ok(w.state.teams[1].resources.wood > before);
});

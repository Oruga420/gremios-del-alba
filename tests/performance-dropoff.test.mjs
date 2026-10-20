import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { BUILDINGS, UNITS, TERRAIN } from '../src/game/data.js';

function emptyWorld() {
  const world = new World({ mode: 'peaceful' });
  world.state.units = []; world.state.buildings = []; world.state.nodes = [];
  world.state.map.terrain.fill(TERRAIN.GRASS);
  world._indexes(); world.navigation.rebuild();
  return world;
}

// Previous production selector remains an independent behavioral oracle.
function originalDropoff(world, unit, kind) {
  return world.state.buildings.filter(b => b.team === unit.team && b.progress === 1 && b.hp > 0 && (BUILDINGS[b.kind].dropoff || []).includes(kind))
    .sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y))
    .find(b => { const field = world.navigation.field(b.x, b.y, UNITS[unit.kind].movement, b); return field && field.distance[Math.floor(unit.y) * 80 + Math.floor(unit.x)] >= 0; });
}

test('dropoff preserves first-building ties and live team/resource eligibility', () => {
  const world = emptyWorld(), first = world._building('lumber_camp', 1, 10, 10, 1);
  const second = world._building('lumber_camp', 1, 20, 10, 1);
  world._building('lumber_camp', 2, 15, 11, 1);
  world._building('mill', 1, 15, 8, 1);
  world.navigation.rebuild(); const unit = world._spawn('villager', 1, 15, 10);
  unit.x = 15; unit.y = 10;
  assert.equal(world._dropoff(unit, 'wood'), first);
  first.hp = 0; assert.equal(world._dropoff(unit, 'wood'), second);
  second.progress = .9; assert.equal(world._dropoff(unit, 'wood'), undefined);
  assert.equal(world._dropoff(unit, 'gold'), undefined);
});

test('dropoff sees completion, creation, destruction, navigation and unit changes within one step', () => {
  const world = emptyWorld(), far = world._building('lumber_camp', 1, 30, 10, 1);
  const near = world._building('lumber_camp', 1, 12, 10, .9999);
  world.navigation.rebuild(); const unit = world._spawn('villager', 1, 11, 10);
  unit.order = { type: 'gather' };
  world._gather = function () {
    const check = kind => assert.equal(this._dropoff(unit, kind), originalDropoff(this, unit, kind));
    check('wood'); assert.equal(this._dropoff(unit, 'wood'), far);
    unit.order = { type: 'build', targetId: near.id }; this._build(unit, .1);
    assert.equal(near.progress, 1); check('wood'); assert.equal(this._dropoff(unit, 'wood'), near);
    near.hp = 0; check('wood'); assert.equal(this._dropoff(unit, 'wood'), far);
    const added = this._building('lumber_camp', 1, 8, 10, 1);
    this.navigation.rebuild(); check('wood'); assert.equal(this._dropoff(unit, 'wood'), added);
    for (let y = 0; y < 80; y++) this.state.map.terrain[y * 80 + 10] = TERRAIN.CLIFF;
    this.navigation.rebuild(); check('wood'); assert.equal(this._dropoff(unit, 'wood'), far);
    unit.x = 7.5; check('wood'); assert.equal(this._dropoff(unit, 'wood'), added);
    unit.team = 2; check('wood'); assert.equal(this._dropoff(unit, 'wood'), undefined);
    check('food');
  };
  world.tick(.1);
});

test('optimized delivery produces the same serialized state as the original selector and restored saves', () => {
  const world = new World({ mode: 'peaceful' });
  const node = world.state.nodes.find(n => n.kind === 'wood');
  const units = world.state.units.filter(u => u.team === 1 && u.kind === 'villager');
  world.command('gather', { unitIds: units.map(u => u.id), targetId: node.id });
  const reference = World.fromSave(world.serialize());
  reference._dropoff = function (unit, kind) { return originalDropoff(this, unit, kind); };
  for (let i = 0; i < 120; i++) { world.tick(.1); reference.tick(.1); }
  assert.ok(world.state.metrics.gatherCycles > 0);
  assert.deepEqual(world.serialize(), reference.serialize());
  const restored = World.fromSave(world.serialize());
  for (let i = 0; i < 40; i++) { world.tick(.1); restored.tick(.1); }
  assert.deepEqual(world.serialize(), restored.serialize());
});

test('one simulation step shares its depot scan and discards candidates before the next step', () => {
  const world = emptyWorld(), depot = world._building('lumber_camp', 1, 10, 10, 1);
  const unrelated = world._building('house', 1, 40, 40, 1);
  let unrelatedReads = 0;
  Object.defineProperty(unrelated, 'team', { enumerable: true, get() { unrelatedReads++; return 1; } });
  world.navigation.rebuild(); const unit = world._spawn('villager', 1, 9, 10);
  unit.order = { type: 'gather' };
  world._gather = function () {
    unrelatedReads = 0;
    for (let i = 0; i < 100; i++) assert.equal(this._dropoff(unit, 'wood'), depot);
    assert.equal(unrelatedReads, 1, 'Each delivery cohort scans unrelated buildings only once per step');
  };
  world.tick(.1);
  assert.equal(world._stepDropoffs, null);
  assert.equal(Object.hasOwn(world.serialize(), '_stepDropoffs'), false);
  world.tick(.1);
  depot.hp = 0;
  assert.equal(world._dropoff(unit, 'wood'), undefined, 'Queries outside a step cannot reuse a stale group');
});

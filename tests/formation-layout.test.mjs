import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { TERRAIN, UNITS } from '../src/game/data.js';
import { FORMATIONS, planFormation } from '../src/game/formations.js';

function openWorld() {
  const world = new World({ mode: 'peaceful' });
  world.state.units = []; world.state.buildings = []; world.state.nodes = [];
  world.state.map.terrain.fill(TERRAIN.GRASS);
  world._indexes(); world.navigation.rebuild();
  return world;
}

function spawn(world, count, kind = 'infantry', x = 20, y = 20) {
  return Array.from({ length: count }, () => world._spawn(kind, 1, x, y));
}

function assertLegalDistinct(world, result) {
  const goals = new Set();
  for (const item of result.filter(item => item.reachable)) {
    assert.ok(Number.isFinite(item.x) && Number.isFinite(item.y));
    assert.ok(item.x >= .2 && item.x <= 79.8 && item.y >= .2 && item.y <= 79.8);
    assert.ok(world.navigation.walkable(Math.floor(item.x), Math.floor(item.y), UNITS[item.unit.kind].movement));
    const key = `${item.x}:${item.y}`;
    assert.ok(!goals.has(key), 'Every reachable member needs a distinct goal');
    goals.add(key);
  }
  const reached = result.filter(item => item.reachable);
  for (let a = 0; a < reached.length; a++) for (let b = a + 1; b < reached.length; b++) {
    assert.ok(Math.hypot(reached[a].x - reached[b].x, reached[a].y - reached[b].y) >= .45 - 1e-7,
      'Physical destination separation must survive fallback placement');
  }
}

test('formation planning leaves game state intact and is stable under selection order', () => {
  const world = openWorld(), units = spawn(world, 30);
  const withoutRouteHints = () => {
    const saved = world.serialize();
    // Navigation may retain descriptors of the shared field the planner warmed.
    delete saved.navigationFields; delete saved.navigationQueue;
    return saved;
  };
  const saved = withoutRouteHints();
  assert.deepEqual(FORMATIONS, ['line', 'box', 'staggered']);
  for (const kind of FORMATIONS) {
    const plan = planFormation(world, units, { x: 40, y: 40 }, kind);
    assert.equal(plan.length, units.length);
    assert.ok(plan.every(item => item.reachable && item.marchSpeed === 2.5));
    assertLegalDistinct(world, plan);
    const byId = result => result.map(({ unit, ...item }) => ({ id: unit.id, ...item })).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(byId(plan), byId(planFormation(world, [...units].reverse(), { x: 40, y: 40 }, kind)));
  }
  assert.deepEqual(withoutRouteHints(), saved);
  assert.throws(() => planFormation(world, units, { x: 40, y: 40 }, 'unknown'), /formation/i);
});

test('line, box and staggered layouts have distinct geometry and line has wider frontage', () => {
  const world = openWorld(), units = spawn(world, 30);
  const layouts = Object.fromEntries(FORMATIONS.map(kind => [kind, planFormation(world, units, { x: 20.5, y: 40.5 }, kind)]));
  const width = items => Math.max(...items.map(item => item.x)) - Math.min(...items.map(item => item.x));
  const signature = items => items.map(item => `${item.x.toFixed(4)}:${item.y.toFixed(4)}`).sort().join('|');
  assert.ok(width(layouts.line) > width(layouts.box) * 1.5);
  assert.equal(new Set(Object.values(layouts).map(signature)).size, 3);
});

test('frontline roles precede support roles and the slowest group member sets march speed', () => {
  const world = openWorld();
  const units = [...spawn(world, 6, 'healer'), ...spawn(world, 6, 'heavy_knight'), ...spawn(world, 6, 'archer')];
  const plan = planFormation(world, units, { x: 20.5, y: 40.5 }, 'box');
  const averageY = kind => {
    const members = plan.filter(item => item.unit.kind === kind);
    return members.reduce((sum, item) => sum + item.y, 0) / members.length;
  };
  assert.ok(averageY('heavy_knight') > averageY('archer'));
  assert.ok(averageY('archer') > averageY('healer'));
  assert.ok(plan.every(item => item.marchSpeed === 2.5 && item.marchSpeed <= UNITS[item.unit.kind].speed));
});

test('closed wall components remain unreachable and an open gate reconnects all destination slots', () => {
  const world = openWorld(), units = spawn(world, 30, 'infantry', 30, 40);
  for (let y = 0; y < 80; y++) if (y !== 40) world._building('wall', 1, 40, y, 1);
  const gate = world._building('gate', 1, 40, 40, 1);
  world.navigation.rebuild();
  const closed = planFormation(world, units, { x: 60, y: 40 }, 'box');
  assert.ok(closed.every(item => !item.reachable));
  assert.ok(closed.every(item => [item.x, item.y, item.anchorX, item.anchorY].every(Number.isFinite)));
  gate.open = true; world.navigation.rebuild();
  const opened = planFormation(world, units, { x: 60, y: 40 }, 'box');
  assert.ok(opened.every(item => item.reachable));
  assertLegalDistinct(world, opened);
});

test('map-edge fallback stays legal, distinct, connected and avoids nonselected occupied cells', () => {
  const world = openWorld(), units = spawn(world, 30);
  const other = world._spawn('infantry', 2, 77, 77);
  for (const kind of FORMATIONS) {
    const plan = planFormation(world, units, { x: 79.99, y: 79.99 }, kind);
    assert.ok(plan.every(item => item.reachable));
    assertLegalDistinct(world, plan);
    assert.ok(plan.every(item => Math.floor(item.x) !== Math.floor(other.x) || Math.floor(item.y) !== Math.floor(other.y)));
  }
});

test('mixed land and water selections build only one normalized field for each movement class', () => {
  const world = openWorld();
  for (let y = 0; y < 80; y++) for (let x = 40; x < 80; x++) world.state.map.terrain[y * 80 + x] = TERRAIN.WATER;
  world.navigation.rebuild();
  const units = [...spawn(world, 15, 'infantry', 30, 40), ...spawn(world, 15, 'war_boat', 50, 40)];
  let calls = 0;
  const field = world.navigation.field.bind(world.navigation);
  world.navigation.field = (...args) => { calls++; return field(...args); };
  const plan = planFormation(world, units, { x: 40, y: 40 }, 'staggered');
  assert.equal(calls, 2);
  assert.ok(plan.every(item => item.reachable));
  assertLegalDistinct(world, plan);
  assert.ok(plan.every(item => UNITS[item.unit.kind].movement === 'land' ? item.x < 40 : item.x >= 40));
});

test('a thousand-unit plan stays sub-tile, bounded and shares one full route field', () => {
  const world = openWorld(), units = spawn(world, 1000);
  let calls = 0, walkableChecks = 0;
  const field = world.navigation.field.bind(world.navigation), walkable = world.navigation.walkable.bind(world.navigation);
  world.navigation.field = (...args) => { calls++; return field(...args); };
  world.navigation.walkable = (...args) => { walkableChecks++; return walkable(...args); };
  const plan = planFormation(world, units, { x: 40, y: 40 }, 'box');
  assert.equal(calls, 1);
  assert.ok(walkableChecks < 400000, `Placement must not scan the map for each of 1000 members: ${walkableChecks}`);
  assert.ok(plan.every(item => item.reachable));
  assertLegalDistinct(world, plan);
  const width = Math.max(...plan.map(item => item.x)) - Math.min(...plan.map(item => item.x));
  const height = Math.max(...plan.map(item => item.y)) - Math.min(...plan.map(item => item.y));
  assert.ok(Math.max(width, height) < 24, '1000-member box must not expand to one tile per member');
});

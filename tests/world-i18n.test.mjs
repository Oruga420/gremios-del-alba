import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { World } from '../src/game/world.js';
import { TECHNOLOGIES } from '../src/game/data.js';
import { DICTIONARIES, t } from '../src/i18n/index.js';
import '../src/i18n/names.js';
import worldEs from '../src/i18n/dict/es/world.js';
import dataEs from '../src/i18n/dict/es/data.js';

const es = DICTIONARIES.es;
const spanish = record => t(record.i18n.key, record.i18n.params, 'es');
const known = key => Object.hasOwn(worldEs, key) || Object.hasOwn(dataEs, key);

function checkRecord(record, field) {
  assert.ok(record.i18n && typeof record.i18n.key === 'string', `missing i18n on ${JSON.stringify(record)}`);
  assert.ok(known(record.i18n.key), `unknown key ${record.i18n.key}`);
  assert.equal(spanish(record), record[field], `Spanish interpolation of ${record.i18n.key}`);
  // Params stay language-neutral: primitives, entity refs or nested dictionary refs.
  for (const value of Object.values(record.i18n.params || {})) {
    if (value && typeof value === 'object') {
      assert.ok('kind' in value || ('key' in value && known(value.key)), JSON.stringify(value));
    } else assert.ok(['string', 'number'].includes(typeof value));
  }
}

/** Records every command result, including the AI's internal commands. */
function recording(world) {
  const results = [];
  const original = world._command.bind(world);
  world._command = (...args) => { const result = original(...args); results.push(result); return result; };
  return results;
}

test('every world.* key referenced by world.js exists in the Spanish world dictionary', async () => {
  const source = await readFile(new URL('../src/game/world.js', import.meta.url), 'utf8');
  const keys = new Set([...source.matchAll(/'(world\.[a-zA-Z0-9_.]+)'/g)].map(match => match[1]));
  for (const plural of source.matchAll(/`(world\.[a-zA-Z0-9_.]+)\.\$\{/g)) { keys.add(`${plural[1]}.one`); keys.add(`${plural[1]}.other`); }
  assert.ok(keys.size > 50);
  for (const key of keys) assert.ok(Object.hasOwn(worldEs, key), key);
  for (const key of Object.keys(worldEs)) assert.ok(key.startsWith('world.'), key);
  for (const key of Object.keys(worldEs)) assert.equal(es[key], worldEs[key]);
});

test('starting event and command results carry keys that reproduce the Spanish text', () => {
  const w = new World({ mode: 'conquest' });
  checkRecord(w.state.events[0], 'text');
  assert.equal(w.state.events[0].text, 'Tu gremio despierta. Reúne recursos, construye y protege el Alba.');
  const results = recording(w);
  const own = w.state.units.filter(u => u.team === 1), enemy = w.state.units.find(u => u.team === 2);
  const villager = own.find(u => u.kind === 'villager'), infantry = own.find(u => u.kind === 'infantry');
  const hall = w.state.buildings.find(b => b.team === 1 && b.kind === 'guildhall');
  const house = w.state.buildings.find(b => b.team === 1 && b.kind === 'house');
  const wood = w.state.nodes.find(n => n.kind === 'wood');
  const calls = [
    ['pause', { paused: true }], ['pause', { paused: false }], ['pause', { paused: 1 }], ['speed', { speed: 2 }], ['speed', { speed: 3 }],
    ['rename', { unitId: villager.id, name: 'Aurora' }], ['rename', { unitId: villager.id, name: '' }], ['rename', { unitId: 'zz', name: 'x' }],
    ['move', { unitIds: [infantry.id], x: 30, y: 30 }], ['move', { unitIds: [infantry.id], x: -1, y: 30 }], ['move', { unitIds: [enemy.id], x: 1, y: 1 }],
    ['formation', { unitIds: own.slice(12).map(u => u.id), kind: 'line', x: 30, y: 30 }], ['formation', { unitIds: [infantry.id], kind: 'nope' }],
    ['stop', { unitIds: [infantry.id] }], ['defend', { unitIds: [infantry.id], x: 20, y: 20 }], ['defend', { unitIds: [infantry.id], targetId: enemy.id }],
    ['gather', { unitIds: [villager.id], targetId: wood.id }], ['gather', { unitIds: [villager.id], targetId: 'n999999' }],
    ['build', { unitIds: [infantry.id], kind: 'house', x: 30, y: 20 }], ['build', { unitIds: [villager.id], kind: 'castle', x: 30, y: 20 }],
    ['wall', { unitIds: [villager.id], kind: 'house', x: 1, y: 1, endX: 2, endY: 2 }],
    ['repair', { unitIds: [villager.id], targetId: house.id }],
    ['train', { buildingId: hall.id, kind: 'villager' }], ['train', { buildingId: hall.id, kind: 'dragon' }],
    ['cancel_train', { buildingId: hall.id, queueIndex: 0 }], ['cancel_train', { buildingId: hall.id, queueIndex: 9 }],
    ['rally', { buildingId: hall.id, x: 20, y: 20 }], ['rally', { buildingId: 'b999999', x: 20, y: 20 }], ['rally', { buildingId: hall.id, targetId: 'n999999' }],
    ['gate', { buildingId: hall.id, open: true }], ['research', { buildingId: hall.id, technologyId: 'nothing' }],
    ['advance_age', { buildingId: house.id }], ['trade', { resource: 'wood', amount: 5, direction: 'buy' }],
    ['attack', { unitIds: [infantry.id], targetId: enemy.id }], ['attack', { unitIds: [infantry.id], targetId: villager.id }],
    ['convert', { unitIds: [infantry.id], targetId: enemy.id }], ['cast', { unitIds: [infantry.id], spell: 'heal', x: 20, y: 20 }],
    ['teleport', {}], ['move', null],
  ];
  for (const [type, args] of calls) w.command(type, args);
  for (let i = 0; i < 300; i++) w.tick(0.5);
  const seen = new Set();
  for (const result of results) { checkRecord(result, 'message'); seen.add(result.i18n.key); }
  for (const event of w.state.events) checkRecord(event, 'text');
  for (const key of ['world.done.paused', 'world.done.resumed', 'world.done.renamed', 'world.fail.nameRules', 'world.done.marching', 'world.done.trainQueued', 'world.fail.unknownCommand', 'world.fail.invalidArgs'])
    assert.ok(seen.has(key), key);
});

test('simulation events (built, researched, age, fallen, converted, victory) keep their Spanish text', () => {
  const w = new World({ mode: 'conquest' });
  const hall = w.state.buildings.find(b => b.team === 1 && b.kind === 'guildhall');
  const smithy = w.state.buildings.find(b => b.team === 1 && TECHNOLOGIES.forging && b.kind === TECHNOLOGIES.forging.producer) || hall;
  smithy.queue.push({ type: 'research', kind: 'forging', remaining: 0.01, duration: 1, cost: { wood: 0, food: 0, gold: 0, stone: 0 } });
  hall.queue.push({ type: 'age', kind: '2', remaining: 0.01, duration: 1, cost: { wood: 0, food: 0, gold: 0, stone: 0 } });
  const villager = w.state.units.find(u => u.team === 1 && u.kind === 'villager');
  let plot = null;
  for (let y = 4; y < 40 && !plot; y++) for (let x = 4; x < 40 && !plot; x++) if (w._plot('house', x, y) && Math.hypot(x - villager.x, y - villager.y) < 8) plot = { x, y };
  const build = w.command('build', { unitIds: [villager.id], kind: 'house', x: plot.x, y: plot.y });
  assert.ok(build.ok, build.message);
  w.getEntity(build.buildingIds[0]).progress = 0.999;
  const enemy = w.state.units.find(u => u.team === 2 && u.kind === 'infantry');
  w._damage(enemy, 1e6, null);
  const wizard = w._spawn('wizard', 1, 20, 20), convertee = w._spawn('villager', 2, 21, 20);
  w._order(wizard, { type: 'convert', targetId: convertee.id, conversion: 1e6 });
  for (let i = 0; i < 200 && !w.state.events.some(e => e.i18n?.key === 'world.event.built'); i++) w.tick(0.1);
  for (const b of w.state.buildings) if (b.team === 2 && b.kind === 'guildhall') b.hp = 0;
  w.tick(0.1);
  const keys = w.state.events.map(e => e.i18n?.key);
  for (const key of ['world.event.start', 'world.event.researched', 'world.event.ageReached', 'world.event.fallen', 'world.event.built', 'world.event.converted', 'world.event.victory'])
    assert.ok(keys.includes(key), `${key} in ${keys.join(',')}`);
  for (const event of w.state.events) checkRecord(event, 'text');
  const researched = w.state.events.find(e => e.i18n.key === 'world.event.researched');
  assert.deepEqual(researched.i18n.params, { technology: { key: 'data.tech.forging' } });
  assert.equal(researched.text, `${TECHNOLOGIES.forging.name} investigado`);
  // Localized rendering follows the active dictionary, not the Spanish save text.
  assert.equal(t('world.event.ageReached', { age: 3 }, 'es'), 'Tu gremio alcanza la era 3');
});

test('saves load with and without the optional i18n field; malformed i18n is dropped', () => {
  const w = new World();
  const save = w.serialize();
  assert.ok(save.events[0].i18n);
  assert.deepEqual(World.fromSave(save).state.events[0].i18n, save.events[0].i18n);
  const legacy = structuredClone(save); for (const event of legacy.events) delete event.i18n;
  assert.equal(World.fromSave(legacy).state.events[0].i18n, undefined);
  assert.equal(World.fromSave(legacy).state.events[0].text, save.events[0].text);
  const bad = [
    'world.event.start', null, [], { key: 'has spaces' }, { key: 'x'.repeat(121) }, { key: 7 }, { key: 'world.event.built', params: [] },
    { key: 'world.event.built', params: { building: { kind: 'house', evil: 1 } } }, { key: 'world.event.built', extra: true },
    { key: 'world.event.built', params: { building: { kind: 'house', name: { deep: true } } } },
    { key: 'world.event.researched', params: { technology: { key: '<script>' } } },
  ];
  for (const i18n of bad) {
    const tampered = structuredClone(save); tampered.events[0].i18n = i18n;
    const loaded = World.fromSave(tampered);
    assert.equal(loaded.state.events[0].i18n, undefined, JSON.stringify(i18n));
    assert.equal(loaded.state.events[0].text, save.events[0].text);
  }
  const good = structuredClone(save);
  good.events.push({ time: 0, text: 'Granja terminado', kind: 'build', i18n: { key: 'world.event.built', params: { building: { kind: 'farm', name: 'Granja' } } } });
  good.events.push({ time: 0, text: 'x investigado', kind: 'research', i18n: { key: 'world.event.researched', params: { technology: { key: 'data.tech.forging' } } } });
  const loaded = World.fromSave(good);
  assert.deepEqual(loaded.state.events.at(-2).i18n, good.events.at(-2).i18n);
  assert.deepEqual(loaded.state.events.at(-1).i18n, good.events.at(-1).i18n);
});

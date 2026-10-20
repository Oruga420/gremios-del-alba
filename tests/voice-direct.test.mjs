import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/game/world.js';
import { BUILDINGS, UNITS } from '../src/game/data.js';
import { createVoiceRegistry, exportRegistry } from '../src/voice/registry.js';
import { parseSpanishCommand } from '../src/voice/spanish.js';
import { exportPersonalDefinition } from '../scripts/personal-voice.mjs';
import { prepared, plot } from './world-scenarios.mjs';

function harness() {
  const calls = [];
  const game = { world: prepared({ mode: 'conquest' }), worldGeneration: 1, selectedIds: [],
    execute(type, args) { calls.push(type); return this.world.command(type, args); },
    select(ids) { this.selectedIds = ids; },
    newMatch(args) { this.world = new World(args); this.worldGeneration++; return { ok: true }; },
    save() { return { ok: true }; }, load(raw) { this.world = World.fromSave(raw); this.worldGeneration++; return { ok: true }; }
  };
  const registry = createVoiceRegistry(game);
  const text = (value) => { const parsed = parseSpanishCommand(value, { game, confirm: registry.confirm, mode: registry.mode }); return parsed.error || registry.runTool(parsed.name, parsed.input); };
  return { game, registry, text, calls };
}

test('DIRECT01 default gather/build/train/attack execute synchronously without a pause or proposal', () => {
  const h = harness(), { world } = h.game;
  const luna = world.state.units.find((unit) => unit.name === 'Luna');
  assert.equal(h.text('Luna recoge madera').code, 'EXECUTED');
  assert.equal(luna.order.type, 'gather');
  const wood = world.summary().resources.wood, buildingCount = world.state.buildings.length;
  assert.equal(h.registry.runTool('propose_build', { target: 'Luna', kind: 'house', ...plot(world, 'house') }).code, 'EXECUTED');
  assert.equal(world.state.buildings.length, buildingCount + 1);
  assert.equal(world.summary().resources.wood, wood - BUILDINGS.house.cost.wood);
  const gold = world.summary().resources.gold;
  assert.equal(h.text('Entrena cinco arqueros').code, 'EXECUTED');
  assert.equal(world.summary().reservedPopulation, 5);
  assert.equal(world.summary().resources.gold, gold - UNITS.archer.cost.gold * 5);
  const enemy = world.state.units.find((unit) => unit.team === 2);
  assert.equal(h.registry.runTool('propose_attack', { target: 'heavy knight', enemy: enemy.id }).code, 'EXECUTED');
  assert.equal(world.state.units.find((unit) => unit.team === 1 && unit.kind === 'heavy_knight').order.targetId, enemy.id);
  assert.equal(h.registry.mode, 'direct');
  assert.equal(h.registry.confirm.pending, false);
  assert.equal(h.registry.confirm.getState(), null);
  assert.equal(world.state.paused, false);
  assert.equal(h.calls.includes('pause'), false);
});

test('DIRECT02 legacy confirmation and response completion never replay an executed command', () => {
  const h = harness();
  const trained = h.text('Entrena cinco arqueros');
  const resources = { ...h.game.world.summary().resources };
  assert.equal(trained.code, 'EXECUTED');
  assert.equal(h.text('Confirma').code, 'NO_CONFIRMATION_NEEDED');
  assert.equal(h.registry.runTool('confirm_action', { proposalId: 'old-proposal', confirmationText: 'sí' }).code, 'NO_CONFIRMATION_NEEDED');
  h.registry.confirm.speechEnded({ proposalId: 'old-proposal', worldGeneration: 1, sessionEpoch: 1 });
  h.registry.confirm.tick();
  assert.equal(h.game.world.summary().reservedPopulation, 5);
  assert.deepEqual(h.game.world.summary().resources, resources);
  assert.equal(h.calls.filter((type) => type === 'train').length, 1);
});

test('DIRECT03 Alto stops ongoing orders without rolling back completed actions or resource charges', () => {
  const h = harness(), luna = h.game.world.state.units.find((unit) => unit.name === 'Luna');
  h.text('Luna recoge madera');
  const stopped = h.text('Alto');
  assert.equal(stopped.code, 'UNITS_STOPPED');
  assert.equal(luna.order.type, 'idle');
  assert.doesNotMatch(stopped.speak, /cancel|deshech/iu);
  h.game.select([luna.id]); h.text('Aldeanos recoge madera'); h.text('Alto');
  assert.ok(h.game.world.state.units.filter((unit) => unit.team === 1 && unit.kind === 'villager').every((unit) => unit.order.type === 'idle'));
  h.game.select([]);
  h.text('Entrena cinco arqueros');
  const resources = { ...h.game.world.summary().resources };
  assert.equal(h.text('Alto').code, 'NO_ACTIVE_UNITS');
  assert.equal(h.game.world.summary().reservedPopulation, 5);
  assert.deepEqual(h.game.world.summary().resources, resources);
  h.game.select([luna.id]);
  assert.equal(h.text('Alto').code, 'UNITS_STOPPED');
});

test('DIRECT04 input, ownership, affordability, population and aborted requests remain validated', () => {
  const h = harness(), world = h.game.world;
  const enemy = world.state.units.find((unit) => unit.team === 2);
  assert.equal(h.registry.runTool('propose_move', { target: enemy.id, x: 10, y: 10 }).ok, false);
  assert.equal(h.registry.runTool('propose_train', { kind: 'archer', quantity: 1, team: 2 }).code, 'INVALID_INPUT');
  world.state.teams[1].resources.food = 0;
  assert.equal(h.registry.runTool('propose_train', { kind: 'villager', quantity: 1 }).code, 'ENGINE_REJECTED');
  assert.equal(world.summary().reservedPopulation, 0);
  world.state.teams[1].resources.food = 100000;
  while (world.summary().population < world.summary().capacity) world._spawn('villager', 1, 12, 14);
  assert.equal(h.registry.runTool('propose_train', { kind: 'villager', quantity: 1 }).code, 'ENGINE_REJECTED');
  assert.equal(h.registry.runTool('propose_gather', { target: 'Luna', resource: 'wood' }, { signal: AbortSignal.abort() }).code, 'ABORTED');
  assert.equal(world.state.paused, false);
});

test('DIRECT05 Alto cannot target a replacement world through stale IDs or session bindings', () => {
  const h = harness(); h.text('Luna recoge madera');
  h.game.newMatch({ mode: 'peaceful' });
  assert.equal(h.text('Alto').code, 'NO_ACTIVE_UNITS');
  assert.equal(h.game.world.state.units.find((unit) => unit.name === 'Luna').order.type, 'idle');
  h.text('Luna recoge madera'); h.registry.confirm.invalidate('DISCONNECTED');
  assert.equal(h.text('Alto').code, 'NO_ACTIVE_UNITS');
});

test('DIRECT06 canonical and vendor definitions prescribe terse immediate game orders', async () => {
  const tools = exportRegistry(), definition = await exportPersonalDefinition();
  for (const tool of tools) assert.doesNotMatch(tool.description, /propone|propuesta|requiere confirmaci[oó]n|ventana de alto/iu, tool.name);
  assert.equal(definition.conversation_config.agent.first_message, 'Listo.');
  assert.match(definition.conversation_config.agent.prompt.prompt, /1 a 4 palabras/u);
  assert.match(definition.conversation_config.agent.prompt.prompt, /sin pedir confirmación/u);
  assert.ok(definition.conversation_config.agent.prompt.max_tokens >= 1024);
  assert.equal(definition.conversation_config.turn.turn_eagerness, 'eager');
  assert.equal(definition.conversation_config.tts.model_id, 'eleven_flash_v2_5');
  assert.equal(definition.conversation_config.tts.speed, 1.2);
  assert.ok(definition.conversation_config.agent.prompt.tools.every((tool) => tool.pre_tool_speech === 'off' && tool.execution_mode === 'immediate'));
});

test('DIRECT07 direct orders preserve a manually owned pause and its revision', () => {
  const h = harness(); h.game.execute('pause', { paused: true });
  const revision = h.game.world.state.pauseRevision;
  assert.equal(h.text('Luna recoge madera').code, 'EXECUTED');
  assert.equal(h.game.world.state.paused, true);
  assert.equal(h.game.world.state.pauseRevision, revision);
  assert.equal(h.calls.filter((type) => type === 'pause').length, 1);
});

test('DIRECT08 a new explicit or mouse selection supersedes Alto fallback while unchanged selection preserves a group order', () => {
  for (const selection of ['voice', 'mouse']) {
    const h = harness(), units = h.game.world.state.units;
    const luna = units.find((unit) => unit.name === 'Luna'), knight = units.find((unit) => unit.team === 1 && unit.kind === 'heavy_knight');
    h.game.execute('move', { unitIds: [knight.id], x: 20, y: 20 });
    h.text('Luna recoge madera');
    if (selection === 'voice') h.registry.runTool('select_units', { target: knight.id });
    else h.game.select([knight.id]);
    assert.equal(h.text('Alto').code, 'UNITS_STOPPED');
    assert.equal(knight.order.type, 'idle');
    assert.equal(luna.order.type, 'gather');
    h.game.select([luna.id]); h.text('Aldeanos recoge madera'); h.text('Alto');
    assert.ok(units.filter((unit) => unit.team === 1 && unit.kind === 'villager').every((unit) => unit.order.type === 'idle'));
  }
});

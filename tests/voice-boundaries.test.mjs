import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createBrowserSpeech } from '../src/voice/speech.js';
import { createVoiceRegistry, resolveUnits } from '../src/voice/registry.js';
import { parseSpanishCommand } from '../src/voice/spanish.js';
import { TERRAIN } from '../src/game/data.js';
import { prepared, step } from './world-scenarios.mjs';

function gameHarness() {
  return { world: prepared(), worldGeneration: 1, selectedIds: [],
    execute(type, args) { return this.world.command(type, args); },
    announce() {}, select(ids) { this.selectedIds = ids; } };
}

test('world replacement stops browser recognition and rejects a previously captured final callback', t => {
  const coordinator = fs.readFileSync(new URL('../src/voice/index.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gmu, '').replace('export function initializeVoice', 'function initializeVoice');
  let handlers, recognition;
  class Recognition { constructor() { recognition = this; } start() { this.onstart?.(); } abort() { this.aborted = true; } }
  const game = gameHarness(), win = new EventTarget(), doc = new EventTarget(); doc.querySelector = () => ({});
  const panel = { panel: { hidden: false }, visible() {}, addTranscript() {}, setStatus() {}, setProposal() {}, setNative() {}, setLocalReady() {}, setAgentAvailability() {}, destroy() {} };
  const context = { window: win, document: doc, AbortController, setInterval, clearInterval, setTimeout, queueMicrotask,
    fetch: async () => Response.json({ ready: true }), createVoiceRegistry, parseSpanishCommand,
    mountVoicePanel: options => { handlers = options; return panel; },
    createBrowserSpeech: options => createBrowserSpeech({ ...options, recognitionClass: Recognition }),
    createLocalSpeech: () => ({ active: false, destroy() {} }), createPersonalAgent: () => ({ engaged: false, destroy() {} }),
    registerNativeTools: async () => ({ destroy() {} }) };
  vm.createContext(context); vm.runInContext(coordinator, context);
  const voice = context.initializeVoice(game); t.after(() => voice.destroy());
  handlers.onMic({ isTrusted: true }, 'es-MX', 'browser');
  const delayed = recognition.onresult;
  game.world = prepared(); game.worldGeneration++;
  win.dispatchEvent(new Event('worldchange'));
  delayed({ resultIndex: 0, results: [Object.assign([{ transcript: 'Luna recoge madera' }], { isFinal: true })] });
  assert.equal(game.world.state.units.find(u => u.name === 'Luna').order.type, 'idle');
  assert.equal(recognition.aborted, true);
});

function separatedBuilders() {
  const game = gameHarness(), registry = createVoiceRegistry(game);
  const preferred = resolveUnits(game, undefined, { workers: true })[0];
  for (let y = 0; y < 80; y++) game.world._building('wall', 1, 25, y, 1);
  game.world.navigation.rebuild(); Object.assign(preferred, game.world.navigation.nearest(60, 60));
  return { game, registry, preferred };
}

test('automatic house and wall orders choose a reachable builder and actually complete', () => {
  for (const [tool, input] of [['propose_build', { kind: 'house' }], ['propose_wall', { kind: 'palisade', location: 'al sur' }]]) {
    const { game, registry, preferred } = separatedBuilders(), before = game.world.state.buildings.length;
    assert.equal(registry.runTool(tool, input).code, 'EXECUTED');
    const audit = registry.getAudit().at(-1);
    assert.equal(audit.targetIds.length, 1); assert.notEqual(audit.targetIds[0], preferred.id);
    assert.equal(preferred.order.type, 'idle');
    const built = game.world.state.buildings.slice(before);
    assert.equal(built.length, tool === 'propose_wall' ? 7 : 1);
    step(game.world, 90);
    assert.ok(built.every(b => b.progress === 1));
  }
});

test('stopping recognition while handling a final result discards the rest of that result batch', () => {
  let recognition;
  class Recognition { constructor() { recognition = this; } start() {} abort() {} }
  const transcripts = [];
  const speech = createBrowserSpeech({ recognitionClass: Recognition, onStatus() {}, onTranscript(text) {
    transcripts.push(text); speech.stop('world-changed');
  } });
  speech.start({ isTrusted: true });
  recognition.onresult({ resultIndex: 0, results: ['carga la partida', 'Luna recoge madera'].map(transcript => Object.assign([{ transcript }], { isFinal: true })) });
  assert.deepEqual(transcripts, ['carga la partida']);
});

test('unreachable explicit and selected builders are never silently replaced', () => {
  for (const selected of [false, true]) {
    const { game, registry, preferred } = separatedBuilders();
    if (selected) game.select([preferred.id]);
    const before = game.world.serialize();
    assert.equal(registry.runTool('propose_build', { kind: 'house', ...(selected ? {} : { target: preferred.id }) }).code, 'NO_LEGAL_PLACEMENT');
    assert.deepEqual(game.world.serialize(), before);
  }
});

test('selecciona grupo recalls its saved group through the registry instead of selecting a profession', () => {
  const game = gameHarness(), luna = game.world.state.units.find(u => u.name === 'Luna');
  const groups = {};
  game.view = (action, { group }) => { if (action === 'assign-group') groups[group] = [...game.selectedIds]; else if (action === 'recall-group') game.select(groups[group] || []); return { ok: true }; };
  const registry = createVoiceRegistry(game);
  const run = text => { const parsed = parseSpanishCommand(text); return parsed.error || registry.runTool(parsed.name, parsed.input); };
  game.select([luna.id]); assert.equal(run('guarda grupo 1').ok, true); game.select([]);
  assert.equal(run('selecciona grupo 1').ok, true); assert.deepEqual(game.selectedIds, [luna.id]);
  game.select([]); assert.equal(run('selecciona el grupo 1').ok, true); assert.deepEqual(game.selectedIds, [luna.id]);
});

test('shore construction uses reachable footprint edges rather than an unrelated nearest land tile', () => {
  for (const automatic of [true, false]) {
    const game = gameHarness(), world = game.world;
    world.state.units = []; world.state.buildings = []; world.state.nodes = []; world._indexes();
    world.state.map.terrain.fill(TERRAIN.CLIFF);
    for (let y = 20; y < 24; y++) for (let x = 20; x < 24; x++) world.state.map.terrain[y * 80 + x] = TERRAIN.GRASS;
    world._building('guildhall', 1, 20, 20, 1);
    for (let y = 30; y < 33; y++) for (let x = 30; x < 33; x++) world.state.map.terrain[y * 80 + x] = TERRAIN.WATER;
    for (const [x, y] of [[28, 30], [32, 32], [33, 32]]) world.state.map.terrain[y * 80 + x] = TERRAIN.GRASS;
    world.navigation.rebuild();
    const disconnected = world._spawn('villager', 1, 28, 30), reachable = world._spawn('villager', 1, 33, 32);
    assert.equal(world.canPlace('dock', 30, 30), true);
    assert.equal(world.navigation.field(30, 30).distance[30 * 80 + 28], 0);
    if (!automatic) game.select([disconnected.id]);
    const registry = createVoiceRegistry(game), before = world.serialize();
    const result = registry.runTool('propose_build', { kind: 'dock' });
    if (automatic) {
      assert.equal(result.code, 'EXECUTED');
      assert.deepEqual(registry.getAudit().at(-1).targetIds, [reachable.id]);
      const dock = world.state.buildings.at(-1); step(world, 40); assert.equal(dock.progress, 1);
    } else {
      assert.equal(result.code, 'NO_LEGAL_PLACEMENT');
      assert.deepEqual(world.serialize(), before);
    }
  }
});

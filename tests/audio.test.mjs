import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LOCALE_CODES } from '../src/i18n/index.js';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('assets/audio/manifest.json', root), 'utf8'));

test('audio module imports in Node without a DOM', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const audio = await import('../src/audio/index.js');
  assert.equal(typeof audio.installAudio, 'function');
  assert.equal(audio.installAudio({}), null, 'installAudio is a no-op without window/document');
});

test('audio manifest is valid', () => {
  assert.deepEqual([...manifest.languages].sort(), [...LOCALE_CODES].sort());
  const sfxIds = manifest.sfx.map(item => item.id);
  assert.equal(new Set(sfxIds).size, sfxIds.length, 'duplicate sfx ids');
  for (const item of manifest.sfx) {
    assert.match(item.id, /^[a-z0-9_]+$/);
    assert.equal(item.file, `sfx/${item.id}.mp3`);
    assert.ok(typeof item.prompt === 'string' && item.prompt.trim().length > 10, `${item.id} prompt`);
    assert.ok(Number.isFinite(item.duration_seconds) && item.duration_seconds >= 0.5 && item.duration_seconds <= 22, `${item.id} duration`);
  }
  assert.equal(manifest.voice.file_pattern, 'voice/{lang}/{id}.mp3');
  const lineIds = manifest.voice.lines.map(line => line.id);
  assert.equal(new Set(lineIds).size, lineIds.length, 'duplicate voice ids');
  for (const line of manifest.voice.lines) {
    assert.match(line.id, /^[a-z0-9_]+$/);
    for (const code of LOCALE_CODES) {
      const text = line.text?.[code];
      assert.ok(typeof text === 'string' && text.trim().length > 0, `${line.id}.${code} is empty`);
      if (code !== 'ja') assert.ok(text.trim().split(/\s+/).length <= 6, `${line.id}.${code} is longer than six words`);
      else assert.ok(text.length <= 16, `${line.id}.ja is too long`);
    }
  }
});

test('every sound the module can play is listed in the manifest', async () => {
  const { SFX_IDS, VOICE_IDS, EVENT_AUDIO } = await import('../src/audio/index.js');
  const sfx = new Set(manifest.sfx.map(item => item.id)), voice = new Set(manifest.voice.lines.map(line => line.id));
  for (const id of SFX_IDS) assert.ok(sfx.has(id), `sfx ${id} missing from manifest`);
  for (const id of VOICE_IDS) assert.ok(voice.has(id), `voice ${id} missing from manifest`);
  for (const [kind, entry] of Object.entries(EVENT_AUDIO)) {
    for (const id of [entry.sfx, entry.buildingSfx].filter(Boolean)) assert.ok(SFX_IDS.includes(id), `${kind} -> unknown sfx ${id}`);
    if (entry.voice) assert.ok(VOICE_IDS.includes(entry.voice), `${kind} -> unknown voice ${entry.voice}`);
  }
  const source = await readFile(new URL('src/audio/index.js', root), 'utf8');
  for (const [, id] of source.matchAll(/emit(?:Sfx|Voice)\('([a-z_]+)'/g)) assert.ok(sfx.has(id) || voice.has(id), `${id} is not in the manifest`);
});

test('event-kind mapping covers every world event kind', async () => {
  const { EVENT_AUDIO } = await import('../src/audio/index.js');
  const world = await readFile(new URL('src/game/world.js', root), 'utf8');
  const kinds = new Set();
  for (const [, args] of world.matchAll(/this\._event\(([^;]*?)\);/g)) {
    // Kinds are the bare lowercase string literals among the arguments (text is Spanish prose, keys contain dots).
    for (const [, kind] of args.matchAll(/'([a-z_]+)'/g)) kinds.add(kind);
  }
  // Defaults: _event(text, kind = 'info')
  kinds.add('info');
  for (const kind of ['build', 'combat', 'research', 'age', 'convert', 'victory', 'defeat']) assert.ok(kinds.has(kind), `parser missed ${kind}`);
  for (const kind of kinds) assert.ok(Object.hasOwn(EVENT_AUDIO, kind), `no audio mapping for world event kind '${kind}'`);
});

function fakeWorld() {
  return {
    combatEvents: Array(512), combatSequence: 0,
    state: { time: 0, events: [{ time: 0, text: 'start', kind: 'info', i18n: { key: 'world.event.start' } }], units: [{ id: 'u1', team: 1, hp: 10 }, { id: 'u2', team: 2, hp: 10 }], buildings: [{ id: 'b1', team: 1, hp: 100, progress: 1, queue: [] }], teams: { 1: { age: 1, upgrades: {}, resources: { wood: 0, stone: 0 } }, 2: { age: 1, upgrades: {}, resources: {} } } },
  };
}

test('watcher plays the start line, own events only, and throttles combat and alarms', async () => {
  const { createAudioWatcher } = await import('../src/audio/index.js');
  let now = 0;
  const cues = [];
  const watcher = createAudioWatcher(cue => cues.push(cue), { clock: () => now });
  const world = fakeWorld();
  watcher.poll(world);
  assert.deepEqual(cues, [{ voice: 'match_start' }]);
  cues.length = 0;

  // Enemy research: the world emits the event, but team 1 did not change -> silence.
  now = 5000; world.state.time = 5;
  world.state.events.push({ time: 5, text: 'x', kind: 'research', i18n: { key: 'world.event.researched' } });
  watcher.poll(world);
  assert.deepEqual(cues, []);
  // Own research.
  now = 10000; world.state.teams[1].upgrades.attack = true;
  world.state.events.push({ time: 6, text: 'x', kind: 'research', i18n: { key: 'world.event.researched' } });
  watcher.poll(world);
  assert.deepEqual(cues, [{ sfx: 'research_complete' }, { voice: 'research_complete' }]);
  cues.length = 0;

  // Training and conversion are detected from state.
  now = 20000; world.state.units.push({ id: 'u3', team: 1, hp: 10 }); world.state.units[1].team = 1;
  world.state.events.push({ time: 7, text: 'x', kind: 'convert', i18n: { key: 'world.event.converted' } });
  watcher.poll(world);
  assert.ok(cues.some(cue => cue.sfx === 'train_complete'));
  assert.ok(cues.some(cue => cue.sfx === 'conversion'));
  cues.length = 0;

  // A burst of enemy hits on team 1: horn + line once, combat sfx capped per second.
  now = 40000;
  for (let i = 0; i < 20; i++) {
    world.combatSequence++;
    world.combatEvents[(world.combatSequence - 1) % 512] = { seq: world.combatSequence, kind: 'hit', source: { kind: 'infantry', team: 2 }, target: { kind: 'villager', team: 1 }, amount: 5 };
  }
  watcher.poll(world);
  assert.equal(cues.filter(cue => cue.voice === 'under_attack').length, 1);
  assert.equal(cues.filter(cue => cue.sfx === 'under_attack_horn').length, 1);
  assert.ok(cues.filter(cue => cue.sfx === 'sword_hit').length <= 4);
  cues.length = 0;
  now = 45000;
  world.combatSequence++;
  world.combatEvents[(world.combatSequence - 1) % 512] = { seq: world.combatSequence, kind: 'hit', source: { kind: 'infantry', team: 2 }, target: { kind: 'villager', team: 1 }, amount: 5 };
  watcher.poll(world);
  assert.equal(cues.filter(cue => cue.voice === 'under_attack').length, 0, 'under attack is throttled to 20 s');

  // A loaded chronicle does not replay its history.
  cues.length = 0;
  const loaded = fakeWorld(); loaded.state.time = 300;
  loaded.state.events.push({ time: 290, text: 'v', kind: 'victory', i18n: { key: 'world.event.victory' } });
  watcher.poll(loaded);
  assert.deepEqual(cues, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfirmStore } from '../src/voice/confirm.js';
import { validateSchema, schemaDescriptions, vendorSchema } from '../src/voice/schema.js';

function harness(initialPaused = false) {
  let time = 100;
  const calls = [];
  const game = { worldGeneration: 1, world: { state: { paused: initialPaused, pauseRevision: 0 } }, execute(type, args) { if (type === 'pause') { this.world.state.paused = args.paused; this.world.state.pauseRevision++; } return { ok: true }; } };
  const store = createConfirmStore({ game, now: () => time, execute(action) { calls.push(action); return { ok: true, speak: 'Hecho.' }; } });
  return { store, game, calls, advance(ms) { time += ms; store.tick(); } };
}
const action = () => ({ toolName: 'propose_train', title: 'Entrenar', args: { quantity: 2 } });
test('unconfirmed expires by wall clock and restores pause', () => {
  const h = harness(); h.store.propose(action()); assert.equal(h.game.world.state.paused, true);
  h.advance(30_000); assert.equal(h.store.getState().state, 'expired'); assert.equal(h.calls.length, 0); assert.equal(h.game.world.state.paused, false);
});
test('missing speech end expires armed action instead of executing', () => {
  const h = harness(); const p = h.store.propose(action()); h.store.arm(p.proposalId, 'sí');
  h.advance(10_000); assert.equal(h.store.getState().result.code, 'SPEECH_END_MISSING'); h.advance(100_000); assert.equal(h.calls.length, 0); assert.equal(h.game.world.state.paused, false);
});
test('speech end starts full 4 second window; duplicate confirms/ticks execute once', () => {
  const h = harness(); const p = h.store.propose(action()); h.store.arm(p.proposalId, 'confirma'); assert.equal(h.store.arm(p.proposalId, 'sí'), null);
  h.advance(5000); assert.equal(h.calls.length, 0); h.store.speechEnded(p); h.advance(3999); assert.equal(h.calls.length, 0); h.advance(1); h.advance(10_000);
  assert.equal(h.calls.length, 1); assert.equal(h.store.getState().state, 'done'); assert.equal(h.game.world.state.paused, false);
});
test('stop before and during countdown cancels and invalidates late speech events', () => {
  for (const withSpeech of [false, true]) { const h = harness(); const p = h.store.propose(action()); h.store.arm(p.proposalId, 'sí'); if (withSpeech) h.store.speechEnded(p); h.advance(1500); h.store.stop(p.proposalId); assert.equal(h.store.speechEnded(p), null); h.advance(20_000); assert.equal(h.calls.length, 0); assert.equal(h.game.world.state.paused, false); }
});
test('new match/load with reused entity IDs invalidates old binding', () => {
  const h = harness(); const p = h.store.propose(action()); h.store.arm(p.proposalId, 'sí'); h.store.speechEnded(p);
  h.game.worldGeneration++; h.game.world = { state: { paused: false, pauseRevision: 0 } }; h.advance(4000);
  assert.equal(h.store.getState().state, 'invalidated'); assert.equal(h.calls.length, 0); assert.equal(h.game.world.state.paused, false); assert.equal(h.store.speechEnded(p), null);
});
test('disconnect invalidates the session epoch and releases tactical pause', () => {
  const h = harness(); const p = h.store.propose(action()); h.store.arm(p.proposalId, 'sí'); h.store.invalidate('DISCONNECTED'); assert.equal(h.store.sessionEpoch, 2); h.advance(4000); assert.equal(h.store.speechEnded(p), null); assert.equal(h.calls.length, 0); assert.equal(h.game.world.state.paused, false);
});
test('supersession preserves original pause and requires new confirmation', () => {
  for (const paused of [false, true]) { const h = harness(paused); const p = h.store.propose(action()); h.store.arm(p.proposalId, 'sí'); h.store.speechEnded(p); const next = h.store.propose(action()); assert.notEqual(next.proposalId, p.proposalId); assert.equal(h.store.speechEnded(p), null); h.advance(5000); assert.equal(h.calls.length, 0); h.store.stop(); assert.equal(h.game.world.state.paused, paused); }
});
test('manual pause ownership change is not undone by voice completion', () => {
  const h = harness(); h.store.propose(action()); h.game.execute('pause', { paused: true }); h.store.stop(); assert.equal(h.game.world.state.paused, true);
});
test('executor reentry cannot duplicate a confirmed command', () => {
  const h = harness(); const store = createConfirmStore({ game: h.game, now: () => 10_000, stopWindowMs: 0, execute() { store.tick(); h.calls.push('once'); return { ok: true }; } });
  const p = store.propose(action()); store.arm(p.proposalId, 'sí'); store.speechEnded(p); store.tick(); assert.equal(h.calls.length, 1);
});
test('schemas reject nonfinite values, unsafe extras and malformed nested input', () => {
  const schema = { type: 'object', description: 'Entrada', additionalProperties: false, required: ['ids', 'quantity'], properties: { ids: { type: 'array', description: 'IDs', minItems: 1, maxItems: 2, items: { type: 'integer', description: 'ID', minimum: 1 } }, quantity: { type: 'integer', description: 'Cantidad', minimum: 1, maximum: 100 } } };
  assert.deepEqual(validateSchema(schema, { ids: [1], quantity: 2 }), []); assert.ok(validateSchema(schema, { ids: [NaN], quantity: 1, script: 'eval' }).length >= 2); assert.ok(validateSchema(schema, { ids: [1], quantity: 1.5 }).length); assert.deepEqual(schemaDescriptions(schema), []); assert.equal(JSON.stringify(vendorSchema(schema)).includes('additionalProperties'), false);
});

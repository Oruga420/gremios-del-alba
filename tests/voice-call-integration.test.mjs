import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPersonalAgent } from '../src/voice/elevenlabs.js';

// Exercise the production coordinator with tiny browser/panel boundaries; the real
// personal adapter still handles the gesture, session, typed input and cleanup.
const coordinator = readFileSync(new URL('../src/voice/index.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gmu, '').replace('export function initializeVoice', 'function initializeVoice');

function harness(t) {
  let handlers, sdkCallbacks, parsed = 0, executions = 0, sdkStarts = 0, ended = 0;
  const sent = [], transcripts = [], statuses = [], starts = [], muted = [], mount = {};
  const panel = { panel: { hidden: true }, visible(value) { this.panel.hidden = !value; },
    addTranscript(text, source) { transcripts.push({ text, source }); }, setStatus(value) { statuses.push(value); },
    setMuted(value) { muted.push(value); }, setAudioLevel() {}, setActivity() {}, setProposal() {}, setAgentAvailability() {}, setNative() {}, setLocalReady() {}, destroy() {} };
  const confirmation = { sessionEpoch: 1, invalidate() { this.sessionEpoch++; }, subscribe() { return () => {}; }, getState() { return null; }, destroy() {} };
  const microphone = () => ({ active: false, start(event) { starts.push(event); this.active = true; }, stop() { this.active = false; }, invalidate() {}, destroy() { this.active = false; } });
  const doc = new EventTarget(); doc.querySelector = selector => selector === '#voice-mount' ? mount : {};
  const win = new EventTarget();
  const context = {
    document: doc, window: win, AbortController, setInterval, clearInterval, setTimeout, queueMicrotask,
    fetch: async url => Response.json(url === '/api/voice/status' ? { configured: true } : { ready: true }),
    createVoiceRegistry: () => ({ mode: 'direct', confirm: confirmation, exportRegistry: () => [{ name: 'read_city', title: 'Ciudad' }],
      runTool() { executions++; return { ok: true, code: 'EXECUTED', speak: 'Hecho.' }; } }),
    parseSpanishCommand: () => { parsed++; return { name: 'read_city', input: {} }; },
    mountVoicePanel: options => { handlers = options; return panel; }, createBrowserSpeech: microphone, createLocalSpeech: microphone,
    registerNativeTools: async () => ({ destroy() {} }),
    createPersonalAgent: options => createPersonalAgent({ ...options,
      fetcher: async url => Response.json(url === '/api/voice/status' ? { configured: true } : url === '/api/session' ? { csrf: 'test' } : url === '/api/voice/token' ? { conversationToken: 'test', leaseId: 'lease', dynamicVariables: {} } : { ok: true }),
      sdkLoader: async () => ({ Conversation: { async startSession(callbacks) { sdkStarts++; sdkCallbacks = callbacks; callbacks.onConnect(); return { sendUserMessage(text) { sent.push(text); }, setMicMuted(value) { muted.push(value); }, async endSession() { ended++; } }; } } }) })
  };
  vm.createContext(context); vm.runInContext(coordinator, context);
  const voice = context.initializeVoice({ worldGeneration: 1, announce() {} }); t.after(() => voice.destroy());
  return { voice, panel, sent, transcripts, statuses, starts, muted, get handlers() { return handlers; }, get callbacks() { return sdkCallbacks; }, get parsed() { return parsed; }, get executions() { return executions; }, get sdkStarts() { return sdkStarts; }, get ended() { return ended; } };
}

test('launcher starts on the original trusted gesture; a repeated launcher only hides/reopens the active call', async t => {
  const h = harness(t);
  assert.equal((await h.voice.toggle({ isTrusted: false })).code, 'GESTURE_REQUIRED'); assert.equal(h.sdkStarts, 0);
  assert.equal((await h.voice.toggle({ isTrusted: true })).code, 'CONNECTED'); assert.equal(h.panel.panel.hidden, false);
  h.voice.toggle({ isTrusted: true }); assert.equal(h.panel.panel.hidden, true);
  h.voice.toggle({ isTrusted: true }); assert.equal(h.panel.panel.hidden, false);
  assert.equal(h.sdkStarts, 1); assert.equal(h.ended, 0);
  h.voice.close(); assert.equal(h.panel.panel.hidden, true); assert.equal(h.ended, 1);
});

test('public launcher opens controls without attempting the private paid conversation', async t => {
  const h = harness(t);
  h.voice.status.elevenlabs = { configured: false, code: 'PERSONAL_VOICE_PRIVATE' };
  assert.equal((await h.voice.toggle({ isTrusted: true })).code, 'VOICE_PANEL_OPEN');
  assert.equal(h.panel.panel.hidden, false);
  assert.equal(h.sdkStarts, 0);
  h.handlers.onCommand('estado', { source: 'typed' });
  assert.equal(h.executions, 1);
  const event = { isTrusted: true }; h.handlers.onMic(event, 'es-MX', 'browser');
  assert.equal(h.starts.at(-1), event);
});

test('call form talks to the conversation and executes tools once; disconnected form keeps the local fallback', async t => {
  const h = harness(t);
  h.handlers.onCommand('estado', { source: 'typed' }); assert.equal(h.parsed, 1); assert.equal(h.executions, 1);
  await h.voice.toggle({ isTrusted: true });
  const before = h.transcripts.length;
  assert.equal(h.handlers.onCommand('manda a Luna a madera', { source: 'typed' }).code, 'MESSAGE_SENT');
  assert.deepEqual(h.sent, ['manda a Luna a madera']); assert.equal(h.parsed, 1); assert.equal(h.executions, 1);
  h.callbacks.onMessage({ source: 'user', message: 'manda a Luna a madera' }); assert.equal(h.transcripts.length, before + 1);
  await h.callbacks.clientTools.read_city({}); assert.equal(h.executions, 2);
  await h.handlers.onMute(true); assert.equal(h.muted.at(-1), true);
  h.handlers.onEnd('closed'); h.handlers.onCommand('estado', { source: 'typed' });
  assert.equal(h.parsed, 2); assert.equal(h.executions, 3);
  const event = { isTrusted: true }; h.handlers.onMic(event, 'es-MX', 'local'); assert.equal(h.starts.at(-1), event);
});

test('text sent while connecting is retained as an error instead of running a local command', async t => {
  const h = harness(t);
  const opening = h.voice.toggle({ isTrusted: true });
  const response = h.handlers.onCommand('entrena cinco', { source: 'typed' });
  assert.equal(response.code, 'CALL_NOT_ACTIVE'); assert.equal(h.parsed, 0); assert.equal(h.executions, 0); assert.deepEqual(h.sent, []);
  await opening;
});

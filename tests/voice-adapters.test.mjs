import test from 'node:test';
import assert from 'node:assert/strict';
import { registerNativeTools } from '../src/voice/webmcp.js';
import { createBrowserSpeech } from '../src/voice/speech.js';
import { createPersonalAgent } from '../src/voice/elevenlabs.js';
const tools = [{ name: 'read_city', title: 'Ciudad', description: 'Lee la ciudad.', inputSchema: { type: 'object', description: 'Entrada', properties: {} }, annotations: { readOnlyHint: true } }];

test('WebMCP adapter awaits async registration, records exact failure and aborts all registrations', async () => {
  const seen = []; let signal;
  const model = { async registerTool(tool, options) { await Promise.resolve(); seen.push(tool.name); signal = options.signal; if (tool.name === 'bad') throw new DOMException('Invalid schema: missing property', 'DataError'); }, async getTools() { return seen; } };
  const adapter = await registerNativeTools({ document: { modelContext: model }, navigator: {}, tools: [...tools, { ...tools[0], name: 'bad' }], runTool: () => ({ ok: true }) });
  assert.deepEqual(adapter.status.registered, ['read_city']); assert.equal(adapter.status.failures[0].name, 'bad'); assert.equal(adapter.status.failures[0].error, 'DataError'); assert.equal(adapter.status.provenance, 'unverified-implementation'); assert.equal(adapter.status.state, 'registration-failed'); adapter.destroy(); assert.equal(signal.aborted, true);
});
test('WebMCP unsupported does not create a document shim or claim native', async () => {
  const doc = {}; const adapter = await registerNativeTools({ document: doc, navigator: {}, tools, runTool() {} }); assert.equal(adapter.status.state, 'unavailable'); assert.equal(Object.hasOwn(doc, 'modelContext'), false);
});
test('WebMCP mock execution calls shared door and checks AbortSignal', async () => {
  let execute; let called = 0;
  const adapter = await registerNativeTools({ document: { modelContext: { async registerTool(tool) { execute = tool.execute; } } }, navigator: {}, tools, runTool(name, input, context) { called++; assert.equal(name, 'read_city'); assert.deepEqual(input, {}); assert.equal(context.source, 'native-webmcp'); return { ok: true }; } });
  assert.equal(adapter.status.state, 'adapter-registered-unverified'); assert.equal((await execute({})).ok, true); const controller = new AbortController(); controller.abort(); assert.equal((await execute({}, { signal: controller.signal })).code, 'ABORTED'); assert.equal(called, 1); adapter.destroy();
});
class FakeRecognition { static latest; constructor() { FakeRecognition.latest = this; } start() { this.onstart?.(); } abort() { this.aborted = true; } }
test('browser speech requires click, uses es-MX, deduplicates final results, cleans stop listeners', () => {
  const transcripts = []; const statuses = [];
  const speech = createBrowserSpeech({ recognitionClass: FakeRecognition, onTranscript: (text) => transcripts.push(text), onStatus: (state) => statuses.push(state) });
  assert.equal(speech.start({ isTrusted: false }), false); assert.equal(speech.start({ isTrusted: true }), true); const recognition = FakeRecognition.latest; assert.equal(recognition.lang, 'es-MX');
  const results = [Object.assign([{ transcript: 'Luna recoge madera' }], { isFinal: true })]; recognition.onresult({ resultIndex: 0, results }); recognition.onresult({ resultIndex: 0, results }); assert.deepEqual(transcripts, ['Luna recoge madera']); speech.stop(); assert.equal(recognition.aborted, true); assert.equal(recognition.onresult, null); assert.equal(speech.active, false); assert.equal(statuses.at(-1).state, 'stopped');
});
test('mic denial is visible and never auto-restarts; old callbacks cannot submit commands', () => {
  const statuses = []; const speech = createBrowserSpeech({ recognitionClass: FakeRecognition, onTranscript() { assert.fail('Late callback'); }, onStatus: (s) => statuses.push(s) });
  speech.start({ isTrusted: true }); const recognition = FakeRecognition.latest; const oldResult = recognition.onresult; recognition.onerror({ error: 'not-allowed' }); oldResult({ resultIndex: 0, results: [Object.assign([{ transcript: 'ataquen' }], { isFinal: true })] }); assert.equal(speech.active, false); assert.equal(statuses.at(-1).state, 'denied'); assert.match(statuses.at(-1).message, /denegado/u); assert.equal(recognition.onend, null);
});
test('missing personal agent blocks before SDK import or token request', async () => {
  const statuses = []; let loaded = false; let invalidated = 0;
  const agent = createPersonalAgent({ tools, runTool() {}, confirm: { invalidate() { invalidated++; } }, onStatus: (s) => statuses.push(s), onTranscript() {}, sdkLoader: async () => { loaded = true; }, fetcher: async (url) => { assert.equal(url, '/api/voice/status'); return Response.json({ configured: false, code: 'PERSONAL_AGENT_NOT_CONFIGURED' }); } });
  const result = await agent.start({ isTrusted: true }); assert.equal(result.code, 'PERSONAL_AGENT_NOT_CONFIGURED'); assert.equal(loaded, false); assert.equal(invalidated, 0); assert.equal(statuses.at(-1).state, 'blocked');
});
test('ending an inactive personal agent cannot invalidate another microphone mode or emit a call status', async () => {
  let invalidations=0;const statuses=[];
  const agent=createPersonalAgent({tools,runTool(){},confirm:{invalidate(){invalidations++;}},onStatus:state=>statuses.push(state),onTranscript(){}});
  await agent.end('mode-changed');assert.equal(invalidations,0);assert.deepEqual(statuses,[]);
});
test('a stale failed personal connection cannot override a newer local session', async () => {
  let resolveStatus,invalidations=0;const statuses=[];
  const agent=createPersonalAgent({tools,runTool(){},confirm:{invalidate(){invalidations++;}},onStatus:state=>statuses.push(state),onTranscript(){},fetcher:()=>new Promise(resolve=>resolveStatus=resolve)});
  const start=agent.start({isTrusted:true});await agent.end('mode-changed');const count=statuses.length;
  resolveStatus(Response.json({configured:false,code:'PERSONAL_AGENT_NOT_CONFIGURED'}));const result=await start;
  assert.equal(result.code,'DISCONNECTED');assert.equal(statuses.length,count);assert.equal(invalidations,0);
});
test('personal SDK uses a same-origin official worklet and explains the five-minute cap', async () => {
  const statuses=[];let captured,ended=0;
  const agent=createPersonalAgent({tools,runTool(){},confirm:{invalidate(){}},onStatus:state=>statuses.push(state),onTranscript(){},
    fetcher:async url=>Response.json(url==='/api/voice/status'?{configured:true}:url==='/api/session'?{csrf:'test'}:url==='/api/voice/token'?{conversationToken:'test-token',leaseId:'test-lease',hardCapMs:300000,dynamicVariables:{}}:{ok:true}),
    sdkLoader:async()=>({Conversation:{async startSession(options){captured=options;return {async endSession(){ended++;}};}}})});
  assert.equal((await agent.start({isTrusted:true})).code,'CONNECTED');assert.equal(captured.workletPaths.rawAudioProcessor,'/assets/vendor/elevenlabs-raw-audio-processor.js');await agent.end('hard-cap');assert.equal(ended,1);assert.match(statuses.at(-1).message,/5 minutos/u);
});
test('personal SDK tool callbacks cannot execute after the world/session changes or disconnects', async () => {
  let captured,executions=0,ended=0;const statuses=[],confirmation={sessionEpoch:1,invalidate(){this.sessionEpoch++;}};
  const agent=createPersonalAgent({tools,runTool(){executions++;return {ok:true};},confirm:confirmation,onStatus:value=>statuses.push(value),onTranscript(){},
    fetcher:async url=>Response.json(url==='/api/voice/status'?{configured:true}:url==='/api/session'?{csrf:'test'}:url==='/api/voice/token'?{conversationToken:'test-token',leaseId:'test-lease',dynamicVariables:{}}:{ok:true}),
    sdkLoader:async()=>({Conversation:{async startSession(options){captured=options;return {async endSession(){ended++;}};}}})});
  assert.equal((await agent.start({isTrusted:true})).code,'CONNECTED');
  assert.equal(JSON.parse(await captured.clientTools.read_city({})).ok,true);assert.equal(executions,1);
  confirmation.sessionEpoch++;
  assert.equal(JSON.parse(await captured.clientTools.read_city({})).code,'STALE_SESSION');assert.equal(executions,1);
  assert.equal(ended,1);assert.equal(agent.active,false);assert.match(statuses.at(-1).message,/partida cambió.*Vuelve a llamar/u);
  await agent.end();assert.equal(JSON.parse(await captured.clientTools.read_city({})).code,'STALE_SESSION');assert.equal(executions,1);
});

function personalHarness(t, overrides = {}) {
  const statuses = [], transcripts = [], levels = [], mutes = [], activities = [], sent = [], muteRequests = [], requests = [];
  let captured, ended = 0, executions = 0;
  const instance = { async endSession() { ended++; }, setMicMuted(value) { muteRequests.push(value); }, sendUserMessage(text) { sent.push(text); }, getOutputVolume() { return .42; }, ...overrides.instance };
  const agent = createPersonalAgent({ tools, runTool() { executions++; return { ok: true }; },
    confirm: { sessionEpoch: 1, invalidate() { this.sessionEpoch++; }, getState() { return null; } },
    onStatus: value => statuses.push(value), onTranscript: (text, context) => transcripts.push({ text, source: context.source }),
    onAudioLevel: value => levels.push(value), onMuted: value => mutes.push(value), onActivity: value => activities.push(value),
    fetcher: async url => { requests.push(url); return Response.json(url === '/api/voice/status' ? { configured: true } : url === '/api/session' ? { csrf: 'test' } : url === '/api/voice/token' ? { conversationToken: 'test-token', leaseId: 'test-lease', dynamicVariables: {} } : { ok: true }); },
    sdkLoader: async () => ({ Conversation: { async startSession(options) { captured = options; return instance; } } }), ...overrides.options });
  t.after(() => agent.destroy());
  return { agent, instance, statuses, transcripts, levels, mutes, activities, sent, muteRequests, requests, get callbacks() { return captured; }, get ended() { return ended; }, get executions() { return executions; } };
}

test('personal call sends typed messages only through SDK, suppresses its echo, and allows a later repeat', async t => {
  const h = personalHarness(t);
  assert.equal(h.agent.sendText('Luna ven').code, 'CALL_NOT_ACTIVE');
  await h.agent.start({ isTrusted: true });
  assert.equal(h.agent.sendText(' Luna ven ').code, 'MESSAGE_SENT');
  assert.deepEqual(h.sent, ['Luna ven']); assert.equal(h.executions, 0);
  h.callbacks.onMessage({ source: 'user', message: 'Luna ven', event_id: 1 });
  h.callbacks.onMessage({ source: 'user', message: 'Luna ven', event_id: 1 });
  assert.deepEqual(h.transcripts, [{ text: 'Luna ven', source: 'elevenlabs-user' }]);
  h.callbacks.onMessage({ source: 'ai', message: 'Voy.', event_id: 2 });
  h.callbacks.onMessage({ source: 'user', message: 'Luna ven', event_id: 3 });
  assert.equal(h.transcripts.length, 3);
  h.instance.sendUserMessage = () => { throw new Error('transport failed'); };
  assert.equal(h.agent.sendText('otra orden').code, 'MESSAGE_FAILED'); assert.equal(h.transcripts.length, 3);
});

test('personal mute calls the real SDK and never claims muted after failure or a stale completion', async t => {
  const h = personalHarness(t);
  assert.equal((await h.agent.setMuted(true)).code, 'CALL_NOT_ACTIVE');
  await h.agent.start({ isTrusted: true });
  assert.equal((await h.agent.setMuted(true)).muted, true); assert.equal(h.agent.muted, true);
  assert.equal((await h.agent.setMuted(false)).muted, false); assert.deepEqual(h.muteRequests, [true, false]);
  h.instance.setMicMuted = () => { throw new Error('device failed'); };
  assert.equal((await h.agent.setMuted(true)).code, 'MIC_MUTE_FAILED'); assert.equal(h.agent.muted, false);
  let finishMute; h.instance.setMicMuted = () => new Promise(resolve => { finishMute = resolve; });
  const changing = h.agent.setMuted(true); await h.agent.end(); finishMute();
  assert.equal((await changing).code, 'DISCONNECTED'); assert.equal(h.agent.muted, false);
});

test('personal call reports actual output, interruption, reconnecting and one tool activity, then silences stale callbacks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const h = personalHarness(t); await h.agent.start({ isTrusted: true });
  assert.equal((await h.agent.start({ isTrusted: true })).code, 'ALREADY_CONNECTED'); assert.equal(h.ended, 0);
  t.mock.timers.tick(100); assert.equal(h.levels.at(-1), .42);
  h.callbacks.onModeChange({ mode: 'speaking' }); h.callbacks.onInterruption();
  assert.equal(h.statuses.at(-1).state, 'listening'); assert.equal(h.levels.at(-1), 0);
  h.callbacks.onStatusChange({ status: 'reconnecting' }); assert.equal(h.statuses.at(-1).state, 'reconnecting');
  assert.equal(JSON.parse(await h.callbacks.clientTools.read_city({})).ok, true);
  assert.equal(h.executions, 1); assert.equal(h.activities.at(-1), 'Ciudad');
  t.mock.timers.tick(1500); assert.equal(h.activities.at(-1), '');
  const old = h.callbacks; await h.agent.end();
  const counts = [h.statuses.length, h.levels.length, h.activities.length, h.transcripts.length];
  old.onConnect(); old.onModeChange({ mode: 'speaking' }); old.onInterruption(); old.onStatusChange({ status: 'reconnecting' }); old.onMessage({ source: 'user', message: 'Late' });
  assert.equal(JSON.parse(await old.clientTools.read_city({})).code, 'STALE_SESSION');
  t.mock.timers.tick(400_000);
  assert.deepEqual([h.statuses.length, h.levels.length, h.activities.length, h.transcripts.length], counts);
  assert.equal(h.ended, 1); assert.equal(h.requests.filter(url => url === '/api/voice/release').length, 1);
});

test('ending a connecting SDK session releases its grant once and discards the late session', async t => {
  let resolveSession, capture;
  const h = personalHarness(t, { options: { sdkLoader: async () => ({ Conversation: { startSession(options) { capture = options; return new Promise(resolve => { resolveSession = resolve; }); } } }) } });
  const starting = h.agent.start({ isTrusted: true });
  while (!resolveSession) await new Promise(resolve => setImmediate(resolve));
  await h.agent.end(); const count = h.statuses.length;
  resolveSession(h.instance); assert.equal((await starting).code, 'DISCONNECTED');
  capture.onConnect(); assert.equal(h.statuses.length, count);
  assert.equal(h.ended, 1); assert.equal(h.requests.filter(url => url === '/api/voice/release').length, 1);
});
